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

const DEFAULT_ALLOWED_GROUP_SIZES = [2, 3, 4, 5];

export function getClavePresets(meter: Meter): number[][] {
  if (meter.d !== 8) return [];
  return presetsByMeter[meter.n] ?? [];
}

export const supportsClavePresets = (meter: Meter) => meter.d === 8;

export const allowedGroupSizesForMeter = (meter: Meter): number[] => {
  if (meter.d === 8 || meter.d === 16) {
    return DEFAULT_ALLOWED_GROUP_SIZES;
  }
  // Conservador: mantenemos las mismas unidades hasta definir reglas específicas
  // por denominador (pendiente para compases que no sean en octavos).
  return DEFAULT_ALLOWED_GROUP_SIZES;
};

export function formatGroups(groups: number[]): string {
  return groups.join("+");
}
