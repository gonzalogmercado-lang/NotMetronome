import { MutableRefObject } from "react";

export type StateCreator<T> = (
  setState: SetState<T>,
  getState: GetState<T>,
  api: StoreApi<T>
) => T;

export type SetState<T> = (
  partial:
    | T
    | Partial<T>
    | ((state: T) => T | Partial<T> | void),
  replace?: boolean
) => void;

export type GetState<T> = () => T;

export type StoreApi<T> = {
  getState: GetState<T>;
  setState: SetState<T>;
  subscribe: (listener: () => void) => () => void;
};

export interface UseBoundStore<TState> {
  (): TState;
  <StateSlice>(selector: (state: TState) => StateSlice): StateSlice;
  getState: GetState<TState>;
  setState: SetState<TState>;
  subscribe: (listener: () => void) => () => void;
}

export function create<TState>(initializer: StateCreator<TState>): UseBoundStore<TState>;
export default function create<TState>(initializer: StateCreator<TState>): UseBoundStore<TState>;
