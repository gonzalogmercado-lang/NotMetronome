import { useCallback, useEffect, useRef } from "react";

import { Meter, TickInfo } from "../../core/types";
import IntervalClock from "./IntervalClock";

type UseIntervalClockOptions = {
  bpm: number;
  meter: Meter;
  onTick: (info: TickInfo) => void;
};

function useIntervalClock({ bpm, meter, onTick }: UseIntervalClockOptions) {
  const tickHandlerRef = useRef(onTick);
  const clockRef = useRef<IntervalClock | null>(null);

  tickHandlerRef.current = onTick;

  if (!clockRef.current) {
    clockRef.current = new IntervalClock({
      bpm,
      meterTop: meter.n,
      meterBottom: meter.d,
      events: {
        onTick: (info) => tickHandlerRef.current?.(info),
      },
    });
  }

  useEffect(() => {
    clockRef.current?.setBpm(bpm);
  }, [bpm]);

  useEffect(() => {
    clockRef.current?.setMeter(meter.n, meter.d);
  }, [meter.d, meter.n]);

  useEffect(
    () => () => {
      clockRef.current?.stop();
    },
    []
  );

  const start = useCallback(() => clockRef.current?.start(), []);
  const stop = useCallback(() => clockRef.current?.stop(), []);

  return { start, stop };
}

export default useIntervalClock;
