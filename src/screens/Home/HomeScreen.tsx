import { useMemo, useState } from "react";
import { Button, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { useMetronomeAudio } from "../../audio/useMetronomeAudio";
import ClaveButton from "../../components/domain/ClaveButton";
import ClaveModal from "../../components/domain/ClaveModal";
import { TickInfo } from "../../core/types";
import { useMeterStore } from "../../store/meter.store";
import { useTempoStore } from "../../store/tempo.store";
import { useUiStore } from "../../store/ui.store";
import { ACCENT_GAIN, accentPatternGlyphs } from "../../utils/rhythm/deriveAccentPerTick";
import StatRow from "./components/StatRow";

function HomeScreen() {
  const { bpm, increment, decrement, tap } = useTempoStore();
  const { meter, setMeter, groups, setGroups, clearGroups } = useMeterStore();
  const { isPlaying, setPlaying, proMode, setProMode } = useUiStore();

  const [tickInfo, setTickInfo] = useState<TickInfo | null>(null);
  const [tickCount, setTickCount] = useState(0);
  const [isClaveOpen, setClaveOpen] = useState(false);

  // -------------------------------------------------------
  // Subdivisions (MVP UI): SOLO para negras (meter.d === 4)
  // subdiv = cuántos "slots" entran en una negra: 1..8
  // subdivMask = cuáles slots suenan dentro del grupo
  // -------------------------------------------------------
  const [subdiv, setSubdiv] = useState(1);
  const [subdivMask, setSubdivMask] = useState<boolean[]>([true]);

  const setSubdivSafe = (next: number) => {
    const n = Math.max(1, Math.min(8, next));
    setSubdiv(n);
    setSubdivMask((prev) => {
      if (prev.length === n) return prev;

      if (prev.length < n) {
        return [...prev, ...Array(n - prev.length).fill(true)];
      }

      const sliced = prev.slice(0, n);
      return sliced.some(Boolean) ? sliced : [true, ...Array(n - 1).fill(false)];
    });
  };

  const toggleSubdivSlot = (idx: number) => {
    setSubdivMask((prev) => {
      const next = [...prev];
      next[idx] = !next[idx];
      // No permitir "todo apagado" (si apaga todo, no aplicamos cambio)
      if (!next.some(Boolean)) return prev;
      return next;
    });
  };

  const { start: startClock, stop: stopClock, lastTick, accentLevels, audioState } = useMetronomeAudio({
    bpm,
    meter,
    groups,
    // ✅ CABLEADO: la UI ahora manda subdivisiones al engine
    subdiv,
    subdivMask,
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

  const currentAccentLevel = lastTick?.accentLevel ?? (tickInfo ? accentLevels[tickInfo.barTick] : undefined);
  const currentAccentGain = lastTick?.accentGain ?? (currentAccentLevel ? ACCENT_GAIN[currentAccentLevel] : undefined);

  const shouldShowClave = proMode || ((meter.d === 8 || meter.d === 16) && [5, 7, 11, 13, 15].includes(meter.n));
  const meterLabel = `${meter.n}/${meter.d}`;
  const audioStatusLabel =
    audioState === "ready"
      ? "Audio: armado con react-native-audio-api"
      : audioState === "error"
      ? "Audio: no disponible"
      : "Audio: inicializando";

  const isSubdivEnabled = meter.d === 4;

  return (
    <View style={styles.container}>
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
              <Pressable
                key={value}
                style={[styles.denomOption, selected && styles.denomOptionActive]}
                onPress={() => changeBottom(value)}
              >
                <Text style={selected ? styles.denomTextActive : styles.denomText}>{value}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Subdivisions UI (MVP) */}
        <View style={{ marginTop: 8 }}>
          <Text style={styles.sectionLabel}>Subdivisions</Text>

          {!isSubdivEnabled ? (
            <Text style={styles.helperText}>Disponible solo con denominador 4 (subdivisiones sobre negras).</Text>
          ) : (
            <>
              <Text style={styles.helperText}>Cuántas notas entran en una negra (1..8):</Text>
              <View style={styles.denomRow}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => {
                  const selected = subdiv === value;
                  return (
                    <Pressable
                      key={value}
                      style={[styles.denomOption, selected && styles.denomOptionActive]}
                      onPress={() => setSubdivSafe(value)}
                    >
                      <Text style={selected ? styles.denomTextActive : styles.denomText}>{value}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={{ marginTop: 8 }}>
                {subdiv === 1 ? (
                  <Text style={styles.helperText}>1 = sin subdividir (solo pulso).</Text>
                ) : (
                  <>
                    <Text style={styles.helperText}>Qué notas suenan dentro del grupo:</Text>
                    <View style={styles.denomRow}>
                      {Array.from({ length: subdiv }).map((_, i) => {
                        const on = subdivMask[i] ?? true;
                        return (
                          <Pressable
                            key={i}
                            style={[styles.denomOption, on && styles.denomOptionActive]}
                            onPress={() => toggleSubdivSlot(i)}
                          >
                            <Text style={on ? styles.denomTextActive : styles.denomText}>{i + 1}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={styles.helperText}>
                      Tip: podés dejar solo “2” prendido si querés que suene solo el segundo golpe.
                    </Text>
                  </>
                )}
              </View>
            </>
          )}
        </View>

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
        <StatRow
          label="Subdiv"
          value={isSubdivEnabled ? `${subdiv} | mask: ${subdivMask.map((x) => (x ? "1" : "0")).join("")}` : "disabled"}
        />
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
    flexWrap: "wrap",
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
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
  },
  helperText: {
    color: "#777",
  },
});

export default HomeScreen;
