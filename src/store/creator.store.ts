import { create } from "zustand";

import { Meter } from "../core/types";
import { useSavedBarsStore } from "./savedBars.store";

export type CreatorBar = {
  id: string;
  meter: Meter;
  claveEnabled: boolean;
  groups?: number[];
  name?: string;
};

type InitFromCurrentInput = {
  meter: Meter;
  claveEnabled: boolean;
  groups?: number[];
};

type CreatorState = {
  bars: CreatorBar[];
  selectedBarId: string | null;

  initFromCurrentIfEmpty: (input: InitFromCurrentInput) => void;

  selectBar: (barId: string) => void;

  addEmptyBar: (afterBarId?: string) => void;
  addFromSavedBar: (savedId: string, afterBarId?: string) => void;
  duplicateBar: (barId: string) => void;

  removeBar: (barId: string) => void;
  updateBar: (barId: string, patch: Partial<Omit<CreatorBar, "id">>) => void;
};

const newId = () => `bar_${Date.now()}_${Math.random().toString(16).slice(2)}`;

const cloneMeter = (m: Meter): Meter => ({ n: m.n, d: m.d });
const cloneGroups = (g?: number[]) => (Array.isArray(g) ? g.slice() : g);

const normalizePatch = (patch: Partial<Omit<CreatorBar, "id">>) => ({
  ...patch,
  meter: patch.meter ? cloneMeter(patch.meter) : undefined,
  groups: patch.groups ? cloneGroups(patch.groups) : patch.groups,
});

const insertAfter = (arr: CreatorBar[], afterId: string | undefined, item: CreatorBar) => {
  if (!afterId) return [...arr, item];
  const idx = arr.findIndex((b) => b.id === afterId);
  if (idx === -1) return [...arr, item];
  return [...arr.slice(0, idx + 1), item, ...arr.slice(idx + 1)];
};

export const useCreatorStore = create<CreatorState>((set, get) => ({
  bars: [],
  selectedBarId: null,

  initFromCurrentIfEmpty: ({ meter, claveEnabled, groups }) => {
    const { bars } = get();
    if (bars.length > 0) return;

    const first: CreatorBar = {
      id: newId(),
      meter: cloneMeter(meter),
      claveEnabled: !!claveEnabled,
      groups: cloneGroups(groups),
    };

    set({ bars: [first], selectedBarId: first.id });
  },

  selectBar: (barId) => {
    set({ selectedBarId: barId });
  },

  addEmptyBar: (afterBarId) => {
    const base = get().bars[get().bars.length - 1];
    const bar: CreatorBar = {
      id: newId(),
      meter: base ? cloneMeter(base.meter) : { n: 4, d: 4 },
      claveEnabled: false,
      groups: [],
      name: "",
    };

    set((state) => ({
      bars: insertAfter(state.bars, afterBarId, bar),
      selectedBarId: bar.id,
    }));
  },

  addFromSavedBar: (savedId, afterBarId) => {
    const savedBars = useSavedBarsStore.getState().savedBars as any[];
    const saved = savedBars.find((s) => s.id === savedId);
    if (!saved) return;

    const bar: CreatorBar = {
      id: newId(),
      meter: saved.meter ? cloneMeter(saved.meter) : { n: 4, d: 4 },
      claveEnabled: !!saved.claveEnabled,
      groups: cloneGroups(saved.groups),
      name: typeof saved.name === "string" ? saved.name : "",
    };

    set((state) => ({
      bars: insertAfter(state.bars, afterBarId, bar),
      selectedBarId: bar.id,
    }));
  },

  duplicateBar: (barId) => {
    const src = get().bars.find((b) => b.id === barId);
    if (!src) return;

    const copy: CreatorBar = {
      ...src,
      id: newId(),
      meter: cloneMeter(src.meter),
      groups: cloneGroups(src.groups),
      name: src.name ? `${src.name} (copy)` : "",
    };

    set((state) => ({
      bars: insertAfter(state.bars, barId, copy),
      selectedBarId: copy.id,
    }));
  },

  removeBar: (barId) => {
    set((state) => {
      const nextBars = state.bars.filter((b) => b.id !== barId);

      let nextSelected: string | null = state.selectedBarId;
      if (state.selectedBarId === barId) {
        nextSelected = nextBars.length ? nextBars[Math.max(0, nextBars.length - 1)].id : null;
      }

      return { bars: nextBars, selectedBarId: nextSelected };
    });
  },

  updateBar: (barId, patch) => {
    const p = normalizePatch(patch);

    set((state) => ({
      bars: state.bars.map((b) => {
        if (b.id !== barId) return b;

        const next: CreatorBar = {
          ...b,
          ...p,
          meter: p.meter ?? b.meter,
          groups: p.groups !== undefined ? p.groups : b.groups,
        };

        next.meter = cloneMeter(next.meter);
        next.groups = cloneGroups(next.groups);

        return next;
      }),
    }));
  },
}));

export default useCreatorStore;
