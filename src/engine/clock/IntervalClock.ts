import { ClockEvents, TickInfo } from "./types";

const MS_PER_MINUTE = 60_000;

class IntervalClock {
  private bpm: number;

  private meterTop: number;

  private meterBottom: number;

  private tickIntervalId: ReturnType<typeof setInterval> | null = null;

  private tickIndex = 0;

  private events: ClockEvents;

  constructor({ bpm = 120, meterTop = 4, meterBottom = 4, events = {} }: { bpm?: number; meterTop?: number; meterBottom?: number; events?: ClockEvents }) {
    this.bpm = bpm;
    this.meterTop = meterTop;
    this.meterBottom = meterBottom;
    this.events = events;
  }

  private get intervalMs() {
    return MS_PER_MINUTE / this.bpm;
  }

  setBpm(bpm: number) {
    this.bpm = bpm;
    if (this.tickIntervalId) {
      this.restart();
    }
  }

  setMeter(top: number, bottom: number) {
    this.meterTop = top;
    this.meterBottom = bottom;
  }

  start() {
    if (this.tickIntervalId) return;
    this.tickIndex = 0;
    this.tickIntervalId = setInterval(() => this.tick(), this.intervalMs);
  }

  stop() {
    if (this.tickIntervalId) {
      clearInterval(this.tickIntervalId);
      this.tickIntervalId = null;
    }
  }

  private restart() {
    this.stop();
    this.start();
  }

  private tick() {
    const now = Date.now();
    const currentTick = this.tickIndex;
    const isDownbeat = currentTick % this.meterTop === 0;
    const info: TickInfo = {
      tickIndex: currentTick,
      atMs: now,
      isDownbeat,
    };
    this.events.onTick?.(info);
    this.tickIndex += 1;
  }
}

export default IntervalClock;
