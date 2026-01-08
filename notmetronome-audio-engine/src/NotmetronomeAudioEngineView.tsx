import { requireNativeView } from 'expo';
import * as React from 'react';

import { NotmetronomeAudioEngineViewProps } from './NotmetronomeAudioEngine.types';

const NativeView: React.ComponentType<NotmetronomeAudioEngineViewProps> =
  requireNativeView('NotmetronomeAudioEngine');

export default function NotmetronomeAudioEngineView(props: NotmetronomeAudioEngineViewProps) {
  return <NativeView {...props} />;
}
