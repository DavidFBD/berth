"use client";

import { useSyncExternalStore } from "react";

// Never fires — mount state can't change back, so there's nothing to subscribe to.
const emptySubscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Returns `false` on the server and during the hydration render, `true`
 * after the client mounts. Use to gate browser-only work (e.g. wallet
 * extension detection reading `window.*`) so SSR and hydration stay in sync.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    getClientSnapshot,
    getServerSnapshot,
  );
}
