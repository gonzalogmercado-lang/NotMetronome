import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AccentLevel, Meter, TickInfo } from "../core/types";
import { ACCENT_GAIN, deriveAccentPerTick } from "../utils/rhythm/deriveAccentPerTick";
import MetronomeAudioScheduler, { ScheduledTick } from "./MetronomeAudioScheduler";

export type MetronomeStartInput = {
  bpm: number;
  meter: Meter;
  groups?: number[];
  // subdivisions (solo tiene efecto si meter.d === 4 en el scheduler)
  subdiv?: number; // 1..8
  subdivMask?: boolean[]; // length === subdiv
};

type UseMetronomeAudioOptions = MetronomeStartInput & {
  onTick?: (tick: ScheduledTick) => void;
  accentGains?: Partial<Record<AccentLevel, number>>;
};

export function useMetronomeAudio(options: UseMetronomeAudioOptions) {
  const { bpm, meter, groups, subdiv, subdivMask, onTick, accentGains } = options;

  const schedulerRef = useRef<MetronomeAudioScheduler | null>(null);
  const [audioState, setAudioState] = useState<"idle" | "ready" | "error" | "starting">("idle");
  const [lastTick, setLastTick] = useState<ScheduledTick | null>(null);

  const accentMap = useMemo(() => ({ ...ACCENT_GAIN, ...accentGains }), [accentGains]);

  if (!schedulerRef.current) {
    schedulerRef.current = new MetronomeAudioScheduler({
      onTick: (tick) => {
        setLastTick(tick);
        onTick?.(tick);
      },
      onStateChange: (state) => {
        setAudioState(state === "ready" ? "ready" : state === "error" ? "error" : "idle");
      },
    });
  }

  useEffect(() => {
    schedulerRef.current?.setAccentGains(accentMap);
  }, [accentMap]);

  useEffect(() => {
    schedulerRef.current?.update({ bpm, meter, groups, subdiv, subdivMask });
  }, [bpm, groups, meter, subdiv, subdivMask]);

  useEffect(
    () => () => {
      schedulerRef.current?.stop();
    },
    []
  );

  const start = useCallback(async () => {
    setAudioState((prev) => (prev === "ready" ? prev : "starting"));
    const result = await schedulerRef.current?.start({ bpm, meter, groups, subdiv, subdivMask });
    return result ?? false;
  }, [bpm, groups, meter, subdiv, subdivMask]);

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
  };
}

export default useMetronomeAudio;
