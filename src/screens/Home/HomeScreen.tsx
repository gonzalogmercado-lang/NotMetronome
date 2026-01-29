import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { useMetronomeAudio } from "../../audio/useMetronomeAudio";
import ClaveButton from "../../components/domain/ClaveButton";
import ClaveModal from "../../components/domain/ClaveModal";
import { TickInfo } from "../../core/types";
import { useMeterStore } from "../../store/meter.store";
import { useProjectMetaStore } from "../../store/projectMeta.store";
import { useTempoStore } from "../../store/tempo.store";
import { useUiStore } from "../../store/ui.store";
import { accentPatternGlyphs } from "../../utils/rhythm/deriveAccentPerTick";
import StatRow from "./components/StatRow";

const subdivFigure = (n: number) => {
  switch (n) {
    case 1:
      return "♩"; // negra
    case 2:
      return "♪"; // corcheas
    case 3:
      return "3"; // tresillo (placeholder claro)
    case 4:
      return "♬"; // semicorcheas
    case 5:
      return "5";
    case 6:
      return "6";
    case 7:
      return "7";
    case 8:
      return "8";
    default:
      return String(n);
  }
};

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

    // ✅ NUEVO: duplicar bar (ya lo tenías implementado antes en Home)
    duplicateBar,
  } = useMeterStore() as any;

  const { isPlaying, setPlaying, proMode, setProMode, beatGuide, setBeatGuide } = useUiStore();

  const {
    projectName,
    setProjectName,
    resetProjectName,
    projects,
    activeProjectId,
    newProject,
    openProject,
  } = useProjectMetaStore();

  const [isProjectMenuOpen, setProjectMenuOpen] = useState(false);

  const [isProjectModalOpen, setProjectModalOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState(projectName);

  const [tickInfo, setTickInfo] = useState<TickInfo | null>(null);
  const [tickCount, setTickCount] = useState(0);
  const [isClaveOpen, setClaveOpen] = useState(false);

  // Subdivisions: por ahora UI habilitada solo si denominador 4 (subdivisiones sobre negras)
  const isSubdivEnabled = meter.d === 4;

  const [selectedBeat, setSelectedBeat] = useState(0);

  const barCount = Math.max(1, bars?.length ?? 1);
  const safeSelectedBar = Math.max(0, Math.min(barCount - 1, selectedBarIndex ?? 0));

  // =========================
  // 🔥 PLAYHEAD VISUAL (beat + sub-slot)
  // =========================
  const [playBeat, setPlayBeat] = useState<number | null>(null); // 0..meter.n-1
  const [playSlot, setPlaySlot] = useState<number | null>(null); // 0..subdiv-1
  const [playSubdiv, setPlaySubdiv] = useState<number>(1);

  const playTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearPlayTimers = useCallback(() => {
    playTimersRef.current.forEach((id) => clearTimeout(id));
    playTimersRef.current = [];
  }, []);

  // ✅ Seguimiento robusto del compás en playback (source of truth: tick.barIndex)
  const lastFollowedBarRef = useRef<number | null>(0);

  const followPlaybackBar = useCallback(
    (nextBarIndex: number) => {
      lastFollowedBarRef.current = nextBarIndex;

      // Seguimos el playback en UI
      selectBar(nextBarIndex);
      setSelectedBeat(0);

      // reset visual del playhead
      clearPlayTimers();
      setPlayBeat(0);
      setPlaySlot(0);
      setPlaySubdiv(1);
    },
    [selectBar, clearPlayTimers]
  );

  const bpmRef = useRef(bpm);
  const meterRef = useRef(meter);
  const isSubdivEnabledRef = useRef(isSubdivEnabled);
  const pulseSubdivsRef = useRef(pulseSubdivs);
  const isPlayingRef = useRef(isPlaying);

  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);

  useEffect(() => {
    meterRef.current = meter;
    isSubdivEnabledRef.current = isSubdivEnabled;
    pulseSubdivsRef.current = pulseSubdivs;
  }, [meter, isSubdivEnabled, pulseSubdivs]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    if (!isPlaying) {
      clearPlayTimers();
      setPlayBeat(null);
      setPlaySlot(null);
      setPlaySubdiv(1);
    }
  }, [isPlaying, clearPlayTimers]);

  useEffect(() => {
    return () => {
      clearPlayTimers();
    };
  }, [clearPlayTimers]);

  const schedulePlayheadForBeat = useCallback(
    (beatIndex: number) => {
      if (!isPlayingRef.current) return;

      const m = meterRef.current;
      const localBpm = bpmRef.current;

      // duración de un beat según denominador actual
      const beatDurMs = (60_000 / Math.max(1, localBpm)) * (4 / Math.max(1, m.d));

      const enabled = isSubdivEnabledRef.current;
      const ps = pulseSubdivsRef.current;

      const subdiv = enabled && ps && ps.length > 0 ? Math.max(1, Math.min(16, ps[beatIndex] ?? 1)) : 1;

      clearPlayTimers();
      setPlayBeat(beatIndex);
      setPlaySubdiv(subdiv);
      setPlaySlot(0);

      if (subdiv <= 1) return;

      const slotDur = beatDurMs / subdiv;

      for (let i = 1; i < subdiv; i += 1) {
        const id = setTimeout(() => {
          if (!isPlayingRef.current) return;
          setPlaySlot(i);
        }, Math.max(0, Math.round(i * slotDur)));
        playTimersRef.current.push(id);
      }
    },
    [clearPlayTimers]
  );

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

  // --- Project name modal ---
  const openProjectModal = () => {
    setProjectDraft(projectName);
    setProjectModalOpen(true);
  };

  const closeProjectModal = () => {
    Keyboard.dismiss();
    setProjectModalOpen(false);
  };

  const commitProjectName = () => {
    setProjectName(projectDraft);
    closeProjectModal();
  };
  // --- end project name modal ---

  const meterLabel = useMemo(() => `${meter.n}/${meter.d}`, [meter]);

  const shouldShowClave = useMemo(() => {
    // Clave visible en compases irregulares o si Pro mode está activado
    return proMode || meter.n !== 4 || meter.d !== 4;
  }, [meter, proMode]);

  const { start: startClock, stop: stopClock, lastTick, accentLevels, audioState, audioDetails } = useMetronomeAudio({
    bpm,

    // En modo bars, estos 2 quedan como "compat" (y para Clave UI).
    meter,
    groups,

    // ✅ per-beat subdiv + per-beat mask (solo d=4)
    pulseSubdivs: isSubdivEnabled ? pulseSubdivs : undefined,
    pulseSubdivMasks: isSubdivEnabled ? pulseSubdivMasks : undefined,

    // ✅ multi-bar loop
    bars,
    // 🔥 regla de producto: cuando le das play, SIEMPRE arranca desde Bar 1
    startBarIndex: 0,
    loop: true,

    // ✅ Beat guide
    beatGuide,

    onBarChange: (nextBarIndex) => {
      // Vía “evento de bar” (cuando llega)
      followPlaybackBar(nextBarIndex);
    },

    onTick: (info) => {
      setTickCount((prev) => prev + 1);
      setTickInfo(info);

      // ✅ Fallback robusto: si el motor nos trae barIndex por tick, seguimos eso
      const tickBarIndex = Number((info as any)?.barIndex);
      if (Number.isFinite(tickBarIndex) && tickBarIndex >= 0 && tickBarIndex !== lastFollowedBarRef.current) {
        followPlaybackBar(tickBarIndex);
      }

      // 🔥 Iluminación por beat/subslot (UI-side)
      // barTick debería ser el beat dentro del compás (0..n-1)
      const beatIndex = Number((info as any)?.barTick ?? 0);
      if (Number.isFinite(beatIndex)) schedulePlayheadForBeat(beatIndex);
    },
  });

  const accentGlyphs = useMemo(() => accentPatternGlyphs(accentLevels), [accentLevels]);

  const handleStartStop = async () => {
    if (isPlaying) {
      stopClock();
      setTickCount(0);
      setTickInfo(null);

      clearPlayTimers();
      setPlayBeat(null);
      setPlaySlot(null);
      setPlaySubdiv(1);

      // 🔥 STOP = volvemos a Bar 1 visualmente también
      lastFollowedBarRef.current = 0;
      selectBar(0);
      setSelectedBeat(0);

      setPlaying(false);
    } else {
      // 🔥 START = arrancamos limpio desde Bar 1
      setTickCount(0);
      setTickInfo(null);

      // Marcamos bar 0 como “seguido” desde ya
      lastFollowedBarRef.current = 0;

      clearPlayTimers();
      setPlayBeat(0);
      setPlaySlot(0);
      setPlaySubdiv(1);

      selectBar(0);
      setSelectedBeat(0);

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
    const len = Math.max(1, Math.min(16, selectedSubdiv));

    if (!raw || raw.length !== len) {
      return Array.from({ length: len }).map(() => true);
    }
    return raw;
  }, [isSubdivEnabled, pulseSubdivMasks, safeSelectedBeat, selectedSubdiv]);

  // helper: máscara segura por beat para render interno de tiles
  const getMaskForBeat = useCallback(
    (beatIndex: number, subdiv: number) => {
      const len = Math.max(1, Math.min(16, subdiv));
      const raw = pulseSubdivMasks?.[beatIndex];
      if (!raw || raw.length !== len) return Array.from({ length: len }).map(() => true);
      return raw;
    },
    [pulseSubdivMasks]
  );

  const sortedProjects = useMemo(() => {
    const list = Array.isArray(projects) ? projects.slice() : [];
    list.sort((a: any, b: any) => (b?.updatedAt ?? 0) - (a?.updatedAt ?? 0));
    return list;
  }, [projects]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>NotMetronome</Text>

        <View style={styles.headerRight}>
          <Pressable
            style={[styles.projectPill, isPlaying && styles.pillDisabled]}
            disabled={isPlaying}
            onPress={() => setProjectMenuOpen((v) => !v)}
          >
            <View style={styles.projectPillTopRow}>
              <Text style={styles.projectPillLabel}>Proyecto</Text>
              <Text style={styles.projectPillArrow}>▾</Text>
            </View>
            <Text style={styles.projectPillValue} numberOfLines={1}>
              {projectName}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.newProjectBtn, isPlaying && styles.pillDisabled]}
            disabled={isPlaying}
            onPress={() => {
              setProjectMenuOpen(false);
              newProject();
              setSelectedBeat(0);
              selectBar(0);
            }}
          >
            <Text style={styles.newProjectBtnText}>New</Text>
          </Pressable>
        </View>
      </View>

      {isProjectMenuOpen && (
        <View style={styles.projectMenuCard}>
          <Text style={styles.projectMenuTitle}>Proyectos</Text>

          <View style={{ marginTop: 8, gap: 8 }}>
            {sortedProjects.map((p: any) => {
              const active = p.id === activeProjectId;
              return (
                <Pressable
                  key={p.id}
                  style={[styles.projectMenuItem, active && styles.projectMenuItemActive]}
                  disabled={isPlaying || active}
                  onPress={() => {
                    setProjectMenuOpen(false);
                    openProject(p.id);
                    setSelectedBeat(0);
                  }}
                >
                  <Text style={[styles.projectMenuItemText, active && styles.projectMenuItemTextActive]} numberOfLines={1}>
                    {p.name}
                  </Text>
                  {active ? <Text style={styles.projectMenuBadge}>ACTUAL</Text> : null}
                </Pressable>
              );
            })}
          </View>

          <View style={styles.projectMenuRow}>
            <Pressable
              style={[styles.projectMenuAction, isPlaying && styles.pillDisabled]}
              disabled={isPlaying}
              onPress={() => {
                setProjectMenuOpen(false);
                openProjectModal();
              }}
            >
              <Text style={styles.projectMenuActionText}>Renombrar…</Text>
            </Pressable>

            <Pressable
              style={[styles.projectMenuAction, isPlaying && styles.pillDisabled]}
              disabled={isPlaying}
              onPress={() => setProjectMenuOpen(false)}
            >
              <Text style={styles.projectMenuActionText}>Cerrar</Text>
            </Pressable>
          </View>

          {isPlaying ? <Text style={styles.helperText}>Pará el playback para cambiar de proyecto.</Text> : null}
        </View>
      )}

      <Text style={styles.smallMuted}>
        Audio: {audioState}
        {audioDetails ? ` — ${audioDetails}` : ""}
      </Text>

      {/* Project name modal */}
      <Modal transparent visible={isProjectModalOpen} animationType="fade" onRequestClose={closeProjectModal}>
        <Pressable style={styles.modalBackdrop} onPress={closeProjectModal}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Nombre del proyecto</Text>
            <Text style={styles.modalHint}>Poné un nombre corto. Si lo dejás vacío, vuelve a “Proyecto sin nombre”.</Text>

            <TextInput
              value={projectDraft}
              onChangeText={setProjectDraft}
              autoFocus
              placeholder="Ej: Set Jazz 11/8"
              style={styles.modalInput}
              returnKeyType="done"
              onSubmitEditing={commitProjectName}
            />

            <View style={styles.modalRow}>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => {
                  resetProjectName();
                  closeProjectModal();
                }}
              >
                <Text style={styles.modalBtnGhostText}>Reset</Text>
              </Pressable>

              <Pressable style={[styles.modalBtn, styles.modalBtnGhost]} onPress={closeProjectModal}>
                <Text style={styles.modalBtnGhostText}>Cancelar</Text>
              </Pressable>

              <Pressable style={[styles.modalBtn, styles.modalBtnPrimary]} onPress={commitProjectName}>
                <Text style={styles.modalBtnPrimaryText}>OK</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

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

          {/* Orden: seleccionado ; Duplicate ; +Bar ; Delete */}
          <Pressable
            style={[styles.pill, styles.pillGhost]}
            onPress={() => {
              if (typeof duplicateBar === "function") {
                duplicateBar(safeSelectedBar);
              } else {
                // fallback si duplicateBar no existe en store: duplicamos con "add + copia" (mejor tenerlo en store)
                addBar();
              }
              setSelectedBeat(0);
            }}
          >
            <Text style={styles.pillText}>Duplicate</Text>
          </Pressable>

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
              1) Elegís el beat. 2) Elegís subdiv (♩/♪/3/♬/5/6/7/8). 3) Podés prender/apagar golpes tocando casillas adentro del beat.
            </Text>

            {/* Beat selector (con casillas internas + playhead) */}
            <View style={styles.beatRow}>
              {Array.from({ length: beatCount }).map((_, i) => {
                const v = Math.max(1, Math.min(16, pulseSubdivs?.[i] ?? 1));
                const mask = getMaskForBeat(i, v);

                const isSel = i === safeSelectedBeat;
                const isPlayingBeat = isPlaying && playBeat === i;

                return (
                  <Pressable
                    key={i}
                    style={[styles.beatTile, v > 1 && styles.beatTileActive, isSel && styles.beatTileSelected, isPlayingBeat && styles.beatTilePlaying]}
                    onPress={() => setSelectedBeat(i)}
                  >
                    <View style={styles.beatTopRow}>
                      <Text style={v > 1 ? styles.beatTextActive : styles.beatText}>Beat {i + 1}</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={styles.beatFig}>{subdivFigure(v)}</Text>
                        <Text style={styles.beatFigSmall}>{v}</Text>
                      </View>
                    </View>

                    <View style={styles.slotRow}>
                      {Array.from({ length: v }).map((__, idx) => {
                        const on = mask[idx] ?? true;
                        const isSlotPlaying = isPlaying && playBeat === i && playSlot === idx && playSubdiv === v;

                        return (
                          <Pressable
                            key={idx}
                            onPress={() => togglePulseSubdivMaskSlot(i, idx)}
                            style={[styles.slot, on ? styles.slotOn : styles.slotOff, isSlotPlaying && styles.slotPlayhead]}
                          />
                        );
                      })}
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {/* Subdiv buttons for selected beat (con “figuras”) */}
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
                      <Text style={[styles.subdivBtnText, isActive && styles.subdivBtnTextActive]}>{subdivFigure(value)}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.helperText}>Guía: ♩=1 · ♪=2 · 3=tresillo · ♬=4 · 5/6/7/8=tuplet.</Text>
            </View>

            {/* Per-beat mask editor (SE MANTIENE) */}
            <View style={{ marginTop: 12 }}>
              <Text style={styles.helperText}>
                Máscara del Beat {safeSelectedBeat + 1} (subdiv {selectedSubdiv}): encendé/apagá golpes (modo grande).
              </Text>

              {selectedSubdiv === 1 && (
                <Text style={styles.helperText}>Tip: con subdiv=1 hay 1 único golpe. Si lo apagás, ese beat queda en silencio.</Text>
              )}

              <View style={[styles.denomRow, { marginTop: 8 }]}>
                {Array.from({ length: Math.max(1, Math.min(16, selectedSubdiv)) }).map((_, idx) => {
                  const on = selectedMask[idx] ?? true;
                  const isSlotPlaying = isPlaying && playBeat === safeSelectedBeat && playSlot === idx && playSubdiv === selectedSubdiv;

                  return (
                    <Pressable
                      key={idx}
                      style={[styles.denomOption, on && styles.denomOptionActive, isSlotPlaying && styles.denomOptionPlayhead]}
                      onPress={() => togglePulseSubdivMaskSlot(safeSelectedBeat, idx)}
                    >
                      <Text style={on ? styles.denomTextActive : styles.denomText}>{idx + 1}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {selectedSubdiv > 1 && <Text style={styles.helperText}>Ejemplo: en 5, dejá 1.0.1.0.1 para “tresillo raro” sin cambiar el subdiv.</Text>}
            </View>
          </>
        )}
      </View>

      {/* Beat guide + Pro mode + stats */}
      <View style={styles.switchRow}>
        <Text style={styles.sectionLabel}>Beat guía</Text>
        <Switch value={beatGuide} onValueChange={setBeatGuide} />
      </View>
      <Text style={styles.helperText}>Si está activo, el “golpe base” del beat suena siempre aunque hayas apagado el primer slot de la máscara.</Text>

      <View style={styles.switchRow}>
        <Text style={styles.sectionLabel}>Pro mode</Text>
        <Switch value={proMode} onValueChange={setProMode} />
      </View>

      <StatRow label="Groups" value={groups && groups.length > 0 ? groups.join(" + ") : "None"} />
      <StatRow label="Accent pattern" value={accentGlyphs} />

      {shouldShowClave ? (
        <>
          <ClaveButton meterLabel={meterLabel} onPress={() => setClaveOpen(true)} accentPreview={accentGlyphs} footer={<Text>Editar agrupaciones</Text>} />
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
          playhead={playBeat === null ? "—" : `beat ${playBeat + 1} slot ${((playSlot ?? 0) + 1)} / ${playSubdiv}`}
        </Text>
      </View>
    </ScrollView>
  );
}

export default HomeScreen;

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: "#fff", paddingBottom: 32 },

  headerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 10,
  },

  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  title: { fontSize: 28, fontWeight: "700", marginBottom: 8, color: "#111" },

  projectPill: {
    maxWidth: 210,
    backgroundColor: "#111",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  projectPillTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  projectPillLabel: { fontSize: 10, color: "rgba(255,255,255,0.75)", fontWeight: "800" },
  projectPillArrow: { fontSize: 12, color: "rgba(255,255,255,0.75)", fontWeight: "900" },
  projectPillValue: { fontSize: 12, color: "#fff", fontWeight: "900" },

  newProjectBtn: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
  },
  newProjectBtnText: { color: "#fff", fontWeight: "900" },

  projectMenuCard: {
    marginTop: 10,
    backgroundColor: "#f3f3f3",
    borderRadius: 12,
    padding: 12,
  },
  projectMenuTitle: { fontSize: 12, fontWeight: "900", color: "#111" },
  projectMenuItem: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  projectMenuItemActive: { borderColor: "#111" },
  projectMenuItemText: { color: "#111", fontWeight: "800", flex: 1, paddingRight: 10 },
  projectMenuItemTextActive: { color: "#111", fontWeight: "900" },
  projectMenuBadge: { fontSize: 10, fontWeight: "900", color: "#111" },

  projectMenuRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
  },
  projectMenuAction: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
    alignItems: "center",
    justifyContent: "center",
  },
  projectMenuActionText: { color: "#111", fontWeight: "900" },

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

  pillGhost: { backgroundColor: "#fff", borderColor: "#ddd" },

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
    width: 140,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  beatTileActive: { borderColor: "#1e88e5" },
  beatTileSelected: { borderColor: "#111", borderWidth: 2 },
  beatTilePlaying: { backgroundColor: "#f0f0f0", borderColor: "#111" },

  beatTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  beatText: { fontSize: 12, color: "#666" },
  beatTextActive: { fontSize: 12, color: "#1e88e5" },
  beatFig: { fontSize: 16, fontWeight: "900", color: "#111" },
  beatFigSmall: { fontSize: 12, fontWeight: "900", color: "#666" },

  slotRow: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  slot: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  slotOn: { backgroundColor: "#111", borderColor: "#111" },
  slotOff: { backgroundColor: "#fff", borderColor: "#ddd" },
  slotPlayhead: { borderColor: "#1e88e5", borderWidth: 2 },

  subdivRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  subdivBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
    alignItems: "center",
    justifyContent: "center",
  },
  subdivBtnActive: { backgroundColor: "#1e88e5", borderColor: "#1e88e5" },
  subdivBtnText: { color: "#111", fontWeight: "900", fontSize: 16 },
  subdivBtnTextActive: { color: "#fff", fontWeight: "900", fontSize: 16 },

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
  denomOptionPlayhead: { borderColor: "#1e88e5", borderWidth: 2 },
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
