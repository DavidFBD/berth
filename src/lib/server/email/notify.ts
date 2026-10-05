import { after } from "next/server";
import type { NoticeInput } from "./send";

/**
 * The one door for scheduling a notice from server code. It loads the
 * sender (./send, a .tsx with React Email templates) only when a notice is
 * actually sent, so a node script that reaches this module through its
 * imports (orders:recover, the backfills) never has to load JSX, which
 * Node's type stripping cannot.
 *
 * Same contract as before: call it once the event's own write has
 * succeeded; it never throws and never waits. Inside a request the work
 * is scheduled with `after()` and the import happens there; outside one (a
 * script, a test) it runs now, unawaited. With sending off it does nothing.
 */
export function sendNotice(input: NoticeInput): void {
  const run = () =>
    import("./send")
      .then((send) => send.deliverNotice(input))
      .catch((error: unknown) => {
        console.warn(`[email] ${input.notice.type} not loaded for ${input.userId.slice(0, 8)}: ${error instanceof Error ? error.name : "error"}`);
      });
  try {
    after(run);
  } catch {
    void run();
  }
}

export type { NoticeInput };
