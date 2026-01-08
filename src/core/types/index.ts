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

/**
 * Accent contract (canonical)
 * - BAR_STRONG: acento de compás
 * - GROUP_MED: acento de inicio de grupo (clave)
 * - SUBDIV_WEAK: resto
 */
export type AccentLevel = "BAR_STRONG" | "GROUP_MED" | "SUBDIV_WEAK";
