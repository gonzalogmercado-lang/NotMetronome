import { create } from "zustand";

export type Meter = {
  top: number;
  bottom: number;
};

type MeterState = {
  meter: Meter;
  setMeter: (meter: Meter) => void;
};

export const useMeterStore = create<MeterState>((set) => ({
  meter: { top: 4, bottom: 4 },
  setMeter: (meter) => set({ meter }),
}));
