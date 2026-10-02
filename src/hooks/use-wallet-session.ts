"use client";

import { useCallback } from "react";
import { getAddress } from "viem";
import { createSiweMessage } from "viem/siwe";
import { useXSignMessage } from "@sodax/wallet-sdk-react";

/**
 * The client half of wallet-guest SIWE. One signature (free, no gas) mints a
 * week-long session token; the rewards routes refuse wallet callers without
 * one. The token lives in localStorage keyed with its address so switching
 * wallets naturally re-prompts.
 *
 * Kept OUT of the theme voices on purpose: the statement renders inside
 * wallet UIs next to scary hex, so it stays plain and reassuring.
 */

const LEGACY_KEY = "lsteatime.wallet-session";
const STORAGE_KEY = "berth.wallet-sessions";
const KEEP_SEPARATE_KEY = "berth.keep-separate";
/**
 * Which wallet signed the pocketed session in (lib/wallet-restore). Versioned
 * and new with the restore: a browser that signed in before it has no
 * record, so its old session never opens the account on load.
 */
const WALLET_RECORD_KEY = "berth.wallet-restore.v1";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SIWE_STATEMENT =
  "Prove this wallet is yours to Berth. Signing is free and moves nothing.";

type StoredSession = { token: string; address: string; expiresAt: number; storedAt?: number };

/**
 * One pocketed session per address (phase 2: an account may hold several
 * EVM wallets, and switching between them in the extension must not forget
 * the others). The old single-slot key is read once and folded in.
 */
function readAll(): Record<string, StoredSession> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, StoredSession>) : {};
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const old = JSON.parse(legacy) as StoredSession;
      if (old?.address && !all[old.address]) all[old.address] = { ...old, storedAt: 0 };
    }
    return all;
  } catch {
    return {};
  }
}

const listeners = new Set<() => void>();
let version = 0;
function changed() {
  version += 1;
  for (const listener of listeners) listener();
}

/**
 * Sign out, on the server and here: every pocketed session is sent to be
 * ended (lib/server/wallet-session-revocations), then forgotten with the
 * wallet record. The local half never waits on the network: a sign out
 * that cannot reach the server still forgets, and the token expires on its
 * own within the week.
 */
export function revokeWalletSessions(): void {
  const tokens = Object.values(readAll())
    .map((stored) => stored.token)
    .filter((token): token is string => typeof token === "string")
    .slice(0, 20);
  clearWalletSession();
  if (tokens.length === 0) return;
  void fetch("/api/siwe/revoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tokens }),
    // Survives the page going away right after the tap.
    keepalive: true,
  }).catch(() => undefined);
}

/** Subscribe to pocketed sessions and keep-separate choices (useSyncExternalStore). */
export function subscribeWalletSessions(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === KEEP_SEPARATE_KEY || event.key === WALLET_RECORD_KEY) changed();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Changes whenever a session or a choice is pocketed, for useSyncExternalStore. */
export function walletSessionsVersion(): number {
  return version;
}

const isFresh = (stored: StoredSession | undefined) => !!stored && stored.expiresAt > Date.now() + 60_000;

export type WalletRecord = { address: string; id: string; name: string };

/** The wallet this browser last signed in with (hooks/use-wallet-restore). */
export function walletRecord(): WalletRecord | null {
  try {
    const raw = localStorage.getItem(WALLET_RECORD_KEY);
    const parsed = raw ? (JSON.parse(raw) as WalletRecord) : null;
    return parsed && typeof parsed.address === "string" && typeof parsed.id === "string" && typeof parsed.name === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function rememberWallet(record: WalletRecord | null): void {
  try {
    const current = localStorage.getItem(WALLET_RECORD_KEY);
    const next = record ? JSON.stringify({ ...record, address: record.address.toLowerCase() }) : null;
    if (current === next) return;
    if (next) localStorage.setItem(WALLET_RECORD_KEY, next);
    else localStorage.removeItem(WALLET_RECORD_KEY);
  } catch {
    return;
  }
  changed();
}

function forgetRecordFor(addresses: string[]): void {
  const record = walletRecord();
  if (record && addresses.includes(record.address.toLowerCase())) rememberWallet(null);
}

/** A still-fresh session token for this address, if one is pocketed. */
export function storedWalletSession(address: string): string | null {
  const stored = readAll()[address.toLowerCase()];
  return isFresh(stored) ? stored!.token : null;
}

/**
 * The account this browser last signed in to with a wallet: the freshest
 * pocketed session, whichever address it proves. When the extension switches
 * to an address with no session of its own, the identity stays on this one
 * until the person says whether the new wallet joins it (hooks/use-profile).
 */
export function anchorWalletSession(): { address: string; token: string } | null {
  const fresh = Object.values(readAll()).filter(isFresh);
  fresh.sort((a, b) => (b.storedAt ?? 0) - (a.storedAt ?? 0));
  return fresh[0] ? { address: fresh[0].address, token: fresh[0].token } : null;
}

/** Pocket a session for `address` (the handshake, or a wallet just linked). */
export function storeWalletSession(address: string, token: string): void {
  try {
    const all = readAll();
    const key = address.toLowerCase();
    all[key] = { token, address: key, expiresAt: Date.now() + SESSION_TTL_MS, storedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Storage refused: the session lives only as long as this request.
  }
  changed();
}

/**
 * Drop one pocketed session, by its address or by the token itself: a
 * session the server refused (a merge moved its wallet after it was
 * signed), so the next request signs in afresh instead of repeating it.
 */
export function forgetWalletSession(match: { address?: string; token?: string }): void {
  try {
    const all = readAll();
    let changedAny = false;
    const dropped: string[] = [];
    for (const [key, stored] of Object.entries(all)) {
      if ((match.address && key === match.address.toLowerCase()) || (match.token && stored.token === match.token)) {
        delete all[key];
        dropped.push(key);
        changedAny = true;
      }
    }
    // A refused session's wallet record goes with it: the record is what
    // lets a load restore (lib/wallet-restore).
    forgetRecordFor(dropped);
    if (!changedAny) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    return;
  }
  changed();
}

export function clearWalletSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_KEY);
    localStorage.removeItem(WALLET_RECORD_KEY);
  } catch {
    // Nothing to clear.
  }
  changed();
}

/** Addresses the person chose to keep as accounts of their own ("Not now"). */
export function keptSeparate(address: string): boolean {
  try {
    const list = JSON.parse(localStorage.getItem(KEEP_SEPARATE_KEY) ?? "[]") as string[];
    return list.includes(address.toLowerCase());
  } catch {
    return false;
  }
}

export function keepSeparate(address: string): void {
  try {
    const list = JSON.parse(localStorage.getItem(KEEP_SEPARATE_KEY) ?? "[]") as string[];
    if (!list.includes(address.toLowerCase())) list.push(address.toLowerCase());
    localStorage.setItem(KEEP_SEPARATE_KEY, JSON.stringify(list));
  } catch {
    // Storage refused: the prompt returns next visit.
  }
  changed();
}

/**
 * Returns an ensure function: cached token when fresh, otherwise the full
 * handshake (nonce → signature → verify → pocket). Null when the user
 * declines the signature or anything else goes sideways — callers treat
 * that as "no rewards session", never as an error screen.
 */
export function useEnsureWalletSession() {
  const signMessage = useXSignMessage();
  const { mutateAsync: sign } = signMessage;

  return useCallback(
    async (address: string): Promise<string | null> => {
      const cached = storedWalletSession(address);
      if (cached) return cached;

      try {
        const nonceResponse = await fetch("/api/siwe/nonce", {
          method: "POST",
        });
        if (!nonceResponse.ok) return null;
        const { nonce, nonceToken } = (await nonceResponse.json()) as {
          nonce: string;
          nonceToken: string;
        };

        const message = createSiweMessage({
          address: getAddress(address),
          chainId: 146, // Sonic, where the rewards identity lives
          domain: window.location.host,
          uri: window.location.origin,
          nonce,
          version: "1",
          statement: SIWE_STATEMENT,
        });

        const signature = await sign({ xChainType: "EVM", message });
        if (typeof signature !== "string" || !signature.startsWith("0x")) {
          return null;
        }

        const verifyResponse = await fetch("/api/siwe/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message, signature, nonceToken }),
        });
        if (!verifyResponse.ok) return null;
        const { sessionToken, walletAddress } =
          (await verifyResponse.json()) as {
            sessionToken: string;
            walletAddress: string;
          };

        storeWalletSession(walletAddress, sessionToken);
        return sessionToken;
      } catch {
        // Declined signature or a network stumble: quietly no session.
        return null;
      }
    },
    [sign],
  );
}
