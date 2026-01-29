import { Platform } from "react-native";
import { create } from "zustand";

import { Bar, useMeterStore } from "./meter.store";
import { useTempoStore } from "./tempo.store";
import { useUiStore } from "./ui.store";

/**
 * Nota: NO importamos AsyncStorage directo para no romper TS si no está instalado.
 * Lo intentamos cargar dinámicamente. En Web usamos localStorage.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: any;

type ProjectSnapshot = {
  bpm: number;
  bars: Bar[];
  selectedBarIndex: number;
  proMode: boolean;
  beatGuide: boolean;
};

type Project = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  snapshot: ProjectSnapshot;
};

type ProjectMetaState = {
  projects: Project[];
  activeProjectId: string;

  // proxy para UI actual
  projectName: string;

  // hidratación + guardado
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  saveActiveNow: () => Promise<void>;

  // acciones de UI
  setProjectName: (name: string) => void;
  resetProjectName: () => void;
  newProject: () => Promise<void>;
  openProject: (projectId: string) => Promise<void>;
};

const STORAGE_KEY = "notmetronome:projects:v1";
const DEFAULT_PROJECT_NAME = "Proyecto sin nombre";
const MAX_LEN = 60;
const MAX_PROJECTS = 200;

const clampInt = (value: number, min: number, max: number) => {
  const v = Math.floor(Number(value));
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
};

const clampIndex = (value: number, maxExclusive: number) => {
  if (maxExclusive <= 0) return 0;
  return clampInt(value, 0, maxExclusive - 1);
};

const sanitizeName = (name: string) => {
  const trimmed = String(name ?? "").trim();
  return trimmed.length > 0 ? trimmed.slice(0, MAX_LEN) : DEFAULT_PROJECT_NAME;
};

const createId = () =>
  `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const cloneBarsDeep = (bars: Bar[]): Bar[] => {
  const src = Array.isArray(bars) ? bars : [];

  const out: Bar[] = [];
  for (let i = 0; i < src.length; i += 1) {
    const b = src[i];

    const groups = Array.isArray((b as any)?.groups) ? (b as any).groups.slice() : undefined;
    const pulseSubdivs = Array.isArray((b as any)?.pulseSubdivs) ? (b as any).pulseSubdivs.slice() : [];

    const masksSrc = Array.isArray((b as any)?.pulseSubdivMasks) ? (b as any).pulseSubdivMasks : [];
    const pulseSubdivMasks = masksSrc.map((row: any) => (Array.isArray(row) ? row.slice() : []));

    out.push({
      meter: { n: b.meter.n, d: b.meter.d },
      groups,
      pulseSubdivs,
      pulseSubdivMasks,
    });
  }

  return out;
};

const makeDefaultSnapshot = (): ProjectSnapshot => {
  const defaultBar: Bar = {
    meter: { n: 4, d: 4 },
    groups: undefined,
    pulseSubdivs: [1, 1, 1, 1],
    pulseSubdivMasks: [[true], [true], [true], [true]],
  };

  return {
    bpm: 120,
    bars: cloneBarsDeep([defaultBar]),
    selectedBarIndex: 0,
    proMode: false,
    beatGuide: false,
  };
};

const captureSnapshot = (): ProjectSnapshot => {
  const tempo: any = useTempoStore.getState();
  const meter: any = useMeterStore.getState();
  const ui: any = useUiStore.getState();

  const bpm = clampInt(tempo?.bpm ?? 120, 30, 300);
  const bars = cloneBarsDeep(meter?.bars ?? []);
  const selectedBarIndex = clampIndex(meter?.selectedBarIndex ?? 0, Math.max(1, bars.length));

  return {
    bpm,
    bars: bars.length > 0 ? bars : makeDefaultSnapshot().bars,
    selectedBarIndex,
    proMode: !!ui?.proMode,
    beatGuide: !!ui?.beatGuide,
  };
};

let isApplying = false;

const applySnapshotToApp = (snap: ProjectSnapshot) => {
  isApplying = true;
  try {
    // Tempo
    const tempo: any = useTempoStore.getState();
    if (typeof tempo?.setBpm === "function") tempo.setBpm(snap.bpm);
    else useTempoStore.setState({ bpm: snap.bpm } as any);

    // UI flags
    const ui: any = useUiStore.getState();
    if (typeof ui?.setProMode === "function") ui.setProMode(!!snap.proMode);
    else useUiStore.setState({ proMode: !!snap.proMode } as any);

    if (typeof ui?.setBeatGuide === "function") ui.setBeatGuide(!!snap.beatGuide);
    else useUiStore.setState({ beatGuide: !!snap.beatGuide } as any);

    // Meter timeline (usar API del store si existe)
    const nextBars = cloneBarsDeep(snap.bars ?? []);
    const safeBars = nextBars.length > 0 ? nextBars : makeDefaultSnapshot().bars;

    const nextSelected = clampIndex(snap.selectedBarIndex ?? 0, safeBars.length);

    const meterState: any = useMeterStore.getState();
    if (typeof meterState?.replaceTimeline === "function") {
      meterState.replaceTimeline(safeBars, nextSelected);
    } else {
      const activeBar = safeBars[nextSelected] ?? safeBars[0];

      useMeterStore.setState(
        {
          bars: safeBars,
          selectedBarIndex: nextSelected,
          meter: { n: activeBar.meter.n, d: activeBar.meter.d },
          groups: activeBar.groups ? activeBar.groups.slice() : undefined,
          pulseSubdivs: (activeBar.pulseSubdivs ?? []).slice(),
          pulseSubdivMasks: (activeBar.pulseSubdivMasks ?? []).map((row) => (row ?? []).slice()),
        } as any,
        false
      );
    }
  } finally {
    isApplying = false;
  }
};

// ----------------------
// storage adapter
// ----------------------
const getAsyncStorage = () => {
  try {
    const mod = require("@react-native-async-storage/async-storage");
    return mod?.default ?? mod ?? null;
  } catch {
    return null;
  }
};

const storageGet = async (key: string): Promise<string | null> => {
  if (Platform.OS === "web") {
    try {
      const ls: any = (globalThis as any)?.localStorage;
      return ls ? (ls.getItem(key) as string | null) : null;
    } catch {
      return null;
    }
  }
  const AS = getAsyncStorage();
  if (!AS) return null;
  return await AS.getItem(key);
};

const storageSet = async (key: string, value: string): Promise<void> => {
  if (Platform.OS === "web") {
    try {
      const ls: any = (globalThis as any)?.localStorage;
      if (ls) ls.setItem(key, value);
    } catch {
      // noop
    }
    return;
  }
  const AS = getAsyncStorage();
  if (!AS) return;
  await AS.setItem(key, value);
};

// ----------------------
// store
// ----------------------
export const useProjectMetaStore = create<ProjectMetaState>((set, get) => {
  const now = Date.now();
  const bootSnap = captureSnapshot();

  const firstProject: Project = {
    id: createId(),
    name: DEFAULT_PROJECT_NAME,
    createdAt: now,
    updatedAt: now,
    snapshot: {
      ...bootSnap,
      bars: cloneBarsDeep(bootSnap.bars),
    },
  };

  return {
    projects: [firstProject],
    activeProjectId: firstProject.id,
    projectName: firstProject.name,

    isHydrated: false,

    hydrate: async () => {
      if (get().isHydrated) return;

      const raw = await storageGet(STORAGE_KEY);
      if (!raw) {
        set({ isHydrated: true });
        return;
      }

      try {
        const parsed = JSON.parse(raw) as any;
        const projects: Project[] = Array.isArray(parsed?.projects) ? parsed.projects : [];
        const activeProjectId: string = String(parsed?.activeProjectId ?? "");

        const safeProjects = projects.filter(
          (p) => p && typeof p.id === "string" && p.snapshot && Array.isArray(p.snapshot.bars)
        );

        const finalProjects =
          safeProjects.length > 0 ? safeProjects.slice(0, MAX_PROJECTS) : [firstProject];

        const active =
          finalProjects.find((p) => p.id === activeProjectId) ?? finalProjects[0] ?? firstProject;

        set({
          projects: finalProjects,
          activeProjectId: active.id,
          projectName: active.name,
          isHydrated: true,
        });

        if (active?.snapshot) {
          applySnapshotToApp({
            ...active.snapshot,
            bars: cloneBarsDeep(active.snapshot.bars),
          });
        }
      } catch {
        set({ isHydrated: true });
      }
    },

    saveActiveNow: async () => {
      if (isApplying) return;

      const s = get();
      const snap = captureSnapshot();
      const now2 = Date.now();

      const idx = s.projects.findIndex((p) => p.id === s.activeProjectId);
      const nextProjects =
        idx >= 0
          ? s.projects.map((p, i) =>
              i === idx
                ? {
                    ...p,
                    updatedAt: now2,
                    name: s.projectName,
                    snapshot: { ...snap, bars: cloneBarsDeep(snap.bars) },
                  }
                : p
            )
          : s.projects;

      set({ projects: nextProjects });

      await storageSet(
        STORAGE_KEY,
        JSON.stringify({
          projects: nextProjects,
          activeProjectId: s.activeProjectId,
        })
      );
    },

    setProjectName: (name: string) => {
      const nextName = sanitizeName(name);
      set({ projectName: nextName });

      const s = get();
      const idx = s.projects.findIndex((p) => p.id === s.activeProjectId);
      if (idx >= 0) {
        const now2 = Date.now();
        const nextProjects = s.projects.map((p, i) =>
          i === idx ? { ...p, name: nextName, updatedAt: now2 } : p
        );
        set({ projects: nextProjects });
      }
    },

    resetProjectName: () => {
      get().setProjectName(DEFAULT_PROJECT_NAME);
    },

    newProject: async () => {
      await get().saveActiveNow();

      const now2 = Date.now();
      const id = createId();
      const snap = makeDefaultSnapshot();

      const nextProject: Project = {
        id,
        name: DEFAULT_PROJECT_NAME,
        createdAt: now2,
        updatedAt: now2,
        snapshot: { ...snap, bars: cloneBarsDeep(snap.bars) },
      };

      const s = get();
      const nextProjects = [nextProject, ...s.projects].slice(0, MAX_PROJECTS);

      set({
        projects: nextProjects,
        activeProjectId: id,
        projectName: nextProject.name,
      });

      applySnapshotToApp(snap);
      await get().saveActiveNow();
    },

    openProject: async (projectId: string) => {
      await get().saveActiveNow();

      const s = get();
      const p = s.projects.find((x) => x.id === projectId);
      if (!p) return;

      set({ activeProjectId: p.id, projectName: p.name });

      applySnapshotToApp({
        ...p.snapshot,
        bars: cloneBarsDeep(p.snapshot.bars),
      });

      await get().saveActiveNow();
    },
  };
});

// auto-hydrate apenas se importa el módulo
void useProjectMetaStore.getState().hydrate();
