import { getEvmViemChain, isEvmChainKeyType, type EvmChainKey, type SpokeChainKey } from "@sodax/sdk";
import { toEventSelector } from "viem";

/**
 * Privy's gas sponsorship ("Fee sponsorship" in the Privy dashboard): on
 * the chains listed here, an email user's embedded wallet sends with
 * `sponsor: true`, and Privy pays the network fee from the app's prepaid
 * credits, so the person needs no ETH, POL or BNB to buy, sell or cancel.
 *
 * Off unless NEXT_PUBLIC_GAS_SPONSOR_CHAINS lists EVM chain ids
 * ("8453,42161"); empty means off. List only chains that are also ticked
 * under Supported chains in the dashboard, and only chains Privy sponsors
 * at all (docs.privy.io/wallets/gas-and-asset-management/gas/overview:
 * Base, Arbitrum, Optimism, Polygon, BNB Smart Chain, Ethereum, and more,
 * but not Sonic, Avalanche or HyperEVM).
 *
 * Embedded wallets only: an external wallet signs and pays for itself, and
 * Privy refuses to sponsor anything but a TEE embedded wallet.
 */

/** The chain ids in a comma or space separated list; anything else is ignored. */
export function parseSponsorChains(raw: string | undefined): ReadonlySet<number> {
  const ids = new Set<number>();
  for (const part of (raw ?? "").split(/[\s,]+/)) {
    if (!/^\d+$/.test(part)) continue;
    const id = Number(part);
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  }
  return ids;
}

/**
 * The chains Privy sponsors (docs.privy.io/wallets/gas-and-asset-management/gas/overview,
 * read 2026-10-04) that Berth uses: Ethereum, Optimism, BNB Chain, Polygon,
 * Base, Arbitrum and Robinhood Chain. Any other id in the env list is
 * ignored, so a typo or a hopeful 146 can never drop the gas gate or claim
 * "no network fee" on a chain nobody pays for. Robinhood Chain (4663) is
 * not an SDK spoke yet, so it does nothing until one exists.
 */
export const PRIVY_SPONSORABLE_CHAIN_IDS: ReadonlySet<number> = new Set([1, 10, 56, 137, 8453, 42161, 4663]);

/** The env list, kept only where Privy can sponsor; each dropped id is warned about in development. */
export function sponsorChainsFromEnv(
  raw: string | undefined,
  warn: (message: string) => void = () => {},
): ReadonlySet<number> {
  const kept = new Set<number>();
  for (const id of parseSponsorChains(raw)) {
    if (PRIVY_SPONSORABLE_CHAIN_IDS.has(id)) kept.add(id);
    else warn(`[gas-sponsor] NEXT_PUBLIC_GAS_SPONSOR_CHAINS lists ${id}, which Privy cannot sponsor for Berth; ignored`);
  }
  return kept;
}

/** Read once at build time: Next inlines NEXT_PUBLIC_ variables into the client bundle. */
export const GAS_SPONSOR_CHAIN_IDS: ReadonlySet<number> = sponsorChainsFromEnv(
  process.env.NEXT_PUBLIC_GAS_SPONSOR_CHAINS,
  process.env.NODE_ENV === "development" ? (message) => console.warn(message) : undefined,
);

/** Whether `chainKey` is an EVM chain on the sponsor list. Says nothing about the wallet. */
export function isSponsoredChain(
  chainKey: SpokeChainKey | null | undefined,
  ids: ReadonlySet<number> = GAS_SPONSOR_CHAIN_IDS,
): boolean {
  if (!chainKey || ids.size === 0 || !isEvmChainKeyType(chainKey)) return false;
  return ids.has(getEvmViemChain(chainKey).id);
}

/**
 * Chains where Privy refused to sponsor in this browser session (credits
 * run out, a chain not ticked in the dashboard). Once refused, Berth stops
 * saying "no network fee" there and gates the chain as before, because
 * the person will in fact pay; it also stops asking Privy, so the next
 * order goes straight to the ordinary send. Kept in sessionStorage so a
 * reload does not bring the claim back; a new session tries again.
 */
const REFUSED_KEY = "berth.gasSponsorRefused";
let refused: ReadonlySet<number> = readRefused();
const listeners = new Set<() => void>();

function readRefused(): ReadonlySet<number> {
  try {
    if (typeof window === "undefined") return new Set();
    return parseSponsorChains(window.sessionStorage.getItem(REFUSED_KEY) ?? "");
  } catch {
    return new Set();
  }
}

export function markSponsorRefused(chainId: number): void {
  if (refused.has(chainId)) return;
  refused = new Set([...refused, chainId]);
  try {
    window.sessionStorage.setItem(REFUSED_KEY, [...refused].join(","));
  } catch {
    // Private mode or blocked storage: remembered for this page only.
  }
  for (const listener of listeners) listener();
}

/** The refused chain ids, as a stable snapshot for useSyncExternalStore. */
export function sponsorRefusals(): ReadonlySet<number> {
  return refused;
}

export function subscribeSponsorRefusals(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam: forget every refusal. */
export function resetSponsorRefusals(): void {
  refused = new Set();
  for (const listener of listeners) listener();
}

/**
 * Whether an order on `chainKey` is gas-free for this person: the chain is
 * sponsored, Privy has not refused it this session, AND they sign with the
 * Privy embedded wallet (an email session on an EVM chain, lib/account
 * resolveAccount's "email" mode). External wallets are never sponsored.
 */
export function gasSponsored(
  chainKey: SpokeChainKey | null | undefined,
  emailSession: boolean,
  ids: ReadonlySet<number> = GAS_SPONSOR_CHAIN_IDS,
  refusals: ReadonlySet<number> = refused,
): boolean {
  if (!emailSession || !isSponsoredChain(chainKey, ids)) return false;
  return !refusals.has(getEvmViemChain(chainKey as EvmChainKey).id);
}

/**
 * The sponsored chains Berth uses, by the names people know, in the order
 * listed: "Base, Arbitrum and BNB Chain". Empty when sponsorship is off.
 */
export function sponsoredChainNames(
  chains: readonly SpokeChainKey[],
  nameOf: (chainKey: SpokeChainKey) => string,
  ids: ReadonlySet<number> = GAS_SPONSOR_CHAIN_IDS,
): string[] {
  const byId = new Map<number, SpokeChainKey>();
  for (const chainKey of chains) {
    if (isEvmChainKeyType(chainKey)) byId.set(getEvmViemChain(chainKey).id, chainKey);
  }
  return [...ids].flatMap((id) => {
    const chainKey = byId.get(id);
    return chainKey ? [nameOf(chainKey)] : [];
  });
}

/** "Base", "Base and Arbitrum", "Base, Arbitrum and Polygon". */
export function joinNames(names: readonly string[], and = "and"): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`;
}

/** The JSON-RPC transaction viem hands eth_sendTransaction (hex quantities). */
export type RpcTransaction = {
  from?: string;
  to?: string;
  data?: string;
  input?: string;
  value?: string;
};

/** What Privy's sponsored send takes: Privy re-estimates gas and fees itself, so only the call goes over. */
export type SponsoredTransaction = {
  from?: string;
  to?: string;
  data?: string;
  value?: string;
  chainId: number;
};

export function toSponsoredTransaction(tx: RpcTransaction, chainId: number): SponsoredTransaction {
  const data = tx.data ?? tx.input;
  return {
    ...(tx.from ? { from: tx.from } : {}),
    ...(tx.to ? { to: tx.to } : {}),
    ...(data && data !== "0x" ? { data } : {}),
    ...(tx.value && BigInt(tx.value) !== 0n ? { value: tx.value } : {}),
    chainId,
  };
}

/**
 * The options for Privy's sponsored send. `showWalletUIs: false` keeps the
 * send out of Privy's modal: its error screen has a Retry button that calls
 * the sponsored send again inside Privy, out of Berth's sight, so after an
 * ambiguous failure one tap could move the money twice. Headless, every
 * failure comes straight back to withGasSponsor, which alone decides
 * whether anything is sent again. Berth's own order drawer is the consent;
 * an MFA prompt, where one is set, still shows.
 */
export function sponsoredSendOptions(address: string): {
  sponsor: true;
  address: string;
  uiOptions: { showWalletUIs: false };
} {
  return { sponsor: true, address, uiOptions: { showWalletUIs: false } };
}

/** One error and its causes, outermost first (at most 8 deep). */
function causeChain(error: unknown): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  let node: unknown = error;
  for (let depth = 0; node !== null && typeof node === "object" && depth < 8; depth++) {
    nodes.push(node as Record<string, unknown>);
    node = (node as { cause?: unknown }).cause;
  }
  return nodes;
}

/**
 * How a failed sponsored send ended, which decides whether it may be sent
 * again the ordinary way, paid by the person.
 *
 * - `refused`: Privy said no BEFORE anything was broadcast. Only two kinds
 *   of failure qualify: an answer from Privy's API with a client error
 *   status (400, 401, 402, 403, 404, 422), and the throws react-auth makes
 *   on the client before it calls the API at all. Falls back.
 * - `rate-limited`: a 429, also before broadcast. Retried once after
 *   RATE_LIMIT_RETRY_MS; a second 429 falls back for this order only and
 *   leaves the chain sponsored.
 * - `cancelled`: the person said no. Rethrown, never resent.
 * - `unknown`: everything else. A 5xx, a 408, no status, "Unable to sign
 *   transaction" (Privy answered 2xx without a hash), a dropped
 *   connection, anything unrecognised. The operation may still land, so a
 *   second send could move the money twice. Rethrown as
 *   SponsoredOutcomeUnknown, never resent.
 *
 * The status and code decide first; the message is read only for errors
 * that carry neither, and only to recognise react-auth's known pre-send
 * throws (react-auth 3.35.2 index-wGOlH2Wi.mjs, js-sdk-core 0.68.4
 * wallet-api/rpc.mjs). An unrecognised message is `unknown`, never `refused`.
 */
export type SponsorErrorKind = "refused" | "rate-limited" | "cancelled" | "unknown";

/** Privy API statuses that mean the request was refused before broadcast. */
const REFUSED_STATUSES = new Set([400, 401, 402, 403, 404, 422]);

/** Error codes react-auth and js-sdk-core raise on the client before the API call. */
const PRE_SEND_CODES = new Set(["embedded_wallet_request_expired", "unsupported_chain_id", "embedded_wallet_not_found", "must_be_authenticated"]);

/** react-auth's own pre-send throws that carry no code. Matched only when no status or code decided. */
const PRE_SEND_MESSAGES = [
  /^sponsoring (transactions )?is only supported for wallets on the tee stack/,
  /^cannot sponsor/,
  /^chain id \d+ is not supported/,
  /^must have valid access token/,
  /^user must be authenticated before signing/,
  /^must have a privy wallet before signing/,
  /^no embedded or connected wallet found/,
  /^unable to connect to wallet$/,
  /^wallet request expired before it could be sent/,
];

/**
 * The person said no. `mfa_canceled` is js-sdk-core's code for closing the
 * MFA prompt (errorIndicatesMfaCanceled): not a refusal by Privy, so no paid
 * send follows and the chain stays sponsored.
 */
const CANCEL_CODES = new Set<unknown>([4001, "ACTION_REJECTED", "USER_REJECTED", "mfa_canceled"]);

export function classifySponsorError(error: unknown): SponsorErrorKind {
  const chain = causeChain(error);
  if (chain.length === 0) return "unknown";
  // The person said no: a 4001 anywhere down the chain, or the wallet's
  // own words for it. Never resent, whatever else the error carries.
  for (const node of chain) {
    if (CANCEL_CODES.has(node.code) || CANCEL_CODES.has(node.privyErrorCode)) return "cancelled";
    if (node.name === "UserRejectedRequestError") return "cancelled";
  }
  // An HTTP status, where there is one, decides.
  for (const node of chain) {
    if (typeof node.status === "number") {
      if (node.status === 429) return "rate-limited";
      return REFUSED_STATUSES.has(node.status) ? "refused" : "unknown";
    }
    // react-auth's api_error with no response (a dropped connection) has
    // status null: the request may have reached Privy.
    if (node.status === null) return "unknown";
  }
  // Then a code.
  for (const node of chain) {
    for (const code of [node.code, node.privyErrorCode]) {
      if (typeof code !== "string") continue;
      if (PRE_SEND_CODES.has(code)) return "refused";
      return "unknown";
    }
  }
  // Last, the message, only to recognise known pre-send throws.
  const message = chain[0].message;
  if (typeof message === "string") {
    const prose = message.trim().toLowerCase();
    if (/user rejected|rejected the request/.test(prose)) return "cancelled";
    if (PRE_SEND_MESSAGES.some((pattern) => pattern.test(prose))) return "refused";
  }
  return "unknown";
}

/** Whether a failed sponsored send may be sent again the ordinary way. */
export function sponsorFallbackAllowed(error: unknown): boolean {
  const kind = classifySponsorError(error);
  return kind === "refused" || kind === "rate-limited";
}

/**
 * A sponsored send whose outcome Berth cannot know: Privy may have
 * broadcast it. Never resent; the order screen says it may still go
 * through (lib/error-copy).
 */
export class SponsoredOutcomeUnknown extends Error {
  constructor(cause: unknown) {
    super("The sponsored transaction may have been sent; not resending.", { cause });
    this.name = "SponsoredOutcomeUnknown";
  }
}

/**
 * After an unknown outcome, the order buttons stay off for a minute
 * (OUTCOME_HOLD_MS), so a second tap cannot send the same money again
 * while the first may still land. In memory only: a refresh clears it,
 * and by then What you own shows whether the order went through.
 */
export const OUTCOME_HOLD_MS = 60_000;
let holdUntil = 0;
const holdListeners = new Set<() => void>();

export function holdAfterUnknownOutcome(now = Date.now()): void {
  holdUntil = now + OUTCOME_HOLD_MS;
  for (const listener of holdListeners) listener();
}

/** When the hold ends, in ms since the epoch; 0 when there is none. */
export function outcomeHoldUntil(): number {
  return holdUntil;
}

export function subscribeOutcomeHold(listener: () => void): () => void {
  holdListeners.add(listener);
  return () => holdListeners.delete(listener);
}

/** Test seam. */
export function resetOutcomeHold(): void {
  holdUntil = 0;
  for (const listener of holdListeners) listener();
}

/** True for SponsoredOutcomeUnknown however deeply the SDK and viem wrap it. */
export function isSponsoredOutcomeUnknown(error: unknown): boolean {
  return causeChain(error).some((node) => node instanceof SponsoredOutcomeUnknown || node.name === "SponsoredOutcomeUnknown");
}

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * A sponsored send lands as a bundler's handleOps transaction, and when the
 * call inside it reverts, the outer transaction still succeeds: the SDK
 * would read success and wait out the whole relay for a message that never
 * left. The EntryPoint's UserOperationEvent carries the inner call's own
 * success flag, so the wrapper reads it from the receipt.
 */
export const USER_OPERATION_EVENT = toEventSelector(
  "UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)",
);

/** The canonical ERC-4337 EntryPoints, v0.6, v0.7 and v0.8: only their events count. */
export const ENTRY_POINTS = new Set([
  "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789",
  "0x0000000071727de22e5e9d8baf0edac6f37da032",
  "0x4337084d9e255ff0702461cf8895ce9e3b5ff108",
]);

export type ReceiptLike = {
  status: string;
  logs: readonly { address: string; topics: readonly string[]; data: string }[];
};

/**
 * Whether the call inside a sponsored transaction succeeded: `false` when
 * the outer transaction reverted or our user operation reports failure,
 * `true` when it reports success, `undefined` when the receipt carries no
 * user operation of ours (not a 4337 bundle), so nothing can be said.
 */
export function sponsoredCallSucceeded(receipt: ReceiptLike, sender: string): boolean | undefined {
  if (receipt.status === "reverted" || receipt.status === "0x0") return false;
  const ours = receipt.logs.filter(
    (log) =>
      ENTRY_POINTS.has(log.address.toLowerCase()) &&
      log.topics[0]?.toLowerCase() === USER_OPERATION_EVENT &&
      log.topics.length === 4 &&
      `0x${log.topics[2].slice(26)}`.toLowerCase() === sender.toLowerCase(),
  );
  if (ours.length === 0) return undefined;
  // data: nonce, success, actualGasCost, actualGasUsed, 32 bytes each.
  return ours.every((log) => {
    const word = log.data.slice(2 + 64, 2 + 128);
    return word.length === 64 && BigInt(`0x${word}`) !== 0n;
  });
}

/** The call inside a sponsored transaction reverted: nothing moved, so the order simply failed. */
export class SponsoredCallFailed extends Error {
  constructor(readonly hash: string) {
    super(`The sponsored transaction ${hash} landed but the call inside it reverted.`);
    this.name = "SponsoredCallFailed";
  }
}

/** How long to wait before the one retry after a 429. */
export const RATE_LIMIT_RETRY_MS = 2_000;

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

/**
 * The embedded wallet's EIP-1193 provider, with eth_sendTransaction sent
 * through Privy's sponsored path first. The provider alone can't sponsor:
 * Privy's Embedded1193Provider sends without `sponsor` (react-auth 3.35.2),
 * and only `useSendTransaction().sendTransaction(tx, { sponsor: true })`
 * reaches the paymaster. Everything else passes straight through.
 *
 * When Privy refuses before broadcast (classifySponsorError), the same transaction goes out
 * the ordinary way, paid by the person; if they hold no gas, that send fails
 * with the node's insufficient-funds line, which lib/error-copy already
 * turns into the calm "add about 0.0002 ETH" sentence.
 */
export function withGasSponsor(
  provider: Eip1193,
  {
    chainId,
    address,
    active,
    sendSponsored,
    readReceipt,
    onFallback,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }: {
    chainId: number;
    /** The embedded wallet's address: the user operation's sender. */
    address: string;
    /**
     * The receipt of a landed sponsored transaction, or undefined when it
     * cannot be read in time; then the hash is trusted as before.
     */
    readReceipt?: (hash: `0x${string}`) => Promise<ReceiptLike | undefined>;
    /** Asked at each send: still sponsored here (not refused this session)? */
    active: () => boolean;
    sendSponsored: (tx: SponsoredTransaction) => Promise<{ hash: string }>;
    /**
     * Privy refused before broadcast and the ordinary send follows.
     * `refused` should drop the chain for the session; `rate-limited`
     * (two 429s in a row) should not.
     */
    onFallback?: (error: unknown, kind: "refused" | "rate-limited") => void;
    /** Test seam for the 429 wait. */
    sleep?: (ms: number) => Promise<void>;
  },
): Eip1193 {
  return {
    request: async (args) => {
      // viem retries a failed eth_sendTransaction as wallet_sendTransaction
      // on some error codes; that path would skip the rules below and could
      // send a second time, so it is closed while sponsorship is on.
      if (args.method === "wallet_sendTransaction" && active()) {
        throw Object.assign(new Error("wallet_sendTransaction is not used while gas is sponsored"), { code: 4200 });
      }
      if (args.method !== "eth_sendTransaction" || !active()) return provider.request(args);
      const tx = (Array.isArray(args.params) ? args.params[0] : undefined) as RpcTransaction | undefined;
      if (!tx) return provider.request(args);
      const sponsoredTx = toSponsoredTransaction(tx, chainId);
      let hash: string;
      try {
        try {
          ({ hash } = await sendSponsored(sponsoredTx));
        } catch (first) {
          // One 429 is a busy moment, not a refusal: wait and ask once more.
          if (classifySponsorError(first) !== "rate-limited") throw first;
          await sleep(RATE_LIMIT_RETRY_MS);
          ({ hash } = await sendSponsored(sponsoredTx));
        }
      } catch (error) {
        const kind = classifySponsorError(error);
        if (kind === "cancelled") throw error;
        if (kind === "unknown") {
          holdAfterUnknownOutcome();
          throw new SponsoredOutcomeUnknown(error);
        }
        onFallback?.(error, kind);
        return provider.request(args);
      }
      // Privy answered without a hash: the operation was accepted and may
      // land, so a second send could pay twice.
      if (!TX_HASH.test(hash)) {
        holdAfterUnknownOutcome();
        throw new SponsoredOutcomeUnknown(new Error(`no transaction hash: ${String(hash)}`));
      }
      // Privy's client waits for inclusion before it answers, so the
      // receipt is normally there already.
      const receipt = readReceipt ? await readReceipt(hash as `0x${string}`).catch(() => undefined) : undefined;
      if (receipt && sponsoredCallSucceeded(receipt, tx.from ?? address) === false) {
        throw new SponsoredCallFailed(hash);
      }
      return hash;
    },
  };
}
