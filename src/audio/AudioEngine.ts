import { Platform } from "react-native";

import { AccentLevel, Meter, TickInfo } from "../core/types";
import NativeMetronomeAudioEngine from "./engines/native/NativeMetronomeAudioEngine";
import WebMetronomeAudioEngine from "./engines/web/WebMetronomeAudioEngine";

export type AccentGainMap = Record<AccentLevel, number>;

export type StartOptions = {
  bpm: number;
  meter: Meter;
  groups?: number[];
};

export type UpdateOptions = StartOptions;

export type ScheduledTick = TickInfo & {
  accentLevel: AccentLevel;
  accentGain: number;
  scheduledTime: number;
};

export type AudioState = "ready" | "suspended" | "error";

export type SchedulerEvents = {
  onTick?: (tick: ScheduledTick) => void;
  onStateChange?: (state: AudioState, details?: string) => void;
};

export type TestBeepResult = { ok: boolean; details?: string };

export type AudioEngineDetails = {
  isAvailable: boolean;
  state: AudioState;
  details?: string;
};

export interface MetronomeAudioEngine {
  start(options: StartOptions): Promise<boolean>;
  stop(): void;
  update(options: UpdateOptions): void;
  setAccentGains(map: Partial<AccentGainMap>): void;
  playTestBeep(): Promise<TestBeepResult>;
  getDetails(): AudioEngineDetails;
}

export function createAudioEngine(events: SchedulerEvents): MetronomeAudioEngine {
  if (Platform.OS === "web") {
    return new WebMetronomeAudioEngine(events);
  }
  return new NativeMetronomeAudioEngine(events);
}
