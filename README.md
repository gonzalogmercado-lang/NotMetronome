# NotMetronome

Metronomo React Native (Expo) con audio sample-accurate.

## Requisitos previos

- Node 20+
- `npm install -g eas-cli` para generar development builds.
- Dispositivo o emulador Android con USB debugging/habilitado.

## Instalación

```bash
npm install
```

## Development build (Expo dev client)

1. **Generar el cliente**

   ```bash
   eas build --profile development --platform android
   ```

   - Requiere sesión en Expo: `eas login`.
   - Descarga/instala el `.apk` generado en el dispositivo/emulador.

2. **Arrancar el bundler en modo dev-client**

   ```bash
   npm run start:dev
   ```

   Luego, desde el prompt de Expo, abre en Android (físico o emulador) con el dev build instalado.

### Configuración incluida

- `expo-dev-client` agregado en `package.json` y `app.json` (plugins) para habilitar dev builds.
- `metro.config.js` acepta assets de audio (`wav`, `mp3`, `caf`).
- `eas.json` incluye el profile `development` con `developmentClient: true` para generar el dev client sin configuración extra.

## Scheduler de audio

- Implementación: `src/audio/engines/web/WebMetronomeAudioEngine.ts`
  - Usa Web Audio API nativa en web para programar ticks en la timeline de audio (no en JS timers).
  - Lookahead fijo (25 ms) que agenda una ventana de ~180 ms con `start()` sample-accurate.
  - Recalcula acentos por compás/clave una sola vez por cambio de métrica.
  - Audio actual por síntesis (oscilador + envelope); samples quedan para una siguiente iteración.
- Stub nativo: `src/audio/engines/native/NativeMetronomeAudioEngine.ts` (sin audio por ahora).
- Hook de integración: `src/audio/useMetronomeAudio.ts` (fuente de verdad para UI y click).

## Ejecutar la app

```bash
npx expo start --dev-client
```

> Nota: En Android/iOS el engine nativo aún no está implementado; por ahora sólo hay audio en web.

## Pruebas manuales sugeridas (Android)

- 120 BPM en 4/4: start/stop sin duplicar clicks, estabilidad del tempo.
- 180 BPM en 7/8 con clave: revisar acentos fuertes/medios/suaves.
- 220 BPM en 11/16 con clave: sin flams ni jitter audible.
- Cambios de BPM en reproducción: transición suave y re-sync limpio.
- Cambios de compás/clave en reproducción: el audio sigue siendo el reloj (UI sólo refleja los ticks del scheduler).
