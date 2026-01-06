import { useEffect, useMemo, useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";

import { IntervalClock, TickInfo } from "../../engine/clock";
import { useMeterStore } from "../../store/meter.store";
import { useTempoStore } from "../../store/tempo.store";
import { useUiStore } from "../../store/ui.store";
import StatRow from "./components/StatRow";

function HomeScreen() {
  const { bpm, increment, decrement, tap } = useTempoStore();
  const { meter } = useMeterStore();
  const { isPlaying, setPlaying } = useUiStore();

  const [tickInfo, setTickInfo] = useState<TickInfo | null>(null);
  const [tickCount, setTickCount] = useState(0);

  const clock = useMemo(
    () =>
      new IntervalClock({
        bpm,
        meterTop: meter.top,
        meterBottom: meter.bottom,
        events: {
          onTick: (info) => {
            setTickInfo(info);
            setTickCount((prev) => prev + 1);
          },
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    clock.setBpm(bpm);
  }, [bpm, clock]);

  useEffect(() => {
    clock.setMeter(meter.top, meter.bottom);
  }, [clock, meter.bottom, meter.top]);

  useEffect(() => {
    return () => {
      clock.stop();
    };
  }, [clock]);

  const handleStartStop = () => {
    if (isPlaying) {
      clock.stop();
      setTickCount(0);
      setTickInfo(null);
      setPlaying(false);
    } else {
      setTickCount(0);
      setTickInfo(null);
      clock.start();
      setPlaying(true);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>NotMetronome</Text>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Tempo</Text>
        <View style={styles.bpmRow}>
          <Button title="-" onPress={decrement} />
          <Text style={styles.bpmValue}>{bpm} BPM</Text>
          <Button title="+" onPress={increment} />
        </View>
        <Button title={isPlaying ? "Stop" : "Start"} onPress={handleStartStop} />
        <Button title="Tap Tempo" onPress={tap} />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Status</Text>
        <StatRow label="Meter" value={`${meter.top}/${meter.bottom}`} />
        <StatRow label="Ticks" value={tickCount} />
        <StatRow label="Last tick index" value={tickInfo?.tickIndex ?? "-"} />
        <StatRow label="Last tick at" value={tickInfo?.atMs ?? "-"} />
        <StatRow label="Last downbeat" value={tickInfo ? (tickInfo.isDownbeat ? "Yes" : "No") : "-"} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
  },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ddd",
    padding: 16,
    gap: 12,
    backgroundColor: "#fafafa",
  },
  sectionLabel: {
    fontSize: 18,
    fontWeight: "600",
  },
  bpmRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bpmValue: {
    fontSize: 22,
    fontWeight: "700",
  },
});

export default HomeScreen;
