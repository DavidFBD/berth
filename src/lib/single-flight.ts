/**
 * One signing run at a time, decided synchronously. A busy flag in React
 * state lands a render after the tap, so two taps in the same frame both
 * read "not busy" and both go; this flag is set before the first await, so
 * the second tap finds the berth taken and does nothing at all (no second
 * terms read, no second fresh quote, no second signature request).
 *
 * The flag is released when the run settles, whether it resolved or threw.
 */
export type SingleFlight = {
  /** Runs `task` unless one is already running; then resolves `undefined` without calling it. */
  run: <R>(task: () => Promise<R>) => Promise<R | undefined>;
  isRunning: () => boolean;
};

export function createSingleFlight(): SingleFlight {
  let running = false;
  return {
    run: async (task) => {
      if (running) return undefined;
      running = true;
      try {
        return await task();
      } finally {
        running = false;
      }
    },
    isRunning: () => running,
  };
}
