/**
 * A small ring buffer of recent console output, so an error report can carry
 * the breadcrumbs that led to it rather than just the final message.
 *
 * The app deliberately logs raw SDK errors to the console while showing the
 * user friendly tea copy (see `[vault-action]`, `[privy-wallet]`), which makes
 * the console the only place the real cause exists. Capturing it here is what
 * turns a report into something diagnosable.
 */

export type CapturedLog = {
  /** ISO timestamp. */
  at: string;
  level: "error" | "warn";
  text: string;
};

const MAX_ENTRIES = 40;
/** Hard cap per entry so one giant object can't dominate the payload. */
const MAX_TEXT_LENGTH = 2_000;

const buffer: CapturedLog[] = [];
let installed = false;

/**
 * JSON.stringify throws on bigint and cycles, and both are everywhere in SDK
 * error objects — so serialize defensively and never let logging throw.
 */
function formatArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (typeof arg === "bigint") return `${arg}n`;
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}`;
  }
  if (arg === null || arg === undefined) return String(arg);
  if (typeof arg === "object") {
    const seen = new WeakSet<object>();
    try {
      return JSON.stringify(
        arg,
        (_key, value) => {
          if (typeof value === "bigint") return `${value}n`;
          if (value instanceof Error) return `${value.name}: ${value.message}`;
          if (typeof value === "object" && value !== null) {
            if (seen.has(value)) return "[circular]";
            seen.add(value);
          }
          return value;
        },
        2,
      );
    } catch {
      return "[unserializable]";
    }
  }
  return String(arg);
}

function push(level: CapturedLog["level"], args: unknown[]) {
  const text = args.map(formatArg).join(" ").slice(0, MAX_TEXT_LENGTH);
  buffer.push({ at: new Date().toISOString(), level, text });
  if (buffer.length > MAX_ENTRIES) buffer.shift();
}

/**
 * Wrap console.error/warn to tee into the buffer. Idempotent, so React strict
 * mode and hot reloads can't stack wrappers. Original behaviour is preserved:
 * the console still shows everything it always did.
 */
export function installLogCapture() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const originalError = console.error;
  const originalWarn = console.warn;

  console.error = (...args: unknown[]) => {
    try {
      push("error", args);
    } catch {
      // Capture must never break logging.
    }
    originalError.apply(console, args as []);
  };
  console.warn = (...args: unknown[]) => {
    try {
      push("warn", args);
    } catch {
      /* as above */
    }
    originalWarn.apply(console, args as []);
  };

  // Unhandled failures are exactly the ones with no friendly copy attached.
  window.addEventListener("unhandledrejection", (event) => {
    push("error", ["[unhandledrejection]", event.reason]);
  });
  window.addEventListener("error", (event) => {
    push("error", ["[window.error]", event.message]);
  });
}

/** Snapshot of the buffer, oldest first. */
export function recentLogs(): CapturedLog[] {
  return [...buffer];
}
