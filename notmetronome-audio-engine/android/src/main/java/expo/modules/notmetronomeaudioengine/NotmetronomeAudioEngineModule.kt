package expo.modules.notmetronomeaudioengine

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Process
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.PI
import kotlin.math.sin

private typealias EngineStatus = String

private data class EngineParams(
  val bpm: Double,
  val meterN: Int,
  val meterD: Int,
  val groups: List<Int> = emptyList(),
  val subdiv: Int = 1,                  // 1..8 (cuántos golpes entran en un beat/tick base)
  val subdivMask: BooleanArray = booleanArrayOf(true), // length === subdiv
  val sampleRate: Int = 48000,
  val applyAt: String = "now" // "now" | "bar"
)

class NotmetronomeAudioEngineModule : Module() {
  private val running = AtomicBoolean(false)
  private val statusRef = AtomicReference<EngineStatus>("idle")

  private var audioTrack: AudioTrack? = null
  private var thread: Thread? = null

  // Active params (read by audio thread)
  @Volatile private var bpm: Double = 120.0
  @Volatile private var meterN: Int = 4
  @Volatile private var meterD: Int = 4
  @Volatile private var groups: IntArray = intArrayOf()
  @Volatile private var sampleRate: Int = 48000

  // Subdivisions (native)
  @Volatile private var subdiv: Int = 1
  @Volatile private var subdivMask: BooleanArray = booleanArrayOf(true)

  // Pending update applied at next bar (optional)
  private val pendingParams = AtomicReference<EngineParams?>(null)

  override fun definition() = ModuleDefinition {
    Name("NotmetronomeAudioEngine")

    // JS events
    Events("onTick", "onState")

    // Simple health check
    AsyncFunction("ping") {
      "pong"
    }

    AsyncFunction("getStatus") {
      statusRef.get()
    }

    AsyncFunction("start") { params: Map<String, Any?> ->
      val p = parseStartParams(params)

      if (running.get()) {
        // Already running: queue update at bar boundary for deterministic timing
        pendingParams.set(p.copy(applyAt = "bar"))
        emitState("running", "already running; params queued (applyAt=bar)")
        return@AsyncFunction null
      }

      statusRef.set("starting")
      emitState("starting")

      applyParamsNow(p)

      // Create AudioTrack + start thread
      val track = createAudioTrackOrThrow(sampleRate)
      audioTrack = track

      running.set(true)
      statusRef.set("running")
      emitState("running")

      track.play()

      val t = Thread {
        runAudioLoop(track)
      }.apply {
        name = "NotMetronomeAudioEngine"
        priority = Thread.MAX_PRIORITY
        isDaemon = true
      }

      thread = t
      t.start()

      null
    }

    AsyncFunction("stop") {
      if (!running.get()) {
        statusRef.set("idle")
        emitState("idle", "already stopped")
        return@AsyncFunction null
      }

      statusRef.set("stopping")
      emitState("stopping")

      running.set(false)

      try {
        thread?.join(1200)
      } catch (_: Throwable) {
        // ignore
      } finally {
        thread = null
      }

      try {
        audioTrack?.pause()
        audioTrack?.flush()
        audioTrack?.stop()
      } catch (_: Throwable) {
        // ignore
      } finally {
        try { audioTrack?.release() } catch (_: Throwable) {}
        audioTrack = null
      }

      pendingParams.set(null)
      statusRef.set("idle")
      emitState("idle")

      null
    }

    AsyncFunction("update") { params: Map<String, Any?> ->
      val update = parseUpdateParams(params)

      if (!running.get()) {
        // Not running -> just apply immediately so next start uses it
        applyParamsNow(update.copy(applyAt = "now"))
        emitState("idle", "updated while idle")
        return@AsyncFunction null
      }

      // Running -> always apply at bar boundary for perfect, deterministic bar alignment
      pendingParams.set(update.copy(applyAt = "bar"))
      emitState("running", "update queued (applyAt=bar)")

      null
    }
  }

  // ---------- Audio loop (native timing) ----------

  private fun runAudioLoop(track: AudioTrack) {
    // Try to give this thread audio priority
    try { Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO) } catch (_: Throwable) {}

    val sr = sampleRate
    val channelCount = 1
    val framesPerBuffer = 256
    val buffer = ShortArray(framesPerBuffer * channelCount)

    var phase = 0.0
    var totalFramesWritten = 0L

    // Tick scheduling in samples (fractional-safe)
    var samplesUntilTick = 0.0
    var tickIndex = 0L

    // First tick immediately
    samplesUntilTick = 0.0

    // Sub-click scheduling within the current tick
    var subIndex = 0
    var samplesUntilSub = 0.0

    // Click burst state
    var burstRemaining = 0
    var burstFreqHz = 1000.0
    var burstAmp = 0.6

    // Precompute group starts per bar
    var groupStarts = computeGroupStarts(meterN, groups)

    while (running.get()) {
      // Apply queued update at bar boundary if needed
      val barTick = (tickIndex % meterN).toInt()
      if (barTick == 0) {
        val pending = pendingParams.getAndSet(null)
        if (pending != null) {
          applyParamsNow(pending.copy(applyAt = "now"))
          groupStarts = computeGroupStarts(meterN, groups)

          // Hard bar alignment: start the new bar cleanly
          tickIndex = 0L
          samplesUntilTick = 0.0

          // Reset sub state (new params)
          subIndex = 0
          samplesUntilSub = 0.0
        }
      }

      // Read current params (volatile -> local snapshot)
      val curBpm = bpm
      val curMeterN = meterN
      val curMeterD = meterD
      val curSubdiv = clampInt(subdiv, 1, 8)
      val curMask = normalizeSubdivMask(curSubdiv, subdivMask)

      val secondsPerTick = (60.0 / curBpm) * (4.0 / curMeterD.toDouble())
      val samplesPerTick = secondsPerTick * sr.toDouble()
      val samplesPerSub = samplesPerTick / curSubdiv.toDouble()

      for (i in 0 until framesPerBuffer) {
        // Base tick trigger?
        if (samplesUntilTick <= 0.0) {
          val bt = (tickIndex % curMeterN).toInt()
          val isDownbeat = bt == 0
          val isGroupStart = groupStarts.getOrElse(bt) { false }

          // Emit event once per base tick (no spam for sub-clicks)
          val atMs = ((totalFramesWritten.toDouble() / sr.toDouble()) * 1000.0)
          emitTick(tickIndex, bt, isDownbeat, atMs)

          // Start sub-cycle for this tick (subIndex = 0 happens "now")
          subIndex = 0
          samplesUntilSub = 0.0

          // Schedule next tick
          tickIndex += 1
          samplesUntilTick += samplesPerTick

          // Store accent state for subIndex==0 in the burst trigger below via local vars
          // (we compute freq/amp when sub-click actually fires)
        }

        // Sub-click trigger inside this tick
        if (curSubdiv > 1) {
          if (samplesUntilSub <= 0.0 && subIndex < curSubdiv) {
            if (curMask.getOrElse(subIndex) { true }) {
              // Determine musical accent for subIndex 0, otherwise weaker sub-click
              val btForAccent = ((tickIndex - 1) % curMeterN).toInt().coerceAtLeast(0)
              val isDownbeat = btForAccent == 0
              val isGroupStart = groupStarts.getOrElse(btForAccent) { false }

              val (freq, amp) = if (subIndex == 0) {
                when {
                  isDownbeat -> 1800.0 to 0.95
                  isGroupStart -> 1200.0 to 0.70
                  else -> 800.0 to 0.45
                }
              } else {
                650.0 to 0.28
              }

              burstFreqHz = freq
              burstAmp = amp
              burstRemaining = (sr * 0.010).toInt().coerceAtLeast(1) // 10ms click burst
            }

            subIndex += 1
            samplesUntilSub += samplesPerSub
          }
        } else {
          // subdiv == 1: just fire a single click per base tick at tick boundary.
          // We do it when samplesUntilTick just got reset by checking if we're effectively at start of tick:
          // To keep it simple and deterministic, reuse sub mechanism even for subdiv==1.
          // (subIndex logic already handled in tick trigger)
          if (subIndex == 0 && samplesUntilSub <= 0.0) {
            // This means we just entered a new tick cycle
            val btForAccent = ((tickIndex - 1) % curMeterN).toInt().coerceAtLeast(0)
            val isDownbeat = btForAccent == 0
            val isGroupStart = groupStarts.getOrElse(btForAccent) { false }

            val (freq, amp) = when {
              isDownbeat -> 1800.0 to 0.95
              isGroupStart -> 1200.0 to 0.70
              else -> 800.0 to 0.45
            }

            burstFreqHz = freq
            burstAmp = amp
            burstRemaining = (sr * 0.010).toInt().coerceAtLeast(1)

            subIndex = 1 // mark done for this tick
            samplesUntilSub = 1e9 // disable until next tick
          }
        }

        // Generate sample
        var sample = 0.0

        if (burstRemaining > 0) {
          val totalBurst = (sr * 0.010)
          val remaining = burstRemaining.toDouble()
          val decay = (remaining / totalBurst).coerceIn(0.0, 1.0) // 1..0
          val env = decay * decay
          sample += sin(phase) * (burstAmp * env)
          burstRemaining -= 1
        }

        phase += (2.0 * PI * burstFreqHz) / sr.toDouble()
        if (phase > 2.0 * PI) phase -= 2.0 * PI

        // soft clip
        if (sample > 1.0) sample = 1.0
        if (sample < -1.0) sample = -1.0

        buffer[i] = (sample * 32767.0).toInt().toShort()

        samplesUntilTick -= 1.0
        samplesUntilSub -= 1.0
        totalFramesWritten += 1
      }

      // Write to AudioTrack (blocking write = steady stream)
      val written = track.write(buffer, 0, buffer.size)
      if (written <= 0) {
        statusRef.set("error")
        emitState("error", "AudioTrack write failed: $written")
        running.set(false)
      }
    }

    // Stop track in loop end
    try {
      track.pause()
      track.flush()
      track.stop()
    } catch (_: Throwable) {
      // ignore
    }
  }

  private fun computeGroupStarts(meterN: Int, groups: IntArray): BooleanArray {
    val n = meterN.coerceAtLeast(1)
    val starts = BooleanArray(n) { false }
    starts[0] = true

    // Normalize groups to avoid invalid states / races:
    // - remove non-positive
    // - truncate if it would overflow bar
    // - pad with remainder if short
    val cleaned = groups.filter { it > 0 }.toMutableList()
    if (cleaned.isEmpty()) cleaned.add(n)

    val normalized = mutableListOf<Int>()
    var acc = 0
    for (g in cleaned) {
      if (acc >= n) break
      val take = g.coerceAtMost(n - acc)
      if (take > 0) {
        normalized.add(take)
        acc += take
      }
    }
    if (acc < n) normalized.add(n - acc)

    var pos = 0
    for (g in normalized) {
      pos += g
      // IMPORTANT: do not mark the bar boundary (pos == n), only in-bar indices 0..n-1
      if (pos in 0 until n) {
        starts[pos] = true
      }
    }

    return starts
  }

  // ---------- Params + helpers ----------

  private fun parseStartParams(map: Map<String, Any?>): EngineParams {
    val bpm = (map["bpm"] as? Number)?.toDouble() ?: 120.0
    val meterN = (map["meterN"] as? Number)?.toInt() ?: 4
    val meterD = (map["meterD"] as? Number)?.toInt() ?: 4
    val sr = (map["sampleRate"] as? Number)?.toInt() ?: 48000

    val groupsAny = map["groups"]
    val groups = when (groupsAny) {
      is List<*> -> groupsAny.mapNotNull { (it as? Number)?.toInt() }
      else -> emptyList()
    }

    val subdivAny = map["subdiv"]
    val subdiv = (subdivAny as? Number)?.toInt() ?: 1

    val maskAny = map["subdivMask"]
    val subdivMask = parseSubdivMask(subdiv, maskAny)

    val applyAt = (map["applyAt"] as? String)?.lowercase() ?: "now"

    return EngineParams(
      bpm = bpm.coerceIn(30.0, 300.0),
      meterN = meterN.coerceIn(1, 64),
      meterD = meterD.coerceIn(1, 64),
      groups = groups,
      subdiv = clampInt(subdiv, 1, 8),
      subdivMask = subdivMask,
      sampleRate = sr,
      applyAt = applyAt
    )
  }

  private fun parseUpdateParams(map: Map<String, Any?>): EngineParams {
    val bpmNew = (map["bpm"] as? Number)?.toDouble() ?: bpm
    val meterNNew = (map["meterN"] as? Number)?.toInt() ?: meterN
    val meterDNew = (map["meterD"] as? Number)?.toInt() ?: meterD
    val srNew = (map["sampleRate"] as? Number)?.toInt() ?: sampleRate

    val groupsAny = map["groups"]
    val groupsNew = when (groupsAny) {
      null -> groups.toList()
      is List<*> -> groupsAny.mapNotNull { (it as? Number)?.toInt() }
      else -> groups.toList()
    }

    val subdivNew = ((map["subdiv"] as? Number)?.toInt()) ?: subdiv
    val maskAny = map["subdivMask"]
    val maskNew = if (map.containsKey("subdivMask")) {
      parseSubdivMask(subdivNew, maskAny)
    } else {
      normalizeSubdivMask(subdivNew, subdivMask)
    }

    val applyAt = (map["applyAt"] as? String)?.lowercase() ?: "now"

    return EngineParams(
      bpm = bpmNew.coerceIn(30.0, 300.0),
      meterN = meterNNew.coerceIn(1, 64),
      meterD = meterDNew.coerceIn(1, 64),
      groups = groupsNew,
      subdiv = clampInt(subdivNew, 1, 8),
      subdivMask = maskNew,
      sampleRate = srNew,
      applyAt = applyAt
    )
  }

  private fun applyParamsNow(p: EngineParams) {
    bpm = p.bpm
    meterN = p.meterN
    meterD = p.meterD
    groups = p.groups.toIntArray()
    sampleRate = p.sampleRate
    subdiv = clampInt(p.subdiv, 1, 8)
    subdivMask = normalizeSubdivMask(subdiv, p.subdivMask)
  }

  private fun createAudioTrackOrThrow(sampleRate: Int): AudioTrack {
    val sr = if (sampleRate > 0) sampleRate else 48000

    val channelMask = AudioFormat.CHANNEL_OUT_MONO
    val encoding = AudioFormat.ENCODING_PCM_16BIT

    val minBuf = AudioTrack.getMinBufferSize(sr, channelMask, encoding)
    if (minBuf <= 0) {
      throw IllegalStateException("AudioTrack.getMinBufferSize failed: $minBuf")
    }

    val bufferSize = (minBuf * 4).coerceAtLeast(sr / 10 * 2) // ~100ms-ish

    val attrs = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_MEDIA)
      .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
      .build()

    val format = AudioFormat.Builder()
      .setEncoding(encoding)
      .setSampleRate(sr)
      .setChannelMask(channelMask)
      .build()

    return AudioTrack(
      attrs,
      format,
      bufferSize,
      AudioTrack.MODE_STREAM,
      AudioManager.AUDIO_SESSION_ID_GENERATE
    )
  }

  private fun emitState(status: String, message: String? = null) {
    try {
      val payload = if (message != null) {
        mapOf("status" to status, "message" to message)
      } else {
        mapOf("status" to status)
      }
      sendEvent("onState", payload)
    } catch (_: Throwable) {
      // ignore
    }
  }

  private fun emitTick(tickIndex: Long, barTick: Int, isDownbeat: Boolean, atAudioTimeMs: Double) {
    try {
      sendEvent(
        "onTick",
        mapOf(
          "tickIndex" to tickIndex,
          "barTick" to barTick,
          "isDownbeat" to isDownbeat,
          "atAudioTimeMs" to atAudioTimeMs
        )
      )
    } catch (_: Throwable) {
      // ignore
    }
  }

  // ---------- Subdiv helpers ----------

  private fun clampInt(v: Int, min: Int, max: Int): Int {
    if (v < min) return min
    if (v > max) return max
    return v
  }

  private fun normalizeSubdivMask(subdiv: Int, mask: BooleanArray?): BooleanArray {
    val n = clampInt(subdiv, 1, 8)
    if (mask == null || mask.isEmpty()) {
      return BooleanArray(n) { true }
    }
    if (mask.size == n) return mask
    val out = BooleanArray(n) { true }
    val take = minOf(n, mask.size)
    for (i in 0 until take) out[i] = mask[i]
    return out
  }

  private fun parseSubdivMask(subdiv: Int, any: Any?): BooleanArray {
    val n = clampInt(subdiv, 1, 8)
    if (any == null) return BooleanArray(n) { true }

    if (any is List<*>) {
      val bools = BooleanArray(n) { true }
      for (i in 0 until n) {
        val v = any.getOrNull(i)
        bools[i] = when (v) {
          is Boolean -> v
          is Number -> v.toInt() != 0
          else -> true
        }
      }
      return bools
    }

    // Unknown type -> default "all on"
    return BooleanArray(n) { true }
  }
}
