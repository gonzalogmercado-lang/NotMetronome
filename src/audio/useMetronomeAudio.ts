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
};

type UseMetronomeAudioOptions = MetronomeStartInput & {
  onTick?: (tick: ScheduledTick) => void;
  onBarChange?: (barIndex: number) => void;
  accentGains?: Partial<Record<AccentLevel, number>>;
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
    onTick,
    onBarChange,
    accentGains,
  } = options;

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
        const next =
          state === "ready" ? "ready" : state === "error" ? "error" : "idle";

        setAudioState(next);
        setAudioDetails(details ?? null);

        // Logging mínimo (visible en consola RN), cero logcat
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

  useEffect(() => {
    schedulerRef.current?.update({
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
    });
  }, [bpm, groups, meter, subdiv, subdivMask, pulseSubdivs, pulseSubdivMasks, bars, startBarIndex, loop]);

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
      meter,
      groups,
      subdiv,
      subdivMask,
      pulseSubdivs,
      pulseSubdivMasks,
      bars,
      startBarIndex,
      loop,
    });

    // Si falla y el scheduler no llegó a emitir details, dejá una pista
    if (!result) {
      setAudioDetails((prev) => prev ?? "start() devolvió false (sin detalle). Mirar consola RN.");
    }

    return result ?? false;
  }, [bpm, groups, meter, subdiv, subdivMask, pulseSubdivs, pulseSubdivMasks, bars, startBarIndex, loop]);

  const stop = useCallback(() => {
    setLastTick(null);
    return schedulerRef.current?.stop();
  }, []);

  const accentLevels = useMemo(() => deriveAccentPerTick(meter, groups), [groups, meter]);

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
