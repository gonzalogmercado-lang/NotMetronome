import { useDebugValue, useSyncExternalStore } from "react";

const identity = (value) => value;

const createStoreImpl = (initializer) => {
  let state;
  const listeners = new Set();

  const getState = () => state;

  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const setState = (partial, replace = false) => {
    const nextState =
      typeof partial === "function" ? partial(state) : partial;
    if (nextState === state) return;
    const newState = replace
      ? nextState
      : { ...state, ...(nextState ?? {}) };
    if (newState === state) return;
    state = newState;
    notify();
  };

  const api = { getState, setState, subscribe }; // minimal subset

  state = initializer(setState, getState, api);

  const useBoundStore = (selector = identity, equalityFn = Object.is) => {
    const selectedState = useSyncExternalStore(
      subscribe,
      () => selector(getState()),
      () => selector(getState())
    );
    useDebugValue(selectedState);
    return selectedState;
  };

  Object.assign(useBoundStore, api);

  return useBoundStore;
};

const create = (initializer) => {
  if (typeof initializer !== "function") {
    return createStoreImpl;
  }
  return createStoreImpl(initializer);
};

export default create;
export { create };
