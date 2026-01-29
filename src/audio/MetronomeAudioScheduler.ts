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

  // NEW per-beat subdivisions (web supports; native may support)
  pulseSubdivs?: number[];
  pulseSubdivMasks?: boolean[][];

  // NEW: multi-bar timeline loop
  bars?: BarConfig[];
  startBarIndex?: number;
  loop?: boolean;

  // Beat guide: forces beat-down subtick to be audible even if edited off
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

  // UI playhead info
  subIndex?: number; // 0..subCount-1
  subCount?: number; // current beat subdiv
  isAudible?: boolean; // derived from mask (+ beat guide)
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

// Subdiv limits
const MAX_SUBDIV_NATIVE = 8; // keep native-safe today
const MAX_SUBDIV_WEB = 16; // web + UI/store support

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

function normalizeSubdivMask(subdiv: number, mask?: boolean[], maxSubdiv = MAX_SUBDIV_WEB) {
  const n = clampInt(subdiv, 1, maxSubdiv);
  // allow full silence (all false) on web path; beatGuide can override
  return Array.from({ length: n }).map((_, i) => mask?.[i] ?? true);
}

function applyBeatGuideToMask(mask: boolean[], enabled: boolean) {
  if (!enabled) return mask;
  const out = mask.slice();
  out[0] = true;
  return out;
}

function applyBeatGuideToPulseMasks(pulseMasks: boolean[][], enabled: boolean) {
  if (!enabled) return pulseMasks;
  return pulseMasks.map((m) => applyBeatGuideToMask(m, true));
}

function normalizePulseSubdivs(meterN: number, pulseSubdivs?: number[], maxSubdiv = MAX_SUBDIV_WEB) {
  const n = Math.max(1, meterN);
  if (!pulseSubdivs || pulseSubdivs.length === 0) return undefined;
  const out = Array.from({ length: n }).map((_, i) =>
    clampInt(pulseSubdivs[i] ?? pulseSubdivs[pulseSubdivs.length - 1] ?? 1, 1, maxSubdiv)
  );
  return out;
}

function normalizePulseMasks(
  meterN: number,
  pulseSubdivs: number[],
  pulseMasks?: boolean[][],
  maxSubdiv = MAX_SUBDIV_WEB
) {
  const n = Math.max(1, meterN);
  const out: boolean[][] = [];
  for (let i = 0; i < n; i++) {
    const subdiv = clampInt(pulseSubdivs[i] ?? 1, 1, maxSubdiv);
    const mask = pulseMasks?.[i];
    out.push(normalizeSubdivMask(subdiv, mask, maxSubdiv));
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

// ---- Clave helpers (beat-mode vs pool-mode) ----

function normalizeClaveGroups(groups: number[] | undefined, meterN: number, poolTicks?: number): number[] | undefined {
  if (!groups || groups.length === 0) return undefined;

  const safe: number[] = [];
  let total = 0;

  for (let i = 0; i < groups.length; i += 1) {
    const raw = Math.floor(Number(groups[i]));
    if (!Number.isFinite(raw)) return undefined;

    // Rule: no "morse": 2..8 only
    if (raw < 2 || raw > 8) return undefined;

    safe.push(raw);
    total += raw;
  }

  if (total === meterN) return safe; // beat-mode
  if (typeof poolTicks === "number" && poolTicks > 0 && total === poolTicks) return safe; // pool-mode

  return undefined;
}

function computePoolTicks(meterN: number, pulseSubdivs?: number[], legacySubdiv = 1, maxSubdiv = MAX_SUBDIV_WEB) {
  if (pulseSubdivs && pulseSubdivs.length === meterN) {
    return sum(pulseSubdivs.map((v) => clampInt(v ?? 1, 1, maxSubdiv)));
  }
  return meterN * clampInt(legacySubdiv ?? 1, 1, maxSubdiv);
}

function normalizeBars(bars: BarConfig[]): BarConfig[] {
  return (bars ?? [])
    .map((b) => {
      const meter = normalizeMeter(b.meter);

      // Per-beat subdiv only makes sense for denominator 4 (as per current UX rule)
      let pulseSubdivs: number[] | undefined = undefined;
      let pulseSubdivMasks: boolean[][] | undefined = undefined;

      if (meter.d === 4) {
        const ps = normalizePulseSubdivs(meter.n, b.pulseSubdivs, MAX_SUBDIV_WEB);
        if (ps) {
          pulseSubdivs = ps;
          pulseSubdivMasks = normalizePulseMasks(meter.n, ps, b.pulseSubdivMasks, MAX_SUBDIV_WEB);
        }
      }

      const poolTicks = meter.d === 4 ? computePoolTicks(meter.n, pulseSubdivs, 1, MAX_SUBDIV_WEB) : undefined;
      const groups = normalizeClaveGroups(b.groups, meter.n, poolTicks);

      return { meter, groups, pulseSubdivs, pulseSubdivMasks };
    })
    .filter((b) => b.meter && b.meter.n >= 1 && b.meter.d >= 1);
}

// ---------- Fingerprint helpers (for "BPM-only" fast-path safety) ----------

const keyNums = (arr?: number[]) => (arr && arr.length ? arr.join(",") : "");
const keyBools = (arr?: boolean[]) => (arr && arr.length ? arr.map((v) => (v ? "1" : "0")).join("") : "");
const keyMasks = (m?: boolean[][]) => (m && m.length ? m.map((row) => keyBools(row)).join("|") : "");

// =====================================================

class MetronomeAudioScheduler {
  // Native
  private native: NativeEngineModule | null = null;
  private nativeTickSub: { remove: () => void } | null = null;
  private nativeStateSub: { remove: () => void } | null = null;

  // Native UI synthesis (when native only reports 1 tick per beat)
  private nativePrevBeatKey: string | null = null;
  private nativeSeesSubticks = false; // per-beat detection
  private nativeSubIndex = 0;
  private nativeUiTimers: ReturnType<typeof setTimeout>[] = [];
  private nativePendingSynthKey: string | null = null;

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
  private subdiv = 1; // 1..16 (web); clamped to 8 when sent to native
  private subdivMask: boolean[] = [true];

  // Per-beat (web uses; native may use)
  private pulseSubdivs?: number[];
  private pulseSubdivMasks?: boolean[][];

  // Beat guide
  private beatGuideEnabled = false;

  // Accent model (beat vs pool)
  private accentMode: "beat" | "pool" = "beat";
  private accentLevelsBeat: AccentLevel[] = deriveAccentPerTick(this.meter, undefined);
  private accentLevelsPool: AccentLevel[] = [];
  private poolTicksPerBar = 0;

  // What we send to native (native only understands beat-mode groups today)
  private nativeGroups?: number[];

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

  // Unified bar-change dedupe
  private lastNotifiedBarIndex: number | null = null;

  private isRunning = false;
  private events: SchedulerEvents;

  // Timeline fingerprint (EXCLUDES bpm). Used to decide if a native "bpm-only" update is safe.
  private timelineSig = "";

  constructor(events: SchedulerEvents = {}) {
    this.events = events;
    this.native = getNativeEngine();
    this.recomputeAccentModel(MAX_SUBDIV_WEB);
    this.timelineSig = this.computeTimelineSigFromCurrent();
  }

  private notifyBarChange(barIndex: number) {
    if (!this.events.onBarChange) return;
    if (this.lastNotifiedBarIndex === barIndex) return;
    this.lastNotifiedBarIndex = barIndex;
    this.events.onBarChange(barIndex);
  }

  private computeTimelineSigFromCurrent(): string {
    const parts: string[] = [];

    parts.push(`seq:${this.sequenceEnabled ? "1" : "0"}`);
    parts.push(`loop:${this.loop ? "1" : "0"}`);
    parts.push(`bg:${this.beatGuideEnabled ? "1" : "0"}`);
    parts.push(`legacy:${this.subdiv}|${keyBools(this.subdivMask)}`);

    if (this.sequenceEnabled && this.bars && this.bars.length > 0) {
      const b = this.bars
        .map((bar) => {
          const m = `${bar.meter.n}/${bar.meter.d}`;
          const g = keyNums(bar.groups);
          const ps = keyNums(bar.pulseSubdivs);
          const pm = keyMasks(bar.pulseSubdivMasks);
          return `${m}#g:${g}#ps:${ps}#pm:${pm}`;
        })
        .join("||");
      parts.push(`bars:${b}`);
    } else {
      parts.push(`m:${this.meter.n}/${this.meter.d}`);
      parts.push(`g:${keyNums(this.groups)}`);
      parts.push(`ps:${keyNums(this.pulseSubdivs)}`);
      parts.push(`pm:${keyMasks(this.pulseSubdivMasks)}`);
    }

    return parts.join("|");
  }

  private secondsPerTickForMeter(m: Meter) {
    return (60 / this.bpm) * (4 / m.d);
  }

  private get scheduleAheadSeconds() {
    return SCHEDULE_AHEAD_MS / 1000;
  }

  private clearNativeUiTimers() {
    this.nativeUiTimers.forEach((t) => clearTimeout(t));
    this.nativeUiTimers = [];
    this.nativePendingSynthKey = null;
  }

  private computeBeatSubdivAndMask(barTick: number, maxSubdiv: number) {
    const safeBarTick = clampInt(barTick ?? 0, 0, Math.max(0, this.meter.n - 1));

    const beatSubdiv =
      this.pulseSubdivs && this.pulseSubdivs.length === this.meter.n
        ? clampInt(this.pulseSubdivs[safeBarTick] ?? 1, 1, maxSubdiv)
        : clampInt(this.subdiv ?? 1, 1, maxSubdiv);

    const beatMaskRaw =
      this.pulseSubdivs && this.pulseSubdivs.length === this.meter.n
        ? normalizeSubdivMask(beatSubdiv, this.pulseSubdivMasks?.[safeBarTick], maxSubdiv)
        : normalizeSubdivMask(beatSubdiv, this.subdivMask, maxSubdiv);

    const beatMask = applyBeatGuideToMask(beatMaskRaw, this.beatGuideEnabled);

    return { beatSubdiv, beatMask };
  }

  private computePoolStartForBeat(barTick: number, maxSubdiv: number) {
    const n = clampInt(barTick ?? 0, 0, Math.max(0, this.meter.n));
    let cursor = 0;

    for (let i = 0; i < n; i += 1) {
      const s =
        this.pulseSubdivs && this.pulseSubdivs.length === this.meter.n
          ? clampInt(this.pulseSubdivs[i] ?? 1, 1, maxSubdiv)
          : clampInt(this.subdiv ?? 1, 1, maxSubdiv);
      cursor += s;
    }

    return cursor;
  }

  private getAccentForSubTick(barTick: number, subIndex: number, maxSubdiv: number): AccentLevel {
    if (this.accentMode !== "pool") {
      return subIndex === 0 ? (this.accentLevelsBeat[barTick] ?? "WEAK") : "WEAK";
    }

    const start = this.computePoolStartForBeat(barTick, maxSubdiv);
    const idx = start + clampInt(subIndex ?? 0, 0, 99999);
    return this.accentLevelsPool[idx] ?? "WEAK";
  }

  private recomputeAccentModel(maxSubdiv: number) {
    this.poolTicksPerBar = computePoolTicks(this.meter.n, this.pulseSubdivs, this.subdiv, maxSubdiv);

    const gsum = this.groups && this.groups.length ? sum(this.groups) : 0;

    if (this.groups && this.groups.length > 0 && gsum === this.poolTicksPerBar && this.poolTicksPerBar > 0) {
      // pool-mode: accents over full subtick pool
      this.accentMode = "pool";
      this.accentLevelsPool = deriveAccentPerTick(this.meter, this.groups, { ticksPerBar: this.poolTicksPerBar });
      this.accentLevelsBeat = deriveAccentPerTick(this.meter, undefined);
      this.nativeGroups = undefined; // don't lie to native engine
      return;
    }

    // beat-mode (default)
    this.accentMode = "beat";
    this.accentLevelsPool = [];
    this.accentLevelsBeat = deriveAccentPerTick(this.meter, this.groups);
    this.nativeGroups = this.groups; // native understands beat-mode groups
  }

  setAccentGains(map: Partial<AccentGainMap>) {
    this.accentGains = { ...this.accentGains, ...map };
  }

  async start(options: StartOptions): Promise<boolean> {
    if (this.isRunning) return true;

    this.setFromOptions(options, "start");

    // reset native UI synthesis state
    this.nativePrevBeatKey = null;
    this.nativeSeesSubticks = false;
    this.nativeSubIndex = 0;
    this.clearNativeUiTimers();

    // reset bar notify
    this.lastNotifiedBarIndex = null;
    this.lastBarNotifyTickIndex = -1;

    if (this.native) {
      try {
        this.attachNativeListenersIfNeeded();
        this.isRunning = true;

        const hasPulse = !!(this.pulseSubdivs && this.pulseSubdivs.length === this.meter.n);

        const legacySubdiv = clampInt(this.subdiv ?? 1, 1, MAX_SUBDIV_NATIVE);
        const legacyMaskRaw = normalizeSubdivMask(legacySubdiv, this.subdivMask, MAX_SUBDIV_NATIVE);
        const legacyMask = applyBeatGuideToMask(legacyMaskRaw, this.beatGuideEnabled);

        let pulseSubdivsNative: number[] | undefined = undefined;
        let pulseSubdivMasksNative: boolean[][] | undefined = undefined;

        if (hasPulse) {
          pulseSubdivsNative = (this.pulseSubdivs ?? []).map((v) => clampInt(v ?? 1, 1, MAX_SUBDIV_NATIVE));

          pulseSubdivMasksNative = applyBeatGuideToPulseMasks(
            normalizePulseMasks(this.meter.n, pulseSubdivsNative, this.pulseSubdivMasks, MAX_SUBDIV_NATIVE),
            this.beatGuideEnabled
          );
        }

        await this.native.start({
          bpm: this.bpm,
          meterN: this.meter.n,
          meterD: this.meter.d,
          groups: this.nativeGroups,

          ...(hasPulse ? { pulseSubdivs: pulseSubdivsNative, pulseSubdivMasks: pulseSubdivMasksNative } : {}),

          subdiv: legacySubdiv,
          subdivMask: legacyMask,
        });

        this.events.onStateChange?.("ready");

        // Immediately notify starting bar (native path otherwise waits for boundary logic)
        if (this.sequenceEnabled) {
          this.notifyBarChange(this.barIndex);
        }

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

    // Immediate notify for web too
    if (this.sequenceEnabled) {
      this.notifyBarChange(this.barIndex);
    }

    this.scheduleWindow();
    this.timerId = setInterval(() => this.scheduleWindow(), LOOKAHEAD_MS);

    return true;
  }

  async stop() {
    this.clearNativeUiTimers();

    // reset bar notify
    this.lastNotifiedBarIndex = null;
    this.lastBarNotifyTickIndex = -1;

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
    const prevTimelineSig = this.timelineSig;

    this.setFromOptions(options, "update");
    const nextTimelineSig = this.timelineSig;

    if (this.native) {
      const applyAt = options.applyAt ?? "now";
      try {
        // If we have a queued bar swap AND the update is "now":
        // - If ONLY bpm changed (timelineSig unchanged), keep the queued swap and update bpm only.
        // - If timeline changed, we MUST overwrite native pending update (avoid phantom bars) and cancel the queued swap.
        if (this.sequenceEnabled && this.pendingBarIndex !== null && applyAt === "now") {
          const timelineUnchanged = prevTimelineSig === nextTimelineSig;
          if (timelineUnchanged) {
            await this.native.update({ bpm: this.bpm, applyAt: "now" });
            return;
          }
          // timeline changed -> cancel queued bar swap on our side
          this.pendingBarIndex = null;
        }

        const hasPulse = !!(this.pulseSubdivs && this.pulseSubdivs.length === this.meter.n);

        const legacySubdiv = clampInt(this.subdiv ?? 1, 1, MAX_SUBDIV_NATIVE);
        const legacyMaskRaw = normalizeSubdivMask(legacySubdiv, this.subdivMask, MAX_SUBDIV_NATIVE);
        const legacyMask = applyBeatGuideToMask(legacyMaskRaw, this.beatGuideEnabled);

        let pulseSubdivsNative: number[] | undefined = undefined;
        let pulseSubdivMasksNative: boolean[][] | undefined = undefined;

        if (hasPulse) {
          pulseSubdivsNative = (this.pulseSubdivs ?? []).map((v) => clampInt(v ?? 1, 1, MAX_SUBDIV_NATIVE));

          pulseSubdivMasksNative = applyBeatGuideToPulseMasks(
            normalizePulseMasks(this.meter.n, pulseSubdivsNative, this.pulseSubdivMasks, MAX_SUBDIV_NATIVE),
            this.beatGuideEnabled
          );
        }

        await this.native.update({
          bpm: this.bpm,
          meterN: this.meter.n,
          meterD: this.meter.d,
          groups: this.nativeGroups,
          applyAt,

          ...(hasPulse ? { pulseSubdivs: pulseSubdivsNative, pulseSubdivMasks: pulseSubdivMasksNative } : {}),

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
    } else {
      this.beatGuideEnabled = !!options.beatGuide;
    }

    // Keep legacy subdiv always; allow web up to 16, clamp to 8 only when sending to native.
    const nextSubdiv = clampInt(options.subdiv ?? 1, 1, MAX_SUBDIV_WEB);
    this.subdiv = nextSubdiv;
    this.subdivMask = normalizeSubdivMask(nextSubdiv, options.subdivMask, MAX_SUBDIV_WEB);

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
        this.barIndex = clampInt(this.barIndex, 0, bars.length - 1);
      }

      this.applyActiveBar(this.barIndex, { resetBarTick: mode === "start" });
      this.recomputeAccentModel(MAX_SUBDIV_WEB);
      this.timelineSig = this.computeTimelineSigFromCurrent();
      return;
    }

    // Single-bar mode
    this.sequenceEnabled = false;
    this.bars = undefined;
    this.loop = true;
    this.pendingBarIndex = null;

    this.meter = normalizeMeter(options.meter);

    const ps = normalizePulseSubdivs(this.meter.n, options.pulseSubdivs, MAX_SUBDIV_WEB);
    if (ps && this.meter.d === 4) {
      this.pulseSubdivs = ps;
      this.pulseSubdivMasks = normalizePulseMasks(this.meter.n, ps, options.pulseSubdivMasks, MAX_SUBDIV_WEB);
    } else {
      this.pulseSubdivs = undefined;
      this.pulseSubdivMasks = undefined;
    }

    const poolTicks =
      this.meter.d === 4 ? computePoolTicks(this.meter.n, this.pulseSubdivs, this.subdiv, MAX_SUBDIV_WEB) : undefined;
    this.groups = normalizeClaveGroups(options.groups, this.meter.n, poolTicks);

    this.recomputeAccentModel(MAX_SUBDIV_WEB);
    this.timelineSig = this.computeTimelineSigFromCurrent();
  }

  private applyActiveBar(index: number, opts: { resetBarTick: boolean }) {
    if (!this.bars || this.bars.length === 0) return;
    const safeIndex = clampInt(index, 0, this.bars.length - 1);
    this.barIndex = safeIndex;

    const bar = this.bars[safeIndex];
    this.meter = normalizeMeter(bar.meter);

    if (this.meter.d === 4) {
      const ps = normalizePulseSubdivs(this.meter.n, bar.pulseSubdivs, MAX_SUBDIV_WEB);
      if (ps) {
        this.pulseSubdivs = ps;
        this.pulseSubdivMasks = normalizePulseMasks(this.meter.n, ps, bar.pulseSubdivMasks, MAX_SUBDIV_WEB);
      } else {
        this.pulseSubdivs = undefined;
        this.pulseSubdivMasks = undefined;
      }
    } else {
      this.pulseSubdivs = undefined;
      this.pulseSubdivMasks = undefined;
    }

    const poolTicks =
      this.meter.d === 4 ? computePoolTicks(this.meter.n, this.pulseSubdivs, this.subdiv, MAX_SUBDIV_WEB) : undefined;
    this.groups = normalizeClaveGroups(bar.groups, this.meter.n, poolTicks);

    this.recomputeAccentModel(MAX_SUBDIV_WEB);

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
    if (this.pendingBarIndex !== null) return;

    const lastTickOfBar = this.meter.n - 1;
    if (e.barTick !== lastTickOfBar) return;

    const nextIndex = this.getNextBarIndex();
    const nextBar = this.bars[nextIndex];
    const nextMeter = normalizeMeter(nextBar.meter);

    // Keep legacy subdiv stable across bars (do not derive from pulseSubdivs)
    const legacySubdiv = clampInt(this.subdiv ?? 1, 1, MAX_SUBDIV_NATIVE);
    const legacyMaskRaw = normalizeSubdivMask(legacySubdiv, this.subdivMask, MAX_SUBDIV_NATIVE);
    const legacyMask = applyBeatGuideToMask(legacyMaskRaw, this.beatGuideEnabled);

    this.pendingBarIndex = nextIndex;

    const psNative =
      nextBar.pulseSubdivs && nextMeter.d === 4
        ? normalizePulseSubdivs(nextMeter.n, nextBar.pulseSubdivs, MAX_SUBDIV_NATIVE)
        : undefined;

    const pmNative = psNative
      ? applyBeatGuideToPulseMasks(
          normalizePulseMasks(nextMeter.n, psNative, nextBar.pulseSubdivMasks, MAX_SUBDIV_NATIVE),
          this.beatGuideEnabled
        )
      : undefined;

    // Native only: groups must be beat-mode (sum == meter.n)
    const nextGroupsNative = normalizeClaveGroups(nextBar.groups, nextMeter.n, undefined);

    this.native
      .update({
        bpm: this.bpm,
        meterN: nextMeter.n,
        meterD: nextMeter.d,
        groups: nextGroupsNative,
        applyAt: "bar",

        ...(psNative
          ? {
              pulseSubdivs: psNative,
              pulseSubdivMasks: pmNative,
            }
          : {}),

        subdiv: legacySubdiv,
        subdivMask: legacyMask,
      })
      .catch(() => {
        this.pendingBarIndex = null;
      });
  }

  // ---------- Native listeners ----------

  private attachNativeListenersIfNeeded() {
    if (!this.native) return;
    if (this.nativeTickSub && this.nativeStateSub) return;

    this.nativeTickSub = this.native.addListener("onTick", (e) => {
      // Commit bar swap as soon as native starts a new bar (barTick==0).
      if (this.sequenceEnabled && this.pendingBarIndex !== null && e.barTick === 0) {
        this.applyActiveBar(this.pendingBarIndex, { resetBarTick: true });
        this.pendingBarIndex = null;
        this.notifyBarChange(this.barIndex);
      }

      // Queue next bar update (applyAt="bar") near the end of current bar
      this.queueNativeNextBarUpdateIfNeeded(e);

      const { beatSubdiv, beatMask } = this.computeBeatSubdivAndMask(e.barTick, MAX_SUBDIV_NATIVE);
      const secondsPerTick = this.secondsPerTickForMeter(this.meter);
      const subMs = (secondsPerTick * 1000) / Math.max(1, beatSubdiv);

      const currentBarIndex = this.sequenceEnabled ? this.barIndex : undefined;
      const beatKey = `${currentBarIndex ?? -1}:${e.barTick}`;

      const sameBeat = this.nativePrevBeatKey === beatKey;

      if (sameBeat) {
        // Native is emitting subticks (or at least >1 event per beat)
        this.nativeSeesSubticks = true;
        this.clearNativeUiTimers();

        this.nativeSubIndex = (this.nativeSubIndex + 1) % Math.max(1, beatSubdiv);

        const subIndex = this.nativeSubIndex;
        const isAudible = !!beatMask[subIndex];

        const accentLevel = this.getAccentForSubTick(e.barTick, subIndex, MAX_SUBDIV_NATIVE);
        const accentGain = this.accentGains[accentLevel] ?? 1;

        const tick: ScheduledTick = {
          tickIndex: e.tickIndex,
          atMs: e.atAudioTimeMs,
          barTick: e.barTick,
          isDownbeat: e.isDownbeat && subIndex === 0,
          accentGain,
          accentLevel,
          scheduledTime: e.atAudioTimeMs / 1000,
          barIndex: currentBarIndex,

          subIndex,
          subCount: beatSubdiv,
          isAudible,
        };

        this.events.onTick?.(tick);
      } else {
        // New beat boundary
        this.nativePrevBeatKey = beatKey;
        this.nativeSubIndex = 0;

        // Reset per-beat subtick detection
        this.nativeSeesSubticks = false;

        const isAudible0 = !!beatMask[0];
        const accentLevel0 = this.getAccentForSubTick(e.barTick, 0, MAX_SUBDIV_NATIVE);
        const accentGain0 = this.accentGains[accentLevel0] ?? 1;

        // Emit the boundary tick immediately as subIndex=0
        this.events.onTick?.({
          tickIndex: e.tickIndex,
          atMs: e.atAudioTimeMs,
          barTick: e.barTick,
          isDownbeat: e.isDownbeat,
          accentGain: accentGain0,
          accentLevel: accentLevel0,
          scheduledTime: e.atAudioTimeMs / 1000,
          barIndex: currentBarIndex,
          subIndex: 0,
          subCount: beatSubdiv,
          isAudible: isAudible0,
        });

        // If native does NOT send subticks, synthesize i=1..N-1 for UI
        this.clearNativeUiTimers();

        if (beatSubdiv > 1) {
          this.nativePendingSynthKey = beatKey;

          const checkDelay = Math.max(10, Math.ceil(subMs * 1.05)); // after expected 2nd subtick
          const checkTimer = setTimeout(() => {
            if (!this.isRunning) return;
            if (this.nativeSeesSubticks) return;
            if (this.nativePendingSynthKey !== beatKey) return;
            if (this.nativePrevBeatKey !== beatKey) return;

            for (let i = 1; i < beatSubdiv; i += 1) {
              const delay = Math.max(0, Math.round(i * subMs));
              const t = setTimeout(() => {
                if (!this.isRunning) return;
                if (this.nativePrevBeatKey !== beatKey) return;

                const isAudible = !!beatMask[i];
                const accentLevel = this.getAccentForSubTick(e.barTick, i, MAX_SUBDIV_NATIVE);
                const accentGain = this.accentGains[accentLevel] ?? 1;

                this.events.onTick?.({
                  tickIndex: e.tickIndex * 1000 + i, // UI-only uniqueness
                  atMs: e.atAudioTimeMs + i * subMs,
                  barTick: e.barTick,
                  isDownbeat: false,
                  accentGain,
                  accentLevel,
                  scheduledTime: (e.atAudioTimeMs + i * subMs) / 1000,
                  barIndex: currentBarIndex,
                  subIndex: i,
                  subCount: beatSubdiv,
                  isAudible,
                });
              }, delay);

              this.nativeUiTimers.push(t);
            }
          }, checkDelay);

          this.nativeUiTimers.push(checkTimer);
        }
      }
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

    if (this.barTick !== 0) return;

    if (this.lastBarNotifyTickIndex === this.tickIndex) return;
    this.lastBarNotifyTickIndex = this.tickIndex;

    const delayMs = Math.max(0, (atTime - this.context.currentTime) * 1000);
    setTimeout(() => {
      if (!this.isRunning) return;
      this.notifyBarChange(this.barIndex);
    }, delayMs);
  }

  private scheduleTick(atTime: number): number {
    if (!this.context) return 0.01;

    const secondsPerTick = this.secondsPerTickForMeter(this.meter);
    this.maybeNotifyBarChange(atTime);

    const barTick = this.barTick;
    const { beatSubdiv, beatMask } = this.computeBeatSubdivAndMask(barTick, MAX_SUBDIV_WEB);

    if (beatSubdiv > 1) {
      const secondsPerSub = secondsPerTick / beatSubdiv;

      for (let i = 0; i < beatSubdiv; i++) {
        const t = atTime + i * secondsPerSub;

        const isAudible = !!beatMask[i];
        const level = this.getAccentForSubTick(barTick, i, MAX_SUBDIV_WEB);
        const gain = this.accentGains[level] ?? 1;

        if (isAudible) {
          this.scheduleClick(t, level, gain);
        }

        const tick: ScheduledTick = {
          tickIndex: this.tickIndex,
          atMs: t * 1000,
          barTick,
          isDownbeat: barTick === 0 && i === 0,
          accentGain: gain,
          accentLevel: level,
          scheduledTime: t,
          barIndex: this.sequenceEnabled ? this.barIndex : undefined,
          subIndex: i,
          subCount: beatSubdiv,
          isAudible,
        };

        this.events.onTick?.(tick);
        this.tickIndex += 1;
      }
    } else {
      const isAudible = !!beatMask[0];
      const level = this.getAccentForSubTick(barTick, 0, MAX_SUBDIV_WEB);
      const gain = this.accentGains[level] ?? 1;

      if (isAudible) {
        this.scheduleClick(atTime, level, gain);
      }

      const tick: ScheduledTick = {
        tickIndex: this.tickIndex,
        atMs: atTime * 1000,
        barTick,
        isDownbeat: barTick === 0,
        accentGain: gain,
        accentLevel: level,
        scheduledTime: atTime,
        barIndex: this.sequenceEnabled ? this.barIndex : undefined,
        subIndex: 0,
        subCount: 1,
        isAudible,
      };

      this.events.onTick?.(tick);
      this.tickIndex += 1;
    }

    // advance beat counter
    this.barTick += 1;

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
