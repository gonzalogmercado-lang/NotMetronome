import { Meter } from "../types";

const presetsByTop: Record<number, number[][]> = {
  5: [
    [2, 3],
    [3, 2],
  ],
  7: [
    [2, 2, 3],
    [3, 2, 2],
    [2, 3, 2],
  ],
  11: [
    [3, 3, 3, 2],
    [2, 2, 3, 2, 2],
    [3, 2, 3, 3],
    [2, 3, 3, 3],
  ],
  13: [
    [3, 3, 3, 2, 2],
    [2, 2, 3, 2, 2, 2],
    [3, 2, 2, 3, 3],
  ],
};

const sumsTo = (target: number) => (group: number[]) => group.reduce((sum, value) => sum + value, 0) === target;

export function getClavePresets(meter: Meter): number[][] {
  if (meter.d !== 8) return [];

  const candidates = presetsByTop[meter.n] ?? [];
  return candidates.filter(sumsTo(meter.n));
}

export default getClavePresets;
