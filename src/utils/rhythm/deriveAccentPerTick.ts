import { AccentLevel, Meter } from "../../core/types";

export type { AccentLevel } from "../../core/types";

const COMPOUND_TOPS = new Set([6, 9, 12]);

const accentToGlyph: Record<AccentLevel, string> = {
  BAR_STRONG: "F",
  GROUP_MED: "m",
  SUBDIV_WEAK: "x",
};

export const ACCENT_GAIN: Record<AccentLevel, number> = {
  BAR_STRONG: 1.0,
  GROUP_MED: 0.7,
  SUBDIV_WEAK: 0.4,
};

export function deriveAccentPerTick(meter: Meter, groups?: number[]): AccentLevel[] {
  const ticksPerBar = Math.max(0, Math.floor(meter.n));
  if (ticksPerBar === 0) return [];

  const accent: AccentLevel[] = Array.from({ length: ticksPerBar }, () => "SUBDIV_WEAK");
  accent[0] = "BAR_STRONG";

  if (groups && groups.length > 0) {
    let cursor = 0;
    for (let i = 0; i < groups.length; i += 1) {
      const size = groups[i];
      const start = cursor;
      if (i > 0 && start < ticksPerBar) {
        accent[start] = "GROUP_MED";
      }
      cursor += size;
      if (cursor >= ticksPerBar) break;
    }
    return accent;
  }

  if (meter.d === 8 && COMPOUND_TOPS.has(ticksPerBar)) {
    for (let i = 3; i < ticksPerBar; i += 3) {
      accent[i] = "GROUP_MED";
    }
    return accent;
  }

  return accent;
}

export function accentPatternGlyphs(accentLevels: AccentLevel[]): string {
  return accentLevels.map((level) => accentToGlyph[level]).join(" ");
}

if (typeof __DEV__ !== "undefined" && __DEV__) {
  const sample = (meter: { n: number; d: number }, groups?: number[]) =>
    accentPatternGlyphs(deriveAccentPerTick(meter, groups));

  console.log("[dev:self-check] 12/8 default", sample({ n: 12, d: 8 }));
  console.log("[dev:self-check] 11/8 default", sample({ n: 11, d: 8 }));
  console.log("[dev:self-check] 11/8 groups [3,3,3,2]", sample({ n: 11, d: 8 }, [3, 3, 3, 2]));
}

export default deriveAccentPerTick;
