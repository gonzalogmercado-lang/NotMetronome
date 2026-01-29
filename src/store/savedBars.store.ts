import { create } from "zustand";

import { Meter } from "../core/types";

export type SavedBar = {
  id: string;
  name: string;
  meter: Meter;
  claveEnabled: boolean;
  groups?: number[];
  createdAtMs?: number;
  updatedAtMs?: number;
};

type SavedBarsState = {
  savedBars: SavedBar[];

  addSavedBar: (bar: Omit<SavedBar, "id" | "createdAtMs" | "updatedAtMs"> & { id?: string }) => string;
  updateSavedBar: (id: string, patch: Partial<Omit<SavedBar, "id">>) => void;
  removeSavedBar: (id: string) => void;

  getById: (id: string) => SavedBar | null;
  clearSavedBars: () => void;
};

const newId = () => `saved_${Date.now()}_${Math.random().toString(16).slice(2)}`;

const cloneMeter = (m: Meter): Meter => ({ n: m.n, d: m.d });
const cloneGroups = (g?: number[]) => (Array.isArray(g) ? g.slice() : g);

export const useSavedBarsStore = create<SavedBarsState>((set, get) => ({
  savedBars: [],

  addSavedBar: (input) => {
    const now = Date.now();
    const id = input.id ?? newId();

    const next: SavedBar = {
      id,
      name: input.name ?? "Saved bar",
      meter: cloneMeter(input.meter),
      claveEnabled: !!input.claveEnabled,
      groups: cloneGroups(input.groups),
      createdAtMs: now,
      updatedAtMs: now,
    };

    set((state) => ({ savedBars: [...state.savedBars, next] }));
    return id;
  },

  updateSavedBar: (id, patch) => {
    const now = Date.now();
    set((state) => ({
      savedBars: state.savedBars.map((b) => {
        if (b.id !== id) return b;

        const next: SavedBar = {
          ...b,
          ...patch,
          meter: patch.meter ? cloneMeter(patch.meter) : b.meter,
          groups: patch.groups !== undefined ? cloneGroups(patch.groups) : b.groups,
          updatedAtMs: now,
        };

        // Clones defensivos para inmutabilidad real
        next.meter = cloneMeter(next.meter);
        next.groups = cloneGroups(next.groups);

        return next;
      }),
    }));
  },

  removeSavedBar: (id) => {
    set((state) => ({ savedBars: state.savedBars.filter((b) => b.id !== id) }));
  },

  getById: (id) => {
    return get().savedBars.find((b) => b.id === id) ?? null;
  },

  clearSavedBars: () => set({ savedBars: [] }),
}));

export default useSavedBarsStore;
