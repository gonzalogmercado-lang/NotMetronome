import { NativeModule, requireNativeModule } from "expo";

export type EngineStartParams = {
  bpm: number;          // 30..300
  meterN: number;       // top (e.g. 11)
  meterD: number;       // bottom (e.g. 8)
  groups?: number[];    // e.g. [3,3,3,2]
  sampleRate?: number;  // optional hint (native may ignore)
};

export type EngineUpdateParams = Partial<EngineStartParams> & {
  // When changing meter/groups while running, choose behavior:
  // - "bar": apply at next bar boundary
  // - "now": apply ASAP (may click/pop if extreme)
  applyAt?: "bar" | "now";
};

export type EngineStatus = "idle" | "starting" | "running" | "stopping" | "error";

export type EngineTickEvent = {
  tickIndex: number;      // absolute tick count since start
  barTick: number;        // 0..(meterN-1)
  isDownbeat: boolean;
  atAudioTimeMs: number;  // audio timeline time (monotonic), not Date.now
};

export type EngineStateEvent = {
  status: EngineStatus;
  message?: string;
};

export type NotmetronomeAudioEngineModuleEvents = {
  onTick: (event: EngineTickEvent) => void;
  onState: (event: EngineStateEvent) => void;
};

declare class NotmetronomeAudioEngineModule extends NativeModule<NotmetronomeAudioEngineModuleEvents> {
  // lifecycle
  start(params: EngineStartParams): Promise<void>;
  stop(): Promise<void>;
  update(params: EngineUpdateParams): Promise<void>;

  // debug/health
  getStatus(): Promise<EngineStatus>;
  ping(): Promise<string>;
}

// JSI native module
export default requireNativeModule<NotmetronomeAudioEngineModule>("NotmetronomeAudioEngine");
