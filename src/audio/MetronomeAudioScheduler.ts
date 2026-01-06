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

function createClickBuffer(context: AudioContextLike): AudioBuffer {
  const sampleRate = context.sampleRate ?? 44_100;
  const durationSeconds = 0.035;
  const length = Math.ceil(sampleRate * durationSeconds);
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  const decaySamples = Math.ceil(length * 0.6);
  for (let i = 0; i < length; i += 1) {
    const envelope = i < decaySamples ? 1 - i / decaySamples : 0;
    const value = envelope * Math.sin((2 * Math.PI * i * 440) / sampleRate);
    data[i] = value;
  }

  return buffer;
}

class MetronomeAudioScheduler {
  private context: AudioContextLike | null = null;

  private clickBuffer: AudioBuffer | null = null;

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
        this.events.onStateChange?.("ready");
      }
      return;
    }
    this.context = await loadAudioContext();
    if (!this.context) {
      this.events.onStateChange?.("error", "No AudioContext available");
      return;
    }
    this.events.onStateChange?.("ready");
    this.clickBuffer = createClickBuffer(this.context);
  }

  private scheduleWindow() {
    if (!this.context || !this.clickBuffer || !this.isRunning) return;
    const now = this.context.currentTime;
    const horizon = now + this.scheduleAheadSeconds;

    while (this.nextTickTime < horizon) {
      this.scheduleTick(this.nextTickTime);
      this.nextTickTime += this.secondsPerTick;
    }
  }

  private scheduleTick(atTime: number) {
    if (!this.context || !this.clickBuffer) return;
    const source = this.context.createBufferSource();
    source.buffer = this.clickBuffer;

    const gainNode = this.context.createGain();
    const accentLevel = this.accentLevels[this.tickIndex % this.accentLevels.length] ?? "WEAK";
    const accentGain = this.accentGains[accentLevel] ?? 1;

    gainNode.gain.setValueAtTime(accentGain, atTime);
    source.connect(gainNode);
    gainNode.connect(this.context.destination);

    source.start(atTime);
    source.onended = () => {
      source.disconnect();
      gainNode.disconnect();
    };

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
}

export default MetronomeAudioScheduler;
