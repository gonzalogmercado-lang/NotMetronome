import { create } from "zustand";

import { Meter } from "../core/types";

type Bar = {
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
};

type MeterState = {
  /**
   * Timeline: lista de compases (bars).
   */
  bars: Bar[];

  /**
   * Bar actualmente seleccionado/activo para edición.
   */
  selectedBarIndex: number;

  /**
   * Proxies del bar seleccionado (para compatibilidad con el código actual).
   * Estos campos SIEMPRE reflejan bars[selectedBarIndex].
   */
  meter: Meter;
  groups?: number[];
  pulseSubdivs: number[];
  pulseSubdivMasks: boolean[][];

  /**
   * Bar control
   */
  selectBar: (barIndex: number) => void;
  addBar: () => void; // agrega SIEMPRE un nuevo bar default 4/4
  removeBar: (barIndex: number) => void;

  /**
   * APIs existentes (operan sobre el bar seleccionado)
   */
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

const clampIndex = (value: number, maxExclusive: number) => {
  if (maxExclusive <= 0) return 0;
  return clampInt(value, 0, maxExclusive - 1);
};

const DEFAULT_SUBDIV = 1;

const normalizePulseSubdivs = (n: number, prev?: number[]) => {
  const safeN = clampInt(n, 1, 64);
  const base = Array.isArray(prev) ? prev.slice(0, safeN) : [];
  while (base.length < safeN) base.push(DEFAULT_SUBDIV);
  // Hoy la UI usa 1..8, pero el motor puede tolerar más. Mantenemos 1..16 como antes.
  return base.map((x) => clampInt(x, 1, 16));
};

const normalizeMask = (subdiv: number, prev?: boolean[]) => {
  const n = clampInt(subdiv, 1, 16);
  const base = Array.from({ length: n }).map((_, i) => prev?.[i] ?? true);
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

const makeBar = (n: number, d: number): Bar => {
  const nextN = clampInt(n, 1, 64);
  const nextD = clampInt(d, 1, 64);

  const nextPulseSubdivs = normalizePulseSubdivs(nextN);
  const nextPulseMasks = normalizePulseMasks(nextPulseSubdivs);

  return {
    meter: { n: nextN, d: nextD },
    groups: undefined,
    pulseSubdivs: nextPulseSubdivs,
    pulseSubdivMasks: nextPulseMasks,
  };
};

const normalizeGroupsForMeter = (groups: number[] | undefined, meterN: number) => {
  if (!groups || groups.length === 0) return undefined;
  return sum(groups) === meterN ? groups : undefined;
};

export const useMeterStore = create<MeterState>((set, get) => {
  const initialBar = makeBar(4, 4);

  const syncSelectedProxiesFromBars = (bars: Bar[], selectedBarIndex: number) => {
    const idx = clampIndex(selectedBarIndex, bars.length);
    const bar = bars[idx] ?? initialBar;

    return {
      bars,
      selectedBarIndex: idx,
      meter: bar.meter,
      groups: bar.groups,
      pulseSubdivs: bar.pulseSubdivs,
      pulseSubdivMasks: bar.pulseSubdivMasks,
    };
  };

  const writeSelectedBar = (updater: (bar: Bar) => Bar) => {
    set((state) => {
      const idx = clampIndex(state.selectedBarIndex, state.bars.length);
      const bars = state.bars.slice();
      const current = bars[idx] ?? initialBar;
      const next = updater(current);

      bars[idx] = next;

      // Proxies siempre sincronizados con el bar seleccionado
      return syncSelectedProxiesFromBars(bars, idx);
    });
  };

  return {
    // Timeline
    bars: [initialBar],
    selectedBarIndex: 0,

    // Proxies (bar seleccionado)
    meter: initialBar.meter,
    groups: initialBar.groups,
    pulseSubdivs: initialBar.pulseSubdivs,
    pulseSubdivMasks: initialBar.pulseSubdivMasks,

    // Bar control
    selectBar: (barIndex) =>
      set((state) => {
        return syncSelectedProxiesFromBars(state.bars, barIndex);
      }),

    addBar: () =>
      set((state) => {
        const nextBars = state.bars.slice();
        nextBars.push(makeBar(4, 4)); // ✅ siempre default 4/4
        const nextIndex = nextBars.length - 1;
        return syncSelectedProxiesFromBars(nextBars, nextIndex); // selecciona el nuevo para editar rápido
      }),

    removeBar: (barIndex) =>
      set((state) => {
        if (state.bars.length <= 1) return state; // no permitir 0 bars

        const idxToRemove = clampIndex(barIndex, state.bars.length);
        const nextBars = state.bars.slice();
        nextBars.splice(idxToRemove, 1);

        // Ajustar selección
        let nextSelected = state.selectedBarIndex;
        if (idxToRemove < nextSelected) nextSelected -= 1;
        if (idxToRemove === nextSelected) nextSelected = Math.min(nextSelected, nextBars.length - 1);

        return syncSelectedProxiesFromBars(nextBars, nextSelected);
      }),

    // APIs existentes sobre el bar seleccionado
    setMeter: (n, d) =>
      writeSelectedBar((bar) => {
        const nextN = clampInt(n, 1, 64);
        const nextD = clampInt(d, 1, 64);

        const nextPulseSubdivs = normalizePulseSubdivs(nextN, bar.pulseSubdivs);
        const nextPulseMasks = normalizePulseMasks(nextPulseSubdivs, bar.pulseSubdivMasks);

        const nextGroups = normalizeGroupsForMeter(bar.groups, nextN);

        return {
          meter: { n: nextN, d: nextD },
          groups: nextGroups,
          pulseSubdivs: nextPulseSubdivs,
          pulseSubdivMasks: nextPulseMasks,
        };
      }),

    setGroups: (groups) =>
      writeSelectedBar((bar) => {
        const nextGroups = normalizeGroupsForMeter(groups, bar.meter.n);
        return { ...bar, groups: nextGroups };
      }),

    clearGroups: () =>
      writeSelectedBar((bar) => {
        return { ...bar, groups: undefined };
      }),

    setPulseSubdiv: (beatIndex, subdiv) =>
      writeSelectedBar((bar) => {
        const idx = clampInt(beatIndex, 0, Math.max(0, bar.meter.n - 1));
        const nextSubdivs = bar.pulseSubdivs.slice();
        nextSubdivs[idx] = clampInt(subdiv, 1, 16);

        const nextMasks = normalizePulseMasks(nextSubdivs, bar.pulseSubdivMasks);
        return { ...bar, pulseSubdivs: nextSubdivs, pulseSubdivMasks: nextMasks };
      }),

    setAllPulseSubdivs: (subdiv) =>
      writeSelectedBar((bar) => {
        const v = clampInt(subdiv, 1, 16);
        const nextSubdivs = Array(bar.meter.n).fill(v);
        const nextMasks = normalizePulseMasks(nextSubdivs, bar.pulseSubdivMasks);
        return { ...bar, pulseSubdivs: nextSubdivs, pulseSubdivMasks: nextMasks };
      }),

    setPulseSubdivs: (subdivs) =>
      writeSelectedBar((bar) => {
        const nextSubdivs = normalizePulseSubdivs(bar.meter.n, subdivs);
        const nextMasks = normalizePulseMasks(nextSubdivs, bar.pulseSubdivMasks);
        return { ...bar, pulseSubdivs: nextSubdivs, pulseSubdivMasks: nextMasks };
      }),

    setPulseSubdivMask: (beatIndex, mask) =>
      writeSelectedBar((bar) => {
        const idx = clampInt(beatIndex, 0, Math.max(0, bar.meter.n - 1));
        const subdiv = clampInt(bar.pulseSubdivs[idx] ?? 1, 1, 16);
        const nextMasks = bar.pulseSubdivMasks.slice();
        nextMasks[idx] = normalizeMask(subdiv, mask);
        return { ...bar, pulseSubdivMasks: nextMasks };
      }),

    togglePulseSubdivMaskSlot: (beatIndex, slotIndex) =>
      writeSelectedBar((bar) => {
        const idx = clampInt(beatIndex, 0, Math.max(0, bar.meter.n - 1));
        const subdiv = clampInt(bar.pulseSubdivs[idx] ?? 1, 1, 16);
        const slot = clampInt(slotIndex, 0, Math.max(0, subdiv - 1));

        const prevMask = normalizeMask(subdiv, bar.pulseSubdivMasks[idx]);
        const nextMask = prevMask.slice();
        nextMask[slot] = !nextMask[slot];

        // no permitir todo apagado
        if (!nextMask.some(Boolean)) return bar;

        const nextMasks = bar.pulseSubdivMasks.slice();
        nextMasks[idx] = nextMask;

        return { ...bar, pulseSubdivMasks: nextMasks };
      }),
  };
});

export type { Bar, Meter };

