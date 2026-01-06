export type Meter = {
  n: number;
  d: number;
};

export type TickInfo = {
  tickIndex: number;
  atMs: number;
  barTick: number;
  isDownbeat: boolean;
};

export type ClockEvents = {
  onTick?: (info: TickInfo) => void;
};

export type AccentLevel = "BAR" | "GROUP" | "WEAK";
