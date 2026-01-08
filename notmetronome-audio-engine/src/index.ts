// Reexport the native module. On web, it will be resolved to NotmetronomeAudioEngineModule.web.ts
// and on native platforms to NotmetronomeAudioEngineModule.ts
export { default } from './NotmetronomeAudioEngineModule';
export { default as NotmetronomeAudioEngineView } from './NotmetronomeAudioEngineView';
export * from  './NotmetronomeAudioEngine.types';
