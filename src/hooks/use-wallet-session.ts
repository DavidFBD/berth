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

const STORAGE_KEY = "lsteatime.wallet-session";
const SIWE_STATEMENT =
  "Prove this teapot is yours to LSTeaTime. Signing is free and moves nothing.";

type StoredSession = { token: string; address: string; expiresAt: number };

function readStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

/** A still-fresh session token for this address, if one is pocketed. */
export function storedWalletSession(address: string): string | null {
  const stored = readStored();
  if (!stored) return null;
  const fresh =
    stored.address === address.toLowerCase() &&
    stored.expiresAt > Date.now() + 60_000;
  return fresh ? stored.token : null;
}

export function clearWalletSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

        const stored: StoredSession = {
          token: sessionToken,
          address: walletAddress,
          expiresAt: Date.now() + SESSION_TTL_MS,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        return sessionToken;
      } catch {
        // Declined signature or a network stumble: quietly no session.
        return null;
      }
    },
    [sign],
  );
}
