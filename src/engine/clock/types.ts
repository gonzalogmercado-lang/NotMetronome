export type TickInfo = {
  tickIndex: number;
  atMs: number;
  isDownbeat: boolean;
};

export type ClockEvents = {
  onTick?: (info: TickInfo) => void;
};
