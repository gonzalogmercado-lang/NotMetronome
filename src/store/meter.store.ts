import { create } from "zustand";

import { Meter } from "../core/types";

type MeterState = {
  meter: Meter;
  groups?: number[];

  /**
   * Subdivisión por pulso (beat). Largo = meter.n
   * Ej: 4/4 -> [5,5,5,5]
   */
  pulseSubdivs: number[];

  /**
   * Máscara por pulso.
   * pulseSubdivMasks[i].length === pulseSubdivs[i]
   * true = suena, false = mute
   */
  pulseSubdivMasks: boolean[][];

  setMeter: (n: number, d: number) => void;

  setGroups: (groups: number[]) => void;
  clearGroups: () => void;

  setPulseSubdiv: (beatIndex: number, subdiv: number) => void;
  setAllPulseSubdivs: (subdiv: number) => void;
  setPulseSubdivs: (subdivs: number[]) => void;

  setPulseSubdivMask: (beatIndex: number, mask: boolean[]) => void;
  togglePulseSubdivMaskSlot: (beatIndex: number, slotIndex: number) => void;
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

const clampInt = (value: number, min: number, max: number) => {
  const v = Math.floor(Number(value));
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
};

const DEFAULT_SUBDIV = 1;

const normalizePulseSubdivs = (n: number, prev?: number[]) => {
  const safeN = clampInt(n, 1, 64);
  const base = Array.isArray(prev) ? prev.slice(0, safeN) : [];
  while (base.length < safeN) base.push(DEFAULT_SUBDIV);
  return base.map((x) => clampInt(x, 1, 16));
};

const normalizeMask = (subdiv: number, prev?: boolean[]) => {
  const n = clampInt(subdiv, 1, 16);
  const base = Array.from({ length: n }).map((_, i) => (prev?.[i] ?? true));
  // no permitir todo apagado
  if (!base.some(Boolean)) base[0] = true;
  return base;
};

const normalizePulseMasks = (pulseSubdivs: number[], prev?: boolean[][]) => {
  const out: boolean[][] = [];
  for (let i = 0; i < pulseSubdivs.length; i++) {
    const subdiv = clampInt(pulseSubdivs[i] ?? 1, 1, 16);
    out.push(normalizeMask(subdiv, prev?.[i]));
  }
  return out;
};

export const useMeterStore = create<MeterState>((set, get) => {
  const initSubdivs = normalizePulseSubdivs(4);
  const initPulseMasks = normalizePulseMasks(initSubdivs);

  return {
    meter: { n: 4, d: 4 },
    groups: undefined,

    pulseSubdivs: initSubdivs,
    pulseSubdivMasks: initPulseMasks,

    setMeter: (n, d) =>
      set((state) => {
        const nextN = clampInt(n, 1, 64);
        const nextD = clampInt(d, 1, 64);

        const currentGroups = state.groups;
        const isValidForMeter = currentGroups && sum(currentGroups) === nextN ? currentGroups : undefined;

        const nextPulseSubdivs = normalizePulseSubdivs(nextN, state.pulseSubdivs);
        const nextPulseMasks = normalizePulseMasks(nextPulseSubdivs, state.pulseSubdivMasks);

        return {
          meter: { n: nextN, d: nextD },
          groups: isValidForMeter,
          pulseSubdivs: nextPulseSubdivs,
          pulseSubdivMasks: nextPulseMasks,
        };
      }),

    setGroups: (groups) => set({ groups }),
    clearGroups: () => set({ groups: undefined }),

    setPulseSubdiv: (beatIndex, subdiv) =>
      set((state) => {
        const idx = clampInt(beatIndex, 0, Math.max(0, state.meter.n - 1));
        const nextSubdivs = state.pulseSubdivs.slice();
        nextSubdivs[idx] = clampInt(subdiv, 1, 16);

        const nextMasks = normalizePulseMasks(nextSubdivs, state.pulseSubdivMasks);
        return { pulseSubdivs: nextSubdivs, pulseSubdivMasks: nextMasks };
      }),

    setAllPulseSubdivs: (subdiv) =>
      set((state) => {
        const v = clampInt(subdiv, 1, 16);
        const nextSubdivs = Array(state.meter.n).fill(v);
        const nextMasks = normalizePulseMasks(nextSubdivs, state.pulseSubdivMasks);
        return { pulseSubdivs: nextSubdivs, pulseSubdivMasks: nextMasks };
      }),

    setPulseSubdivs: (subdivs) =>
      set((state) => {
        const nextSubdivs = normalizePulseSubdivs(state.meter.n, subdivs);
        const nextMasks = normalizePulseMasks(nextSubdivs, state.pulseSubdivMasks);
        return { pulseSubdivs: nextSubdivs, pulseSubdivMasks: nextMasks };
      }),

    setPulseSubdivMask: (beatIndex, mask) =>
      set((state) => {
        const idx = clampInt(beatIndex, 0, Math.max(0, state.meter.n - 1));
        const subdiv = clampInt(state.pulseSubdivs[idx] ?? 1, 1, 16);
        const nextMasks = state.pulseSubdivMasks.slice();
        nextMasks[idx] = normalizeMask(subdiv, mask);
        return { pulseSubdivMasks: nextMasks };
      }),

    togglePulseSubdivMaskSlot: (beatIndex, slotIndex) =>
      set((state) => {
        const idx = clampInt(beatIndex, 0, Math.max(0, state.meter.n - 1));
        const subdiv = clampInt(state.pulseSubdivs[idx] ?? 1, 1, 16);
        const slot = clampInt(slotIndex, 0, Math.max(0, subdiv - 1));

        const prevMask = normalizeMask(subdiv, state.pulseSubdivMasks[idx]);
        const nextMask = prevMask.slice();
        nextMask[slot] = !nextMask[slot];

        // no permitir todo apagado
        if (!nextMask.some(Boolean)) return state;

        const nextMasks = state.pulseSubdivMasks.slice();
        nextMasks[idx] = nextMask;

        return { pulseSubdivMasks: nextMasks };
      }),
  };
});

export type { Meter };
