export type TickInfo = {
  tickIndex: number;
  atMs: number;
  barTick: number;
  isDownbeat: boolean;
};

export type ClockEvents = {
  onTick?: (info: TickInfo) => void;
};
