import { create } from "zustand";

type UiState = {
  isPlaying: boolean;
  setPlaying: (value: boolean) => void;

  proMode: boolean;
  setProMode: (value: boolean) => void;

  // Beat guía (siempre “negra”)
  beatGuide: boolean;
  setBeatGuide: (value: boolean) => void;
  toggleBeatGuide: () => void;
};

export const useUiStore = create<UiState>((set) => ({
  isPlaying: false,
  setPlaying: (value) => set({ isPlaying: value }),

  proMode: false,
  setProMode: (value) => set({ proMode: value }),

  beatGuide: false,
  setBeatGuide: (value) => set({ beatGuide: value }),
  toggleBeatGuide: () => set((s) => ({ beatGuide: !s.beatGuide })),
}));

export default useUiStore;
