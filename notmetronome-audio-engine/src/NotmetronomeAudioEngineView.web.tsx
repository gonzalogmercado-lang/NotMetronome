import * as React from 'react';

import { NotmetronomeAudioEngineViewProps } from './NotmetronomeAudioEngine.types';

export default function NotmetronomeAudioEngineView(props: NotmetronomeAudioEngineViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
