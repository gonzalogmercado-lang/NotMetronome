import { Meter } from "../types";

const presetsByMeter: Record<number, number[][]> = {
  5: [
    [2, 3],
    [3, 2],
  ],
  7: [
    [4, 3],
    [5, 2],
    [2, 2, 3],
    [3, 2, 2],
    [2, 3, 2],
  ],
  9: [
    [2, 2, 2, 3],
    [3, 3, 3],
  ],
  11: [
    [3, 3, 3, 2],
    [2, 2, 2, 2, 3],
  ],
  13: [
    [3, 3, 3, 2, 2],
    [2, 2, 3, 3, 3],
  ],
  15: [
    [3, 3, 3, 3, 3],
    [2, 2, 2, 2, 2, 2, 3],
  ],
};

export function getClavePresets(meter: Meter): number[][] {
  if (meter.d !== 8) return [];
  return presetsByMeter[meter.n] ?? [];
}

export function formatGroups(groups: number[]): string {
  return groups.join("+");
}
