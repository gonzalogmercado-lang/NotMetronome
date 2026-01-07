import { AccentLevel, Meter, TickInfo } from "../core/types";
import { ACCENT_GAIN, deriveAccentPerTick } from "../utils/rhythm/deriveAccentPerTick";

type AccentGainMap = Record<AccentLevel, number>;

type StartOptions = {
  bpm: number;
  meter: Meter;
  groups?: number[];
};

type UpdateOptions = StartOptions;

export type ScheduledTick = TickInfo & {
  accentLevel: AccentLevel;
  accentGain: number;
  scheduledTime: number;
};

type SchedulerEvents = {
  onTick?: (tick: ScheduledTick) => void;
  onStateChange?: (state: "ready" | "suspended" | "error", details?: string) => void;
};

type AudioContextLike = AudioContext | BaseAudioContext;

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_MS = 180;
const START_DELAY_MS = 60;
const ENVELOPE_ATTACK_SECONDS = 0.002;
const ENVELOPE_DECAY_SECONDS = 0.016;
const OSCILLATOR_DURATION_SECONDS = 0.03;

const ACCENT_FREQUENCY: Record<AccentLevel, number> = {
  BAR_STRONG: 1200,
  GROUP_MED: 900,
  WEAK: 700,
};

const ACCENT_PEAK: Record<AccentLevel, number> = {
  BAR_STRONG: 0.95,
  GROUP_MED: 0.65,
  WEAK: 0.4,
};

async function loadAudioContext(): Promise<AudioContextLike | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const audioApi = require("react-native-audio-api");
    if (audioApi?.AudioContext) {
      return new audioApi.AudioContext();
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[MetronomeAudioScheduler] react-native-audio-api unavailable, falling back to built-in AudioContext if present", error);
  }

  if (typeof globalThis.AudioContext !== "undefined") {
    return new AudioContext();
  }
  if (typeof globalThis.webkitAudioContext !== "undefined") {
    return new globalThis.webkitAudioContext();
  }

  return null;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

class MetronomeAudioScheduler {
  private context: AudioContextLike | null = null;

  private timerId: ReturnType<typeof setInterval> | null = null;

  private bpm = 120;

  private meter: Meter = { n: 4, d: 4 };

  private groups?: number[];

  private accentLevels: AccentLevel[] = deriveAccentPerTick(this.meter, this.groups);

  private accentGains: AccentGainMap = ACCENT_GAIN;

  private tickIndex = 0;

  private nextTickTime = 0;

  private isRunning = false;

  private events: SchedulerEvents;

  private scheduledNodes = new Map<OscillatorNode, GainNode>();

  constructor(events: SchedulerEvents = {}) {
    this.events = events;
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
    await this.ensureContext();
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
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn("[MetronomeAudioScheduler] Unable to stop scheduled oscillator", error);
        } finally {
          osc.disconnect();
          gain.disconnect();
        }
      });
      this.scheduledNodes.clear();
    }
  }

  async update(options: UpdateOptions) {
    this.setFromOptions(options);
    if (this.isRunning && this.context) {
      if (this.nextTickTime < this.context.currentTime) {
        this.nextTickTime = this.context.currentTime + this.secondsPerTick;
      }
    }
  }

  private setFromOptions(options: UpdateOptions) {
    this.bpm = options.bpm;
    this.meter = options.meter;
    this.groups = options.groups;
    this.accentLevels = deriveAccentPerTick(this.meter, this.groups);
  }

  private async ensureContext() {
    if (this.context) {
      if ("state" in this.context && this.context.state === "suspended" && "resume" in this.context && typeof this.context.resume === "function") {
        await (this.context as AudioContext).resume();
        const currentState = "state" in this.context ? this.context.state : "unknown";
        this.events.onStateChange?.(currentState === "suspended" ? "suspended" : "ready", `resume() called; state=${currentState}`);
      }
      return;
    }
    this.context = await loadAudioContext();
    if (!this.context) {
      this.events.onStateChange?.("error", "No AudioContext available");
      return;
    }
    if ("state" in this.context && this.context.state === "suspended" && "resume" in this.context && typeof this.context.resume === "function") {
      await (this.context as AudioContext).resume();
    }
    const createdState = "state" in this.context ? this.context.state : "unknown";
    this.events.onStateChange?.(createdState === "suspended" ? "suspended" : "ready", `context created; state=${createdState}`);
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
    this.scheduleClick(atTime, accentLevel, accentGain);

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
      osc.disconnect();
      gainNode.disconnect();
      this.scheduledNodes.delete(osc);
    };
  }

  async playTestBeep(): Promise<{ ok: boolean; details?: string }> {
    await this.ensureContext();
    if (!this.context) return { ok: false, details: "Audio context not available" };

    if ("state" in this.context && this.context.state === "suspended" && "resume" in this.context && typeof this.context.resume === "function") {
      await (this.context as AudioContext).resume();
    }

    const state = "state" in this.context ? this.context.state : "unknown";
    if (state === "suspended") {
      return { ok: false, details: `Audio context suspended; state=${state}` };
    }

    const when = this.context.currentTime + 0.01;
    this.scheduleClick(when, "BAR_STRONG", 1);
    const sampleRate = "sampleRate" in this.context ? this.context.sampleRate : undefined;
    const detailParts = [`state=${state}`];
    if (sampleRate) {
      detailParts.push(`sampleRate=${sampleRate}`);
    }
    return { ok: true, details: detailParts.join(", ") };
  }
}

export default MetronomeAudioScheduler;
