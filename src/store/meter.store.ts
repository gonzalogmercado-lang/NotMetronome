import { create } from "zustand";

import { Meter } from "../core/types";

type ClaveMode = "presets" | "build";

type MeterState = {
  meter: Meter;
  claveEnabled: boolean;
  claveMode: ClaveMode;
  groups?: number[];
  setMeter: (n: number, d: number) => void;
  setClaveEnabled: (enabled: boolean) => void;
  setClaveMode: (mode: ClaveMode) => void;
  setGroups: (groups: number[] | undefined) => void;
  resetGroups: () => void;
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export const useMeterStore = create<MeterState>((set) => ({
  meter: { n: 4, d: 4 },
  claveEnabled: false,
  claveMode: "presets",
  groups: undefined,
  setMeter: (n, d) =>
    set((state) => {
      const currentGroups = state.groups;
      const isValidForMeter = currentGroups && sum(currentGroups) === n ? currentGroups : undefined;
      return { meter: { n, d }, groups: isValidForMeter };
    }),
  setClaveEnabled: (enabled) =>
    set((state) => ({
      claveEnabled: enabled,
      groups: enabled ? state.groups : undefined,
    })),
  setClaveMode: (mode) => set({ claveMode: mode }),
  setGroups: (groups) => set({ groups }),
  resetGroups: () => set({ groups: undefined }),
}));

export type { Meter, ClaveMode };
