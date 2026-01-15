import { requireNativeModule } from "expo";
import { Platform } from "react-native";

import { AccentLevel, Meter, TickInfo } from "../core/types";
import { ACCENT_GAIN, deriveAccentPerTick } from "../utils/rhythm/deriveAccentPerTick";

type AccentGainMap = Record<AccentLevel, number>;

type StartOptions = {
  bpm: number;
  meter: Meter;
  groups?: number[];

  // Subdivisions sobre negras (solo cuando meter.d === 4)
  // subdiv = 1..8 (cuántos golpes entran en una negra)
  // subdivMask = qué golpes suenan dentro del grupo (length === subdiv)
  subdiv?: number;
  subdivMask?: boolean[];
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
  BAR_STRONG: 1200,
  GROUP_MED: 900,
  SUBDIV_WEAK: 700,
};

const ACCENT_PEAK: Record<AccentLevel, number> = {
  BAR_STRONG: 0.95,
  GROUP_MED: 0.65,
  SUBDIV_WEAK: 0.4,
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

    // subdivisions (Android engine puede ignorarlo por ahora; lo cableamos ya)
    subdiv?: number;
    subdivMask?: boolean[];
  }): Promise<void>;

  stop(): Promise<void>;

  update(params: {
    bpm?: number;
    meterN?: number;
    meterD?: number;
    groups?: number[];
    sampleRate?: number;
    applyAt?: "bar" | "now";

    // subdivisions
    subdiv?: number;
    subdivMask?: boolean[];
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
  // no permitimos "todo apagado" (si viene así, prendemos el 1)
  if (!base.some(Boolean)) {
    base[0] = true;
  }
  return base;
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

  // Subdivisions (solo sobre negras)
  private subdiv = 1; // 1..8
  private subdivMask: boolean[] = [true];

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
    // Base grid: denominator ticks
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

    // Prefer native on Android
    if (this.native) {
      try {
        this.attachNativeListenersIfNeeded();
        this.isRunning = true;

        await this.native.start({
          bpm: this.bpm,
          meterN: this.meter.n,
          meterD: this.meter.d,
          groups: this.groups,

          // subdivisions (engine Android lo soporta en el próximo paso)
          subdiv: this.meter.d === 4 ? this.subdiv : 1,
          subdivMask: this.meter.d === 4 ? this.subdivMask : [true],
        });

        this.events.onStateChange?.("ready");
        return true;
      } catch (e: any) {
        this.isRunning = false;
        this.events.onStateChange?.("error", e?.message ?? "Native engine start failed");
        return false;
      }
    }

    // WebAudio fallback (web only)
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
    // Native stop
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

    // WebAudio stop
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

    // Native update
    if (this.native) {
      const applyAt = options.applyAt ?? "now";
      try {
        await this.native.update({
          bpm: this.bpm,
          meterN: this.meter.n,
          meterD: this.meter.d,
          groups: this.groups,
          applyAt,

          subdiv: this.meter.d === 4 ? this.subdiv : 1,
          subdivMask: this.meter.d === 4 ? this.subdivMask : [true],
        });
      } catch {
        // ignore
      }
      return;
    }

    // WebAudio update
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

    // Subdivisions rule: SOLO sobre negras (denominador 4)
    if (this.meter.d === 4) {
      const nextSubdiv = clampInt(options.subdiv ?? 1, 1, 8);
      this.subdiv = nextSubdiv;
      this.subdivMask = normalizeSubdivMask(nextSubdiv, options.subdivMask);
    } else {
      this.subdiv = 1;
      this.subdivMask = [true];
    }

    this.accentLevels = deriveAccentPerTick(this.meter, this.groups);
  }

  // ---------- Native listeners ----------

  private attachNativeListenersIfNeeded() {
    if (!this.native) return;
    if (this.nativeTickSub && this.nativeStateSub) return;

    this.nativeTickSub = this.native.addListener("onTick", (e) => {
      const accentLevel = this.accentLevels[e.tickIndex % this.accentLevels.length] ?? "SUBDIV_WEAK";
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

    const accentLevel = this.accentLevels[this.tickIndex % this.accentLevels.length] ?? "SUBDIV_WEAK";
    const accentGain = this.accentGains[accentLevel] ?? 1;

    // === AUDIO ===
    // Si hay subdivisiones (solo d=4), hacemos "grupo" dentro de esta negra.
    if (this.meter.d === 4 && this.subdiv > 1) {
      const secondsPerSub = this.secondsPerTick / this.subdiv;

      for (let i = 0; i < this.subdiv; i++) {
        if (!this.subdivMask[i]) continue;

        const t = atTime + i * secondsPerSub;

        // Importante: mantenemos 3 intensidades
        // - slot 0 hereda el acento del pulso (bar/group/weak)
        // - slots > 0 siempre SUBDIV_WEAK
        const level: AccentLevel = i === 0 ? accentLevel : "SUBDIV_WEAK";
        const gain = i === 0 ? accentGain : 1;

        this.scheduleClick(t, level, gain);
      }
    } else {
      // normal: un click por tick
      this.scheduleClick(atTime, accentLevel, accentGain);
    }

    // === EVENT === (base tick; no spameamos eventos por subdivisiones)
    const tick: ScheduledTick = {
      tickIndex: this.tickIndex,
      atMs: atTime * 1000,
      barTick: this.tickIndex % this.meter.n,
      isDownbeat: this.tickIndex % this.meter.n === 0,
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

    const frequency = ACCENT_FREQUENCY[accentLevel] ?? ACCENT_FREQUENCY.SUBDIV_WEAK;
    const basePeak = ACCENT_PEAK[accentLevel] ?? ACCENT_PEAK.SUBDIV_WEAK;
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
    // Native: no-op true (engine tick should be audible when started)
    if (this.native) return true;

    await this.ensureWebContext();
    if (!this.context) return false;

    const when = this.context.currentTime + 0.01;
    this.scheduleClick(when, "BAR_STRONG", 1);
    return true;
  }
}

export default MetronomeAudioScheduler;
