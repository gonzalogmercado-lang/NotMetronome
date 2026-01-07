import { create } from "zustand";

import { sumGroups } from "../core/clave/builder";
import { formatGroups } from "../core/clave/presets";
import { Meter } from "../core/types";

type SavedBar = {
  id: string;
  name: string;
  meter: Meter;
  claveEnabled: boolean;
  groups?: number[];
  createdAt: number;
  updatedAt: number;
};

type SavedBarsState = {
  savedBars: SavedBar[];
  addFromCurrent: (current: { meter: Meter; claveEnabled: boolean; groups?: number[] }, name?: string) => SavedBar;
  add: (bar: SavedBar) => void;
  update: (id: string, patch: Partial<Omit<SavedBar, "id" | "createdAt">>) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
  getById: (id: string) => SavedBar | undefined;
};

const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeGroups = (meter: Meter, claveEnabled: boolean, groups?: number[]): number[] | undefined => {
  if (!claveEnabled) return undefined;
  if (!groups || groups.length === 0) return undefined;
  if (sumGroups(groups) !== meter.n) return undefined;
  return groups;
};

const buildDefaultName = (meter: Meter, groups?: number[]) => {
  const suffix = groups && groups.length > 0 ? ` ${formatGroups(groups)}` : "";
  return `${meter.n}/${meter.d}${suffix}`.trim();
};

export const useSavedBarsStore = create<SavedBarsState>((set, get) => ({
  savedBars: [],
  addFromCurrent: (current, name) => {
    const now = Date.now();
    const normalizedGroups = normalizeGroups(current.meter, current.claveEnabled, current.groups);
    const resolvedName = name?.trim() || buildDefaultName(current.meter, normalizedGroups);
    const bar: SavedBar = {
      id: createId(),
      name: resolvedName,
      meter: current.meter,
      claveEnabled: current.claveEnabled,
      groups: normalizedGroups,
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({ savedBars: [...state.savedBars, bar] }));
    return bar;
  },
  add: (bar) => {
    set((state) => ({ savedBars: [...state.savedBars, bar] }));
  },
  update: (id, patch) => {
    set((state) => ({
      savedBars: state.savedBars.map((bar) => {
        if (bar.id !== id) return bar;
        const meter = patch.meter ?? bar.meter;
        const claveEnabled = patch.claveEnabled ?? bar.claveEnabled;
        const groups = normalizeGroups(meter, claveEnabled, patch.groups ?? bar.groups);
        return {
          ...bar,
          ...patch,
          meter,
          claveEnabled,
          groups,
          updatedAt: Date.now(),
        };
      }),
    }));
  },
  remove: (id) => set((state) => ({ savedBars: state.savedBars.filter((bar) => bar.id !== id) })),
  duplicate: (id) => {
    const existing = get().savedBars.find((bar) => bar.id === id);
    if (!existing) return;
    const now = Date.now();
    const copy: SavedBar = {
      ...existing,
      id: createId(),
      name: `${existing.name} (copy)`,
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({ savedBars: [...state.savedBars, copy] }));
  },
  getById: (id) => get().savedBars.find((bar) => bar.id === id),
}));

// Persistencia opcional: si se agrega AsyncStorage en el futuro,
// envolver el store con `persist` y un storage compatible.

export type { SavedBar };
