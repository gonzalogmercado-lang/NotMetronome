import { useEffect, useMemo, useState } from "react";
import { Button, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { addGroup, canAddGroup, remainingTicks, undoGroup } from "../../core/clave/builder";
import { formatGroups, getClavePresets } from "../../core/clave/presets";
import { Meter } from "../../core/types";
import { useCreatorStore } from "../../store/creator.store";
import { useMeterStore } from "../../store/meter.store";
import { useSavedBarsStore } from "../../store/savedBars.store";

const isGroupsComplete = (meter: Meter, groups?: number[]) => {
  if (!groups || groups.length === 0) return false;
  return groups.reduce((sum, value) => sum + value, 0) === meter.n;
};

function CreatorScreen() {
  const { meter, groups } = useMeterStore();
  const claveEnabled = !!(groups && groups.length > 0);

  const { savedBars } = useSavedBarsStore();
  const {
    bars,
    selectedBarId,
    initFromCurrentIfEmpty,
    selectBar,
    addEmptyBar,
    addFromSavedBar,
    duplicateBar,
    removeBar,
    updateBar,
  } = useCreatorStore();

  const [showAddOptions, setShowAddOptions] = useState(false);
  const [showSavedPicker, setShowSavedPicker] = useState(false);
  const [editorMode, setEditorMode] = useState<"presets" | "build">("presets");

  useEffect(() => {
    initFromCurrentIfEmpty({ meter, claveEnabled, groups });
  }, [initFromCurrentIfEmpty, meter, claveEnabled, groups]);

  useEffect(() => {
    setEditorMode("presets");
  }, [selectedBarId]);

  const selectedBar = bars.find((bar) => bar.id === selectedBarId) ?? null;

  const handleAddBar = (type: "empty" | "duplicate" | "saved") => {
    const lastBarId = bars[bars.length - 1]?.id;
    if (type === "empty") {
      addEmptyBar(lastBarId);
    }
    if (type === "duplicate" && lastBarId) {
      duplicateBar(lastBarId);
    }
    if (type === "saved") {
      setShowSavedPicker((prev) => !prev);
      return;
    }
    setShowAddOptions(false);
  };

  const handleInsertSaved = (savedId: string) => {
    const lastBarId = bars[bars.length - 1]?.id;
    addFromSavedBar(savedId, lastBarId);
    setShowAddOptions(false);
    setShowSavedPicker(false);
  };

  const editorGroups = selectedBar?.groups ?? [];
  const editorRemaining = selectedBar ? remainingTicks(selectedBar.meter, editorGroups) : 0;
  const editorComplete = selectedBar ? isGroupsComplete(selectedBar.meter, selectedBar.groups) : false;
  const editorPresets = useMemo(() => (selectedBar ? getClavePresets(selectedBar.meter) : []), [selectedBar]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Creator</Text>

      <View style={styles.list}>
        {bars.map((bar) => {
          const claveActive = bar.claveEnabled && isGroupsComplete(bar.meter, bar.groups);
          return (
            <View key={bar.id} style={[styles.barCard, selectedBarId === bar.id && styles.barCardSelected]}>
              <View style={styles.barHeader}>
                <Text style={styles.barTitle}>
                  {bar.meter.n}/{bar.meter.d}
                </Text>
                <Text style={[styles.badge, claveActive ? styles.badgeOn : styles.badgeOff]}>
                  {claveActive ? "ON" : "OFF"}
                </Text>
              </View>
              <Text style={styles.barSubtitle}>Clave: {bar.groups && bar.groups.length > 0 ? formatGroups(bar.groups) : "—"}</Text>
              {bar.name ? <Text style={styles.barName}>{bar.name}</Text> : null}
              <View style={styles.barActions}>
                <Pressable style={styles.actionButton} onPress={() => selectBar(bar.id)}>
                  <Text style={styles.actionText}>Edit</Text>
                </Pressable>
                <Pressable style={styles.actionButton} onPress={() => duplicateBar(bar.id)}>
                  <Text style={styles.actionText}>Duplicate</Text>
                </Pressable>
                <Pressable style={styles.actionButton} onPress={() => removeBar(bar.id)}>
                  <Text style={styles.actionText}>Delete</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.addBlock}>
        <Pressable style={styles.addButton} onPress={() => setShowAddOptions((prev) => !prev)}>
          <Text style={styles.addText}>+ Agregar compás</Text>
        </Pressable>
        {showAddOptions ? (
          <View style={styles.addOptions}>
            <Button title="Nuevo vacío" onPress={() => handleAddBar("empty")} />
            <Button title="Duplicar último" onPress={() => handleAddBar("duplicate")} />
            <Button title="Insertar guardado" onPress={() => handleAddBar("saved")} />
            {showSavedPicker ? (
              <View style={styles.savedList}>
                {savedBars.length === 0 ? (
                  <Text style={styles.helperText}>Sin compases guardados.</Text>
                ) : (
                  savedBars.map((saved) => (
                    <Pressable key={saved.id} style={styles.savedItem} onPress={() => handleInsertSaved(saved.id)}>
                      <Text style={styles.savedName}>{saved.name}</Text>
                      <Text style={styles.savedMeta}>
                        {saved.meter.n}/{saved.meter.d}
                      </Text>
                    </Pressable>
                  ))
                )}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {selectedBar ? (
        <View style={styles.editorBlock}>
          <Text style={styles.sectionTitle}>Editor</Text>

          <View style={styles.meterRow}>
            <Button
              title="-"
              onPress={() =>
                updateBar(selectedBar.id, { meter: { ...selectedBar.meter, n: Math.max(1, selectedBar.meter.n - 1) } })
              }
            />
            <Text style={styles.meterValue}>
              {selectedBar.meter.n}/{selectedBar.meter.d}
            </Text>
            <Button title="+" onPress={() => updateBar(selectedBar.id, { meter: { ...selectedBar.meter, n: selectedBar.meter.n + 1 } })} />
          </View>

          <View style={styles.denomRow}>
            {[4, 8, 16].map((value) => {
              const selected = selectedBar.meter.d === value;
              return (
                <Pressable
                  key={value}
                  style={[styles.denomOption, selected && styles.denomOptionActive]}
                  onPress={() => updateBar(selectedBar.id, { meter: { ...selectedBar.meter, d: value } })}
                >
                  <Text style={selected ? styles.denomTextActive : styles.denomText}>{value}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.sectionTitle}>Clave</Text>
            <Switch
              value={selectedBar.claveEnabled}
              onValueChange={(value) => updateBar(selectedBar.id, { claveEnabled: value })}
            />
          </View>

          <Text style={styles.helperText}>
            Clave actual: {selectedBar.groups && selectedBar.groups.length > 0 ? formatGroups(selectedBar.groups) : "—"}
          </Text>

          {selectedBar.claveEnabled ? (
            <>
              <View style={styles.segmentRow}>
                {([
                  { key: "presets", label: "Presets" },
                  { key: "build", label: "Build" },
                ] as const).map((option) => {
                  const selected = editorMode === option.key;
                  return (
                    <Pressable
                      key={option.key}
                      style={[styles.segmentButton, selected && styles.segmentButtonActive]}
                      onPress={() => setEditorMode(option.key)}
                    >
                      <Text style={selected ? styles.segmentTextActive : styles.segmentText}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {editorMode === "presets" ? (
                <View style={styles.presetBlock}>
                  {editorPresets.length === 0 ? (
                    <Text style={styles.helperText}>Sin presets sugeridos para este compás.</Text>
                  ) : (
                    <View style={styles.presetsGrid}>
                      {editorPresets.map((preset, index) => {
                        const label = formatGroups(preset);
                        const selected = editorComplete && label === formatGroups(editorGroups);
                        return (
                          <Pressable
                            key={`${label}-${index}`}
                            style={[styles.presetButton, selected && styles.presetButtonActive]}
                            onPress={() => updateBar(selectedBar.id, { groups: preset })}
                          >
                            <Text style={selected ? styles.presetTextActive : styles.presetText}>{label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              ) : (
                <View style={styles.builderBlock}>
                  <View style={styles.builderRow}>
                    {[2, 3, 4].map((value) => {
                      const disabled = !canAddGroup(selectedBar.meter, editorGroups, value);
                      return (
                        <Pressable
                          key={value}
                          style={[styles.builderButton, disabled && styles.builderButtonDisabled]}
                          onPress={() => updateBar(selectedBar.id, { groups: addGroup(selectedBar.meter, editorGroups, value) })}
                          disabled={disabled}
                        >
                          <Text style={disabled ? styles.builderTextDisabled : styles.builderText}>+{value}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <View style={styles.builderRow}>
                    <Pressable style={styles.builderButton} onPress={() => updateBar(selectedBar.id, { groups: undoGroup(editorGroups) })}>
                      <Text style={styles.builderText}>Undo</Text>
                    </Pressable>
                    <Pressable style={styles.builderButton} onPress={() => updateBar(selectedBar.id, { groups: [] })}>
                      <Text style={styles.builderText}>Reset</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              <Text style={styles.helperText}>{editorRemaining === 0 ? "Completo" : `Restan ${editorRemaining}`}</Text>
            </>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: "700" },

  list: { gap: 10 },
  barCard: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "#ddd" },
  barCardSelected: { borderColor: "#999" },

  barHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  barTitle: { fontSize: 16, fontWeight: "700" },

  badge: { fontSize: 12, fontWeight: "700", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeOn: { borderWidth: 1, borderColor: "#aaa" },
  badgeOff: { borderWidth: 1, borderColor: "#ddd" },

  barSubtitle: { marginTop: 6, fontSize: 14 },
  barName: { marginTop: 4, fontSize: 13, opacity: 0.8 },

  barActions: { flexDirection: "row", gap: 10, marginTop: 10 },
  actionButton: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: "#ddd" },
  actionText: { fontSize: 13, fontWeight: "600" },

  addBlock: { gap: 10 },
  addButton: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: "#ddd" },
  addText: { fontSize: 14, fontWeight: "700" },
  addOptions: { gap: 8 },
  savedList: { gap: 8, marginTop: 8 },
  savedItem: { padding: 10, borderRadius: 12, borderWidth: 1, borderColor: "#ddd" },
  savedName: { fontSize: 14, fontWeight: "700" },
  savedMeta: { fontSize: 12, opacity: 0.7 },

  editorBlock: { marginTop: 6, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "#ddd", gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: "700" },

  meterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  meterValue: { fontSize: 16, fontWeight: "700" },

  denomRow: { flexDirection: "row", gap: 10 },
  denomOption: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: "#ddd" },
  denomOptionActive: { borderColor: "#999" },
  denomText: { fontSize: 13, fontWeight: "600" },
  denomTextActive: { fontSize: 13, fontWeight: "800" },

  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

  segmentRow: { flexDirection: "row", gap: 10 },
  segmentButton: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: "#ddd", alignItems: "center" },
  segmentButtonActive: { borderColor: "#999" },
  segmentText: { fontSize: 13, fontWeight: "600" },
  segmentTextActive: { fontSize: 13, fontWeight: "800" },

  presetBlock: { gap: 8 },
  presetsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  presetButton: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: "#ddd" },
  presetButtonActive: { borderColor: "#999" },
  presetText: { fontSize: 13, fontWeight: "600" },
  presetTextActive: { fontSize: 13, fontWeight: "800" },

  builderBlock: { gap: 10 },
  builderRow: { flexDirection: "row", gap: 10 },
  builderButton: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: "#ddd", alignItems: "center" },
  builderButtonDisabled: { opacity: 0.4 },
  builderText: { fontSize: 13, fontWeight: "700" },
  builderTextDisabled: { fontSize: 13, fontWeight: "700" },

  helperText: { fontSize: 12, opacity: 0.75 },
});

export default CreatorScreen;
