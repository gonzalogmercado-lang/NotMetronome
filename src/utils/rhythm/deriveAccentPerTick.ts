import { AccentLevel, Meter } from "../../core/types";

export type { AccentLevel } from "../../core/types";

/**
 * Default compound grouping (only used when no explicit groups are provided).
 * 12/8 => 3+3+3+3
 * 9/8  => 3+3+3
 * 6/8  => 3+3
 */
const COMPOUND_TOPS = new Set([6, 9, 12]);

const MIN_GROUP_SIZE_DEFAULT = 2;
const MAX_GROUP_SIZE_DEFAULT = 8;

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

export type DeriveAccentOptions = {
  /**
   * Overrides how many ticks exist in the bar.
   * Use this for "pool" scenarios like 4/4 in quintuplets (4*5 = 20 ticks),
   * where you want to build the clave over the full 20-tick bar.
   */
  ticksPerBar?: number;

  /**
   * Hard validation rules for groups. Defaults to true.
   * If invalid, we fall back to default grouping (compound) or only BAR+WEAK.
   */
  validateGroups?: boolean;

  /** Minimum allowed group size (default: 2). */
  minGroupSize?: number;

  /** Maximum allowed group size (default: 8). */
  maxGroupSize?: number;
};

type GroupValidationResult = { ok: true } | { ok: false; reason: string };

// ✅ Type guard: asegura narrowing siempre (y chau TS2339)
function isGroupValidationError(res: GroupValidationResult): res is { ok: false; reason: string } {
  return res.ok === false;
}

function isPositiveInt(n: number): boolean {
  return Number.isFinite(n) && Number.isInteger(n) && n > 0;
}

function validateTickGroups(
  groups: number[],
  ticksPerBar: number,
  minGroupSize: number,
  maxGroupSize: number
): GroupValidationResult {
  if (!Array.isArray(groups) || groups.length === 0) {
    return { ok: false, reason: "Groups is empty or not an array." };
  }

  let sum = 0;
  for (let i = 0; i < groups.length; i += 1) {
    const g = groups[i];
    if (!isPositiveInt(g)) {
      return { ok: false, reason: `Group at index ${i} is not a positive integer: ${String(g)}` };
    }
    if (g < minGroupSize || g > maxGroupSize) {
      return { ok: false, reason: `Group at index ${i} is out of range [${minGroupSize}..${maxGroupSize}]: ${g}` };
    }
    sum += g;
  }

  if (sum !== ticksPerBar) {
    return { ok: false, reason: `Sum(groups) must equal ticksPerBar (${ticksPerBar}), got ${sum}.` };
  }

  return { ok: true };
}

/**
 * Derives an AccentLevel array for a bar.
 *
 * - BAR: downbeat (tick 0)
 * - GROUP: start of each group (except tick 0)
 * - WEAK: everything else
 *
 * "Pro mode": pass options.ticksPerBar to treat the bar as a flat pool of ticks,
 * and pass groups as the claveGroups over that pool (must sum exactly).
 */
export function deriveAccentPerTick(meter: Meter, groups?: number[], options?: DeriveAccentOptions): AccentLevel[] {
  const ticksPerBar =
    typeof options?.ticksPerBar === "number" && Number.isFinite(options.ticksPerBar)
      ? Math.max(0, Math.floor(options.ticksPerBar))
      : Math.max(0, Math.floor(meter.n));

  if (ticksPerBar === 0) return [];

  const accent: AccentLevel[] = Array.from({ length: ticksPerBar }, () => "WEAK");
  accent[0] = "BAR";

  const validate = options?.validateGroups ?? true;
  const minGroupSize = options?.minGroupSize ?? MIN_GROUP_SIZE_DEFAULT;
  const maxGroupSize = options?.maxGroupSize ?? MAX_GROUP_SIZE_DEFAULT;

  // Explicit groups (clave) over the whole bar pool.
  if (groups && groups.length > 0) {
    if (validate) {
      const res = validateTickGroups(groups, ticksPerBar, minGroupSize, maxGroupSize);

      if (isGroupValidationError(res)) {
        if (typeof __DEV__ !== "undefined" && __DEV__) {
          // eslint-disable-next-line no-console
          console.warn("[deriveAccentPerTick] invalid groups; falling back to defaults:", res.reason, {
            meter,
            ticksPerBar,
            groups,
            minGroupSize,
            maxGroupSize,
          });
        }
      } else {
        let cursor = 0;
        for (let i = 0; i < groups.length; i += 1) {
          const start = cursor;
          if (i > 0 && start < ticksPerBar) {
            accent[start] = "GROUP";
          }
          cursor += groups[i];
        }
        return accent;
      }
    } else {
      // Non-validating legacy behavior: mark group starts until we reach ticksPerBar.
      let cursor = 0;
      for (let i = 0; i < groups.length; i += 1) {
        const size = groups[i];
        const start = cursor;
        if (i > 0 && start < ticksPerBar) {
          accent[start] = "GROUP";
        }
        cursor += size;
        if (cursor >= ticksPerBar) break;
      }
      return accent;
    }
  }

  // Default compound behavior (only when no valid explicit groups were applied).
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
  const sample = (meter: { n: number; d: number }, groups?: number[], options?: DeriveAccentOptions) =>
    accentPatternGlyphs(deriveAccentPerTick(meter, groups, options));

  // Simple dev-time sanity checks
  // eslint-disable-next-line no-console
  console.log("[dev:self-check] 12/8 default", sample({ n: 12, d: 8 }));
  // eslint-disable-next-line no-console
  console.log("[dev:self-check] 11/8 default", sample({ n: 11, d: 8 }));
  // eslint-disable-next-line no-console
  console.log("[dev:self-check] 11/8 groups [3,3,3,2]", sample({ n: 11, d: 8 }, [3, 3, 3, 2]));

  // "Pool" example: 4/4 in quintuplets => 20 ticks, clave over the full 20.
  // eslint-disable-next-line no-console
  console.log(
    "[dev:self-check] 4/4 quint pool (20 ticks) groups [5,7,6,2]",
    sample({ n: 4, d: 4 }, [5, 7, 6, 2], { ticksPerBar: 20 })
  );

  // Invalid example (group > 8) should warn + fall back
  // eslint-disable-next-line no-console
  console.log(
    "[dev:self-check] invalid (should fallback): 20 ticks groups [9,11]",
    sample({ n: 4, d: 4 }, [9, 11], { ticksPerBar: 20 })
  );
}

export default deriveAccentPerTick;
