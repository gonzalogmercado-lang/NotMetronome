import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";

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
  const { bpm, setBpm, increment, decrement, tap } = useTempoStore();
  const {
    // ✅ multi-bar
    bars,
    selectedBarIndex,
    selectBar,
    addBar,
    removeBar,

    // ✅ proxies del bar seleccionado
    meter,
    setMeter,
    groups,
    setGroups,
    clearGroups,
    pulseSubdivs,
    pulseSubdivMasks,
    setPulseSubdiv,
    togglePulseSubdivMaskSlot,
  } = useMeterStore();
  const { isPlaying, setPlaying, proMode, setProMode } = useUiStore();

  const [tickInfo, setTickInfo] = useState<TickInfo | null>(null);
  const [tickCount, setTickCount] = useState(0);
  const [isClaveOpen, setClaveOpen] = useState(false);

  // Subdivisions: por ahora UI habilitada solo si denominador 4 (subdivisiones sobre negras)
  const isSubdivEnabled = meter.d === 4;

  const [selectedBeat, setSelectedBeat] = useState(0);

  const barCount = Math.max(1, bars?.length ?? 1);
  const safeSelectedBar = Math.max(0, Math.min(barCount - 1, selectedBarIndex ?? 0));

  // --- Tempo UX (long-press accel + manual edit) ---
  const [isBpmModalOpen, setBpmModalOpen] = useState(false);
  const [bpmDraft, setBpmDraft] = useState(String(bpm));

  const tempoHoldRef = useRef<{
    dir: 1 | -1;
    startMs: number;
    timeoutId: ReturnType<typeof setTimeout> | null;
    intervalId: ReturnType<typeof setInterval> | null;
  } | null>(null);

  const stopTempoHold = () => {
    const ref = tempoHoldRef.current;
    if (!ref) return;
    if (ref.timeoutId) clearTimeout(ref.timeoutId);
    if (ref.intervalId) clearInterval(ref.intervalId);
    tempoHoldRef.current = null;
  };

  const applyTempoStep = (dir: 1 | -1, step: number) => {
    for (let i = 0; i < step; i += 1) {
      if (dir === 1) increment();
      else decrement();
    }
  };

  const startTempoHold = (dir: 1 | -1) => {
    stopTempoHold();

    // Tap: siempre 1 paso inmediato
    applyTempoStep(dir, 1);

    const startMs = Date.now();

    const timeoutId = setTimeout(() => {
      const intervalId = setInterval(() => {
        const elapsed = Date.now() - startMs;

        // Aceleración por tiempo sostenido (simple y predecible)
        const step = elapsed < 800 ? 1 : elapsed < 1600 ? 2 : elapsed < 2400 ? 5 : 10;

        applyTempoStep(dir, step);
      }, 110);

      if (tempoHoldRef.current) {
        tempoHoldRef.current.intervalId = intervalId;
      } else {
        clearInterval(intervalId);
      }
    }, 350);

    tempoHoldRef.current = {
      dir,
      startMs,
      timeoutId,
      intervalId: null,
    };
  };

  useEffect(() => {
    return () => {
      stopTempoHold();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openBpmModal = () => {
    stopTempoHold();
    setBpmDraft(String(bpm));
    setBpmModalOpen(true);
  };

  const closeBpmModal = () => {
    Keyboard.dismiss();
    setBpmModalOpen(false);
  };

  const commitBpmDraft = () => {
    const raw = bpmDraft.trim();
    const next = parseInt(raw, 10);
    if (!Number.isFinite(next)) {
      closeBpmModal();
      return;
    }
    setBpm(next);
    closeBpmModal();
  };
  // --- end tempo UX ---

  const meterLabel = useMemo(() => `${meter.n}/${meter.d}`, [meter]);

  const shouldShowClave = useMemo(() => {
    // Clave visible en compases irregulares o si Pro mode está activado
    return proMode || meter.n !== 4 || meter.d !== 4;
  }, [meter, proMode]);

  const {
    start: startClock,
    stop: stopClock,
    lastTick,
    accentLevels,
    audioState,
    audioDetails,
  } = useMetronomeAudio({
    bpm,

    // En modo bars, estos 2 quedan como "compat" (y para Clave UI).
    meter,
    groups,

    // ✅ per-beat subdiv + per-beat mask (solo d=4)
    pulseSubdivs: isSubdivEnabled ? pulseSubdivs : undefined,
    pulseSubdivMasks: isSubdivEnabled ? pulseSubdivMasks : undefined,

    // ✅ multi-bar loop
    bars,
    startBarIndex: safeSelectedBar,
    loop: true,

    onBarChange: (nextBarIndex) => {
      // Seguimos el playback en UI
      selectBar(nextBarIndex);
      setSelectedBeat(0);
    },

    onTick: (info) => {
      setTickCount((prev) => prev + 1);
      setTickInfo(info);
    },
  });

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

      <Text style={styles.smallMuted}>
        Audio: {audioState}
        {audioDetails ? ` — ${audioDetails}` : ""}
      </Text>

      {/* Tempo */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Tempo</Text>
        <View style={styles.rowBetween}>
          <Pressable style={styles.smallBtn} onPressIn={() => startTempoHold(-1)} onPressOut={stopTempoHold}>
            <Text style={styles.smallBtnText}>-</Text>
          </Pressable>

          <Pressable onPress={openBpmModal}>
            <Text style={styles.bigValue}>{bpm} BPM</Text>
          </Pressable>

          <Pressable style={styles.smallBtn} onPressIn={() => startTempoHold(1)} onPressOut={stopTempoHold}>
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

      {/* BPM edit modal */}
      <Modal transparent visible={isBpmModalOpen} animationType="fade" onRequestClose={closeBpmModal}>
        <Pressable style={styles.modalBackdrop} onPress={closeBpmModal}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Editar BPM</Text>

            <Text style={styles.modalHint}>Escribí un número (ej: 120). El store lo clamp-ea a su rango.</Text>

            <TextInput
              value={bpmDraft}
              onChangeText={setBpmDraft}
              keyboardType="number-pad"
              autoFocus
              placeholder="BPM"
              style={styles.modalInput}
              returnKeyType="done"
              onSubmitEditing={commitBpmDraft}
            />

            <View style={styles.modalRow}>
              <Pressable style={[styles.modalBtn, styles.modalBtnGhost]} onPress={closeBpmModal}>
                <Text style={styles.modalBtnGhostText}>Cancelar</Text>
              </Pressable>

              <Pressable style={[styles.modalBtn, styles.modalBtnPrimary]} onPress={commitBpmDraft}>
                <Text style={styles.modalBtnPrimaryText}>OK</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Bars */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Bars</Text>
        <Text style={styles.helperText}>
          Bar seleccionado: {safeSelectedBar + 1} / {barCount}
        </Text>

        <View style={[styles.row, { marginTop: 10, gap: 10, flexWrap: "wrap" }]}>
          {Array.from({ length: barCount }).map((_, i) => {
            const bar = bars?.[i];
            const label = bar ? `${i + 1}: ${bar.meter.n}/${bar.meter.d}` : `${i + 1}`;
            const active = i === safeSelectedBar;

            return (
              <Pressable
                key={i}
                style={[styles.pill, active && styles.pillActive]}
                onPress={() => {
                  selectBar(i);
                  setSelectedBeat(0);
                }}
              >
                <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
              </Pressable>
            );
          })}

          <Pressable
            style={[styles.pill, styles.pillAdd]}
            onPress={() => {
              addBar();
              setSelectedBeat(0);
            }}
          >
            <Text style={styles.pillAddText}>+ Bar</Text>
          </Pressable>

          <Pressable
            style={[styles.pill, styles.pillDanger, barCount <= 1 && styles.pillDisabled]}
            disabled={barCount <= 1}
            onPress={() => {
              removeBar(safeSelectedBar);
              setSelectedBeat(0);
            }}
          >
            <Text style={[styles.pillDangerText, barCount <= 1 && styles.pillDisabledText]}>Delete</Text>
          </Pressable>
        </View>

        <Text style={styles.helperText}>Tip: “+ Bar” crea 4/4 por defecto. Después lo editás como quieras.</Text>
      </View>

      {/* Meter (del bar seleccionado) */}
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
              1) Elegís el beat. 2) Elegís subdiv (1–8). 3) Elegís qué golpes suenan (máscara).
            </Text>

            {/* Beat selector */}
            <View style={styles.beatRow}>
              {Array.from({ length: beatCount }).map((_, i) => {
                const v = pulseSubdivs?.[i] ?? 1;
                const isSel = i === safeSelectedBeat;
                return (
                  <Pressable
                    key={i}
                    style={[styles.beatTile, v > 1 && styles.beatTileActive, isSel && styles.beatTileSelected]}
                    onPress={() => setSelectedBeat(i)}
                  >
                    <Text style={v > 1 ? styles.beatTextActive : styles.beatText}>Beat {i + 1}</Text>
                    <Text style={v > 1 ? styles.beatValueActive : styles.beatValue}>{v}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Subdiv buttons for selected beat */}
            <View style={{ marginTop: 12 }}>
              <Text style={styles.helperText}>Subdivisión del Beat {safeSelectedBeat + 1}:</Text>

              <View style={styles.subdivRow}>
                {Array.from({ length: 8 }).map((_, idx) => {
                  const value = idx + 1;
                  const isActive = selectedSubdiv === value;
                  return (
                    <Pressable
                      key={value}
                      style={[styles.subdivBtn, isActive && styles.subdivBtnActive]}
                      onPress={() => setPulseSubdiv(safeSelectedBeat, value)}
                    >
                      <Text style={[styles.subdivBtnText, isActive && styles.subdivBtnTextActive]}>{value}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.helperText}>
                Por ahora 1–8. Después lo cambiamos por figuras (negra, corchea, tresillo, etc.).
              </Text>
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

  pillAdd: { backgroundColor: "#1e88e5", borderColor: "#1e88e5" },
  pillAddText: { color: "#fff", fontWeight: "800" },

  pillDanger: { backgroundColor: "#fff", borderColor: "#ffb3b3" },
  pillDangerText: { color: "#c62828", fontWeight: "800" },

  pillDisabled: { opacity: 0.45 },
  pillDisabledText: { color: "#888" },

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

  subdivRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  subdivBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
    alignItems: "center",
    justifyContent: "center",
  },
  subdivBtnActive: { backgroundColor: "#1e88e5", borderColor: "#1e88e5" },
  subdivBtnText: { color: "#111", fontWeight: "800" },
  subdivBtnTextActive: { color: "#fff", fontWeight: "800" },

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

  modalBackdrop: {
    flex: 1,
    padding: 16,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
  },
  modalTitle: { fontSize: 16, fontWeight: "800", color: "#111" },
  modalHint: { fontSize: 12, color: "#666", marginTop: 6 },
  modalInput: {
    marginTop: 10,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#f3f3f3",
    paddingHorizontal: 12,
    fontSize: 16,
    fontWeight: "700",
    color: "#111",
  },
  modalRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
    justifyContent: "flex-end",
  },
  modalBtn: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBtnGhost: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  modalBtnGhostText: { color: "#111", fontWeight: "800" },
  modalBtnPrimary: { backgroundColor: "#111" },
  modalBtnPrimaryText: { color: "#fff", fontWeight: "800" },
});
