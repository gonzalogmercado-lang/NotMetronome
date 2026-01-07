import { create } from "zustand";

import { sumGroups } from "../core/clave/builder";
import { Meter } from "../core/types";
import { useSavedBarsStore } from "./savedBars.store";

type CreatorBar = {
  id: string;
  meter: Meter;
  claveEnabled: boolean;
  groups?: number[];
  name?: string;
};

type CreatorState = {
  bars: CreatorBar[];
  selectedBarId: string | null;
  initFromCurrentIfEmpty: (current: { meter: Meter; claveEnabled: boolean; groups?: number[] }) => void;
  selectBar: (id: string | null) => void;
  addEmptyBar: (afterId?: string) => void;
  addFromSavedBar: (savedBarId: string, afterId?: string) => void;
  duplicateBar: (id: string) => void;
  removeBar: (id: string) => void;
  updateBar: (id: string, patch: Partial<Omit<CreatorBar, "id">>) => void;
  replaceAll: (bars: CreatorBar[]) => void;
};

const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeGroups = (meter: Meter, claveEnabled: boolean, groups?: number[]): number[] | undefined => {
  if (!claveEnabled) return undefined;
  if (!groups || groups.length === 0) return undefined;
  if (sumGroups(groups) !== meter.n) return undefined;
  return groups;
};

const normalizeBar = (bar: CreatorBar): CreatorBar => {
  const groups = normalizeGroups(bar.meter, bar.claveEnabled, bar.groups);
  return { ...bar, groups };
};

const createEmptyBar = (): CreatorBar => ({
  id: createId(),
  meter: { n: 4, d: 4 },
  claveEnabled: false,
  groups: undefined,
});

const insertAfter = (bars: CreatorBar[], bar: CreatorBar, afterId?: string) => {
  if (!afterId) return [...bars, bar];
  const index = bars.findIndex((item) => item.id === afterId);
  if (index === -1) return [...bars, bar];
  const next = [...bars];
  next.splice(index + 1, 0, bar);
  return next;
};

export const useCreatorStore = create<CreatorState>((set, get) => ({
  bars: [],
  selectedBarId: null,
  initFromCurrentIfEmpty: (current) => {
    const state = get();
    if (state.bars.length > 0) return;
    const initial: CreatorBar = normalizeBar({
      id: createId(),
      meter: current.meter,
      claveEnabled: current.claveEnabled,
      groups: current.groups,
    });
    set({ bars: [initial], selectedBarId: initial.id });
  },
  selectBar: (id) => set({ selectedBarId: id }),
  addEmptyBar: (afterId) => {
    const newBar = createEmptyBar();
    set((state) => ({
      bars: insertAfter(state.bars, newBar, afterId),
      selectedBarId: newBar.id,
    }));
  },
  addFromSavedBar: (savedBarId, afterId) => {
    const savedBar = useSavedBarsStore.getState().getById(savedBarId);
    if (!savedBar) return;
    const newBar: CreatorBar = normalizeBar({
      id: createId(),
      meter: savedBar.meter,
      claveEnabled: savedBar.claveEnabled,
      groups: savedBar.groups,
      name: savedBar.name,
    });
    set((state) => ({
      bars: insertAfter(state.bars, newBar, afterId),
      selectedBarId: newBar.id,
    }));
  },
  duplicateBar: (id) => {
    const bar = get().bars.find((item) => item.id === id);
    if (!bar) return;
    const newBar: CreatorBar = {
      ...bar,
      id: createId(),
      name: bar.name ? `${bar.name} (copy)` : bar.name,
    };
    set((state) => ({
      bars: insertAfter(state.bars, normalizeBar(newBar), id),
      selectedBarId: newBar.id,
    }));
  },
  removeBar: (id) => {
    set((state) => {
      const remaining = state.bars.filter((bar) => bar.id !== id);
      if (remaining.length === 0) {
        const empty = createEmptyBar();
        return { bars: [empty], selectedBarId: empty.id };
      }
      const nextSelected = state.selectedBarId === id ? remaining[0].id : state.selectedBarId;
      return { bars: remaining, selectedBarId: nextSelected };
    });
  },
  updateBar: (id, patch) => {
    set((state) => ({
      bars: state.bars.map((bar) => {
        if (bar.id !== id) return bar;
        const meter = patch.meter ?? bar.meter;
        const claveEnabled = patch.claveEnabled ?? bar.claveEnabled;
        const groups = normalizeGroups(meter, claveEnabled, patch.groups ?? bar.groups);
        return normalizeBar({
          ...bar,
          ...patch,
          meter,
          claveEnabled,
          groups,
        });
      }),
    }));
  },
  replaceAll: (bars) => {
    const normalized = bars.map(normalizeBar);
    if (normalized.length === 0) {
      const empty = createEmptyBar();
      set({ bars: [empty], selectedBarId: empty.id });
      return;
    }
    set({ bars: normalized, selectedBarId: normalized[0].id });
  },
}));

export type { CreatorBar };
