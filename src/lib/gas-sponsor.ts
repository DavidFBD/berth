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
 * read 2026-10-04) that Berth uses: Optimism, BNB Chain, Polygon, Base,
 * Arbitrum and Robinhood Chain. Any other id in the env list is ignored,
 * so a typo or a hopeful 146 can never drop the gas gate or claim "no
 * network fee" on a chain nobody pays for.
 *
 * Robinhood Chain (4663) is sponsorable since 2026-10-10: SODAX confirmed
 * its relayer picks up an intent sent inside a sponsored EIP-7702 bundle
 * (docs/plans/2026-10-05-robinhood-chain-delivery.md, decision 2), and
 * David enabled and funded 4663 in the Privy dashboard. Listed in
 * NEXT_PUBLIC_GAS_SPONSOR_CHAINS, it pays an email account's sell from its
 * wallet there, and makes email wallets eligible for delivery there
 * (lib/server/delivery embeddedEligible).
 *
 * Ethereum (1) is left out on purpose although Privy sponsors it: Privy's
 * client gives up after 20 seconds while it waits for inclusion, and with
 * 12 second blocks a sponsored send there would often end as an unknown
 * outcome, held for a minute with the money perhaps on its way.
 */
export const PRIVY_SPONSORABLE_CHAIN_IDS: ReadonlySet<number> = new Set([10, 56, 137, 8453, 42161, 4663]);

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
  /** Hex, when the caller filled them in: what the node will check against the balance. */
  gas?: string;
  maxFeePerGas?: string;
  gasPrice?: string;
};

/**
 * What Privy's sponsored send takes: Privy re-estimates gas and fees itself, so only the call goes over.
 * `value` is a bigint on purpose: react-auth's sponsored branch runs it through viem's `toHex`, which
 * reads a hex string as text, so "0x10" would go out as the bytes of "0x10", an enormous amount.
 */
export type SponsoredTransaction = {
  from?: string;
  to?: string;
  data?: string;
  value?: bigint;
  chainId: number;
};

export function toSponsoredTransaction(tx: RpcTransaction, chainId: number): SponsoredTransaction {
  const data = tx.data ?? tx.input;
  return {
    ...(tx.from ? { from: tx.from } : {}),
    ...(tx.to ? { to: tx.to } : {}),
    ...(data && data !== "0x" ? { data } : {}),
    ...(tx.value && BigInt(tx.value) !== 0n ? { value: BigInt(tx.value) } : {}),
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
 * - `refused`: Privy declined to sponsor BEFORE anything was broadcast.
 *   Only two kinds of failure qualify: an answer from Privy's API with a
 *   client error status that is about sponsorship (402, 403; a 400 or 422
 *   only when its code or words say sponsorship was declined, see
 *   sponsorshipDeclined), and the throws react-auth makes on the client
 *   before it calls the API at all. Falls back, and the chain is dropped
 *   for the session.
 * - `auth`: the Privy session, not sponsorship, stopped the send before
 *   broadcast: a 401 or 404, `must_be_authenticated`,
 *   `embedded_wallet_request_expired`, or react-auth's own words for a
 *   missing token or an expired request. Says nothing about sponsorship,
 *   so the chain stays sponsored and nothing is sent paid: the token is
 *   refreshed and the sponsored send asked once more; failing that, the
 *   order fails with its own error.
 * - `failed`: a 400 or 422 that is not a sponsorship refusal, above all
 *   Privy's simulation reverting (a stale quote, slippage, execution
 *   reverted). Nothing was broadcast and the same call would revert paid
 *   too, so it is an ordinary failed order: rethrown with its own error,
 *   no paid send, and the chain stays sponsored. When unsure, a 400 or 422
 *   lands here. A 400 or 422 that speaks of broadcast, a timeout or a
 *   nonce (transaction_broadcast_failure) is `unknown` instead: the
 *   operation may already be on its way.
 * - `rate-limited`: a 429, also before broadcast. Retried once after
 *   RATE_LIMIT_RETRY_MS; a second 429 falls back for this order only and
 *   leaves the chain sponsored.
 * - `cancelled`: the person said no. Rethrown, never resent.
 * - `failed` also covers the few other 4xx statuses that refuse the
 *   request's form and cannot follow a submit (405, 411, 413, 414, 415,
 *   431; DEFINITE_FORM_STATUSES). Statuses decide; an error's words or a
 *   relayed RPC code never turn an ambiguous status into a definite one,
 *   since Privy's one POST spans the bundler submit and inclusion and its
 *   error may wrap any upstream answer (review 2026-10-11).
 * - `unknown`: everything else. A 5xx, a 408, a 409, a 410, a 424, any
 *   4xx not listed above, no status, an unrecognised code, "Unable to sign
 *   transaction" (Privy answered 2xx without a hash), a dropped
 *   connection, anything unrecognised. The operation may still land, so a
 *   second send could move the money twice. Rethrown as
 *   SponsoredOutcomeUnknown, never resent. Privy's own client would
 *   replay the POST on a 5xx or a dropped connection; Berth's patch of
 *   js-sdk-core (patches/, guarded by privy-rpc-no-retry.test.ts) sends it
 *   once, so the failure reaches this classifier instead.
 *
 * The status and code decide first; the message is read only for errors
 * that carry neither, and only to recognise react-auth's known pre-send
 * throws (react-auth 3.35.2 index-wGOlH2Wi.mjs, js-sdk-core 0.68.4
 * wallet-api/rpc.mjs). An unrecognised message is `unknown`, never `refused`.
 */
export type SponsorErrorKind = "refused" | "auth" | "failed" | "rate-limited" | "cancelled" | "unknown";

/** Privy API statuses that mean the request was refused before broadcast, whatever it said. */
const REFUSED_STATUSES = new Set([402, 403]);

/** Privy API statuses of a lapsed session or an expired request: before broadcast, and not about sponsorship. */
const AUTH_STATUSES = new Set([401, 404]);

/** Privy API statuses that are refusals only when they speak of sponsorship; otherwise ordinary failures. */
const AMBIGUOUS_STATUSES = new Set([400, 422]);

/**
 * Privy error codes (api-base PrivyErrorCode) that mean sponsorship itself
 * was declined: not switched on, not offered for the chain, or over a limit.
 */
const SPONSOR_REFUSAL_CODES = new Set(["feature_not_enabled", "not_supported", "transaction_limit_reached"]);

/** Words that tie a 400 or 422 to sponsorship: credits, the paymaster, the sponsor policy. */
const SPONSOR_WORDS = /sponsor|paymaster|gas credit|credits/;

/** Words of a simulation revert, which outrank any talk of sponsorship. */
const REVERT_WORDS = /revert|simulat|execution|slippage|stale|quote|transaction_execution_failure/;

/**
 * Words of a failure at or after broadcast, which outrank everything else
 * a 400 or 422 says. Broadcast is the one step where the operation can
 * reach a bundler or the mempool while Privy still answers with an error
 * (a timed out eth_sendUserOperation, a nonce already used, a replacement
 * underpriced), so the money may still move: unknown, never failed or
 * refused, so it is held and never sent again.
 */
const AFTER_SUBMIT_WORDS = /broadcast|time[sd]? ?out|already known|nonce|mempool|underpriced|replacement|submitted|pending|in flight|in-flight/;

/**
 * Other 4xx statuses that refuse the request's form before Privy does
 * anything with it: wrong method, no length, too large, URI too long,
 * wrong media type, headers too large. Nothing past these can have been
 * submitted. Every 4xx not listed here or above stays `unknown`.
 */
const DEFINITE_FORM_STATUSES = new Set([405, 411, 413, 414, 415, 431]);

/** Error codes react-auth and js-sdk-core raise on the client before the API call. */
const PRE_SEND_CODES = new Set(["unsupported_chain_id", "embedded_wallet_not_found"]);

/** Error codes of a lapsed session or an expired request, raised before the send. */
const AUTH_CODES = new Set(["must_be_authenticated", "embedded_wallet_request_expired"]);

/** react-auth's own pre-send throws that carry no code. Matched only when no status or code decided. */
const PRE_SEND_MESSAGES = [
  /^sponsoring (transactions )?is only supported for wallets on the tee stack/,
  /^cannot sponsor/,
  /^chain id \d+ is not supported/,
  /^must have a privy wallet before signing/,
  /^no embedded or connected wallet found/,
  /^unable to connect to wallet$/,
];

/** react-auth's own words for a missing token or an expired request, thrown before the send. */
const AUTH_MESSAGES = [
  /^must have valid access token/,
  /^user must be authenticated before signing/,
  /^wallet request expired before it could be sent/,
];

/** Every message, error text and code down an error's causes, lower case. */
function chainProse(chain: Record<string, unknown>[]): string {
  return chain
    .flatMap((node) => [node.message, node.error, node.code, node.privyErrorCode, node.details, node.shortMessage])
    .filter((part): part is string => typeof part === "string")
    .join("\n")
    .toLowerCase();
}

/**
 * Whether a 400 or 422 from Privy declined sponsorship, rather than the
 * transaction failing its simulation. A revert wins over any mention of
 * sponsorship; a code or words about sponsorship make it a refusal;
 * anything else is an ordinary failure.
 */
function sponsorshipDeclined(chain: Record<string, unknown>[]): boolean {
  const prose = chainProse(chain);
  if (REVERT_WORDS.test(prose)) return false;
  for (const node of chain) {
    for (const code of [node.code, node.privyErrorCode]) {
      if (typeof code === "string" && SPONSOR_REFUSAL_CODES.has(code)) return true;
    }
  }
  return SPONSOR_WORDS.test(prose);
}

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
      if (AMBIGUOUS_STATUSES.has(node.status)) {
        if (AFTER_SUBMIT_WORDS.test(chainProse(chain))) return "unknown";
        return sponsorshipDeclined(chain) ? "refused" : "failed";
      }
      if (AUTH_STATUSES.has(node.status)) return "auth";
      if (REFUSED_STATUSES.has(node.status)) return "refused";
      // A refusal of the request's form. Broadcast words still hold it.
      if (DEFINITE_FORM_STATUSES.has(node.status)) {
        return AFTER_SUBMIT_WORDS.test(chainProse(chain)) ? "unknown" : "failed";
      }
      // A 5xx, 408, 409, 410, 424 or any other status: unknown, whatever it says.
      return "unknown";
    }
    // react-auth's api_error with no response (a dropped connection) has
    // status null: the request may have reached Privy.
    if (node.status === null) return "unknown";
  }
  // Then a code.
  for (const node of chain) {
    for (const code of [node.code, node.privyErrorCode]) {
      if (typeof code !== "string") continue;
      if (AUTH_CODES.has(code)) return "auth";
      if (PRE_SEND_CODES.has(code)) return "refused";
      return "unknown";
    }
  }
  // Last, the message, only to recognise known pre-send throws.
  const message = chain[0].message;
  if (typeof message === "string") {
    const prose = message.trim().toLowerCase();
    if (/user rejected|rejected the request/.test(prose)) return "cancelled";
    if (AUTH_MESSAGES.some((pattern) => pattern.test(prose))) return "auth";
    if (PRE_SEND_MESSAGES.some((pattern) => pattern.test(prose))) return "refused";
  }
  return "unknown";
}

/**
 * The raw shape of a sponsored failure, with no words and nothing about the
 * person: the first HTTP status and the first code down its causes, and the
 * error names. Logged and reported for every `unknown`, so the allowlist
 * above can widen later from Privy's real answers rather than guesses.
 * Example: "status=500 code=none names=SponsoredOutcomeUnknown>PrivyApiError".
 */
export function sponsorFailureFacts(error: unknown): string {
  const chain = causeChain(error);
  const statusNode = chain.find((node) => typeof node.status === "number" || node.status === null);
  const status = statusNode ? String(statusNode.status) : "none";
  let code = "none";
  for (const node of chain) {
    const found = [node.code, node.privyErrorCode].find((value) => typeof value === "string" || typeof value === "number");
    if (found !== undefined) {
      // Codes are short identifiers; anything else is cut to a safe token.
      code = String(found).replace(/[^\w.:-]/g, "").slice(0, 48) || "none";
      break;
    }
  }
  const names = chain
    .map((node) => (typeof node.name === "string" ? node.name.replace(/[^\w]/g, "").slice(0, 40) : ""))
    .filter(Boolean)
    .join(">");
  return `status=${status} code=${code} names=${names || "none"}`;
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
 * While a sponsored send is out, and after an unknown outcome, the order
 * buttons stay off, so a second tap cannot send the same money again while
 * the first may still land. The hold is set the moment the sponsored send
 * starts and renewed every HOLD_RENEW_MS until it settles: Privy's POST
 * waits up to about 20 seconds for inclusion, and a reload in that window
 * would otherwise show free buttons with nothing on the page to say an
 * order is out. A definite answer before broadcast (a refusal, a revert, a
 * cancel) or a hash lifts it; an unknown outcome holds a further minute
 * (OUTCOME_HOLD_MS). Kept in localStorage under one key for the whole
 * site, so neither a refresh nor another open tab lifts it early; other
 * tabs hear of it through the storage event. Storage that is blocked keeps
 * it for this page only.
 */
export const OUTCOME_HOLD_MS = 60_000;
const HOLD_KEY = "berth.gasSponsorOutcomeHold";
let holdUntil = readHold();
const holdListeners = new Set<() => void>();

function readHold(now = Date.now()): number {
  try {
    if (typeof window === "undefined") return 0;
    const until = Number(window.localStorage.getItem(HOLD_KEY));
    // A stored end later than a fresh hold would be is not ours to trust.
    return Number.isFinite(until) && until > now && until <= now + OUTCOME_HOLD_MS ? until : 0;
  } catch {
    return 0;
  }
}

/**
 * The end of a hold this tab must keep to its minute whatever its own sends
 * do: one set by holdAfterUnknownOutcome, and, failing closed, any hold
 * this tab did not set itself (read from storage at load, or heard from
 * another tab), since it cannot know whether that one was an unknown
 * outcome. Never a hold this tab's own sends are keeping up.
 */
let plainHoldUntil = holdUntil;

export function holdAfterUnknownOutcome(now = Date.now()): void {
  setHold(now);
  plainHoldUntil = holdUntil;
}

/** Sets (or renews) the minute's hold, here and for every other tab. */
function setHold(now: number): void {
  holdUntil = now + OUTCOME_HOLD_MS;
  try {
    window.localStorage.setItem(HOLD_KEY, String(holdUntil));
  } catch {
    // Private mode or blocked storage: held for this page only.
  }
  for (const listener of holdListeners) listener();
}

/**
 * Lifts the hold kept up while sponsored sends were out, once the last of
 * them has a definite answer: nothing of them can still sail unseen. An
 * ordinary hold set by an unknown outcome meanwhile is kept to its minute.
 */
function releaseOutcomeHold(now = Date.now()): void {
  const plain = plainHoldUntil > now ? plainHoldUntil : 0;
  holdUntil = plain;
  try {
    if (plain) window.localStorage.setItem(HOLD_KEY, String(plain));
    else window.localStorage.removeItem(HOLD_KEY);
  } catch {
    // Nowhere stored.
  }
  for (const listener of holdListeners) listener();
}

/** When the hold ends, in ms since the epoch; 0 when there is none. */
export function outcomeHoldUntil(): number {
  return holdUntil;
}

/** Another tab set the hold: take it up here too. A hold of our own is never shortened. */
function onHoldStorage(event: { key: string | null }): void {
  if (event.key !== HOLD_KEY && event.key !== null) return;
  const now = Date.now();
  const stored = readHold(now);
  // Not ours: kept to its end, never lifted by a send of this tab.
  plainHoldUntil = Math.max(plainHoldUntil, stored);
  const next = Math.max(holdUntil > now ? holdUntil : 0, stored);
  if (next === holdUntil) return;
  holdUntil = next;
  for (const listener of holdListeners) listener();
}

export function subscribeOutcomeHold(listener: () => void): () => void {
  if (holdListeners.size === 0 && typeof window !== "undefined") window.addEventListener?.("storage", onHoldStorage);
  holdListeners.add(listener);
  return () => {
    holdListeners.delete(listener);
    if (holdListeners.size === 0 && typeof window !== "undefined") window.removeEventListener?.("storage", onHoldStorage);
  };
}

/**
 * What Berth knows, during and after the hold, about a sponsored send whose
 * answer did not come back clearly. Progress only: chain silence never
 * lifts the hold, since it proves only that nothing was included yet, not
 * that nothing waits in a bundler (review 2026-10-11). The hold lifts early
 * only on Privy's own definite answer (sendSettled), as before.
 * - `checking`: the chain is being read, or a send past its deadline is
 *   still waiting on Privy.
 * - `sent`: something from the wallet reached the network (its nonce moved,
 *   a UserOperationEvent with it as sender landed, or a late hash came).
 *   The hold keeps its minute.
 * - `nothing-sent`: Privy answered a send past its deadline with a
 *   definite refusal. The only case that may say nothing was sent.
 * - `unclear`: an unclear outcome, with no check running now.
 */
export type OutcomeCheckPhase = "idle" | "checking" | "nothing-sent" | "sent" | "unclear";

/** Where the wallet stood on chain just before a sponsored send: the block, and its pending nonce. */
export type ChainMark = { block: bigint; txCount: number };

/**
 * How the wallet reads its own chain, cheaply: a mark before each
 * sponsored send, and later whether anything moved since it (the nonce, or
 * a UserOperationEvent with the wallet as sender). Either may throw.
 */
export type ChainProbe = {
  mark: () => Promise<ChainMark>;
  moved: (since: ChainMark) => Promise<boolean>;
};

/** How often the chain is read while the hold is on. */
export const OUTCOME_CHECK_EVERY_MS = 5_000;
/**
 * A mark is kept only if it came back this soon after the send started:
 * a slow read (viem retries for tens of seconds) could land after an L2
 * inclusion and hide it.
 */
export const MARK_WINDOW_MS = 2_000;
/** Blocks taken off the mark, so a lagging read cannot start the log range past our operation. */
export const MARK_MARGIN_BLOCKS = 20n;

/** Chain checks still reading. */
let checksRunning = 0;
let landed = false;
let lateDeclined = false;
let watched = false;
/** Bumped only by the test seam: every watch of an earlier epoch stops. */
let outcomeEpoch = 0;
const outcomeListeners = new Set<() => void>();

function notifyOutcome(): void {
  for (const listener of outcomeListeners) listener();
}

/** The phase of unclear sponsored sends, as a snapshot for useSyncExternalStore. */
export function outcomeCheckPhase(): OutcomeCheckPhase {
  if (landed) return "sent";
  if (checksRunning > 0 || lateSends > 0) return "checking";
  if (lateDeclined) return "nothing-sent";
  return watched ? "unclear" : "idle";
}

export function subscribeOutcomeCheck(listener: () => void): () => void {
  outcomeListeners.add(listener);
  return () => {
    outcomeListeners.delete(listener);
  };
}

/**
 * A new send forgets what earlier unclear sends found, but only once none
 * of them is still being checked, waited on or held: a later send never
 * drops the watch on an earlier unclear order.
 */
function forgetSettledOutcomes(now = Date.now()): void {
  if (checksRunning > 0 || lateSends > 0 || holdUntil > now) return;
  if (!landed && !lateDeclined && !watched) return;
  landed = false;
  lateDeclined = false;
  watched = false;
  notifyOutcome();
}

/**
 * After an unclear answer: reads the chain every OUTCOME_CHECK_EVERY_MS
 * while the hold is on, to say whether anything from the wallet reached
 * the network. Never lifts the hold. Without a probe or a trusted mark it
 * reads nothing and the hold simply keeps its minute.
 */
function watchOutcome(probe: ChainProbe | undefined, mark: ChainMark | undefined): void {
  const epoch = outcomeEpoch;
  watched = true;
  if (!probe || !mark) return notifyOutcome();
  checksRunning += 1;
  notifyOutcome();
  const done = () => {
    if (epoch !== outcomeEpoch) return;
    checksRunning = Math.max(0, checksRunning - 1);
    notifyOutcome();
  };
  const tick = async (): Promise<void> => {
    if (epoch !== outcomeEpoch) return;
    if (holdUntil <= Date.now() && sendsOut === 0 && lateSends === 0) return done();
    try {
      if (await probe.moved(mark)) {
        if (epoch === outcomeEpoch) landed = true;
        return done();
      }
    } catch {
      // A read that fails proves nothing; look again.
    }
    setTimeout(() => void tick(), OUTCOME_CHECK_EVERY_MS);
  };
  setTimeout(() => void tick(), OUTCOME_CHECK_EVERY_MS);
}

/** Test seam. */
export function resetOutcomeHold(): void {
  holdUntil = 0;
  plainHoldUntil = 0;
  lateSends = 0;
  sendsOut = 0;
  renewUntil = 0;
  outcomeEpoch += 1;
  checksRunning = 0;
  landed = false;
  lateDeclined = false;
  watched = false;
  stopRenewing();
  try {
    window.localStorage.removeItem(HOLD_KEY);
  } catch {
    // Nothing stored, or nowhere to store it.
  }
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

/**
 * How long one sponsored send may take before the order screen stops
 * waiting on it. Privy normally answers within its own 20 second inclusion
 * wait; a promise that has not settled by now is what this is for. Past
 * it the outcome is unknown: Privy may still broadcast. Nothing is resent
 * and nothing is paid for instead. The send keeps waiting for Privy's own
 * answer underneath, the order buttons stay held until it comes (on every
 * tab), and the order screen is let go through `subscribeSponsoredStall`,
 * saying the order may still go through. A late hash carries on as any
 * sent order does (relay, fill watch, record); a late refusal lifts the hold.
 */
export const SPONSORED_SEND_DEADLINE_MS = 90_000;

/**
 * However long Privy stays silent, the hold is kept up this long at most
 * past the deadline, so a promise that never settles cannot hold the order
 * buttons for the rest of the session. A hold kept up ends a minute after.
 */
export const LATE_HOLD_CAP_MS = 10 * 60_000;

/** How often a held send renews the hold, well inside OUTCOME_HOLD_MS. */
const HOLD_RENEW_MS = 20_000;

/** Kept for its name in logs and reports: the sponsored send passed its deadline. */
export class SponsoredSendTimedOut extends Error {
  constructor(ms: number) {
    super(`The sponsored send gave no answer within ${Math.round(ms / 1000)} seconds.`);
    this.name = "SponsoredSendTimedOut";
  }
}

/** Privy refused a send after its deadline had passed: never a reason to send again. */
class SponsoredLateFailure extends Error {
  constructor(cause: unknown) {
    super("The sponsored send failed after its deadline.", { cause });
    this.name = "SponsoredLateFailure";
  }
}

const stallListeners = new Set<() => void>();

/**
 * Told when a sponsored send passes SPONSORED_SEND_DEADLINE_MS, so the
 * order that is waiting on it can let its screen go. The send itself
 * carries on underneath.
 */
export function subscribeSponsoredStall(listener: () => void): () => void {
  stallListeners.add(listener);
  return () => {
    stallListeners.delete(listener);
  };
}

/** Sends past their deadline that Privy has not answered yet. */
let lateSends = 0;
/** Sponsored sends started and not yet settled, in time or late. */
let sendsOut = 0;
let renewTimer: ReturnType<typeof setInterval> | undefined;
let renewUntil = 0;

/** Whether any sponsored send is past its deadline and still unanswered. */
export function lateSponsoredSends(): number {
  return lateSends;
}

/** How many sponsored sends are out now, waiting on Privy. */
export function sponsoredSendsOut(): number {
  return sendsOut;
}

function stopRenewing(): void {
  if (renewTimer !== undefined) clearInterval(renewTimer);
  renewTimer = undefined;
}

/**
 * Sets the hold now and keeps renewing it every HOLD_RENEW_MS until
 * `until` at the latest, so every tab, and this one after a reload, hears
 * of it through storage.
 */
function keepHolding(until: number, now = Date.now()): void {
  renewUntil = Math.max(renewUntil, until);
  setHold(now);
  if (renewTimer === undefined) {
    renewTimer = setInterval(() => {
      if (Date.now() > renewUntil) return stopRenewing();
      setHold(Date.now());
    }, HOLD_RENEW_MS);
  }
}

/** A sponsored send starts; awaitSponsored sets the hold as it goes out. */
function sendStarted(): void {
  forgetSettledOutcomes();
  sendsOut += 1;
}

/**
 * A sponsored send settled. `unknown`: it may still land, so hold a fresh
 * minute. `definite`: a hash came back, or Privy said no before broadcast;
 * once no other send is out the kept hold is lifted (an ordinary minute
 * from an unknown outcome stays).
 */
function sendSettled(outcome: "definite" | "unknown"): void {
  sendsOut = Math.max(0, sendsOut - 1);
  if (sendsOut === 0) stopRenewing();
  if (outcome === "unknown") holdAfterUnknownOutcome();
  else if (sendsOut === 0) releaseOutcomeHold();
}

/**
 * Holds the order buttons until `pending` settles (capped by
 * LATE_HOLD_CAP_MS): renewed every HOLD_RENEW_MS, so every tab hears of it
 * through the storage event. A late answer restarts the ordinary minute,
 * and so does a late failure that may still land; a late refusal leaves
 * the hold to sendSettled, which lifts it once no other send is out.
 */
function holdUntilSettled(pending: Promise<unknown>, now = Date.now()): void {
  lateSends += 1;
  keepHolding(now + LATE_HOLD_CAP_MS, now);
  pending.then(
    () => {
      lateSends -= 1;
      holdAfterUnknownOutcome();
      notifyOutcome();
    },
    (error: unknown) => {
      lateSends -= 1;
      notifyOutcome();
      // A late answer that does not prove nothing sailed (a timeout, a 5xx,
      // a nonce word) may still land: hold as before the deadline.
      if (classifySponsorError(error) === "unknown") holdAfterUnknownOutcome();
    },
  );
}

/**
 * The sponsored send, waited on: Privy's answer as it comes, before the
 * deadline or after it. Past the deadline the stall is announced and the
 * hold kept until the answer; a late rejection is a SponsoredLateFailure.
 */
async function awaitSponsored<T extends { hash: string }>(pending: Promise<T>, ms: number, onStall?: () => void): Promise<T> {
  // Held from the start, renewed until the deadline (holdUntilSettled
  // carries it on past that): a reload mid-POST keeps the buttons off.
  keepHolding(Date.now() + ms);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"stalled">((resolve) => {
    timer = setTimeout(() => resolve("stalled"), ms);
  });
  try {
    const first = await Promise.race([pending, deadline]);
    if (first !== "stalled") return first;
  } finally {
    clearTimeout(timer);
  }
  console.warn(`[gas-sponsor] ${new SponsoredSendTimedOut(ms).message} Holding orders until Privy answers.`);
  holdUntilSettled(pending);
  onStall?.();
  notifyOutcome();
  for (const listener of stallListeners) listener();
  try {
    const late = await pending;
    console.warn(`[gas-sponsor] late answer from Privy: ${String(late.hash)}`);
    return late;
  } catch (error) {
    console.warn("[gas-sponsor] late refusal from Privy; the hold is lifted", error);
    throw new SponsoredLateFailure(error);
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
 * When the Privy session stops the send before broadcast (`auth`), the
 * token is refreshed through `refreshAuth` and the sponsored send asked
 * once more; if that cannot be done or fails the same way, the order fails
 * with that error: no paid send, and the chain stays sponsored.
 *
 * When Privy refuses before broadcast (classifySponsorError), the same transaction goes out
 * the ordinary way, paid by the person. `beforePaidSend` checks their gas
 * first, and stops with an insufficient-funds line, which lib/error-copy
 * turns into the calm "add about 0.0002 ETH" sentence, rather than letting
 * the node refuse the send.
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
    beforePaidSend,
    refreshAuth,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    sendDeadlineMs = SPONSORED_SEND_DEADLINE_MS,
    chainProbe,
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
    /**
     * The gas check before the paid send that follows a fallback: throws
     * (an insufficient-funds error, so lib/error-copy says "add about X")
     * when the wallet cannot pay, and nothing is sent. Resolves to go on.
     */
    beforePaidSend?: (tx: RpcTransaction) => Promise<void>;
    /**
     * After an `auth` failure: refresh the Privy session and resolve true
     * when a fresh token is in hand, so the sponsored send is asked once
     * more. False, a throw, or no function: the order fails as it is.
     */
    refreshAuth?: () => Promise<boolean>;
    /** Test seam for the 429 wait. */
    sleep?: (ms: number) => Promise<void>;
    /** Test seam for SPONSORED_SEND_DEADLINE_MS, per send. */
    sendDeadlineMs?: number;
    /**
     * Reads the wallet's own chain, so an unclear answer can be settled
     * early (watchOutcome). Without it the hold keeps its minute.
     */
    chainProbe?: ChainProbe;
  },
): Eip1193 {
  return {
    request: async (args) => {
      // viem retries a failed eth_sendTransaction as wallet_sendTransaction
      // on some error codes; that path would skip the rules below and could
      // send a second time, so it is closed while sponsorship is on. The
      // code is -32601 (method not found) on purpose: on that code viem
      // rethrows the ORIGINAL send's error (actions/wallet/sendTransaction),
      // so a paid fallback that ran out of gas still reads "Add about X
      // ETH", where 4200 would have put this error in its place.
      if (args.method === "wallet_sendTransaction" && active()) {
        throw Object.assign(new Error("wallet_sendTransaction is not used while gas is sponsored"), { code: -32601 });
      }
      if (args.method !== "eth_sendTransaction" || !active()) return provider.request(args);
      const tx = (Array.isArray(args.params) ? args.params[0] : undefined) as RpcTransaction | undefined;
      if (!tx) return provider.request(args);
      const sponsoredTx = toSponsoredTransaction(tx, chainId);
      let hash: string;
      // Where the wallet stands before the send, read alongside it. Kept
      // only if it came back within MARK_WINDOW_MS and before Privy
      // answered, and taken back MARK_MARGIN_BLOCKS: a mark read late could
      // already include the send and hide it.
      let answered = false;
      let stalled = false;
      let mark: ChainMark | undefined;
      const markStarted = Date.now();
      chainProbe?.mark().then(
        (read) => {
          if (answered || Date.now() - markStarted > MARK_WINDOW_MS) return;
          mark = { block: read.block > MARK_MARGIN_BLOCKS ? read.block - MARK_MARGIN_BLOCKS : 0n, txCount: read.txCount };
        },
        () => {},
      );
      const unclear = (cause: unknown): SponsoredOutcomeUnknown => {
        watchOutcome(chainProbe, mark);
        return new SponsoredOutcomeUnknown(cause);
      };
      // Held from here until the send settles (sendSettled), so a reload
      // while Privy's POST is out still shows the buttons held.
      sendStarted();
      try {
        let rateRetried = false;
        let authRetried = false;
        for (;;) {
          try {
            ({ hash } = await awaitSponsored(sendSponsored(sponsoredTx), sendDeadlineMs, () => {
              stalled = true;
            }));
            break;
          } catch (attempt) {
            if (attempt instanceof SponsoredLateFailure) throw attempt;
            const kind = classifySponsorError(attempt);
            // One 429 is a busy moment, not a refusal: wait and ask once more.
            if (kind === "rate-limited" && !rateRetried) {
              rateRetried = true;
              await sleep(RATE_LIMIT_RETRY_MS);
              continue;
            }
            // A lapsed session or an expired request: nothing went out.
            // Refresh the token and ask once more, sponsored as before.
            if (kind === "auth" && !authRetried && refreshAuth) {
              authRetried = true;
              const fresh = await refreshAuth().catch((refreshError: unknown) => {
                console.warn("[gas-sponsor] could not refresh the Privy session", refreshError);
                return false;
              });
              if (fresh) continue;
            }
            throw attempt;
          }
        }
      } catch (error) {
        answered = true;
        // Refused after the deadline: the kept hold lifts (a late failure
        // that may still land has set its own minute), and after that long
        // nothing is sent again, sponsored or paid.
        if (error instanceof SponsoredLateFailure) {
          sendSettled("definite");
          // A definite late refusal is the one answer that proves nothing
          // sailed; anything else is watched like any unclear outcome. This
          // late, a refusal counts only when an HTTP status says so (or the
          // person said no): a client-side code or message can't prove it.
          const lateKind = classifySponsorError(error.cause);
          const statusBacked = causeChain(error.cause).some((node) => typeof node.status === "number");
          if (lateKind === "cancelled" || (lateKind !== "unknown" && statusBacked)) {
            lateDeclined = true;
            watched = true;
            notifyOutcome();
            throw new SponsoredOutcomeUnknown(error.cause);
          }
          console.warn(`[gas-sponsor] late unknown outcome: ${sponsorFailureFacts(error.cause)}`);
          throw unclear(error.cause);
        }
        const kind = classifySponsorError(error);
        if (kind === "unknown") {
          console.warn(`[gas-sponsor] unknown outcome: ${sponsorFailureFacts(error)}`);
          sendSettled("unknown");
          throw unclear(error);
        }
        // Every other kind is a definite answer before broadcast.
        sendSettled("definite");
        // A cancel, an ordinary failure such as a simulation revert, or a
        // session that could not be renewed: nothing went out, nothing is
        // resent or paid for, the chain stays sponsored.
        if (kind === "cancelled" || kind === "failed" || kind === "auth") throw error;
        onFallback?.(error, kind);
        // The person pays now: check they can before the node refuses it.
        await beforePaidSend?.(tx);
        return provider.request(args);
      }
      // Privy answered without a hash: the operation was accepted and may
      // land, so a second send could pay twice.
      answered = true;
      if (!TX_HASH.test(hash)) {
        sendSettled("unknown");
        throw unclear(new Error(`no transaction hash: ${String(hash)}`));
      }
      // A hash: the order is out and the screen follows it from here. A
      // screen already let go after the deadline hears that it went out.
      if (stalled) {
        landed = true;
        watched = true;
        notifyOutcome();
      }
      sendSettled("definite");
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
