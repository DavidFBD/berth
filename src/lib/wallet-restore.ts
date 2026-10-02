/**
 * Bringing a wallet sign in back after a refresh.
 *
 * A wallet sign in is two things: the extension's own connection (wagmi,
 * through the wallet SDK's store) and Berth's pocketed SIWE session
 * (hooks/use-wallet-session), a server-signed week-long token proving the
 * address. Only the first used to count as "signed in", and it does not
 * survive a refresh reliably: the SDK reconnects before an EIP-6963 wallet
 * has been merged into wagmi's connectors (or before a slow one, like Hana,
 * has announced at all), the attempt finds nothing, and the SDK forgets the
 * connection. The welcome page then showed to someone who had signed in.
 *
 * The rules here decide what a load shows, from the pocketed session and
 * the live connection, so they can be tested without a browser:
 *
 * - `live`: the extension is connected. Everything works, as always.
 * - `restoring`: a fresh session is pocketed, the extension is not back
 *   yet, and Berth is still trying to reconnect it quietly. The splash
 *   shows, never the welcome page.
 * - `session`: the attempts are over and the extension did not come back
 *   (locked, asleep, uninstalled). The person stays signed in on the
 *   session alone: reads work, and the wallet is asked to open only when
 *   something needs its signature.
 * - `none`: no fresh session. The welcome page, as before.
 *
 * Nothing here grants anything: the token is still verified server side on
 * every request (lib/server/wallet-session), and an expired or refused one
 * is not fresh, so it restores nothing.
 *
 * Only a sign in this code saw happen restores (`restorableAnchor`): the
 * session must carry a session id, so signing out can end it on the server
 * (lib/server/wallet-session-revocations), and this browser must have
 * recorded which wallet signed it. A session pocketed before either existed
 * may belong to someone who signed out without it being forgotten, so it
 * keeps working for the account routes but never opens the account on load.
 */

/** How long a load waits for the extension before trusting the session alone. */
export const RESTORE_GRACE_MS = 5000;

export type RestorePhase = "none" | "live" | "restoring" | "session";

/** Only an EVM address owns an account (lib/account), so only one restores. */
export function isEvmAddress(address: string | null | undefined): address is string {
  return typeof address === "string" && /^0x[0-9a-fA-F]{40}$/.test(address);
}

export function restorePhase(input: {
  /** The freshest pocketed session's address (anchorWalletSession), if any. */
  anchor: string | null | undefined;
  /** The EVM address the wallet SDK reports connected right now. */
  liveEvm: string | null | undefined;
  /** Whether the wallet SDK's store has read its persisted connections. */
  hydrated: boolean;
  /**
   * Whether the email session is known (Privy ready, or Privy off): until it
   * is, a restore would stand the wallet in for what may be an email
   * account, so the load waits on the splash.
   */
  identityReady?: boolean;
  /** Whether the quiet reconnect attempts are over (gave up or grace elapsed). */
  settled: boolean;
}): RestorePhase {
  if (input.liveEvm) return "live";
  if (!isEvmAddress(input.anchor)) return "none";
  if (!input.hydrated || !input.settled || input.identityReady === false) return "restoring";
  return "session";
}

/**
 * Whether a wallet session token carries a session id (`jti`). Read from the
 * token's payload without checking its signature: this only decides whether
 * to try a restore; the server checks the token on every request.
 */
export function sessionHasId(token: string | null | undefined): boolean {
  if (typeof token !== "string") return false;
  const part = token.split(".")[1];
  if (!part) return false;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    const payload = JSON.parse(json) as { jti?: unknown };
    return typeof payload.jti === "string" && payload.jti.length > 0;
  } catch {
    return false;
  }
}

/**
 * The address a load may restore, or null: the freshest pocketed session,
 * when it is an EVM address, carries a session id, was recorded with the
 * wallet that signed it, and no email session is live (an email session is
 * its own account and never borrows a wallet's).
 */
export function restorableAnchor(input: {
  anchor: { address: string; token: string } | null | undefined;
  record: { address: string; id: string; name: string } | null | undefined;
  emailSession: boolean;
}): string | null {
  const { anchor, record, emailSession } = input;
  if (emailSession || !anchor || !isEvmAddress(anchor.address)) return null;
  if (!sessionHasId(anchor.token)) return null;
  if (!rememberedFor(record, anchor.address)) return null;
  return anchor.address;
}

/** The slice of the SDK's EVM connector the reconnect reads. */
export type ReconnectCandidate = { id: string; name: string };

/**
 * Which EVM connectors to try, quietly, in order: the one this browser last
 * signed in with first; without a record, every extension announced through
 * EIP-6963 (they carry a reverse-DNS id, `io.metamask`, `xyz.hana...`). The
 * try itself only asks the wallet which accounts this site already has
 * (`eth_accounts`), which never opens a prompt; a wallet that answers none
 * is skipped. wagmi's generic connectors (`injected`, `metaMaskSDK`) and
 * WalletConnect without a record are never tried: they can deep-link or
 * open a QR code. Already-tried ids are left out, so a late announcement is
 * tried once, when it arrives.
 */
export function reconnectCandidates<C extends ReconnectCandidate>(
  connectors: readonly C[],
  rememberedId: string | null | undefined,
  tried: ReadonlySet<string>,
): C[] {
  const fresh = connectors.filter((connector) => !tried.has(connector.id));
  if (rememberedId) {
    const remembered = fresh.find((connector) => connector.id === rememberedId);
    if (remembered) return [remembered];
    // The remembered wallet has not announced yet: wait for it rather than
    // connect a different extension in its place.
    if (connectors.some((connector) => connector.id === rememberedId)) return [];
    if (rememberedId.includes(".")) return [];
  }
  return fresh.filter((connector) => connector.id.includes(".") && !connector.id.toLowerCase().includes("privy"));
}

/**
 * Whether a remembered wallet record belongs to this session's address: a
 * record from another account in the same browser must not name the wallet
 * to open.
 */
export function rememberedFor(
  record: { address: string; id: string; name: string } | null | undefined,
  anchor: string | null | undefined,
): { id: string; name: string } | null {
  if (!record || !anchor) return null;
  return record.address.toLowerCase() === anchor.toLowerCase() ? { id: record.id, name: record.name } : null;
}
