import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AccentLevel, Meter, TickInfo } from "../core/types";
import { ACCENT_GAIN, deriveAccentPerTick } from "../utils/rhythm/deriveAccentPerTick";
import MetronomeAudioScheduler, { ScheduledTick } from "./MetronomeAudioScheduler";

export type MetronomeStartInput = {
  bpm: number;
  meter: Meter;
  groups?: number[];
};

type UseMetronomeAudioOptions = MetronomeStartInput & {
  onTick?: (tick: ScheduledTick) => void;
  accentGains?: Partial<Record<AccentLevel, number>>;
};

export type AudioState = "idle" | "ready" | "suspended" | "error" | "starting";

export function useMetronomeAudio(options: UseMetronomeAudioOptions) {
  const { bpm, meter, groups, onTick, accentGains } = options;
  const schedulerRef = useRef<MetronomeAudioScheduler | null>(null);
  const [audioState, setAudioState] = useState<AudioState>("idle");
  const [audioDetails, setAudioDetails] = useState<string | null>(null);
  const [lastTick, setLastTick] = useState<ScheduledTick | null>(null);

  const accentMap = useMemo(() => ({ ...ACCENT_GAIN, ...accentGains }), [accentGains]);

  if (!schedulerRef.current) {
    schedulerRef.current = new MetronomeAudioScheduler({
      onTick: (tick) => {
        setLastTick(tick);
        onTick?.(tick);
      },
      onStateChange: (state, details) => {
        setAudioDetails(details ?? null);
        if (state === "ready" || state === "suspended" || state === "error") {
          setAudioState(state);
        } else {
          setAudioState("idle");
        }
      },
    });
  }

  useEffect(() => {
    schedulerRef.current?.setAccentGains(accentMap);
  }, [accentMap]);

  useEffect(() => {
    schedulerRef.current?.update({ bpm, meter, groups });
  }, [bpm, groups, meter]);

  useEffect(
    () => () => {
      schedulerRef.current?.stop();
    },
    []
  );

  const start = useCallback(async () => {
    setAudioState((prev) => (prev === "ready" ? prev : "starting"));
    const result = await schedulerRef.current?.start({ bpm, meter, groups });
    return result ?? false;
  }, [bpm, groups, meter]);

  const stop = useCallback(() => {
    setLastTick(null);
    return schedulerRef.current?.stop();
  }, []);

  const testBeep = useCallback(async (): Promise<{ ok: boolean; details?: string }> => {
    const result = await schedulerRef.current?.playTestBeep();
    return result ?? { ok: false, details: "Scheduler not ready" };
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
    testBeep,
  };
}

export default useMetronomeAudio;
