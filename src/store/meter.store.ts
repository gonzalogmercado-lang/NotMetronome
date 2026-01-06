import { create } from "zustand";

import { Meter } from "../core/types";

type MeterState = {
  meter: Meter;
  groups?: number[];
  setMeter: (n: number, d: number) => void;
  setGroups: (groups: number[]) => void;
  clearGroups: () => void;
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export const useMeterStore = create<MeterState>((set, get) => ({
  meter: { n: 4, d: 4 },
  groups: undefined,
  setMeter: (n, d) =>
    set((state) => {
      const currentGroups = state.groups;
      const isValidForMeter = currentGroups && sum(currentGroups) === n ? currentGroups : undefined;
      return { meter: { n, d }, groups: isValidForMeter };
    }),
  setGroups: (groups) => set({ groups }),
  clearGroups: () => set({ groups: undefined }),
}));

export type { Meter };
