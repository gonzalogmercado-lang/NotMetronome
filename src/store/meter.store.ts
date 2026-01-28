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
   * ✅ Duplica el bar indicado (deep clone) y agrega el duplicado AL FINAL.
   */
  duplicateBar: (barIndex: number) => void;

  /**
   * ✅ Reemplaza el timeline completo (para cargar proyectos)
   */
  replaceTimeline: (bars: Bar[], selectedBarIndex?: number) => void;

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

// Clave rules (user preference)
const MIN_GROUP_SIZE = 2;
const MAX_GROUP_SIZE = 8;

const normalizePulseSubdivs = (n: number, prev?: number[]) => {
  const safeN = clampInt(n, 1, 64);
  return Array.from({ length: safeN }, (_, i) => {
    const raw = Array.isArray(prev) ? prev[i] : DEFAULT_SUBDIV;
    return clampInt(raw ?? DEFAULT_SUBDIV, 1, 16);
  });
};

const normalizeMask = (subdiv: number, prev?: boolean[]) => {
  const n = clampInt(subdiv, 1, 16);
  // ✅ Permitir TODO apagado (silencio real). Default: true si no hay dato previo.
  return Array.from({ length: n }, (_, i) => prev?.[i] ?? true);
};

const normalizePulseMasks = (pulseSubdivs: number[], prev?: boolean[][]) => {
  return pulseSubdivs.map((s, i) => {
    const subdiv = clampInt(s ?? 1, 1, 16);
    return normalizeMask(subdiv, prev?.[i]);
  });
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

const computePoolTicksForBar = (meter: Meter, pulseSubdivs: number[]) => {
  // pool-mode solo tiene sentido en d=4 (por ahora)
  if (meter.d !== 4) return meter.n;
  if (!Array.isArray(pulseSubdivs) || pulseSubdivs.length !== meter.n) return meter.n;
  return sum(pulseSubdivs.map((v) => clampInt(v ?? 1, 1, 16)));
};

/**
 * ✅ Normaliza groups soportando:
 * - beat-mode: sum(groups) === meter.n
 * - pool-mode (solo d=4): sum(groups) === sum(pulseSubdivs) (ej 20 en quintillos)
 *
 * Además aplica regla: grupos 2..8.
 */
const normalizeGroupsForBar = (groups: number[] | undefined, bar: { meter: Meter; pulseSubdivs: number[] }) => {
  if (!groups || groups.length === 0) return undefined;

  const safe: number[] = [];
  for (let i = 0; i < groups.length; i += 1) {
    const g = clampInt(groups[i] as any, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    if (!Number.isFinite(g)) return undefined;
    if (g < MIN_GROUP_SIZE || g > MAX_GROUP_SIZE) return undefined;
    safe.push(g);
  }

  const total = sum(safe);
  const beatTicks = bar.meter.n;
  const poolTicks = computePoolTicksForBar(bar.meter, bar.pulseSubdivs);

  if (total === beatTicks) return safe.slice(); // beat-mode
  if (bar.meter.d === 4 && total === poolTicks) return safe.slice(); // pool-mode
  return undefined;
};

const normalizeIncomingBar = (b: Bar): Bar => {
  const nextN = clampInt(b?.meter?.n ?? 4, 1, 64);
  const nextD = clampInt(b?.meter?.d ?? 4, 1, 64);

  const nextPulseSubdivs = normalizePulseSubdivs(nextN, b?.pulseSubdivs);
  const nextPulseMasks = normalizePulseMasks(nextPulseSubdivs, b?.pulseSubdivMasks);

  const nextMeter: Meter = { n: nextN, d: nextD };
  const nextGroups = normalizeGroupsForBar(b?.groups, { meter: nextMeter, pulseSubdivs: nextPulseSubdivs });

  return {
    meter: nextMeter,
    groups: nextGroups,
    pulseSubdivs: nextPulseSubdivs,
    pulseSubdivMasks: nextPulseMasks,
  };
};

// ✅ deep clone para duplicar SIN refs compartidas
const cloneBarDeep = (b: Bar): Bar => {
  return {
    meter: { n: b.meter.n, d: b.meter.d },
    groups: b.groups ? b.groups.slice() : undefined,
    pulseSubdivs: (b.pulseSubdivs ?? []).slice(),
    pulseSubdivMasks: (b.pulseSubdivMasks ?? []).map((row) => (row ?? []).slice()),
  };
};

export const useMeterStore = create<MeterState>((set) => {
  const initialBar = makeBar(4, 4);

  const syncSelectedProxiesFromBars = (bars: Bar[], selectedBarIndex: number) => {
    const safeBars = bars.length > 0 ? bars : [initialBar];
    const idx = clampIndex(selectedBarIndex, safeBars.length);
    const bar = safeBars[idx] ?? initialBar;

    return {
      bars: safeBars,
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
      const current = state.bars[idx] ?? initialBar;
      const next = updater(current);

      const nextBars =
        state.bars.length > 0
          ? state.bars.map((b, i) => (i === idx ? next : b))
          : [next];

      return syncSelectedProxiesFromBars(nextBars, idx);
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
        const nextBars = [...state.bars, makeBar(4, 4)]; // ✅ sin push/splice
        const nextIndex = nextBars.length - 1;
        return syncSelectedProxiesFromBars(nextBars, nextIndex); // selecciona el nuevo para editar rápido
      }),

    // ✅ DUPLICATE: clona el bar indicado (deep) y lo agrega AL FINAL, seleccionándolo.
    duplicateBar: (barIndex) =>
      set((state) => {
        const safeBars = state.bars.length > 0 ? state.bars : [initialBar];
        const idx = clampIndex(barIndex, safeBars.length);
        const current = safeBars[idx] ?? initialBar;

        const dup = cloneBarDeep(current);

        const nextBars = [...safeBars, dup]; // 🔥 al final
        const nextIndex = nextBars.length - 1;

        return syncSelectedProxiesFromBars(nextBars, nextIndex);
      }),

    removeBar: (barIndex) =>
      set((state) => {
        if (state.bars.length <= 1) return state; // no permitir 0 bars

        const idxToRemove = clampIndex(barIndex, state.bars.length);

        const nextBars = state.bars.filter((_, i) => i !== idxToRemove); // ✅ sin splice

        // Ajustar selección
        let nextSelected = state.selectedBarIndex;
        if (idxToRemove < nextSelected) nextSelected -= 1;
        if (idxToRemove === nextSelected) nextSelected = Math.min(nextSelected, nextBars.length - 1);

        return syncSelectedProxiesFromBars(nextBars, nextSelected);
      }),

    // ✅ Carga completa de timeline (para proyectos)
    replaceTimeline: (bars, selectedBarIndex) =>
      set(() => {
        const incoming = Array.isArray(bars) ? bars : [];
        const nextBarsRaw = incoming.length > 0 ? incoming : [initialBar];

        // Normalizamos + cortamos refs internas (defensivo)
        const nextBars = nextBarsRaw.map((b) => normalizeIncomingBar(b));

        const idx = clampIndex(selectedBarIndex ?? 0, nextBars.length);
        return syncSelectedProxiesFromBars(nextBars, idx);
      }),

    // APIs existentes sobre el bar seleccionado
    setMeter: (n, d) =>
      writeSelectedBar((bar) => {
        const nextN = clampInt(n, 1, 64);
        const nextD = clampInt(d, 1, 64);

        const nextPulseSubdivs = normalizePulseSubdivs(nextN, bar.pulseSubdivs);
        const nextPulseMasks = normalizePulseMasks(nextPulseSubdivs, bar.pulseSubdivMasks);

        const nextMeter: Meter = { n: nextN, d: nextD };
        const nextGroups = normalizeGroupsForBar(bar.groups, { meter: nextMeter, pulseSubdivs: nextPulseSubdivs });

        return {
          meter: nextMeter,
          groups: nextGroups,
          pulseSubdivs: nextPulseSubdivs,
          pulseSubdivMasks: nextPulseMasks,
        };
      }),

    setGroups: (groups) =>
      writeSelectedBar((bar) => {
        const nextGroups = normalizeGroupsForBar(groups, { meter: bar.meter, pulseSubdivs: bar.pulseSubdivs });
        return { ...bar, groups: nextGroups };
      }),

    clearGroups: () =>
      writeSelectedBar((bar) => {
        return { ...bar, groups: undefined };
      }),

    setPulseSubdiv: (beatIndex, subdiv) =>
      writeSelectedBar((bar) => {
        const idx = clampInt(beatIndex, 0, Math.max(0, bar.meter.n - 1));
        const nextSubdivs = bar.pulseSubdivs.map((v, i) => (i === idx ? clampInt(subdiv, 1, 16) : v));

        const nextMasks = normalizePulseMasks(nextSubdivs, bar.pulseSubdivMasks);

        // ✅ si groups era pool-mode, puede volverse inválido al cambiar subdivs
        const nextGroups = normalizeGroupsForBar(bar.groups, { meter: bar.meter, pulseSubdivs: nextSubdivs });

        return { ...bar, groups: nextGroups, pulseSubdivs: nextSubdivs, pulseSubdivMasks: nextMasks };
      }),

    setAllPulseSubdivs: (subdiv) =>
      writeSelectedBar((bar) => {
        const v = clampInt(subdiv, 1, 16);
        const nextSubdivs = Array.from({ length: bar.meter.n }, () => v);
        const nextMasks = normalizePulseMasks(nextSubdivs, bar.pulseSubdivMasks);

        const nextGroups = normalizeGroupsForBar(bar.groups, { meter: bar.meter, pulseSubdivs: nextSubdivs });

        return { ...bar, groups: nextGroups, pulseSubdivs: nextSubdivs, pulseSubdivMasks: nextMasks };
      }),

    setPulseSubdivs: (subdivs) =>
      writeSelectedBar((bar) => {
        const nextSubdivs = normalizePulseSubdivs(bar.meter.n, subdivs);
        const nextMasks = normalizePulseMasks(nextSubdivs, bar.pulseSubdivMasks);

        const nextGroups = normalizeGroupsForBar(bar.groups, { meter: bar.meter, pulseSubdivs: nextSubdivs });

        return { ...bar, groups: nextGroups, pulseSubdivs: nextSubdivs, pulseSubdivMasks: nextMasks };
      }),

    setPulseSubdivMask: (beatIndex, mask) =>
      writeSelectedBar((bar) => {
        const idx = clampInt(beatIndex, 0, Math.max(0, bar.meter.n - 1));
        const subdiv = clampInt(bar.pulseSubdivs[idx] ?? 1, 1, 16);
        const nextRow = normalizeMask(subdiv, mask);

        // ✅ clonamos también filas no tocadas (defensivo contra refs compartidas)
        const nextMasks = bar.pulseSubdivMasks.map((row, i) => (i === idx ? nextRow : row.slice()));

        return { ...bar, pulseSubdivMasks: nextMasks };
      }),

    togglePulseSubdivMaskSlot: (beatIndex, slotIndex) =>
      writeSelectedBar((bar) => {
        const idx = clampInt(beatIndex, 0, Math.max(0, bar.meter.n - 1));
        const subdiv = clampInt(bar.pulseSubdivs[idx] ?? 1, 1, 16);
        const slot = clampInt(slotIndex, 0, Math.max(0, subdiv - 1));

        const prevMask = normalizeMask(subdiv, bar.pulseSubdivMasks[idx]);
        const nextMask = prevMask.map((v, i) => (i === slot ? !v : v));

        // ✅ permitir todo apagado
        // ✅ clonamos filas internas para cortar refs
        const nextMasks = bar.pulseSubdivMasks.map((row, i) => (i === idx ? nextMask : row.slice()));

        return { ...bar, pulseSubdivMasks: nextMasks };
      }),
  };
});

export type { Bar, Meter };
