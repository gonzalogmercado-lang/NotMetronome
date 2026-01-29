import { useCallback, useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";

import { useMetronomeAudio } from "../../audio/useMetronomeAudio";

function SettingsScreen() {
  const { start, stop, audioState, audioDetails } = useMetronomeAudio({
    bpm: 120,
    meter: { n: 4, d: 4 },
  });

  const [lastAction, setLastAction] = useState<string>("OK - idle");

  const handleTestBeep = useCallback(() => {
    void (async () => {
      const ok = await start();
      setLastAction(ok ? "OK - start()" : "FAIL - start()");
      // “beep” simple: arrancar y cortar rápido
      setTimeout(() => {
        void stop();
      }, 200);
    })();
  }, [start, stop]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <Text>Configure NotMetronome defaults here.</Text>
      <Text>Audio state: {audioState}</Text>
      <Text>Last action: {lastAction}</Text>
      {audioDetails ? <Text>Audio details: {audioDetails}</Text> : null}
      <Button title="Test Beep" onPress={handleTestBeep} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
  },
});

export default SettingsScreen;
