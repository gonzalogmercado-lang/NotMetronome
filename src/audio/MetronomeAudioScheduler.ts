import { requireNativeModule } from "expo";
import { Platform } from "react-native";

import { AccentLevel, Meter, TickInfo } from "../core/types";
import { ACCENT_GAIN, deriveAccentPerTick } from "../utils/rhythm/deriveAccentPerTick";

type AccentGainMap = Record<AccentLevel, number>;

type StartOptions = {
  bpm: number;
  meter: Meter;
  groups?: number[];

  // Legacy global subdivisions (works for ANY denominator on native engine)
  subdiv?: number;
  subdivMask?: boolean[];

  // NEW per-beat subdivisions (web supports; native currently ignores)
  pulseSubdivs?: number[];
  pulseSubdivMasks?: boolean[][];
};

type UpdateOptions = StartOptions & {
  applyAt?: "bar" | "now";
};

export type ScheduledTick = TickInfo & {
  accentLevel: AccentLevel;
  accentGain: number;
  scheduledTime: number; // seconds timeline
};

type SchedulerEvents = {
  onTick?: (tick: ScheduledTick) => void;
  onStateChange?: (state: "ready" | "suspended" | "error", details?: string) => void;
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
  return Math.max(min, Math.min(max, value));
}

function normalizeSubdivMask(subdiv: number, mask?: boolean[]) {
  const n = clampInt(subdiv, 1, 8);
  const base = Array.from({ length: n }).map((_, i) => (mask?.[i] ?? true));
  if (!base.some(Boolean)) base[0] = true;
  return base;
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

function maxInt(arr?: number[]) {
  if (!arr || arr.length === 0) return undefined;
  let m = arr[0] ?? 1;
  for (let i = 1; i < arr.length; i++) m = Math.max(m, arr[i] ?? 1);
  return m;
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
  private meter: Meter = { n: 4, d: 4 };
  private groups?: number[];

  // Global (legacy) subdivisions
  private subdiv = 1; // 1..8
  private subdivMask: boolean[] = [true];

  // NEW: per-beat (web uses; native currently ignores)
  private pulseSubdivs?: number[];
  private pulseSubdivMasks?: boolean[][];

  private accentLevels: AccentLevel[] = deriveAccentPerTick(this.meter, this.groups);
  private accentGains: AccentGainMap = ACCENT_GAIN;

  // Web scheduler counters
  private tickIndex = 0;
  private nextTickTime = 0;

  private isRunning = false;
  private events: SchedulerEvents;

  constructor(events: SchedulerEvents = {}) {
    this.events = events;
    this.native = getNativeEngine();
  }

  private get secondsPerTick() {
    return (60 / this.bpm) * (4 / this.meter.d);
  }

  private get scheduleAheadSeconds() {
    return SCHEDULE_AHEAD_MS / 1000;
  }

  setAccentGains(map: Partial<AccentGainMap>) {
    this.accentGains = { ...this.accentGains, ...map };
  }

  async start(options: StartOptions): Promise<boolean> {
    if (this.isRunning) return true;

    this.setFromOptions(options);

    if (this.native) {
      try {
        this.attachNativeListenersIfNeeded();
        this.isRunning = true;

        const hasPulse = !!(this.pulseSubdivs && this.pulseSubdivs.length === this.meter.n);

        // Native TODAY consumes only legacy subdiv/subdivMask.
        // If pulseSubdivs is present, use a GLOBAL audible subdiv:
        // take the MAX (so it definitely subdivides) and all-true mask.
        const pulseMax = hasPulse ? maxInt(this.pulseSubdivs) : undefined;
        const legacySubdiv = clampInt(pulseMax ?? this.subdiv ?? 1, 1, 8);
        const legacyMask = normalizeSubdivMask(legacySubdiv, undefined);

        await this.native.start({
          bpm: this.bpm,
          meterN: this.meter.n,
          meterD: this.meter.d,
          groups: this.groups,

          // Future-proof keys (native may ignore today)
          ...(hasPulse ? { pulseSubdivs: this.pulseSubdivs, pulseSubdivMasks: this.pulseSubdivMasks } : {}),

          // Guaranteed audible path on Android today
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
        this.events.onStateChange?.("ready");
      }
      return;
    }

    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    this.isRunning = false;
    this.tickIndex = 0;
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
    this.setFromOptions(options);

    if (this.native) {
      const applyAt = options.applyAt ?? "now";
      try {
        const hasPulse = !!(this.pulseSubdivs && this.pulseSubdivs.length === this.meter.n);
        const pulseMax = hasPulse ? maxInt(this.pulseSubdivs) : undefined;
        const legacySubdiv = clampInt(pulseMax ?? this.subdiv ?? 1, 1, 8);
        const legacyMask = normalizeSubdivMask(legacySubdiv, undefined);

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

    if (this.isRunning && this.context) {
      if (this.nextTickTime < this.context.currentTime) {
        this.nextTickTime = this.context.currentTime + this.secondsPerTick;
      }
    }
  }

  private setFromOptions(options: StartOptions) {
    this.bpm = options.bpm;
    this.meter = options.meter;
    this.groups = options.groups;

    // Keep legacy subdiv ALWAYS (native uses it for any denominator)
    const nextSubdiv = clampInt(options.subdiv ?? 1, 1, 8);
    this.subdiv = nextSubdiv;
    this.subdivMask = normalizeSubdivMask(nextSubdiv, options.subdivMask);

    // Per-beat only when provided (web uses it)
    const ps = normalizePulseSubdivs(this.meter.n, options.pulseSubdivs);
    if (ps) {
      this.pulseSubdivs = ps;
      this.pulseSubdivMasks = normalizePulseMasks(this.meter.n, ps, options.pulseSubdivMasks);
    } else {
      this.pulseSubdivs = undefined;
      this.pulseSubdivMasks = undefined;
    }

    this.accentLevels = deriveAccentPerTick(this.meter, this.groups);
  }

  // ---------- Native listeners ----------

  private attachNativeListenersIfNeeded() {
    if (!this.native) return;
    if (this.nativeTickSub && this.nativeStateSub) return;

    this.nativeTickSub = this.native.addListener("onTick", (e) => {
      const accentLevel = this.accentLevels[e.tickIndex % this.accentLevels.length] ?? "WEAK";
      const accentGain = this.accentGains[accentLevel] ?? 1;

      const tick: ScheduledTick = {
        tickIndex: e.tickIndex,
        atMs: e.atAudioTimeMs,
        barTick: e.barTick,
        isDownbeat: e.isDownbeat,
        accentGain,
        accentLevel,
        scheduledTime: e.atAudioTimeMs / 1000,
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
      this.scheduleTick(this.nextTickTime);
      this.nextTickTime += this.secondsPerTick;
    }
  }

  private scheduleTick(atTime: number) {
    if (!this.context) return;

    const accentLevel = this.accentLevels[this.tickIndex % this.accentLevels.length] ?? "WEAK";
    const accentGain = this.accentGains[accentLevel] ?? 1;

    const barTick = this.tickIndex % this.meter.n;

    const beatSubdiv =
      this.pulseSubdivs && this.pulseSubdivs.length === this.meter.n
        ? clampInt(this.pulseSubdivs[barTick] ?? 1, 1, 8)
        : this.subdiv;

    const beatMask =
      this.pulseSubdivs && this.pulseSubdivs.length === this.meter.n
        ? normalizeSubdivMask(beatSubdiv, this.pulseSubdivMasks?.[barTick])
        : normalizeSubdivMask(beatSubdiv, this.subdivMask);

    if (beatSubdiv > 1) {
      const secondsPerSub = this.secondsPerTick / beatSubdiv;

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
    };

    this.events.onTick?.(tick);
    this.tickIndex += 1;
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
