import { create } from "zustand";

export type PatternTrack = {
  id: string;
  name: string;
  steps: number[];
};

type PatternState = {
  tracks: PatternTrack[];
};

export const usePatternStore = create<PatternState>(() => ({
  tracks: [],
}));
