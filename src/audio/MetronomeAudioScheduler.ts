import { requireNativeModule } from "expo";
import { Platform } from "react-native";

import { AccentLevel, Meter, TickInfo } from "../core/types";
import { ACCENT_GAIN, deriveAccentPerTick } from "../utils/rhythm/deriveAccentPerTick";

type AccentGainMap = Record<AccentLevel, number>;

export type BarConfig = {
  meter: Meter;
  groups?: number[];
  pulseSubdivs?: number[];
  pulseSubdivMasks?: boolean[][];
};

type StartOptions = {
  bpm: number;

  // Single-bar mode (legacy)
  meter: Meter;
  groups?: number[];

  // Legacy global subdivisions (works for ANY denominator on native engine)
  subdiv?: number;
  subdivMask?: boolean[];

  // NEW per-beat subdivisions (web supports; native currently ignores)
  pulseSubdivs?: number[];
  pulseSubdivMasks?: boolean[][];

  // NEW: multi-bar timeline loop
  bars?: BarConfig[];
  startBarIndex?: number;
  loop?: boolean;

  // NEW: Beat guide (forces beat down-subtick to be audible even if edited off)
  beatGuide?: boolean;
};

type UpdateOptions = StartOptions & {
  applyAt?: "bar" | "now";
};

export type ScheduledTick = TickInfo & {
  accentLevel: AccentLevel;
  accentGain: number;
  scheduledTime: number; // seconds timeline (web) OR approx audio time (native)
  barIndex?: number;
};

type SchedulerEvents = {
  onTick?: (tick: ScheduledTick) => void;
  onStateChange?: (state: "ready" | "suspended" | "error", details?: string) => void;
  onBarChange?: (barIndex: number) => void;
};

type AudioContextLike = AudioContext | BaseAudioContext;

// WebAudio scheduling params
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_MS = 180;
const START_DELAY_MS = 60;
const ENVELOPE_ATTACK_SECONDS = 0.002;
const ENVELOPE_DECAY_SECONDS = 0.016;
const OSCILLATOR_DURATION_SECONDS = 0.03;

const ACCENT_FREQUENCY: Record<AccentLevel, number> = {
  BAR: 1200,
  GROUP: 900,
  WEAK: 700,
};

const ACCENT_PEAK: Record<AccentLevel, number> = {
  BAR: 0.95,
  GROUP: 0.65,
  WEAK: 0.4,
};

// ---------- Native engine (Android) ----------

type NativeEngineTickEvent = {
  tickIndex: number;
  barTick: number;
  isDownbeat: boolean;
  atAudioTimeMs: number; // audio timeline ms
};

type NativeEngineStateEvent = {
  status: "idle" | "starting" | "running" | "stopping" | "error";
  message?: string;
};

type NativeEngineModule = {
  start(params: {
    bpm: number;
    meterN: number;
    meterD: number;
    groups?: number[];
    sampleRate?: number;
    applyAt?: "bar" | "now";

    // legacy (native consumes this today)
    subdiv?: number;
    subdivMask?: boolean[];

    // NEW (native may ignore today)
    pulseSubdivs?: number[];
    pulseSubdivMasks?: boolean[][];
  }): Promise<void>;

  stop(): Promise<void>;

  update(params: {
    bpm?: number;
    meterN?: number;
    meterD?: number;
    groups?: number[];
    sampleRate?: number;
    applyAt?: "bar" | "now";

    subdiv?: number;
    subdivMask?: boolean[];

    pulseSubdivs?: number[];
    pulseSubdivMasks?: boolean[][];
  }): Promise<void>;

  getStatus(): Promise<string>;
  ping(): Promise<string>;

  addListener(eventName: "onTick", listener: (e: NativeEngineTickEvent) => void): { remove: () => void };
  addListener(eventName: "onState", listener: (e: NativeEngineStateEvent) => void): { remove: () => void };
};

let nativeEngineCache: NativeEngineModule | null | undefined;

function getNativeEngine(): NativeEngineModule | null {
  if (Platform.OS !== "android") return null;
  if (nativeEngineCache !== undefined) return nativeEngineCache;

  try {
    const mod = requireNativeModule("NotmetronomeAudioEngine") as unknown as NativeEngineModule;
    nativeEngineCache = mod;
    return mod;
  } catch {
    nativeEngineCache = null;
    return null;
  }
}

// ---------- WebAudio helpers (web only) ----------

async function loadWebAudioContext(): Promise<AudioContextLike | null> {
  if (typeof globalThis.AudioContext !== "undefined") {
    return new AudioContext();
  }
  if (typeof (globalThis as any).webkitAudioContext !== "undefined") {
    return new (globalThis as any).webkitAudioContext();
  }
  return null;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(Number(value))));
}

function normalizeSubdivMask(subdiv: number, mask?: boolean[]) {
  const n = clampInt(subdiv, 1, 8);
  const base = Array.from({ length: n }).map((_, i) => (mask?.[i] ?? true));
  if (!base.some(Boolean)) base[0] = true;
  return base;
}

function applyBeatGuideToMask(mask: boolean[], enabled: boolean) {
  if (!enabled) return mask;
  const out = mask.slice();
  out[0] = true;
  return out;
}

function normalizePulseSubdivs(meterN: number, pulseSubdivs?: number[]) {
  const n = Math.max(1, meterN);
  if (!pulseSubdivs || pulseSubdivs.length === 0) return undefined;
  const out = Array.from({ length: n }).map((_, i) =>
    clampInt(pulseSubdivs[i] ?? pulseSubdivs[pulseSubdivs.length - 1] ?? 1, 1, 8)
  );
  return out;
}

function normalizePulseMasks(meterN: number, pulseSubdivs: number[], pulseMasks?: boolean[][]) {
  const n = Math.max(1, meterN);
  const out: boolean[][] = [];
  for (let i = 0; i < n; i++) {
    const subdiv = clampInt(pulseSubdivs[i] ?? 1, 1, 8);
    const mask = pulseMasks?.[i];
    out.push(normalizeSubdivMask(subdiv, mask));
  }
  return out;
}

function normalizeMeter(m: Meter): Meter {
  return {
    n: clampInt(m?.n ?? 4, 1, 64),
    d: clampInt(m?.d ?? 4, 1, 64),
  };
}

function sum(values: number[]) {
  return values.reduce((t, v) => t + v, 0);
}

function normalizeGroupsForMeter(groups: number[] | undefined, meterN: number) {
  if (!groups || groups.length === 0) return undefined;
  const safe = groups.map((g) => clampInt(g, 1, 64));
  return sum(safe) === meterN ? safe : undefined;
}

function normalizeBars(bars: BarConfig[]): BarConfig[] {
  return (bars ?? [])
    .map((b) => {
      const meter = normalizeMeter(b.meter);
      const groups = normalizeGroupsForMeter(b.groups, meter.n);

      // Per-beat subdiv only makes sense for denominator 4 (as per current UX rule)
      let pulseSubdivs: number[] | undefined = undefined;
      let pulseSubdivMasks: boolean[][] | undefined = undefined;

      if (meter.d === 4) {
        const ps = normalizePulseSubdivs(meter.n, b.pulseSubdivs);
        if (ps) {
          pulseSubdivs = ps;
          pulseSubdivMasks = normalizePulseMasks(meter.n, ps, b.pulseSubdivMasks);
        }
      }

      return { meter, groups, pulseSubdivs, pulseSubdivMasks };
    })
    .filter((b) => b.meter && b.meter.n >= 1 && b.meter.d >= 1);
}

// =====================================================

class MetronomeAudioScheduler {
  // Native
  private native: NativeEngineModule | null = null;
  private nativeTickSub: { remove: () => void } | null = null;
  private nativeStateSub: { remove: () => void } | null = null;

  // WebAudio
  private context: AudioContextLike | null = null;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private scheduledNodes = new Map<OscillatorNode, GainNode>();

  // Shared state
  private bpm = 120;

  // Active bar config (single-bar OR currently playing bar in sequence)
  private meter: Meter = { n: 4, d: 4 };
  private groups?: number[];

  // Global (legacy) subdivisions
  private subdiv = 1; // 1..8
  private subdivMask: boolean[] = [true];

  // Per-beat (web uses; native currently ignores)
  private pulseSubdivs?: number[];
  private pulseSubdivMasks?: boolean[][];

  // Beat guide
  private beatGuideEnabled = false;

  private accentLevels: AccentLevel[] = deriveAccentPerTick(this.meter, this.groups);
  private accentGains: AccentGainMap = ACCENT_GAIN;

  // Web scheduler counters
  private tickIndex = 0;
  private nextTickTime = 0;

  // Sequence (multi-bar)
  private sequenceEnabled = false;
  private bars?: BarConfig[];
  private barIndex = 0; // active bar index in sequence
  private barTick = 0; // 0..meter.n-1 (web only; native gives barTick)
  private loop = true;

  // Native sequencing: queue next bar update to apply at boundary
  private pendingBarIndex: number | null = null;

  // Web UI sync: notify bar changes aligned to audio time
  private lastBarNotifyTickIndex = -1;

  private isRunning = false;
  private events: SchedulerEvents;

  constructor(events: SchedulerEvents = {}) {
    this.events = events;
    this.native = getNativeEngine();
  }

  private secondsPerTickForMeter(m: Meter) {
    return (60 / this.bpm) * (4 / m.d);
  }

  private get scheduleAheadSeconds() {
    return SCHEDULE_AHEAD_MS / 1000;
  }

  setAccentGains(map: Partial<AccentGainMap>) {
    this.accentGains = { ...this.accentGains, ...map };
  }

  async start(options: StartOptions): Promise<boolean> {
    if (this.isRunning) return true;

    this.setFromOptions(options, "start");

    if (this.native) {
      try {
        this.attachNativeListenersIfNeeded();
        this.isRunning = true;

        // IMPORTANT:
        // Native engine currently consumes legacy subdiv/subdivMask.
        // Do NOT "fake" per-beat pulseSubdivs by turning them into a global subdiv,
        // because that changes the native tick semantics and can make 4/4 *feel* like 3/4.
        // Keep legacy subdiv as-is. pulseSubdivs are passed only for future native support.
        const hasPulse = !!(this.pulseSubdivs && this.pulseSubdivs.length === this.meter.n);

        const legacySubdiv = clampInt(this.subdiv ?? 1, 1, 8);
        const legacyMaskRaw = normalizeSubdivMask(legacySubdiv, this.subdivMask);
        const legacyMask = applyBeatGuideToMask(legacyMaskRaw, this.beatGuideEnabled);

        await this.native.start({
          bpm: this.bpm,
          meterN: this.meter.n,
          meterD: this.meter.d,
          groups: this.groups,

          // Future-proof keys (native may ignore today)
          ...(hasPulse ? { pulseSubdivs: this.pulseSubdivs, pulseSubdivMasks: this.pulseSubdivMasks } : {}),

          // Stable / correct bar math path on Android today
          subdiv: legacySubdiv,
          subdivMask: legacyMask,
        });

        this.events.onStateChange?.("ready");
        return true;
      } catch (e: any) {
        this.isRunning = false;
        this.events.onStateChange?.("error", e?.message ?? "Native engine start failed");
        return false;
      }
    }

    // WebAudio fallback
    await this.ensureWebContext();
    if (!this.context) {
      this.events.onStateChange?.("error", "Audio context not available");
      return false;
    }

    this.isRunning = true;
    this.tickIndex = 0;
    this.barTick = 0;

    this.nextTickTime = this.context.currentTime + START_DELAY_MS / 1000;

    this.scheduleWindow();
    this.timerId = setInterval(() => this.scheduleWindow(), LOOKAHEAD_MS);

    return true;
  }

  async stop() {
    if (this.native) {
      try {
        await this.native.stop();
      } catch {
        // ignore
      } finally {
        this.isRunning = false;
        this.pendingBarIndex = null;
        this.events.onStateChange?.("ready");
      }
      return;
    }

    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    this.isRunning = false;
    this.pendingBarIndex = null;
    this.tickIndex = 0;
    this.barTick = 0;
    this.nextTickTime = 0;

    if (this.context) {
      const now = this.context.currentTime;
      this.scheduledNodes.forEach((gain, osc) => {
        try {
          osc.stop(now);
        } catch {
          // ignore
        } finally {
          try {
            osc.disconnect();
          } catch {}
          try {
            gain.disconnect();
          } catch {}
        }
      });
      this.scheduledNodes.clear();
    }
  }

  async update(options: UpdateOptions) {
    this.setFromOptions(options, "update");

    if (this.native) {
      const applyAt = options.applyAt ?? "now";
      try {
        // If we already queued a "next bar" update, don't stomp it every render.
        if (this.sequenceEnabled && this.pendingBarIndex !== null && applyAt === "now") {
          // still allow BPM changes ASAP (safe)
          await this.native.update({ bpm: this.bpm, applyAt: "now" });
          return;
        }

        const hasPulse = !!(this.pulseSubdivs && this.pulseSubdivs.length === this.meter.n);

        // Same rule as start(): do not derive legacy subdiv from pulseSubdivs.
        const legacySubdiv = clampInt(this.subdiv ?? 1, 1, 8);
        const legacyMaskRaw = normalizeSubdivMask(legacySubdiv, this.subdivMask);
        const legacyMask = applyBeatGuideToMask(legacyMaskRaw, this.beatGuideEnabled);

        await this.native.update({
          bpm: this.bpm,
          meterN: this.meter.n,
          meterD: this.meter.d,
          groups: this.groups,
          applyAt,

          ...(hasPulse ? { pulseSubdivs: this.pulseSubdivs, pulseSubdivMasks: this.pulseSubdivMasks } : {}),

          subdiv: legacySubdiv,
          subdivMask: legacyMask,
        });
      } catch {
        // ignore
      }
      return;
    }

    // Web: keep nextTickTime sane if we fall behind
    if (this.isRunning && this.context) {
      if (this.nextTickTime < this.context.currentTime) {
        this.nextTickTime = this.context.currentTime + this.secondsPerTickForMeter(this.meter);
      }
    }
  }

  private setFromOptions(options: StartOptions, mode: "start" | "update") {
    this.bpm = options.bpm;

    if (typeof options.beatGuide === "boolean") {
      this.beatGuideEnabled = options.beatGuide;
    }

    // Keep legacy subdiv ALWAYS (native uses it for any denominator)
    const nextSubdiv = clampInt(options.subdiv ?? 1, 1, 8);
    this.subdiv = nextSubdiv;
    this.subdivMask = normalizeSubdivMask(nextSubdiv, options.subdivMask);

    const bars = options.bars && options.bars.length > 0 ? normalizeBars(options.bars) : undefined;

    if (bars && bars.length > 0) {
      this.sequenceEnabled = true;
      this.bars = bars;
      this.loop = options.loop ?? true;

      if (mode === "start") {
        this.barIndex = clampInt(options.startBarIndex ?? 0, 0, bars.length - 1);
        this.barTick = 0;
        this.pendingBarIndex = null;
      } else {
        // keep current bar index within range if bars count changed
        this.barIndex = clampInt(this.barIndex, 0, bars.length - 1);
      }

      this.applyActiveBar(this.barIndex, { resetBarTick: mode === "start" });
      return;
    }

    // Single-bar mode
    this.sequenceEnabled = false;
    this.bars = undefined;
    this.loop = true;
    this.pendingBarIndex = null;

    this.meter = normalizeMeter(options.meter);
    this.groups = normalizeGroupsForMeter(options.groups, this.meter.n);

    const ps = normalizePulseSubdivs(this.meter.n, options.pulseSubdivs);
    if (ps && this.meter.d === 4) {
      this.pulseSubdivs = ps;
      this.pulseSubdivMasks = normalizePulseMasks(this.meter.n, ps, options.pulseSubdivMasks);
    } else {
      this.pulseSubdivs = undefined;
      this.pulseSubdivMasks = undefined;
    }

    this.accentLevels = deriveAccentPerTick(this.meter, this.groups);
  }

  private applyActiveBar(index: number, opts: { resetBarTick: boolean }) {
    if (!this.bars || this.bars.length === 0) return;
    const safeIndex = clampInt(index, 0, this.bars.length - 1);
    this.barIndex = safeIndex;

    const bar = this.bars[safeIndex];
    this.meter = normalizeMeter(bar.meter);
    this.groups = normalizeGroupsForMeter(bar.groups, this.meter.n);

    // Per-beat subdiv only for denominator 4 (current product rule)
    if (this.meter.d === 4) {
      const ps = normalizePulseSubdivs(this.meter.n, bar.pulseSubdivs);
      if (ps) {
        this.pulseSubdivs = ps;
        this.pulseSubdivMasks = normalizePulseMasks(this.meter.n, ps, bar.pulseSubdivMasks);
      } else {
        this.pulseSubdivs = undefined;
        this.pulseSubdivMasks = undefined;
      }
    } else {
      this.pulseSubdivs = undefined;
      this.pulseSubdivMasks = undefined;
    }

    this.accentLevels = deriveAccentPerTick(this.meter, this.groups);

    if (opts.resetBarTick) {
      this.barTick = 0;
    }
  }

  private getNextBarIndex() {
    if (!this.bars || this.bars.length === 0) return 0;
    const next = this.barIndex + 1;
    if (next < this.bars.length) return next;
    return this.loop ? 0 : this.bars.length - 1;
  }

  private queueNativeNextBarUpdateIfNeeded(e: NativeEngineTickEvent) {
    if (!this.native) return;
    if (!this.sequenceEnabled || !this.bars || this.bars.length <= 1) return;

    // If already queued, wait
    if (this.pendingBarIndex !== null) return;

    // Queue on LAST tick of the bar so applyAt="bar" hits boundary perfectly
    const lastTickOfBar = this.meter.n - 1;
    if (e.barTick !== lastTickOfBar) return;

    const nextIndex = this.getNextBarIndex();
    const nextBar = this.bars[nextIndex];

    const nextMeter = normalizeMeter(nextBar.meter);

    // Keep legacy subdiv stable across bars (do not derive from pulseSubdivs)
    const legacySubdiv = clampInt(this.subdiv ?? 1, 1, 8);
    const legacyMaskRaw = normalizeSubdivMask(legacySubdiv, this.subdivMask);
    const legacyMask = applyBeatGuideToMask(legacyMaskRaw, this.beatGuideEnabled);

    this.pendingBarIndex = nextIndex;

    // Ask native to swap params exactly at next bar boundary
    this.native
      .update({
        bpm: this.bpm,
        meterN: nextMeter.n,
        meterD: nextMeter.d,
        groups: normalizeGroupsForMeter(nextBar.groups, nextMeter.n),
        applyAt: "bar",

        ...(nextBar.pulseSubdivs && nextMeter.d === 4
          ? {
              pulseSubdivs: normalizePulseSubdivs(nextMeter.n, nextBar.pulseSubdivs),
              pulseSubdivMasks: nextBar.pulseSubdivMasks,
            }
          : {}),

        subdiv: legacySubdiv,
        subdivMask: legacyMask,
      })
      .catch(() => {
        // if update fails, drop pending (so we can retry next bar)
        this.pendingBarIndex = null;
      });
  }

  // ---------- Native listeners ----------

  private attachNativeListenersIfNeeded() {
    if (!this.native) return;
    if (this.nativeTickSub && this.nativeStateSub) return;

    this.nativeTickSub = this.native.addListener("onTick", (e) => {
      // If we queued a bar swap, commit it exactly when native hits downbeat of new bar
      if (this.sequenceEnabled && this.pendingBarIndex !== null && e.isDownbeat && e.barTick === 0) {
        this.applyActiveBar(this.pendingBarIndex, { resetBarTick: true });
        this.pendingBarIndex = null;
        this.events.onBarChange?.(this.barIndex);
      }

      // Queue next bar update (applyAt="bar") near the end of current bar
      this.queueNativeNextBarUpdateIfNeeded(e);

      // Accent lookup MUST be by barTick (not tickIndex % meter.n) to survive meter changes
      const accentLevel = this.accentLevels[e.barTick] ?? "WEAK";
      const accentGain = this.accentGains[accentLevel] ?? 1;

      const tick: ScheduledTick = {
        tickIndex: e.tickIndex,
        atMs: e.atAudioTimeMs,
        barTick: e.barTick,
        isDownbeat: e.isDownbeat,
        accentGain,
        accentLevel,
        scheduledTime: e.atAudioTimeMs / 1000,
        barIndex: this.sequenceEnabled ? this.barIndex : undefined,
      };

      this.events.onTick?.(tick);
    });

    this.nativeStateSub = this.native.addListener("onState", (e) => {
      if (e.status === "error") {
        this.events.onStateChange?.("error", e.message ?? "native error");
      } else {
        this.events.onStateChange?.("ready", e.message);
      }
    });
  }

  // ---------- WebAudio ----------

  private async ensureWebContext() {
    if (this.context) {
      if (
        "state" in this.context &&
        (this.context as AudioContext).state === "suspended" &&
        typeof (this.context as AudioContext).resume === "function"
      ) {
        await (this.context as AudioContext).resume();
        this.events.onStateChange?.("ready");
      }
      return;
    }

    this.context = await loadWebAudioContext();
    if (!this.context) {
      this.events.onStateChange?.("error", "No AudioContext available");
      return;
    }

    this.events.onStateChange?.("ready");
  }

  private scheduleWindow() {
    if (!this.context || !this.isRunning) return;

    const now = this.context.currentTime;
    const horizon = now + this.scheduleAheadSeconds;

    while (this.nextTickTime < horizon) {
      const dt = this.scheduleTick(this.nextTickTime);
      this.nextTickTime += dt;
    }
  }

  private maybeNotifyBarChange(atTime: number) {
    if (!this.sequenceEnabled) return;
    if (!this.context) return;
    if (!this.events.onBarChange) return;

    // notify only on downbeat tick scheduling
    if (this.barTick !== 0) return;

    if (this.lastBarNotifyTickIndex === this.tickIndex) return;
    this.lastBarNotifyTickIndex = this.tickIndex;

    const delayMs = Math.max(0, (atTime - this.context.currentTime) * 1000);
    setTimeout(() => {
      if (!this.isRunning) return;
      this.events.onBarChange?.(this.barIndex);
    }, delayMs);
  }

  // Returns seconds per tick for the CURRENT active bar
  private scheduleTick(atTime: number): number {
    if (!this.context) return 0.01;

    const secondsPerTick = this.secondsPerTickForMeter(this.meter);

    // UI sync for sequence mode (aligned to audio time)
    this.maybeNotifyBarChange(atTime);

    const accentLevel = this.accentLevels[this.barTick] ?? "WEAK";
    const accentGain = this.accentGains[accentLevel] ?? 1;

    const barTick = this.barTick;

    const beatSubdiv =
      this.pulseSubdivs && this.pulseSubdivs.length === this.meter.n
        ? clampInt(this.pulseSubdivs[barTick] ?? 1, 1, 8)
        : this.subdiv;

    const beatMaskRaw =
      this.pulseSubdivs && this.pulseSubdivs.length === this.meter.n
        ? normalizeSubdivMask(beatSubdiv, this.pulseSubdivMasks?.[barTick])
        : normalizeSubdivMask(beatSubdiv, this.subdivMask);

    // Beat guide: force the beat-down-subtick to be audible (mask[0] = true)
    const beatMask = applyBeatGuideToMask(beatMaskRaw, this.beatGuideEnabled);

    if (beatSubdiv > 1) {
      const secondsPerSub = secondsPerTick / beatSubdiv;

      for (let i = 0; i < beatSubdiv; i++) {
        if (!beatMask[i]) continue;
        const t = atTime + i * secondsPerSub;
        const level: AccentLevel = i === 0 ? accentLevel : "WEAK";
        const gain = i === 0 ? accentGain : 1;
        this.scheduleClick(t, level, gain);
      }
    } else {
      this.scheduleClick(atTime, accentLevel, accentGain);
    }

    const tick: ScheduledTick = {
      tickIndex: this.tickIndex,
      atMs: atTime * 1000,
      barTick,
      isDownbeat: barTick === 0,
      accentGain,
      accentLevel,
      scheduledTime: atTime,
      barIndex: this.sequenceEnabled ? this.barIndex : undefined,
    };

    this.events.onTick?.(tick);

    // advance counters
    this.tickIndex += 1;
    this.barTick += 1;

    // If bar ended, advance to next bar (sequence) or wrap barTick (single)
    if (this.barTick >= this.meter.n) {
      this.barTick = 0;

      if (this.sequenceEnabled && this.bars && this.bars.length > 0) {
        const next = this.getNextBarIndex();
        this.applyActiveBar(next, { resetBarTick: true });
      }
    }

    return secondsPerTick;
  }

  private scheduleClick(atTime: number, accentLevel: AccentLevel, accentGain: number) {
    if (!this.context) return;

    const osc = this.context.createOscillator();
    const gainNode = this.context.createGain();

    const frequency = ACCENT_FREQUENCY[accentLevel] ?? ACCENT_FREQUENCY.WEAK;
    const basePeak = ACCENT_PEAK[accentLevel] ?? ACCENT_PEAK.WEAK;
    const peak = clamp01(basePeak * accentGain);

    osc.type = "square";
    osc.frequency.setValueAtTime(frequency, atTime);

    gainNode.gain.setValueAtTime(0, atTime);
    gainNode.gain.linearRampToValueAtTime(peak, atTime + ENVELOPE_ATTACK_SECONDS);
    gainNode.gain.linearRampToValueAtTime(0, atTime + ENVELOPE_ATTACK_SECONDS + ENVELOPE_DECAY_SECONDS);

    osc.connect(gainNode);
    gainNode.connect(this.context.destination);
    this.scheduledNodes.set(osc, gainNode);

    osc.start(atTime);
    osc.stop(atTime + OSCILLATOR_DURATION_SECONDS);
    osc.onended = () => {
      try {
        osc.disconnect();
      } catch {}
      try {
        gainNode.disconnect();
      } catch {}
      this.scheduledNodes.delete(osc);
    };
  }

  async playTestBeep() {
    if (this.native) return true;

    await this.ensureWebContext();
    if (!this.context) return false;

    const when = this.context.currentTime + 0.01;
    this.scheduleClick(when, "BAR", 1);
    return true;
  }
}

export default MetronomeAudioScheduler;
