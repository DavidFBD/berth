"use client";

import { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccountHeaders } from "@/hooks/use-profile";
import { forgetStoredChoice } from "@/hooks/use-stored-choice";
import { FRIEND_CHOICE_KEY } from "@/lib/friend-week";

/**
 * Whenever an email session ends, wherever it was ended from (the account
 * drawer, a merge, a link flow, "Sign in again"), the server is asked to
 * clear what it set for that session: today the staff pages' pass
 * (app/api/session/sign-out).
 *
 * And whenever any account, email or wallet, signs out or gives way to
 * another, the choices kept in this browser for that account are
 * forgotten: today the friend picked on the account card, by username.
 */
export function SignOutSweep() {
  const { ready, authenticated } = usePrivy();
  const was = useRef(false);
  const { key } = useAccountHeaders({ prompt: false });
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastKey.current !== null && key !== lastKey.current) forgetStoredChoice(FRIEND_CHOICE_KEY);
    lastKey.current = key;
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    if (was.current && !authenticated) {
      void fetch("/api/session/sign-out", { method: "POST", keepalive: true }).catch(() => undefined);
    }
    was.current = authenticated;
  }, [ready, authenticated]);
  return null;
}
