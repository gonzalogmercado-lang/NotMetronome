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

  // Legacy (global)
  val subdiv: Int = 1,                  // 1..8
  val subdivMask: BooleanArray = booleanArrayOf(true), // length === subdiv

  // NEW (per-beat)
  val pulseSubdivs: List<Int>? = null,            // length === meterN
  val pulseSubdivMasks: List<List<Boolean>>? = null, // length === meterN, each mask length === pulseSubdivs[i]

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

  // Legacy global subdivisions (native)
  @Volatile private var subdiv: Int = 1
  @Volatile private var subdivMask: BooleanArray = booleanArrayOf(true)

  // NEW: per-beat subdivisions (native)
  // If present and length == meterN, overrides legacy subdiv/subdivMask per beat.
  @Volatile private var pulseSubdivs: IntArray? = null
  @Volatile private var pulseSubdivMasks: Array<BooleanArray>? = null

  // Pending update applied at next tick (applyAt="now") OR next bar downbeat (applyAt="bar")
  private val pendingParams = AtomicReference<EngineParams?>(null)

  override fun definition() = ModuleDefinition {
    Name("NotmetronomeAudioEngine")

    Events("onTick", "onState")

    AsyncFunction("ping") { "pong" }

    AsyncFunction("getStatus") { statusRef.get() }

    AsyncFunction("start") { params: Map<String, Any?> ->
      val p = parseStartParams(params)

      if (running.get()) {
        // Respect applyAt (default "now" if provided, else "bar" is fine too)
        val applyAt = p.applyAt.lowercase()
        val safe = if (applyAt == "now") p.copy(applyAt = "now") else p.copy(applyAt = "bar")
        pendingParams.set(safe)
        emitState("running", "already running; params queued (applyAt=${safe.applyAt})")
        return@AsyncFunction null
      }

      statusRef.set("starting")
      emitState("starting")

      applyParamsNow(p.copy(applyAt = "now"))

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
      val applyAt = update.applyAt.lowercase()
      val safe = if (applyAt == "now") update.copy(applyAt = "now") else update.copy(applyAt = "bar")

      if (!running.get()) {
        applyParamsNow(safe.copy(applyAt = "now"))
        emitState("idle", "updated while idle")
        return@AsyncFunction null
      }

      // Apply on audio thread at the correct boundary
      pendingParams.set(safe)
      emitState("running", "update queued (applyAt=${safe.applyAt})")

      null
    }
  }

  // ---------- Audio loop (native timing) ----------

  private fun runAudioLoop(track: AudioTrack) {
    try { Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO) } catch (_: Throwable) {}

    val sr = sampleRate
    val channelCount = 1
    val framesPerBuffer = 256
    val buffer = ShortArray(framesPerBuffer * channelCount)

    var phase = 0.0
    var totalFramesWritten = 0L

    // Base tick scheduling
    var samplesUntilTick = 0.0
    var samplesPerTick = 1.0
    samplesUntilTick = 0.0 // first tick immediately

    // Absolute tick count (for UI/debug)
    var tickIndex = 0L

    // Bar-local beat index (THIS is what defines barTick/downbeat)
    var barBeatIndex = 0

    // Sub-click scheduling inside the current beat
    var subIndex = 0
    var samplesUntilSub = 0.0
    var currentBeatSubdiv = 1
    var currentBeatMask: BooleanArray = booleanArrayOf(true)
    var currentBeatBarTickForSub = 0

    // Click burst state
    var burstRemaining = 0
    var burstFreqHz = 1000.0
    var burstAmp = 0.6

    var groupStarts = computeGroupStarts(meterN, groups)

    // Initialize tick size
    run {
      val curBpm = bpm
      val curMeterD = meterD.coerceAtLeast(1)
      val secondsPerTick = (60.0 / curBpm) * (4.0 / curMeterD.toDouble())
      samplesPerTick = secondsPerTick * sr.toDouble()
    }

    while (running.get()) {
      for (i in 0 until framesPerBuffer) {

        // Base beat trigger?
        if (samplesUntilTick <= 0.0) {

          // Apply pending at the correct boundary:
          // - applyAt="now": apply on next beat immediately
          // - applyAt="bar": apply only on downbeat (barBeatIndex == 0)
          val pending = pendingParams.get()
          if (pending != null) {
            val applyAt = pending.applyAt.lowercase()
            val shouldApply = (applyAt == "now") || (applyAt == "bar" && barBeatIndex == 0)
            if (shouldApply) {
              pendingParams.set(null)
              applyParamsNow(pending.copy(applyAt = "now"))
              groupStarts = computeGroupStarts(meterN, groups)

              // If meter changed and current bar index is out of range, re-sync safely
              val n = meterN.coerceAtLeast(1)
              if (applyAt == "bar") {
                barBeatIndex = 0
              } else {
                if (barBeatIndex !in 0 until n) barBeatIndex = 0
              }

              // Reset sub-cycle for cleanliness
              subIndex = 0
              samplesUntilSub = 0.0
              currentBeatSubdiv = 1
              currentBeatMask = booleanArrayOf(true)
            }
          }

          // Volatile snapshots (for this beat)
          val curBpm = bpm
          val curMeterN = meterN.coerceAtLeast(1)
          val curMeterD = meterD.coerceAtLeast(1)

          // Recompute tick size (BPM / denominator changes)
          val secondsPerTick = (60.0 / curBpm) * (4.0 / curMeterD.toDouble())
          samplesPerTick = secondsPerTick * sr.toDouble()

          // Clamp barBeatIndex defensively if meterN changed
          if (barBeatIndex !in 0 until curMeterN) barBeatIndex = 0

          val bt = barBeatIndex
          val isDownbeat = bt == 0

          val atMs = ((totalFramesWritten.toDouble() / sr.toDouble()) * 1000.0)
          emitTick(tickIndex, bt, isDownbeat, atMs)

          // Decide per-beat subdiv/mask (NEW if present, else legacy global)
          val curLegacySubdiv = clampInt(subdiv, 1, 8)
          val curLegacyMask = normalizeSubdivMask(curLegacySubdiv, subdivMask)

          val curPulseSubdivs = pulseSubdivs
          val curPulseMasks = pulseSubdivMasks

          val beatSubdiv = if (curPulseSubdivs != null && curPulseSubdivs.size == curMeterN) {
            clampInt(curPulseSubdivs[bt], 1, 8)
          } else {
            curLegacySubdiv
          }

          val beatMask = if (
            curPulseSubdivs != null &&
            curPulseMasks != null &&
            curPulseSubdivs.size == curMeterN &&
            curPulseMasks.size == curMeterN
          ) {
            normalizeSubdivMask(beatSubdiv, curPulseMasks[bt])
          } else {
            curLegacyMask
          }

          currentBeatSubdiv = beatSubdiv
          currentBeatMask = beatMask
          currentBeatBarTickForSub = bt

          // Start sub-cycle for this beat
          subIndex = 0
          samplesUntilSub = 0.0

          // Advance counters
          tickIndex += 1
          barBeatIndex += 1
          if (barBeatIndex >= curMeterN) barBeatIndex = 0

          // Schedule next beat
          samplesUntilTick += samplesPerTick
        }

        // Sub-click trigger inside this beat (works for subdiv==1 too)
        val beatSubdiv = currentBeatSubdiv
        val beatMask = currentBeatMask
        val samplesPerSub = samplesPerTick / beatSubdiv.toDouble()

        if (samplesUntilSub <= 0.0 && subIndex < beatSubdiv) {
          if (beatMask.getOrElse(subIndex) { true }) {
            val btForAccent = currentBeatBarTickForSub
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
            burstRemaining = (sr * 0.010).toInt().coerceAtLeast(1) // 10ms burst
          }

          subIndex += 1
          samplesUntilSub += samplesPerSub
        }

        // Generate sample
        var sample = 0.0

        if (burstRemaining > 0) {
          val totalBurst = (sr * 0.010)
          val remaining = burstRemaining.toDouble()
          val decay = (remaining / totalBurst).coerceIn(0.0, 1.0)
          val env = decay * decay
          sample += sin(phase) * (burstAmp * env)
          burstRemaining -= 1
        }

        phase += (2.0 * PI * burstFreqHz) / sr.toDouble()
        if (phase > 2.0 * PI) phase -= 2.0 * PI

        if (sample > 1.0) sample = 1.0
        if (sample < -1.0) sample = -1.0

        buffer[i] = (sample * 32767.0).toInt().toShort()

        samplesUntilTick -= 1.0
        samplesUntilSub -= 1.0
        totalFramesWritten += 1
      }

      val written = track.write(buffer, 0, buffer.size)
      if (written <= 0) {
        statusRef.set("error")
        emitState("error", "AudioTrack write failed: $written")
        running.set(false)
      }
    }

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
      if (pos in 0 until n) starts[pos] = true
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

    // NEW
    val pulseSubdivs = parsePulseSubdivs(map["pulseSubdivs"])
    val pulseSubdivMasks = parsePulseSubdivMasks(map["pulseSubdivMasks"])

    val applyAt = (map["applyAt"] as? String)?.lowercase() ?: "now"

    return EngineParams(
      bpm = bpm.coerceIn(30.0, 300.0),
      meterN = meterN.coerceIn(1, 64),
      meterD = meterD.coerceIn(1, 64),
      groups = groups,
      subdiv = clampInt(subdiv, 1, 8),
      subdivMask = subdivMask,

      pulseSubdivs = pulseSubdivs,
      pulseSubdivMasks = pulseSubdivMasks,

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

    val maskNew = if (map.containsKey("subdivMask")) {
      parseSubdivMask(subdivNew, map["subdivMask"])
    } else {
      normalizeSubdivMask(subdivNew, subdivMask)
    }

    // NEW: only update if keys are present, else keep current
    val pulseSubdivsNew =
      if (map.containsKey("pulseSubdivs")) parsePulseSubdivs(map["pulseSubdivs"]) else pulseSubdivs?.toList()
    val pulseSubdivMasksNew =
      if (map.containsKey("pulseSubdivMasks")) parsePulseSubdivMasks(map["pulseSubdivMasks"]) else pulseSubdivMasks?.map { it.toList() }

    val applyAt = (map["applyAt"] as? String)?.lowercase() ?: "now"

    return EngineParams(
      bpm = bpmNew.coerceIn(30.0, 300.0),
      meterN = meterNNew.coerceIn(1, 64),
      meterD = meterDNew.coerceIn(1, 64),
      groups = groupsNew,
      subdiv = clampInt(subdivNew, 1, 8),
      subdivMask = maskNew,

      pulseSubdivs = pulseSubdivsNew,
      pulseSubdivMasks = pulseSubdivMasksNew,

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

    // NEW: normalize per-beat arrays only if they match meterN
    val ps = normalizePulseSubdivs(meterN, p.pulseSubdivs)
    val pm = normalizePulseMasks(meterN, ps, p.pulseSubdivMasks)

    pulseSubdivs = ps
    pulseSubdivMasks = pm
  }

  private fun createAudioTrackOrThrow(sampleRate: Int): AudioTrack {
    val sr = if (sampleRate > 0) sampleRate else 48000

    val channelMask = AudioFormat.CHANNEL_OUT_MONO
    val encoding = AudioFormat.ENCODING_PCM_16BIT

    val minBuf = AudioTrack.getMinBufferSize(sr, channelMask, encoding)
    if (minBuf <= 0) {
      throw IllegalStateException("AudioTrack.getMinBufferSize failed: $minBuf")
    }

    val bufferSize = (minBuf * 4).coerceAtLeast(sr / 10 * 2)

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
      val payload = if (message != null) mapOf("status" to status, "message" to message) else mapOf("status" to status)
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

  // ---------- Helpers ----------

  private fun clampInt(v: Int, min: Int, max: Int): Int {
    if (v < min) return min
    if (v > max) return max
    return v
  }

  // Normalize a mask to length n, and ensure at least one "true"
  private fun normalizeSubdivMask(subdiv: Int, mask: BooleanArray?): BooleanArray {
    val n = clampInt(subdiv, 1, 8)
    if (mask == null || mask.isEmpty()) return BooleanArray(n) { true }
    if (mask.size == n) {
      val any = mask.any { it }
      return if (any) mask else BooleanArray(n) { i -> i == 0 }
    }
    val out = BooleanArray(n) { true }
    val take = minOf(n, mask.size)
    for (i in 0 until take) out[i] = mask[i]
    if (!out.any { it }) out[0] = true
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
      if (!bools.any { it }) bools[0] = true
      return bools
    }

    return BooleanArray(n) { true }
  }

  // ---------- NEW: pulse subdiv parsing/normalization ----------

  private fun parsePulseSubdivs(any: Any?): List<Int>? {
    val list = any as? List<*> ?: return null
    val out = list.mapNotNull { (it as? Number)?.toInt() }
    if (out.isEmpty()) return null
    return out
  }

  private fun parsePulseSubdivMasks(any: Any?): List<List<Boolean>>? {
    val outer = any as? List<*> ?: return null
    val out = mutableListOf<List<Boolean>>()
    for (i in outer.indices) {
      val inner = outer[i] as? List<*>
      if (inner == null) {
        out.add(emptyList())
        continue
      }
      val mask = inner.map { v ->
        when (v) {
          is Boolean -> v
          is Number -> v.toInt() != 0
          else -> true
        }
      }
      out.add(mask)
    }
    if (out.isEmpty()) return null
    return out
  }

  private fun normalizePulseSubdivs(meterN: Int, pulse: List<Int>?): IntArray? {
    if (pulse == null) return null
    val n = meterN.coerceAtLeast(1)
    if (pulse.isEmpty()) return null

    val out = IntArray(n)
    val last = pulse[pulse.size - 1]
    for (i in 0 until n) {
      val v = if (i < pulse.size) pulse[i] else last
      out[i] = clampInt(v, 1, 8)
    }
    return out
  }

  private fun normalizePulseMasks(meterN: Int, pulseSubdivs: IntArray?, masks: List<List<Boolean>>?): Array<BooleanArray>? {
    if (pulseSubdivs == null) return null
    val n = meterN.coerceAtLeast(1)
    val out = Array(n) { i ->
      val subdiv = clampInt(pulseSubdivs[i], 1, 8)
      val raw = masks?.getOrNull(i)?.toBooleanArray()
      normalizeSubdivMask(subdiv, raw)
    }
    return out
  }
}
