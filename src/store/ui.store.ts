import { create } from "zustand";

type UiState = {
  isPlaying: boolean;
  setPlaying: (playing: boolean) => void;
  proMode: boolean;
  setProMode: (value: boolean) => void;
};

export const useUiStore = create<UiState>((set) => ({
  isPlaying: false,
  setPlaying: (playing) => set({ isPlaying: playing }),
  proMode: false,
  setProMode: (proMode) => set({ proMode }),
}));
