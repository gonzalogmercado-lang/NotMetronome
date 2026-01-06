import { create } from "zustand";

const clampBpm = (value: number) => Math.min(300, Math.max(30, Math.round(value)));

type TempoState = {
  bpm: number;
  lastTapTimestamps: number[];
  setBpm: (bpm: number) => void;
  increment: () => void;
  decrement: () => void;
  tap: () => void;
};

const MAX_TAPS = 8;

const computeBpmFromTaps = (timestamps: number[]) => {
  if (timestamps.length < 2) return null;
  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i += 1) {
    intervals.push(timestamps[i] - timestamps[i - 1]);
  }
  const samples = intervals.slice(-4);
  const avgInterval = samples.reduce((sum, n) => sum + n, 0) / samples.length;
  const bpm = 60_000 / avgInterval;
  return clampBpm(bpm);
};

export const useTempoStore = create<TempoState>((set, get) => ({
  bpm: 120,
  lastTapTimestamps: [],
  setBpm: (bpm) => set({ bpm: clampBpm(bpm) }),
  increment: () => set((state) => ({ bpm: clampBpm(state.bpm + 1) })),
  decrement: () => set((state) => ({ bpm: clampBpm(state.bpm - 1) })),
  tap: () => {
    const now = Date.now();
    const prev = get().lastTapTimestamps;
    const nextTaps = [...prev, now].slice(-MAX_TAPS);
    const nextBpm = computeBpmFromTaps(nextTaps);
    set({
      lastTapTimestamps: nextTaps,
      bpm: nextBpm ?? get().bpm,
    });
  },
}));
