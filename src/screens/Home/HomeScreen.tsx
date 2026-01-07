import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { useMetronomeAudio } from "../../audio/useMetronomeAudio";
import { addGroup, canAddGroup, remainingTicks, undoGroup } from "../../core/clave/builder";
import { formatGroups, getClavePresets } from "../../core/clave/presets";
import { TickInfo } from "../../core/types";
import { useMeterStore } from "../../store/meter.store";
import { useSavedBarsStore } from "../../store/savedBars.store";
import { useTempoStore } from "../../store/tempo.store";
import { useUiStore } from "../../store/ui.store";
import { ACCENT_GAIN, accentPatternGlyphs } from "../../utils/rhythm/deriveAccentPerTick";
import StatRow from "./components/StatRow";

function HomeScreen() {
  useEffect(() => {
    console.log("[HOME NEW MOUNTED] src/screens/Home/HomeScreen.tsx", { stamp: "2026-01-07-B" });
  }, []);

  const { bpm, increment, decrement, tap } = useTempoStore();
  const { meter, setMeter, groups, setGroups, resetGroups, claveEnabled, claveMode, setClaveEnabled, setClaveMode } = useMeterStore();
  const { addFromCurrent } = useSavedBarsStore();
  const { isPlaying, setPlaying, proMode, setProMode } = useUiStore();

  const [tickInfo, setTickInfo] = useState<TickInfo | null>(null);
  const [tickCount, setTickCount] = useState(0);
  const [lastSavedName, setLastSavedName] = useState<string | null>(null);

  const groupsValue = groups ?? [];
  const remaining = remainingTicks(meter, groupsValue);
  const isGroupsComplete = groupsValue.length > 0 && remaining === 0;
  const activeGroups = claveEnabled && isGroupsComplete ? groupsValue : undefined;

  const { start: startClock, stop: stopClock, lastTick, accentLevels, audioState } = useMetronomeAudio({
    bpm,
    meter,
    groups: activeGroups,
    onTick: (info) => {
      setTickCount((prev) => prev + 1);
      setTickInfo(info);
    },
  });

  const handleStartStop = async () => {
    if (isPlaying) {
      stopClock();
      setTickCount(0);
      setTickInfo(null);
      setPlaying(false);
    } else {
      setTickCount(0);
      setTickInfo(null);
      const ok = await startClock();
      setPlaying(!!ok);
    }
  };

  const changeTop = (delta: number) => {
    const next = Math.max(1, meter.n + delta);
    setMeter(next, meter.d);
  };

  const changeBottom = (nextBottom: number) => {
    if (meter.d === nextBottom) return;
    setMeter(meter.n, nextBottom);
  };

  const accentGlyphs = useMemo(() => accentPatternGlyphs(accentLevels), [accentLevels]);
  const accentGains = useMemo(() => accentLevels.map((level) => ACCENT_GAIN[level]), [accentLevels]);
  const presetOptions = useMemo(() => getClavePresets(meter), [meter]);

  const currentAccentLevel = lastTick?.accentLevel ?? (tickInfo ? accentLevels[tickInfo.barTick] : undefined);
  const currentAccentGain = lastTick?.accentGain ?? (currentAccentLevel ? ACCENT_GAIN[currentAccentLevel] : undefined);

  const meterLabel = `${meter.n}/${meter.d}`;
  const claveSummary = !claveEnabled || !groups || groups.length === 0 ? "Clave: —" : `Clave: ${formatGroups(groups)}`;
  const remainingLabel = remaining === 0 ? "Completo" : `Restan ${remaining}`;
  const audioStatusLabel =
    audioState === "ready" ? "Audio: listo (Web Audio)" : audioState === "error" ? "Audio: no disponible" : "Audio: inicializando";

  const handlePresetSelect = (preset: number[]) => {
    setGroups(preset);
  };

  const handleAddGroup = (value: number) => {
    setGroups(addGroup(meter, groupsValue, value));
  };

  const handleUndo = () => {
    setGroups(undoGroup(groupsValue));
  };

  const handleReset = () => {
    resetGroups();
  };

  const handleSaveBar = () => {
    const saved = addFromCurrent({ meter, claveEnabled, groups });
    setLastSavedName(saved.name);
    Alert.alert("Compás guardado", saved.name);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.runtimeStamp}>RUNTIME: HOME_NEW | STAMP: 2026-01-07-B</Text>
      {__DEV__ ? (
        <View style={styles.diagnosticBanner}>
          <Text style={styles.diagnosticBannerText}>HOME NEW (src/screens/Home/HomeScreen.tsx) - CLAVE ENABLED UI</Text>
          <Text style={styles.diagnosticBannerStamp}>STAMP: 2026-01-07-A</Text>
        </View>
      ) : null}
      <Text style={styles.title}>NotMetronome</Text>
      <Text style={styles.statusNote}>{audioStatusLabel}</Text>

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
        <Text style={styles.sectionLabel}>Meter</Text>
        <View style={styles.meterRow}>
          <Button title="-" onPress={() => changeTop(-1)} />
          <Text style={styles.bpmValue}>{meterLabel}</Text>
          <Button title="+" onPress={() => changeTop(1)} />
        </View>
        <View style={styles.denomRow}>
          {[4, 8, 16].map((value) => {
            const selected = meter.d === value;
            return (
              <Pressable key={value} style={[styles.denomOption, selected && styles.denomOptionActive]} onPress={() => changeBottom(value)}>
                <Text style={selected ? styles.denomTextActive : styles.denomText}>{value}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.claveBlock}>
          <View style={styles.switchRow}>
            <Text style={styles.sectionLabel}>Clave</Text>
            <Switch value={claveEnabled} onValueChange={setClaveEnabled} />
          </View>
          <Text style={styles.helperText}>{claveSummary}</Text>

          {claveEnabled ? (
            <>
              <View style={styles.segmentRow}>
                {([
                  { key: "presets", label: "Presets" },
                  { key: "build", label: "Build" },
                ] as const).map((option) => {
                  const selected = claveMode === option.key;
                  return (
                    <Pressable
                      key={option.key}
                      style={[styles.segmentButton, selected && styles.segmentButtonActive]}
                      onPress={() => setClaveMode(option.key)}
                    >
                      <Text style={selected ? styles.segmentTextActive : styles.segmentText}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {claveMode === "presets" ? (
                <View style={styles.presetBlock}>
                  {presetOptions.length === 0 ? (
                    <Text style={styles.helperText}>Sin presets sugeridos para este compás.</Text>
                  ) : (
                    <View style={styles.presetsGrid}>
                      {presetOptions.map((preset, index) => {
                        const label = formatGroups(preset);
                        const selected = isGroupsComplete && label === formatGroups(groupsValue);
                        return (
                          <Pressable
                            key={`${label}-${index}`}
                            style={[styles.presetButton, selected && styles.presetButtonActive]}
                            onPress={() => handlePresetSelect(preset)}
                          >
                            <Text style={selected ? styles.presetTextActive : styles.presetText}>{label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                  <Text style={styles.helperText}>Seleccionado: {groups && groups.length > 0 ? formatGroups(groups) : "—"}</Text>
                </View>
              ) : (
                <View style={styles.builderBlock}>
                  <View style={styles.builderRow}>
                    {[2, 3, 4].map((value) => {
                      const disabled = !canAddGroup(meter, groupsValue, value);
                      return (
                        <Pressable
                          key={value}
                          style={[styles.builderButton, disabled && styles.builderButtonDisabled]}
                          onPress={() => handleAddGroup(value)}
                          disabled={disabled}
                        >
                          <Text style={disabled ? styles.builderTextDisabled : styles.builderText}>+{value}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <View style={styles.builderRow}>
                    <Pressable style={styles.builderButton} onPress={handleUndo}>
                      <Text style={styles.builderText}>Undo</Text>
                    </Pressable>
                    <Pressable style={styles.builderButton} onPress={handleReset}>
                      <Text style={styles.builderText}>Reset</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.helperText}>{remainingLabel}</Text>
                  <Text style={styles.helperText}>Actual: {groups && groups.length > 0 ? formatGroups(groups) : "—"}</Text>
                </View>
              )}
            </>
          ) : null}
        </View>

        <View style={styles.saveBlock}>
          <Button title="Guardar compás" onPress={handleSaveBar} />
          <Text style={styles.helperText}>Último guardado: {lastSavedName ?? "—"}</Text>
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.sectionLabel}>Pro mode</Text>
          <Switch value={proMode} onValueChange={setProMode} />
        </View>
        <StatRow label="Accent pattern" value={accentGlyphs} />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Status</Text>
        <StatRow label="Meter" value={meterLabel} />
        <StatRow label="Ticks" value={tickCount} />
        <StatRow label="Last tick index" value={tickInfo?.tickIndex ?? "-"} />
        <StatRow label="Last tick at" value={tickInfo?.atMs ?? "-"} />
        <StatRow label="Bar tick" value={tickInfo?.barTick ?? "-"} />
        <StatRow label="Last downbeat" value={tickInfo ? (tickInfo.isDownbeat ? "Yes" : "No") : "-"} />
        <StatRow label="Current accent" value={currentAccentLevel ? `${currentAccentLevel} (${currentAccentGain?.toFixed(2)})` : "-"} />
        <StatRow label="Accent gains" value={accentGains.map((gain) => gain.toFixed(2)).join(" ")} />
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
  runtimeStamp: {
    fontSize: 11,
    color: "#444",
  },
  diagnosticBanner: {
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#2b6",
    backgroundColor: "#e9fff1",
    gap: 4,
  },
  diagnosticBannerText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#145c2d",
  },
  diagnosticBannerStamp: {
    fontSize: 12,
    color: "#145c2d",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
  },
  statusNote: {
    color: "#555",
    fontSize: 12,
    marginTop: -6,
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
  meterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bpmValue: {
    fontSize: 22,
    fontWeight: "700",
  },
  denomRow: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "flex-start",
    alignItems: "center",
  },
  denomOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#aaa",
  },
  denomOptionActive: {
    backgroundColor: "#222",
    borderColor: "#222",
  },
  denomText: {
    color: "#222",
    fontWeight: "600",
  },
  denomTextActive: {
    color: "#fff",
    fontWeight: "700",
  },
  claveBlock: {
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#fff",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ddd",
  },
  saveBlock: {
    gap: 6,
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  segmentRow: {
    flexDirection: "row",
    gap: 8,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#aaa",
    alignItems: "center",
  },
  segmentButtonActive: {
    backgroundColor: "#222",
    borderColor: "#222",
  },
  segmentText: {
    color: "#222",
    fontWeight: "600",
  },
  segmentTextActive: {
    color: "#fff",
    fontWeight: "700",
  },
  presetBlock: {
    gap: 8,
  },
  presetsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  presetButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#aaa",
  },
  presetButtonActive: {
    backgroundColor: "#222",
    borderColor: "#222",
  },
  presetText: {
    color: "#222",
    fontWeight: "600",
  },
  presetTextActive: {
    color: "#fff",
    fontWeight: "700",
  },
  builderBlock: {
    gap: 8,
  },
  builderRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  builderButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#aaa",
  },
  builderButtonDisabled: {
    opacity: 0.4,
  },
  builderText: {
    color: "#222",
    fontWeight: "600",
  },
  builderTextDisabled: {
    color: "#666",
    fontWeight: "600",
  },
  helperText: {
    color: "#777",
  },
});

export default HomeScreen;
