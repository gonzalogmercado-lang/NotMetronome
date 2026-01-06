import { useEffect, useMemo, useState } from "react";
import { Button, Modal, ScrollView, StyleSheet, Text, View } from "react-native";

import { getClavePresets } from "../../core/constants/clavePresets";
import { buildCanFill } from "../../utils/rhythm/buildCanFill";
import { accentPatternGlyphs, deriveAccentPerTick } from "../../utils/rhythm/deriveAccentPerTick";

type ClaveModalProps = {
  visible: boolean;
  meter: { n: number; d: number };
  currentGroups?: number[];
  onRequestClose: () => void;
  onUpdateGroups: (groups: number[]) => void;
  onClearGroups: () => void;
};

const allowedSizesForMeter = (d: number) => {
  if (d === 8 || d === 16) return [2, 3, 4, 5];
  return [2, 3, 4, 5];
};

function ClaveModal({ visible, meter, currentGroups, onRequestClose, onUpdateGroups, onClearGroups }: ClaveModalProps) {
  const [builderGroups, setBuilderGroups] = useState<number[]>(currentGroups ?? []);

  const allowedSizes = useMemo(() => allowedSizesForMeter(meter.d), [meter.d]);
  const canFill = useMemo(() => buildCanFill(meter.n, allowedSizes), [meter.n, allowedSizes]);

  useEffect(() => {
    if (visible) {
      setBuilderGroups(currentGroups ?? []);
    }
  }, [currentGroups, meter.d, meter.n, visible]);

  const remaining = Math.max(0, meter.n - builderGroups.reduce((sum, value) => sum + value, 0));

  const commitGroups = (next: number[]) => {
    setBuilderGroups(next);
    if (next.length > 0) {
      onUpdateGroups(next);
    } else {
      onClearGroups();
    }
  };

  const handleAddSize = (size: number) => {
    const canAdd = size <= remaining && canFill[remaining - size];
    if (!canAdd) return;
    commitGroups([...builderGroups, size]);
  };

  const handleUndo = () => {
    if (builderGroups.length === 0) return;
    commitGroups(builderGroups.slice(0, -1));
  };

  const handleReset = () => {
    commitGroups([]);
  };

  const previewAccentGlyphs = accentPatternGlyphs(deriveAccentPerTick(meter, builderGroups.length > 0 ? builderGroups : undefined));
  const presetOptions = useMemo(() => getClavePresets(meter), [meter]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onRequestClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Clave</Text>
          <Button title="Close" onPress={onRequestClose} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sugerencias</Text>
            {presetOptions.length === 0 ? (
              <Text style={styles.helper}>No hay sugerencias para {meter.n}/{meter.d}</Text>
            ) : (
              <View style={styles.presetsGrid}>
                {presetOptions.map((preset, index) => (
                  <Button key={`${preset.join("-")}-${index}`} title={preset.join(" + ")} onPress={() => commitGroups(preset)} />
                ))}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Libre</Text>
            <Text style={styles.helper}>Total: {meter.n} • Remaining: {remaining}</Text>
            <View style={styles.chipRow}>
              {builderGroups.length === 0 ? <Text style={styles.placeholder}>Sin grupos aún</Text> : null}
              {builderGroups.map((value, index) => (
                <View key={`${value}-${index}`} style={styles.chip}>
                  <Text style={styles.chipText}>{value}</Text>
                </View>
              ))}
            </View>
            <View style={styles.buttonsRow}>
              {allowedSizes.map((size) => {
                const disabled = size > remaining || !canFill[remaining - size];
                return <Button key={size} title={`+${size}`} onPress={() => handleAddSize(size)} disabled={disabled} />;
              })}
            </View>
            <View style={styles.buttonsRow}>
              <Button title="Undo" onPress={handleUndo} disabled={builderGroups.length === 0} />
              <Button title="Reset" onPress={handleReset} disabled={builderGroups.length === 0 && !currentGroups?.length} />
            </View>
            {remaining === 0 ? <Text style={styles.complete}>✅ Complete</Text> : null}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Preview</Text>
            <Text style={styles.helper}>Accent pattern (F=BAR, m=GROUP, x=WEAK)</Text>
            <Text style={styles.preview}>{previewAccentGlyphs}</Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 48,
  },
  header: {
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
  },
  content: {
    padding: 16,
    gap: 18,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  helper: {
    color: "#555",
  },
  presetsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    alignItems: "center",
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#efefef",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
  },
  chipText: {
    fontWeight: "600",
  },
  placeholder: {
    color: "#888",
  },
  buttonsRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  preview: {
    fontFamily: "monospace",
    fontSize: 16,
  },
  complete: {
    color: "#2d862d",
    fontWeight: "700",
  },
});

export default ClaveModal;
