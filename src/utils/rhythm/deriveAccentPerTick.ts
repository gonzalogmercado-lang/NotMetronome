export type AccentLevel = "BAR" | "GROUP" | "WEAK";

const COMPOUND_TOPS = new Set([6, 9, 12]);

const accentToGlyph: Record<AccentLevel, string> = {
  BAR: "F",
  GROUP: "m",
  WEAK: "x",
};

export const ACCENT_GAIN: Record<AccentLevel, number> = {
  BAR: 1.0,
  GROUP: 0.7,
  WEAK: 0.4,
};

export function deriveAccentPerTick(meter: { n: number; d: number }, groups?: number[]): AccentLevel[] {
  const ticksPerBar = Math.max(0, Math.floor(meter.n));
  if (ticksPerBar === 0) return [];

  const accent: AccentLevel[] = Array.from({ length: ticksPerBar }, () => "WEAK");
  accent[0] = "BAR";

  if (groups && groups.length > 0) {
    let cursor = 0;
    for (let i = 0; i < groups.length; i += 1) {
      const size = groups[i];
      const start = cursor;
      if (i > 0 && start < ticksPerBar) {
        accent[start] = "GROUP";
      }
      cursor += size;
      if (cursor >= ticksPerBar) {
        break;
      }
    }
    return accent;
  }

  if (meter.d === 8 && COMPOUND_TOPS.has(ticksPerBar)) {
    for (let i = 3; i < ticksPerBar; i += 3) {
      accent[i] = "GROUP";
    }
    return accent;
  }

  return accent;
}

export function accentPatternGlyphs(accentLevels: AccentLevel[]): string {
  return accentLevels.map((level) => accentToGlyph[level]).join(" ");
}

if (typeof __DEV__ !== "undefined" && __DEV__) {
  const sample = (meter: { n: number; d: number }, groups?: number[]) => accentPatternGlyphs(deriveAccentPerTick(meter, groups));

  // Simple dev-time sanity checks
  console.log("[dev:self-check] 12/8 default", sample({ n: 12, d: 8 }));
  console.log("[dev:self-check] 11/8 default", sample({ n: 11, d: 8 }));
  console.log("[dev:self-check] 11/8 groups [3,3,3,2]", sample({ n: 11, d: 8 }, [3, 3, 3, 2]));
}

export default deriveAccentPerTick;
