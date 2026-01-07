import { AccentGainMap, AudioEngineDetails, MetronomeAudioEngine, SchedulerEvents, StartOptions, TestBeepResult, UpdateOptions } from "../../AudioEngine";

const UNAVAILABLE_DETAILS = "Native audio engine not implemented yet";

class NativeMetronomeAudioEngine implements MetronomeAudioEngine {
  private events: SchedulerEvents;

  constructor(events: SchedulerEvents = {}) {
    this.events = events;
  }

  getDetails(): AudioEngineDetails {
    return {
      isAvailable: false,
      state: "error",
      details: UNAVAILABLE_DETAILS,
    };
  }

  setAccentGains(_map: Partial<AccentGainMap>) {}

  async start(_options: StartOptions): Promise<boolean> {
    this.events.onStateChange?.("error", UNAVAILABLE_DETAILS);
    return false;
  }

  stop() {}

  update(_options: UpdateOptions) {}

  async playTestBeep(): Promise<TestBeepResult> {
    this.events.onStateChange?.("error", UNAVAILABLE_DETAILS);
    return { ok: false, details: UNAVAILABLE_DETAILS };
  }
}

export default NativeMetronomeAudioEngine;
