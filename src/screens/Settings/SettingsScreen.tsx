import { useCallback, useEffect, useRef } from "react";
import { Button, StyleSheet, Text, View } from "react-native";

import MetronomeAudioScheduler from "../../audio/MetronomeAudioScheduler";

function SettingsScreen() {
  const schedulerRef = useRef<MetronomeAudioScheduler | null>(null);

  if (!schedulerRef.current) {
    schedulerRef.current = new MetronomeAudioScheduler();
  }

  useEffect(
    () => () => {
      schedulerRef.current?.stop();
    },
    []
  );

  const handleTestBeep = useCallback(() => {
    void schedulerRef.current?.playTestBeep();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <Text>Configure NotMetronome defaults here.</Text>
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
