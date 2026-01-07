import { useCallback, useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";

import { AudioState, useMetronomeAudio } from "../../audio/useMetronomeAudio";

function SettingsScreen() {
  const { testBeep, audioState, audioDetails } = useMetronomeAudio({
    bpm: 120,
    meter: { n: 4, d: 4 },
  });
  const [lastAction, setLastAction] = useState<string>("OK - idle");
  const displayAudioState: AudioState = audioState === "ready" || audioState === "error" || audioState === "suspended" ? audioState : "suspended";

  const handleTestBeep = useCallback(() => {
    void (async () => {
      const result = await testBeep();
      setLastAction(`${result.ok ? "OK" : "FAIL"}${result.details ? ` - ${result.details}` : ""}`);
    })();
  }, [testBeep]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <Text>Configure NotMetronome defaults here.</Text>
      <Text>Audio state: {displayAudioState}</Text>
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
