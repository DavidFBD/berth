"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A small per-viewer choice kept in localStorage (a chosen benchmark, a
 * chosen range). The server snapshot is the fallback, so SSR renders the
 * default and the stored choice arrives with hydration. Storage that throws
 * (a private window, blocked site data) falls back to an in-memory copy for
 * the session, so the control still works.
 */
const listeners = new Map<string, Set<() => void>>();
const memory = new Map<string, string>();

function subscribe(key: string, listener: () => void): () => void {
  const set = listeners.get(key) ?? new Set();
  set.add(listener);
  listeners.set(key, set);
  return () => {
    set.delete(listener);
  };
}

function read(key: string): string | null {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored !== null) return stored;
  } catch {
    // Fall through to the in-memory copy.
  }
  return memory.get(key) ?? null;
}

/**
 * Forget a stored choice everywhere: storage, the in-memory copy, and every
 * control reading it (a per-account choice at sign-out).
 */
export function forgetStoredChoice(key: string): void {
  memory.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage blocked: the in-memory copy was all there was.
  }
  for (const listener of listeners.get(key) ?? []) listener();
}

/**
 * `key` may be null while it is not yet known (a per-account key before the
 * account is): the value is then null and setting it does nothing.
 */
export function useStoredChoice(key: string | null): [string | null, (next: string) => void] {
  const value = useSyncExternalStore(
    useCallback((listener: () => void) => (key ? subscribe(key, listener) : () => {}), [key]),
    () => (key ? read(key) : null),
    () => null,
  );
  const set = useCallback(
    (next: string) => {
      if (!key) return;
      memory.set(key, next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Storage blocked: the in-memory copy carries this session.
      }
      for (const listener of listeners.get(key) ?? []) listener();
    },
    [key],
  );
  return [value, set];
}
