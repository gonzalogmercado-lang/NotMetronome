import { ClockEvents, TickInfo } from "./types";

const MS_PER_MINUTE = 60_000;

class IntervalClock {
  private bpm: number;

  private meterTop: number;

  private meterBottom: number;

  private tickTimeoutId: ReturnType<typeof setTimeout> | null = null;

  private nextTickAt: number | null = null;

  private tickIndex = 0;

  private events: ClockEvents;

  constructor({ bpm = 120, meterTop = 4, meterBottom = 4, events = {} }: { bpm?: number; meterTop?: number; meterBottom?: number; events?: ClockEvents }) {
    this.bpm = bpm;
    this.meterTop = meterTop;
    this.meterBottom = meterBottom;
    this.events = events;
  }

  private get intervalMs(): number {
    return (MS_PER_MINUTE / this.bpm) * (4 / this.meterBottom);
  }

  setBpm(bpm: number) {
    this.bpm = bpm;
    if (this.tickTimeoutId) {
      this.restart();
    }
  }

  setMeter(top: number, bottom: number) {
    this.meterTop = top;
    this.meterBottom = bottom;
    if (this.tickTimeoutId) {
      this.restart();
    }
  }

  start() {
    if (this.tickTimeoutId) return;
    this.tickIndex = 0;
    this.nextTickAt = Date.now();
    this.scheduleNextTick();
  }

  stop() {
    if (this.tickTimeoutId) {
      clearTimeout(this.tickTimeoutId);
      this.tickTimeoutId = null;
      this.nextTickAt = null;
    }
  }

  private restart() {
    this.stop();
    this.start();
  }

  private scheduleNextTick() {
    const now = Date.now();
    if (this.nextTickAt === null) {
      this.nextTickAt = now;
    }
    const delay = Math.max(0, this.nextTickAt - now);
    this.tickTimeoutId = setTimeout(() => this.tick(), delay);
  }

  private tick() {
    const now = Date.now();
    const currentTick = this.tickIndex;
    const barTick = currentTick % this.meterTop;
    const isDownbeat = barTick === 0;
    const info: TickInfo = {
      tickIndex: currentTick,
      atMs: now,
      barTick,
      isDownbeat,
    };
    this.events.onTick?.(info);
    this.tickIndex += 1;
    this.nextTickAt = (this.nextTickAt ?? now) + this.intervalMs;
    this.scheduleNextTick();
  }
}

export default IntervalClock;
