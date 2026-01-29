import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AccentLevel, Meter, TickInfo } from "../core/types";
import { ACCENT_GAIN, deriveAccentPerTick } from "../utils/rhythm/deriveAccentPerTick";
import MetronomeAudioScheduler, { BarConfig, ScheduledTick } from "./MetronomeAudioScheduler";

export type MetronomeStartInput = {
  bpm: number;

  // Single-bar (legacy)
  meter: Meter;
  groups?: number[];

  // Legacy global subdivisions (native supports)
  subdiv?: number; // 1..8
  subdivMask?: boolean[]; // length === subdiv

  // NEW: per-beat subdivisions + masks (web supports)
  pulseSubdivs?: number[]; // length === meter.n
  pulseSubdivMasks?: boolean[][]; // [beatIndex][slotIndex]

  // NEW: multi-bar timeline
  bars?: BarConfig[];
  startBarIndex?: number;
  loop?: boolean;

  // Beat guide: forces beat down-subtick audible
  beatGuide?: boolean;
};

type UseMetronomeAudioOptions = MetronomeStartInput & {
  onTick?: (tick: ScheduledTick) => void;
  onBarChange?: (barIndex: number) => void;
  accentGains?: Partial<Record<AccentLevel, number>>;
};

// =========================
// 🔥 Helpers: keys + deep clones (para matar “residual bars”)
// =========================
const bools01 = (arr?: boolean[]) => (arr && arr.length ? arr.map((v) => (v ? "1" : "0")).join("") : "");
const nums = (arr?: number[]) => (arr && arr.length ? arr.join(",") : "");
const masks01 = (m?: boolean[][]) => (m && m.length ? m.map((row) => bools01(row)).join("|") : "");

const cloneBoolArray = (arr?: boolean[]) => (arr ? arr.slice() : arr);
const cloneBoolMatrix = (m?: boolean[][]) => (m ? m.map((row) => (row ? row.slice() : row)) : m);

const cloneBars = (bars?: BarConfig[]) => {
  if (!bars) return bars;
  // deep clone “lo importante” + preserva cualquier campo extra que exista
  return bars.map((b: any) => ({
    ...b,
    meter: b?.meter ? { ...b.meter } : b.meter,
    groups: Array.isArray(b?.groups) ? b.groups.slice() : b.groups,
    subdivMask: Array.isArray(b?.subdivMask) ? b.subdivMask.slice() : b.subdivMask,
    pulseSubdivs: Array.isArray(b?.pulseSubdivs) ? b.pulseSubdivs.slice() : b.pulseSubdivs,
    pulseSubdivMasks: Array.isArray(b?.pulseSubdivMasks)
      ? b.pulseSubdivMasks.map((row: any) => (Array.isArray(row) ? row.slice() : row))
      : b.pulseSubdivMasks,
  }));
};

const buildBarsKey = (bars?: BarConfig[]) => {
  if (!bars || bars.length === 0) return "bars:none";
  return (
    "bars:" +
    bars
      .map((b: any) => {
        const m = b?.meter ? `${b.meter.n}/${b.meter.d}` : "x/x";
        const g = nums(b?.groups);
        const sd = Number.isFinite(b?.subdiv) ? String(b.subdiv) : "";
        const sm = bools01(b?.subdivMask);
        const ps = nums(b?.pulseSubdivs);
        const pm = masks01(b?.pulseSubdivMasks);
        return `${m}#g:${g}#sd:${sd}#sm:${sm}#ps:${ps}#pm:${pm}`;
      })
      .join("||")
  );
};

export function useMetronomeAudio(options: UseMetronomeAudioOptions) {
  const {
    bpm,
    meter,
    groups,
    subdiv,
    subdivMask,
    pulseSubdivs,
    pulseSubdivMasks,
    bars,
    startBarIndex,
    loop,
    beatGuide,
    onTick,
    onBarChange,
    accentGains,
  } = options;

  // 🔥 Content-keys (NO dependen de “referencia cambió”)
  const meterKey = `m:${meter.n}/${meter.d}`;
  const groupsKey = `g:${nums(groups)}`;
  const subdivMaskKey = `sm:${bools01(subdivMask)}`;
  const pulseKey = `p:${nums(pulseSubdivs)}|pm:${masks01(pulseSubdivMasks)}`;
  const barsKey = buildBarsKey(bars);
  const timelineKey = `${barsKey}|start:${startBarIndex ?? 0}|loop:${loop ? "1" : "0"}|bg:${beatGuide ? "1" : "0"}`;

  // 🔥 Snapshots (deep clones) para que el scheduler/engine reciba “estado real”
  const meterSnap = useMemo(() => ({ ...meter }), [meterKey]);
  const groupsSnap = useMemo(() => (groups ? groups.slice() : groups), [groupsKey]);
  const subdivMaskSnap = useMemo(() => cloneBoolArray(subdivMask), [subdivMaskKey]);
  const pulseSubdivsSnap = useMemo(() => (pulseSubdivs ? pulseSubdivs.slice() : pulseSubdivs), [pulseKey]);
  const pulseSubdivMasksSnap = useMemo(() => cloneBoolMatrix(pulseSubdivMasks), [pulseKey]);
  const barsSnap = useMemo(() => cloneBars(bars), [barsKey]);

  const schedulerRef = useRef<MetronomeAudioScheduler | null>(null);
  const [audioState, setAudioState] = useState<"idle" | "ready" | "error" | "starting">("idle");
  const [audioDetails, setAudioDetails] = useState<string | null>(null);

  const [lastTick, setLastTick] = useState<ScheduledTick | null>(null);
  const [currentBarIndex, setCurrentBarIndex] = useState<number | null>(null);

  const accentMap = useMemo(() => ({ ...ACCENT_GAIN, ...accentGains }), [accentGains]);

  if (!schedulerRef.current) {
    schedulerRef.current = new MetronomeAudioScheduler({
      onTick: (tick) => {
        setLastTick(tick);
        onTick?.(tick);
      },
      onStateChange: (state, details) => {
        const next = state === "ready" ? "ready" : state === "error" ? "error" : "idle";

        setAudioState(next);
        setAudioDetails(details ?? null);

        if (next === "error") {
          console.log("[audio] ERROR:", details ?? "(sin detalle)");
        } else if (details) {
          console.log(`[audio] ${state}:`, details);
        }
      },
      onBarChange: (barIndex) => {
        setCurrentBarIndex(barIndex);
        onBarChange?.(barIndex);
      },
    });
  }

  useEffect(() => {
    schedulerRef.current?.setAccentGains(accentMap);
  }, [accentMap]);

  // 🔥 Update SIEMPRE que cambie el CONTENIDO, no solo la referencia
  useEffect(() => {
    schedulerRef.current?.update({
      applyAt: "now",

      bpm,
      meter: meterSnap,
      groups: groupsSnap,
      subdiv,
      subdivMask: subdivMaskSnap,
      pulseSubdivs: pulseSubdivsSnap,
      pulseSubdivMasks: pulseSubdivMasksSnap,
      bars: barsSnap,
      startBarIndex,
      loop,
      beatGuide,
    });
  }, [
    bpm,
    meterKey,
    groupsKey,
    subdiv,
    subdivMaskKey,
    pulseKey,
    timelineKey,
    meterSnap,
    groupsSnap,
    subdivMaskSnap,
    pulseSubdivsSnap,
    pulseSubdivMasksSnap,
    barsSnap,
    startBarIndex,
    loop,
    beatGuide,
  ]);

  useEffect(
    () => () => {
      schedulerRef.current?.stop();
    },
    []
  );

  const start = useCallback(async () => {
    setAudioDetails(null);
    setAudioState((prev) => (prev === "ready" ? prev : "starting"));

    const result = await schedulerRef.current?.start({
      bpm,
      meter: meterSnap,
      groups: groupsSnap,
      subdiv,
      subdivMask: subdivMaskSnap,
      pulseSubdivs: pulseSubdivsSnap,
      pulseSubdivMasks: pulseSubdivMasksSnap,
      bars: barsSnap,
      startBarIndex,
      loop,
      beatGuide,
    });

    if (!result) {
      setAudioDetails((prev) => prev ?? "start() devolvió false (sin detalle). Mirar consola RN.");
    }

    return result ?? false;
  }, [
    bpm,
    meterKey,
    groupsKey,
    subdiv,
    subdivMaskKey,
    pulseKey,
    timelineKey,
    meterSnap,
    groupsSnap,
    subdivMaskSnap,
    pulseSubdivsSnap,
    pulseSubdivMasksSnap,
    barsSnap,
    startBarIndex,
    loop,
    beatGuide,
  ]);

  const stop = useCallback(() => {
    setLastTick(null);
    return schedulerRef.current?.stop();
  }, []);

  const accentLevels = useMemo(() => deriveAccentPerTick(meter, groups), [groupsKey, meterKey, meter]);

  const tickInfo: TickInfo | null = useMemo(
    () =>
      lastTick
        ? {
            tickIndex: lastTick.tickIndex,
            atMs: lastTick.atMs,
            barTick: lastTick.barTick,
            isDownbeat: lastTick.isDownbeat,
          }
        : null,
    [lastTick]
  );

  return {
    start,
    stop,
    tickInfo,
    lastTick,
    accentLevels,
    audioState,
    audioDetails,
    currentBarIndex,
  };
}

export default useMetronomeAudio;
