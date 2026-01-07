import { useCallback, useEffect, useMemo, useState } from "react";

import { AccentLevel, Meter, TickInfo } from "../core/types";
import { ACCENT_GAIN, deriveAccentPerTick } from "../utils/rhythm/deriveAccentPerTick";
import { AudioState, ScheduledTick, createAudioEngine } from "./AudioEngine";

export type MetronomeStartInput = {
  bpm: number;
  meter: Meter;
  groups?: number[];
};

type UseMetronomeAudioOptions = MetronomeStartInput & {
  onTick?: (tick: ScheduledTick) => void;
  accentGains?: Partial<Record<AccentLevel, number>>;
  enableScheduling?: boolean;
};

export type AudioStatus = "idle" | "starting" | AudioState;

type Listener = {
  onTick?: (tick: ScheduledTick) => void;
  onStateChange?: (state: AudioState, details?: string) => void;
};

const listeners = new Set<Listener>();

const sharedEngine = createAudioEngine({
  onTick: (tick) => {
    listeners.forEach((listener) => listener.onTick?.(tick));
  },
  onStateChange: (state, details) => {
    listeners.forEach((listener) => listener.onStateChange?.(state, details));
  },
});

let activeSchedulers = 0;

export function useMetronomeAudio(options: UseMetronomeAudioOptions) {
  const { bpm, meter, groups, onTick, accentGains, enableScheduling = true } = options;
  const [audioState, setAudioState] = useState<AudioStatus>("idle");
  const [audioDetails, setAudioDetails] = useState<string | null>(null);
  const [lastTick, setLastTick] = useState<ScheduledTick | null>(null);

  const accentMap = useMemo(() => ({ ...ACCENT_GAIN, ...accentGains }), [accentGains]);

  useEffect(() => {
    if (!enableScheduling) return;
    sharedEngine.setAccentGains(accentMap);
  }, [accentMap, enableScheduling]);

  useEffect(() => {
    if (!enableScheduling) return;
    sharedEngine.update({ bpm, meter, groups });
  }, [bpm, groups, meter, enableScheduling]);

  useEffect(() => {
    const listener: Listener = {
      onTick: (tick) => {
        setLastTick(tick);
        onTick?.(tick);
      },
      onStateChange: (state, details) => {
        setAudioDetails(details ?? null);
        setAudioState(state);
      },
    };
    listeners.add(listener);
    const initialDetails = sharedEngine.getDetails();
    setAudioDetails(initialDetails.details ?? null);
    setAudioState(initialDetails.state);
    return () => {
      listeners.delete(listener);
    };
  }, [onTick]);

  useEffect(() => {
    if (!enableScheduling) return;
    activeSchedulers += 1;
    return () => {
      activeSchedulers = Math.max(0, activeSchedulers - 1);
      if (activeSchedulers === 0) {
        sharedEngine.stop();
      }
    };
  }, [enableScheduling]);

  const start = useCallback(async () => {
    if (!enableScheduling) return false;
    setAudioState((prev) => (prev === "ready" ? prev : "starting"));
    return sharedEngine.start({ bpm, meter, groups });
  }, [bpm, groups, meter, enableScheduling]);

  const stop = useCallback(() => {
    setLastTick(null);
    return sharedEngine.stop();
  }, []);

  const testBeep = useCallback(async (): Promise<{ ok: boolean; details?: string }> => {
    const result = await sharedEngine.playTestBeep();
    return result ?? { ok: false, details: "Audio engine not ready" };
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
