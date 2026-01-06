import { Meter } from "../types";

const DEFAULT_ALLOWED_GROUP_SIZES = [2, 3, 4, 5];

export const supportsClavePresets = (meter: Meter) => meter.d === 8;

export const allowedGroupSizesForMeter = (meter: Meter): number[] => {
  if (meter.d === 8 || meter.d === 16) {
    return DEFAULT_ALLOWED_GROUP_SIZES;
  }
  // Conservador: mantenemos las mismas unidades hasta definir reglas específicas
  // por denominador (pendiente para compases que no sean en octavos).
  return DEFAULT_ALLOWED_GROUP_SIZES;
};
