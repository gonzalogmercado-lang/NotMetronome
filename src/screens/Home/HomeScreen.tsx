import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { useMetronomeAudio } from "../../audio/useMetronomeAudio";
import ClaveButton from "../../components/domain/ClaveButton";
import ClaveModal from "../../components/domain/ClaveModal";
import { TickInfo } from "../../core/types";
import { useMeterStore } from "../../store/meter.store";
import { useTempoStore } from "../../store/tempo.store";
import { useUiStore } from "../../store/ui.store";
import { accentPatternGlyphs } from "../../utils/rhythm/deriveAccentPerTick";
import StatRow from "./components/StatRow";

function HomeScreen() {
  const { bpm, increment, decrement, tap } = useTempoStore();
  const {
    meter,
    setMeter,
    groups,
    setGroups,
    clearGroups,
    pulseSubdivs,
    pulseSubdivMasks,
    setPulseSubdiv,
    setAllPulseSubdivs,
    togglePulseSubdivMaskSlot,
  } = useMeterStore();
  const { isPlaying, setPlaying, proMode, setProMode } = useUiStore();

  const [tickInfo, setTickInfo] = useState<TickInfo | null>(null);
  const [tickCount, setTickCount] = useState(0);
  const [isClaveOpen, setClaveOpen] = useState(false);

  // Subdivisions: por ahora UI habilitada solo si denominador 4 (subdivisiones sobre negras)
  const isSubdivEnabled = meter.d === 4;

  const [selectedBeat, setSelectedBeat] = useState(0);

  const cycleSubdiv = (value: number) => {
    const v = Math.max(1, Math.min(8, Math.floor(value)));
    return v === 8 ? 1 : v + 1;
  };

  const meterLabel = useMemo(() => `${meter.n}/${meter.d}`, [meter]);

  const shouldShowClave = useMemo(() => {
    // Clave visible en compases irregulares o si Pro mode está activado
    return proMode || meter.n !== 4 || meter.d !== 4;
  }, [meter, proMode]);

  const { start: startClock, stop: stopClock, lastTick, accentLevels, audioState } = useMetronomeAudio({
    bpm,
    meter,
    groups,

    // ✅ lo que querés: per-beat subdiv + per-beat mask
    pulseSubdivs: isSubdivEnabled ? pulseSubdivs : undefined,
    pulseSubdivMasks: isSubdivEnabled ? pulseSubdivMasks : undefined,

    onTick: (info) => {
      setTickCount((prev) => prev + 1);
      setTickInfo(info);
    },
  });

  // ✅ FIX TS2554: accentPatternGlyphs espera 1 arg (accentLevels), no (meter, groups)
  const accentGlyphs = useMemo(() => accentPatternGlyphs(accentLevels), [accentLevels]);

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
    setSelectedBeat(0);
  };

  const setDenom = (d: number) => {
    setMeter(meter.n, d);
    setSelectedBeat(0);
  };

  const beatCount = Math.max(1, meter.n);
  const safeSelectedBeat = Math.max(0, Math.min(beatCount - 1, selectedBeat));

  const selectedSubdiv = isSubdivEnabled ? pulseSubdivs?.[safeSelectedBeat] ?? 1 : 1;

  // máscara visible: si no hay guardada, default all-true del largo correcto
  const selectedMask = useMemo(() => {
    if (!isSubdivEnabled) return [true];

    const raw = pulseSubdivMasks?.[safeSelectedBeat];
    const len = Math.max(1, Math.min(8, selectedSubdiv));

    if (!raw || raw.length !== len) {
      return Array.from({ length: len }).map(() => true);
    }
    return raw;
  }, [isSubdivEnabled, pulseSubdivMasks, safeSelectedBeat, selectedSubdiv]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>NotMetronome</Text>

      <Text style={styles.smallMuted}>Audio: {audioState}</Text>

      {/* Tempo */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Tempo</Text>
        <View style={styles.rowBetween}>
          <Pressable style={styles.smallBtn} onPress={decrement}>
            <Text style={styles.smallBtnText}>-</Text>
          </Pressable>

          <Text style={styles.bigValue}>{bpm} BPM</Text>

          <Pressable style={styles.smallBtn} onPress={increment}>
            <Text style={styles.smallBtnText}>+</Text>
          </Pressable>
        </View>

        <View style={{ marginTop: 10 }}>
          <Pressable style={[styles.primaryBtn, isPlaying && styles.primaryBtnStop]} onPress={handleStartStop}>
            <Text style={styles.primaryBtnText}>{isPlaying ? "STOP" : "START"}</Text>
          </Pressable>

          <Pressable style={[styles.primaryBtn, { marginTop: 10 }]} onPress={tap}>
            <Text style={styles.primaryBtnText}>TAP TEMPO</Text>
          </Pressable>
        </View>
      </View>

      {/* Meter */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Meter</Text>

        <View style={styles.rowBetween}>
          <Pressable style={styles.smallBtn} onPress={() => changeTop(-1)}>
            <Text style={styles.smallBtnText}>-</Text>
          </Pressable>

          <Text style={styles.bigValue}>{meterLabel}</Text>

          <Pressable style={styles.smallBtn} onPress={() => changeTop(+1)}>
            <Text style={styles.smallBtnText}>+</Text>
          </Pressable>
        </View>

        <View style={[styles.row, { marginTop: 10, gap: 10 }]}>
          {[4, 8, 16].map((d) => (
            <Pressable key={d} style={[styles.pill, meter.d === d && styles.pillActive]} onPress={() => setDenom(d)}>
              <Text style={[styles.pillText, meter.d === d && styles.pillTextActive]}>{d}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Subdivisions */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Subdivisions</Text>

        {!isSubdivEnabled ? (
          <Text style={styles.helperText}>Disponible solo con denominador 4 (subdivisiones sobre negras).</Text>
        ) : (
          <>
            <Text style={styles.helperText}>
              Beat Inspector: cada pulso tiene su subdivisión (tocá para cambiar) + máscara por beat (qué golpes suenan).
            </Text>

            <View style={styles.beatRow}>
              {Array.from({ length: beatCount }).map((_, i) => {
                const v = pulseSubdivs?.[i] ?? 1;
                const isSel = i === safeSelectedBeat;
                return (
                  <Pressable
                    key={i}
                    style={[styles.beatTile, v > 1 && styles.beatTileActive, isSel && styles.beatTileSelected]}
                    onPress={() => {
                      setSelectedBeat(i);
                      setPulseSubdiv(i, cycleSubdiv(v));
                    }}
                  >
                    <Text style={v > 1 ? styles.beatTextActive : styles.beatText}>Beat {i + 1}</Text>
                    <Text style={v > 1 ? styles.beatValueActive : styles.beatValue}>{v}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ flexDirection: "row", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
              <Pressable style={styles.smallAction} onPress={() => setAllPulseSubdivs(5)}>
                <Text style={styles.smallActionText}>All = 5</Text>
              </Pressable>
              <Pressable style={styles.smallAction} onPress={() => setAllPulseSubdivs(3)}>
                <Text style={styles.smallActionText}>All = 3</Text>
              </Pressable>
              <Pressable style={styles.smallAction} onPress={() => setAllPulseSubdivs(1)}>
                <Text style={styles.smallActionText}>All = 1</Text>
              </Pressable>
            </View>

            {/* Per-beat mask editor */}
            <View style={{ marginTop: 12 }}>
              <Text style={styles.helperText}>
                Máscara del Beat {safeSelectedBeat + 1} (subdiv {selectedSubdiv}): encendé/apagá golpes.
              </Text>

              {selectedSubdiv <= 1 ? (
                <Text style={styles.helperText}>Subdiv = 1 → no hay golpes internos para mutear.</Text>
              ) : (
                <View style={[styles.denomRow, { marginTop: 8 }]}>
                  {Array.from({ length: selectedSubdiv }).map((_, idx) => {
                    const on = selectedMask[idx] ?? true;
                    return (
                      <Pressable
                        key={idx}
                        style={[styles.denomOption, on && styles.denomOptionActive]}
                        onPress={() => togglePulseSubdivMaskSlot(safeSelectedBeat, idx)}
                      >
                        <Text style={on ? styles.denomTextActive : styles.denomText}>{idx + 1}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {selectedSubdiv > 1 && (
                <Text style={styles.helperText}>
                  Ejemplo: en 5, dejá 1.0.1.0.1 para “tresillo raro” sin cambiar el subdiv.
                </Text>
              )}
            </View>
          </>
        )}
      </View>

      {/* Pro mode + stats */}
      <View style={styles.switchRow}>
        <Text style={styles.sectionLabel}>Pro mode</Text>
        <Switch value={proMode} onValueChange={setProMode} />
      </View>

      <StatRow label="Groups" value={groups && groups.length > 0 ? groups.join(" + ") : "None"} />
      <StatRow label="Accent pattern" value={accentGlyphs} />

      {shouldShowClave ? (
        <>
          <ClaveButton
            meterLabel={meterLabel}
            onPress={() => setClaveOpen(true)}
            accentPreview={accentGlyphs}
            footer={<Text>Editar agrupaciones</Text>}
          />
          <ClaveModal
            visible={isClaveOpen}
            meter={meter}
            currentGroups={groups}
            onRequestClose={() => setClaveOpen(false)}
            onUpdateGroups={setGroups}
            onClearGroups={clearGroups}
          />
        </>
      ) : (
        <Text style={styles.helperText}>Clave disponible para compases irregulares (o activa Pro mode)</Text>
      )}

      {/* Debug */}
      <View style={{ marginTop: 12 }}>
        <Text style={styles.smallMuted}>
          tickCount={tickCount} lastTick={lastTick ? `${lastTick.tickIndex}@${Math.round(lastTick.atMs)}ms` : "null"}
        </Text>
        <Text style={styles.smallMuted}>
          accents={accentLevels?.length ? accentLevels.slice(0, Math.min(32, accentLevels.length)).join(",") : "none"}
        </Text>
      </View>
    </ScrollView>
  );
}

export default HomeScreen;

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: "#fff", paddingBottom: 32 },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 8, color: "#111" },
  smallMuted: { fontSize: 12, color: "#666" },

  card: {
    backgroundColor: "#f3f3f3",
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
  },

  sectionLabel: { fontSize: 16, fontWeight: "700", color: "#111" },
  helperText: { fontSize: 12, color: "#666", marginTop: 6 },

  row: { flexDirection: "row", alignItems: "center" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 },

  bigValue: { fontSize: 22, fontWeight: "700", color: "#111" },

  smallBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: "#1e88e5",
    alignItems: "center",
    justifyContent: "center",
  },
  smallBtnText: { color: "#fff", fontSize: 20, fontWeight: "800" },

  primaryBtn: {
    height: 44,
    borderRadius: 10,
    backgroundColor: "#1e88e5",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnStop: { backgroundColor: "#1565c0" },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },

  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  pillActive: { backgroundColor: "#111", borderColor: "#111" },
  pillText: { color: "#111", fontWeight: "700" },
  pillTextActive: { color: "#fff" },

  beatRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 10,
  },
  beatTile: {
    width: 120,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  beatTileActive: { borderColor: "#1e88e5" },
  beatTileSelected: { borderColor: "#111", borderWidth: 2 },

  beatText: { fontSize: 12, color: "#666" },
  beatValue: { fontSize: 22, fontWeight: "800", color: "#111" },
  beatTextActive: { fontSize: 12, color: "#1e88e5" },
  beatValueActive: { fontSize: 22, fontWeight: "800", color: "#1e88e5" },

  smallAction: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  smallActionText: { fontSize: 12, fontWeight: "800", color: "#111" },

  denomRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  denomOption: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
    alignItems: "center",
    justifyContent: "center",
  },
  denomOptionActive: { backgroundColor: "#111", borderColor: "#111" },
  denomText: { color: "#111", fontWeight: "800" },
  denomTextActive: { color: "#fff", fontWeight: "800" },

  switchRow: {
    marginTop: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
