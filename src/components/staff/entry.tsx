"use client";

import { useSyncExternalStore } from "react";
import { IdentificationBadge } from "@phosphor-icons/react";
import { useLoginWithEmail, usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCopy } from "@/components/settings-provider";
import { useStaffEntry } from "@/hooks/use-profile";
import { openStaffSession, phaseOnPageShow, STAFF_HOME, STAFF_SIGN_IN_TIMEOUT_MS, staffEntryView, withTimeout } from "@/lib/staff/entry";

/**
 * The account drawer's quiet Staff entry (docs/adr/0008-staff-area.md,
 * lib/staff/entry). Drawn only when the server says this account is on a
 * staff list (POST /api/account/staff); everyone else gets nothing, not
 * even a placeholder.
 *
 * In an email session it is a plain link to /staff, where the area's own
 * door mints the staff session from the Privy token. In a wallet session
 * it says the area opens only after an email code to the account's own
 * email and offers that sign in, headless (Privy's email login with
 * signups off, the same calls the add-email flow makes): with the code
 * entered, the Privy token is traded at POST /api/staff/session exactly as
 * the door does, and the page goes to /staff. A wallet session never
 * mints anything: the server refuses any session whose email code it
 * cannot find. If the trade fails, the Privy session this flow started
 * is ended, so the browser is the wallet sign in it was.
 *
 * The flow's state lives in this module, not the component: signing in
 * may move the drawer from the wallet account's to the email account's
 * for a moment, and the words must survive that.
 */

type Phase = "closed" | "open" | "sending" | "code" | "verifying" | "opening" | "failed";

let snapshot: { phase: Phase; email: string } = { phase: "closed", email: "" };
const listeners = new Set<() => void>();

function set(next: Partial<typeof snapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const read = () => snapshot;
// A page restored from the back and forward cache (the way back from
// /staff) brings this module's state with it: it starts closed, never
// still holding the session guard for a sign in that page already left.
if (typeof window !== "undefined") {
  window.addEventListener("pageshow", (event) => {
    if (phaseOnPageShow(event.persisted, snapshot.phase) === "closed" && snapshot.phase !== "closed") set({ phase: "closed", email: "" });
  });
}

const SERVER = { phase: "closed" as Phase, email: "" };
const readServer = () => SERVER;

/**
 * True while this flow holds a Privy session it started: the session guard
 * (welcome-screen) leaves it alone and the header stays on the wallet
 * account until the page goes to /staff or the session is ended.
 */
export function useStaffSignInRunning(): boolean {
  const { phase } = useSyncExternalStore(subscribe, read, readServer);
  return phase === "verifying" || phase === "opening";
}

export function StaffEntry({ session }: { session: "email" | "wallet" }) {
  const staff = useStaffEntry();
  const view = staffEntryView(staff.data, session);
  if (view === "hidden") return null;
  if (view === "link") return <StaffLink />;
  return <StaffEmailFirst />;
}

const QUIET = "flex min-h-11 w-full items-center justify-start gap-3 rounded-lg px-3 text-sm text-muted-foreground transition-[background-color] duration-150 ease-lift hover:bg-muted/60 active:bg-muted";

function StaffLink() {
  const words = useCopy().staff.entry;
  // A full load: the area is drawn by the server, past its own door.
  return (
    <a href={STAFF_HOME} className={QUIET}>
      <IdentificationBadge weight="duotone" className="size-5" />
      {words.label}
    </a>
  );
}

function StaffEmailFirst() {
  const copy = useCopy();
  const words = copy.staff.entry;
  const state = useSyncExternalStore(subscribe, read, readServer);
  const { authenticated, logout, getAccessToken } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();

  if (state.phase === "closed") {
    return (
      <button type="button" className={QUIET} onClick={() => set({ phase: "open" })}>
        <IdentificationBadge weight="duotone" className="size-5" />
        {words.label}
      </button>
    );
  }

  const sendTo = async (email: string) => {
    set({ phase: "sending", email });
    try {
      // A Privy session left over from an earlier flow is not this sign in.
      if (authenticated) await logout();
      await sendCode({ email, disableSignup: true });
      set({ phase: "code" });
    } catch {
      set({ phase: "failed" });
    }
  };

  const enter = async (code: string) => {
    set({ phase: "verifying" });
    let opened = false;
    try {
      // Login, token and trade inside STAFF_SIGN_IN_TIMEOUT_MS: a hang reads as a no.
      opened = await openStaffSession({
        login: () => loginWithCode({ code }),
        getToken: () => getAccessToken(),
        post: (token, signal) =>
          fetch("/api/staff/session", { method: "POST", headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal }),
      });
      if (opened) {
        set({ phase: "opening" });
        // Should the page not leave, the hold still lets go.
        window.setTimeout(() => {
          if (snapshot.phase === "opening") set({ phase: "closed", email: "" });
        }, STAFF_SIGN_IN_TIMEOUT_MS);
        window.location.assign(STAFF_HOME);
      } else {
        // No staff session: end the one this flow started, back to the wallet sign in.
        await withTimeout(logout(), STAFF_SIGN_IN_TIMEOUT_MS).catch(() => undefined);
      }
    } finally {
      // Whatever happened, the hold on the session guard ends here unless the page is leaving for /staff.
      if (!opened) set({ phase: "failed" });
    }
  };

  const close = () => set({ phase: "closed", email: "" });
  const busy = state.phase === "sending" || state.phase === "verifying" || state.phase === "opening";

  return (
    <div role="region" aria-label={words.label} className="flex flex-col gap-2 rounded-lg bg-muted/60 p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <IdentificationBadge weight="duotone" className="size-5 shrink-0 text-muted-foreground" />
        {words.walletTitle}
      </p>
      <p className="text-xs text-muted-foreground">{words.walletBody}</p>
      {state.phase === "code" || state.phase === "verifying" || state.phase === "opening" ? (
        <form
          key="code"
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const code = new FormData(event.currentTarget).get("code");
            if (typeof code === "string" && code.trim()) void enter(code.trim());
          }}
        >
          <p data-ph-mask className="text-xs text-muted-foreground">
            {copy.addEmailCodeSent(state.email)}
          </p>
          <Input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            onChange={(event) => {
              event.currentTarget.value = event.currentTarget.value.replace(/\D/g, "").slice(0, 6);
            }}
            placeholder={copy.addEmailCodePlaceholder}
            aria-label={copy.addEmailCodePlaceholder}
            disabled={busy}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? words.working : copy.addEmailVerify}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void sendTo(state.email)}>
              {copy.addEmailResend}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={close}>
              {words.notNow}
            </Button>
          </div>
        </form>
      ) : (
        <form
          key="email"
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const email = new FormData(event.currentTarget).get("email");
            if (typeof email === "string" && email.trim()) void sendTo(email.trim());
          }}
        >
          <Input
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue={state.email}
            placeholder={copy.addEmailPlaceholder}
            aria-label={copy.addEmailPlaceholder}
            disabled={busy}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? words.working : words.walletAction}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={close}>
              {words.notNow}
            </Button>
          </div>
        </form>
      )}
      {state.phase === "failed" && (
        <p role="alert" className="text-xs text-foreground">
          {words.failed}
        </p>
      )}
    </div>
  );
}
