import { registerWebModule, NativeModule } from 'expo';

import { NotmetronomeAudioEngineModuleEvents } from './NotmetronomeAudioEngine.types';

class NotmetronomeAudioEngineModule extends NativeModule<NotmetronomeAudioEngineModuleEvents> {
  PI = Math.PI;
  async setValueAsync(value: string): Promise<void> {
    this.emit('onChange', { value });
  }
  hello() {
    return 'Hello world! 👋';
  }
}

export default registerWebModule(NotmetronomeAudioEngineModule, 'NotmetronomeAudioEngineModule');
