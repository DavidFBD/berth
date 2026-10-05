import {
  ChainKeys,
  getChainKeyFromRelayChainId,
  getChainType,
  reverseEncodeAddress,
  walletFactoryAbi,
  type Sodax,
} from "@sodax/sdk";
import { HOME_CHAIN } from "@/lib/account";
import { ROBINHOOD_RELAY_CHAIN_ID } from "@/lib/orders";
import { sdkAddress } from "@/lib/chains";
import { normalizeAddress, type WalletFamily } from "@/lib/identity/caip";
import { getSql } from "@/lib/server/db";
import { linkedWallets } from "@/lib/server/identities";

/**
 * Whose order an intent is, for every source family: the one proof the
 * pour route, the evening pass over pour claims, orders recovery and limit
 * orders share before an intent is written to an account's ledger or pays
 * it XP.
 *
 * What an intent carries (lib/sodax: EvmSolverService.constructCreateIntentData):
 * - `creator`: whatever the caller of the Intents contract wrote. The
 *   contract pulls the input from msg.sender and does NOT check that the
 *   creator is msg.sender (verified 2026-10-01 with eth_simulateV1 against
 *   Sonic: an EOA emitted an intent naming another address as creator,
 *   paying for it itself). So the creator alone proves nothing.
 * - `srcChain`, `srcAddress`: the relay chain id and the payer's address,
 *   encoded per chain type (SDK encodeAddress): EVM the 20 bytes; Solana
 *   the 32 byte public key; Bitcoin, NEAR and Injective the address string
 *   as UTF-8; Sui its 32 bytes; Stellar the address as ScVal XDR. Also
 *   written by the caller and not checked.
 * - `dstChain`, `dstAddress`: where the output goes. A buy is delivered on
 *   Sonic, to the account's home hub wallet or to the payer's own hub
 *   wallet (the creator, as a cup's deposit is), 20 bytes.
 *
 * What does prove it is the hub transaction itself (judgeOwnership):
 * - A hub wallet (the factory's per (chain, address) wallet) moves funds
 *   only on its owner's relay verified instruction: its executeCalls
 *   answers only to itself, its recvMessage wants an authorised executor
 *   and the validators' signatures, and the asset manager calls it only
 *   after verifying the relay's message (each checked on chain
 *   2026-10-01, reports/pour-ownership-probes/round2). So when the input
 *   token moved from the creator into the Intents contract in that same
 *   transaction, the creator really made it; for a spoke source the
 *   creator must then also be the wallet the factory derives for
 *   (srcChain, srcAddress), which makes srcAddress true.
 * - Signed on Sonic (the router path, or an EOA as its own creator), the
 *   transaction's sender must be the EOA named as srcAddress, and for the
 *   router the creator must be that EOA's router.
 *
 * Then an intent is the account's when:
 * 1. that proven source address, spelled as user_identities stores it
 *    (lib/identity/caip), is a wallet on the account; or, for a sell made
 *    by a hub wallet itself (hubWalletSwap: srcChain Sonic, srcAddress =
 *    creator), the creator is the home chain hub wallet of one of the
 *    account's EVM wallets;
 * 2. a buy is delivered on Sonic to the creator or to one of the account's
 *    home chain hub wallets, or on Robinhood Chain (plan P2a) to one of the
 *    account's own EVM wallets. A sell pays out wherever the person sent it,
 *    a typed cash out address included, so its delivery proves nothing and
 *    is not asked;
 * 3. every wallet the proof leans on was on the account when the intent was
 *    placed (OwnedWallet, from the account's identity history).
 *
 * A read that fails is UNKNOWN, never a "no": the verdict is `unknown`
 * and no caller marks, deletes or refuses for good on it.
 *
 * A source in a family Berth cannot link (Sui, Stellar, NEAR, Injective,
 * ICON, Stacks) or a Bitcoin order placed through a Radfi trading wallet
 * cannot be shown to be the account's. When such a buy (or any genuine buy
 * whose payer is not proven) was delivered to one of the account's own home
 * chain hub wallets, the stock is the account's all the same: the verdict
 * says so (deliveredToAccount), and the ledger records it with no XP, no
 * hold and no referral pair. A stranger reporting it gains nothing: the
 * row can only be written for the account the stock went to.
 */

export const HUB_RELAY_CHAIN_ID = 146n;

/**
 * When a wallet was the account's: from `linkedAt` (null: from the start,
 * as a home is) until `unlinkedAt` (null or absent: still is), epoch ms.
 */
export type Span = { linkedAt: number | null; unlinkedAt?: number | null };

/**
 * A wallet the proof may lean on, for one span of time. A wallet linked,
 * unlinked and linked again appears once per span.
 */
export type OwnedWallet = { family: WalletFamily; address: string } & Span;

/**
 * Whether any span holds `at`: true when one needs no time at all (the
 * home since the start, never unlinked), UNKNOWN when one needs the time
 * and it could not be read, false when it is not read yet or none holds it.
 */
export function heldAt(spans: readonly Span[], at: Maybe<number> | undefined): boolean | Unknown {
  if (spans.some((span) => span.linkedAt === null && (span.unlinkedAt ?? null) === null)) return true;
  if (spans.length === 0) return false;
  if (at === UNKNOWN) return UNKNOWN;
  if (at === undefined) return false;
  return spans.some((span) => (span.linkedAt === null || at >= span.linkedAt) && (span.unlinkedAt == null || at < span.unlinkedAt));
}

export type OwnershipFailure =
  /** The source address does not decode on its chain. */
  | "source unreadable"
  /** The creator is not the wallet the source address derives (or the router of the Sonic signer). */
  | "creator not the source's"
  /** A family no identity can be linked in (Sui, Stellar, …). */
  | "family not linkable"
  /** The payer, or the hub wallet that sold, is not on the account. */
  | "payer not on account"
  /** It is, but joined after the intent was placed (or the time could not be read). */
  | "payer linked later"
  /** A buy delivered somewhere that is not the account's. */
  | "not delivered to account"
  /** A read the proof needed did not answer (an RPC error or a timeout): try again, never a refusal. */
  | "reads failed"
  /** The hub transaction does not show the creator (or the Sonic signer) paying for it: a forged intent. */
  | "not funded by its creator";

export type OwnershipVerdict =
  | { ok: true; payer: { family: WalletFamily; address: string } }
  | {
      ok: false;
      why: OwnershipFailure;
      /**
       * Set by proveOwnership on a buy whose payer is not proven but which
       * was delivered on Sonic to one of the account's own home chain hub
       * wallets, or on Robinhood Chain to one of its own EVM wallets: the
       * stock is the account's, so the ledger records it, with
       * no XP and no hold (lib/server/no-xp, 'unproven_source'). Never set
       * for a sell.
       */
      deliveredToAccount?: boolean;
      /** A read failed: the answer is not known yet. Never mark, delete or refuse for good on it. */
      unknown?: true;
    };

export type DecodedSource = {
  /** The SDK's chain key for the relay chain id, or null when unknown. */
  chainKey: string | null;
  /** The family an identity of this source would have, or null when none can be linked. */
  family: WalletFamily | null;
  /** The address in its family's canonical spelling (lib/identity/caip), or the SDK's decoding for other families; null when unreadable. */
  address: string | null;
};

type Hex = `0x${string}`;

const lower = (value: string) => value.toLowerCase();

/**
 * The payer's address from an intent's (srcChain, srcAddress), spelled as
 * user_identities spells it: EVM lowercase hex; Solana base58 as the key
 * is; Bitcoin bech32 lowercased or base58 as it is. Never throws.
 */
export function decodeSource(srcChain: bigint | number | string, srcAddress: string): DecodedSource {
  let chainKey: string | null = null;
  try {
    chainKey = getChainKeyFromRelayChainId(BigInt(srcChain) as never) as string;
  } catch {
    return { chainKey: null, family: null, address: null };
  }
  let chainType: string;
  try {
    chainType = getChainType(chainKey as never);
  } catch {
    return { chainKey, family: null, address: null };
  }
  const decoded = (() => {
    try {
      return reverseEncodeAddress(chainKey as never, srcAddress as Hex);
    } catch {
      return null;
    }
  })();
  switch (chainType) {
    case "EVM":
      return { chainKey, family: "evm", address: normalizeAddress("evm", srcAddress) };
    case "SOLANA":
      return { chainKey, family: "solana", address: normalizeAddress("solana", decoded) };
    case "BITCOIN":
      return { chainKey, family: "bitcoin", address: normalizeAddress("bitcoin", decoded) };
    default:
      return { chainKey, family: null, address: decoded };
  }
}

/** The intent's parties, as the chain (Intent) or SODAX's backend (strings and numbers) gives them. */
export type IntentParties = {
  creator: string;
  /** What the intent spends, and how much (the fee comes on top): the funding proof looks for it moving. */
  inputToken: string;
  inputAmount: bigint | number | string;
  srcChain: bigint | number | string;
  srcAddress: string;
  dstChain: bigint | number | string;
  dstAddress: string;
};

/**
 * A chain read that could not answer (an RPC error, a timeout): never a
 * "no". A verdict built on one is `unknown`, and no caller acts on it as
 * a refusal: nothing is marked, deleted or refused for good.
 */
export const UNKNOWN: unique symbol = Symbol("unknown");
export type Unknown = typeof UNKNOWN;
export type Maybe<T> = T | Unknown;

/** How long one ownership read may take before it counts as unknown. */
export const OWNERSHIP_READ_MS = 5_000;

/** A read that resolves to its value, or UNKNOWN on an error, a nullish answer or a timeout. Never throws. */
export async function withTimeout<T>(read: () => Promise<T | null | undefined>, ms = OWNERSHIP_READ_MS): Promise<Maybe<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      read(),
      new Promise<Unknown>((resolve) => {
        timer = setTimeout(() => resolve(UNKNOWN), ms);
      }),
    ]);
    return value === null || value === undefined ? UNKNOWN : value;
  } catch {
    return UNKNOWN;
  } finally {
    clearTimeout(timer);
  }
}

export type OwnershipFacts = {
  direction: "buy" | "sell";
  intent: IntentParties;
  wallets: readonly OwnedWallet[];
  /** The hub wallet the intent's own (srcChain, srcAddress) derives; UNKNOWN when the read failed, null when not read. */
  sourceHub: Maybe<string> | null;
  /** The home chain hub wallet of each of the account's EVM wallets, with that wallet's linkedAt; UNKNOWN where a read failed. */
  homeHubs: readonly Maybe<{ address: string } & Span>[];
  /** When the intent was placed (its hub block), epoch ms; undefined until read, UNKNOWN when the read failed. */
  intentAt?: Maybe<number>;
  /** The hub transaction that created the intent: who sent it, and what its logs moved; UNKNOWN when unread. */
  funding: Maybe<HubFunding>;
  /**
   * Whether the intent's input token is a real SODAX hub asset (the SDK's
   * getXTokenFromHubAsset knows it; every listing is one). A token anyone
   * deployed can emit any Transfer it likes, so its logs prove nothing.
   */
  inputIsHubAsset: boolean;
};

/** What the hub transaction shows about who paid for the intent. */
export type HubFunding = {
  /** The account that signed and sent the hub transaction (a relayer, or the EOA itself on Sonic). */
  txFrom: string;
  /** The contract that transaction called (the receipt's `to`), lowercased; null when it created one. */
  txTo?: string | null;
  /** Every Transfer in that transaction, lowercased. */
  transfers: readonly { token: string; from: string; to: string; value: bigint }[];
};

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** The Transfers of a receipt's logs, as HubFunding wants them. */
export function transfersOf(logs: readonly { address: string; topics: readonly string[]; data: string }[]): HubFunding["transfers"] {
  return logs
    .filter((log) => log.topics[0]?.toLowerCase() === TRANSFER_TOPIC && log.topics.length === 3)
    .map((log) => ({
      token: lower(log.address),
      from: `0x${log.topics[1].slice(26)}`.toLowerCase(),
      to: `0x${log.topics[2].slice(26)}`.toLowerCase(),
      value: BigInt(log.data === "0x" ? 0 : log.data),
    }));
}

/** True when the intent was created by the account's own hub wallet on Sonic (hubWalletSwap), or by an EOA there directly. */
export function createdOnHub(intent: Pick<IntentParties, "creator" | "srcChain" | "srcAddress">): boolean {
  return BigInt(intent.srcChain) === HUB_RELAY_CHAIN_ID && lower(intent.srcAddress) === lower(intent.creator);
}

const UNKNOWN_VERDICT: OwnershipVerdict = { ok: false, why: "reads failed", unknown: true };

type Hub = { address: string } & Span;
const knownHubs = (hubs: readonly Maybe<Hub>[]) => hubs.filter((hub): hub is Hub => hub !== UNKNOWN);
const someUnknown = (hubs: readonly Maybe<Hub>[]) => hubs.some((hub) => hub === UNKNOWN);

/**
 * Who funded the intent, from its own hub transaction. The Intents contract
 * pulls the input from msg.sender and does NOT check that the creator field
 * is msg.sender (verified 2026-10-01 with eth_simulateV1: an EOA can emit
 * an intent naming any creator, paying itself). So the creator is believed
 * only when the input token moved from the creator into the Intents
 * contract in that same transaction, at least the intent's amount.
 */
export function fundedBy(funding: HubFunding, intent: Pick<IntentParties, "inputToken" | "inputAmount">, payer: string, intentsContract: string): boolean {
  const token = lower(intent.inputToken);
  const amount = BigInt(intent.inputAmount);
  const into = lower(intentsContract);
  const from = lower(payer);
  return funding.transfers.some((transfer) => transfer.token === token && transfer.to === into && transfer.from === from && transfer.value >= amount);
}

/** Native S on Sonic, as an intent names it (the hub's nativeToken): it moves as value, never as a Transfer. */
export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";

/** The Intents contract on Sonic (sodaxConfig solver.intentsContract), the funding proof's destination. */
export const INTENTS_CONTRACT = "0x6382d6ccd780758c5e8a6123c33ee8f4472f96ef";

/**
 * The pure proof, with every chain read already made.
 *
 * First, is the intent what it says: who made it, from where.
 * - From a spoke chain, or by a hub wallet on Sonic: the creator is a hub
 *   wallet, and a hub wallet moves funds only on its owner's relay
 *   verified instruction (its executeCalls answers only to itself; its
 *   recvMessage wants an authorised executor and the validators'
 *   signatures; the asset manager calls it only after verifying the
 *   relay's message; all checked on chain 2026-10-01). So the input must
 *   have moved from the creator into the Intents contract in this
 *   transaction, and for a spoke source the creator must be the wallet the
 *   factory derives for (srcChain, srcAddress).
 * - Signed on Sonic by an EOA (the router path, or the EOA as its own
 *   creator): the transaction's sender must be that EOA, and for the router
 *   the creator must be the EOA's router.
 * Then, is it the account's: the payer, or the hub wallet that sold, is a
 * wallet on the account at the intent's time. Then a buy's delivery.
 */
export function judgeOwnership({ direction, intent, wallets, sourceHub, homeHubs, intentAt, funding, inputIsHubAsset }: OwnershipFacts): OwnershipVerdict {
  const creator = lower(intent.creator);
  const src = lower(intent.srcAddress);
  const hubs = knownHubs(homeHubs);
  const onSonic = BigInt(intent.srcChain) === HUB_RELAY_CHAIN_ID;

  // 1. Is it what it says.
  if (funding === UNKNOWN) return UNKNOWN_VERDICT;
  // A Transfer log proves a payment only when the token is a real hub
  // asset: the emitting contract is matched to the input token, and the
  // input token must be one SODAX knows.
  const paidBy = (payer: string) => inputIsHubAsset && fundedBy(funding, intent, payer, INTENTS_CONTRACT);
  // Signed on Sonic by the EOA itself: it paid the Intents contract in this
  // transaction, or (native S, which moves as value, not a Transfer) it
  // called the Intents contract directly. A contract the EOA happened to
  // call cannot make an intent in its name and pay for it itself.
  const signerPaid = (signer: string) =>
    lower(funding.txFrom) === signer &&
    (paidBy(signer) || (lower(intent.inputToken) === NATIVE_TOKEN && lower(funding.txTo ?? "") === INTENTS_CONTRACT));
  let made: "hub" | "eoa" | "router" | "spoke";
  if (onSonic && src === creator) {
    if (signerPaid(creator)) made = "eoa";
    else if (lower(funding.txFrom) !== creator && paidBy(creator)) made = "hub";
    else return { ok: false, why: "not funded by its creator" };
  } else if (onSonic) {
    if (!signerPaid(src)) return { ok: false, why: "not funded by its creator" };
    if (sourceHub === UNKNOWN) return UNKNOWN_VERDICT;
    if (!sourceHub || lower(sourceHub) !== creator) return { ok: false, why: "creator not the source's" };
    made = "router";
  } else {
    const source = decodeSource(intent.srcChain, intent.srcAddress);
    if (!source.chainKey || !source.address) return { ok: false, why: "source unreadable" };
    if (!paidBy(creator)) return { ok: false, why: "not funded by its creator" };
    if (sourceHub === UNKNOWN) return UNKNOWN_VERDICT;
    if (!sourceHub || lower(sourceHub) !== creator) return { ok: false, why: "creator not the source's" };
    made = "spoke";
  }

  // 2. Is it the account's.
  let payer: { family: WalletFamily; address: string };
  // Proven if one span holds the intent's time, unknown if none does but
  // the time could not be read, else linked later.
  const timely = (spans: readonly Span[]): OwnershipVerdict | null => {
    const answer = heldAt(spans, intentAt);
    if (answer === UNKNOWN) return UNKNOWN_VERDICT;
    return answer ? null : { ok: false, why: "payer linked later" };
  };
  if (made === "hub") {
    // A sell from the account: its hub wallet made the intent.
    const hub = hubs.filter((candidate) => lower(candidate.address) === creator);
    if (hub.length === 0) return someUnknown(homeHubs) ? UNKNOWN_VERDICT : { ok: false, why: "payer not on account" };
    const late = timely(hub);
    if (late) return late;
    payer = { family: "evm", address: creator };
  } else if (made === "eoa" || made === "router") {
    const eoa = wallets.filter((wallet) => wallet.family === "evm" && wallet.address === src);
    if (eoa.length === 0) return { ok: false, why: "payer not on account" };
    const late = timely(eoa);
    if (late) return late;
    payer = { family: "evm", address: src };
  } else {
    const source = decodeSource(intent.srcChain, intent.srcAddress);
    if (!source.family || !source.address) return { ok: false, why: "family not linkable" };
    const wallet = wallets.filter((candidate) => candidate.family === source.family && candidate.address === source.address);
    if (wallet.length === 0) return { ok: false, why: "payer not on account" };
    const late = timely(wallet);
    if (late) return late;
    payer = { family: source.family, address: source.address };
  }

  // 3. Where a buy went: to its own (proven) creator, as a cup's deposit
  // does, or to one of the account's home chain hub wallets; on Robinhood
  // Chain, to one of the account's own EVM wallets, on the account when the
  // intent was placed (a wallet linked later proves nothing, as for a payer).
  if (direction === "buy" && BigInt(intent.dstChain) === ROBINHOOD_RELAY_CHAIN_ID) {
    const own = robinhoodRecipient(intent, wallets);
    if (own.length === 0) return { ok: false, why: "not delivered to account" };
    const late = timely(own);
    if (late) return late;
  } else if (direction === "buy") {
    if (BigInt(intent.dstChain) !== HUB_RELAY_CHAIN_ID) return { ok: false, why: "not delivered to account" };
    const dst = lower(intent.dstAddress);
    if (dst !== creator) {
      const hub = hubs.filter((candidate) => lower(candidate.address) === dst);
      if (hub.length === 0) return someUnknown(homeHubs) ? UNKNOWN_VERDICT : { ok: false, why: "not delivered to account" };
      const late = timely(hub);
      if (late) return late;
    }
  }
  return { ok: true, payer };
}

/**
 * The account's EVM wallets (each span) a Robinhood Chain buy was delivered
 * to: its dstAddress is the 20 bytes of an EVM address there, compared as
 * user_identities stores it, lowercased.
 */
function robinhoodRecipient(intent: Pick<IntentParties, "dstAddress">, wallets: readonly OwnedWallet[]): OwnedWallet[] {
  const dst = lower(intent.dstAddress);
  return wallets.filter((wallet) => wallet.family === "evm" && lower(wallet.address) === dst);
}

/** Failures that leave the intent genuine (funded by its creator, from the source it names): only these may still count as delivered to the account. */
const GENUINE_BUT_NOT_THEIRS = new Set<OwnershipFailure>(["family not linkable", "payer not on account", "payer linked later"]);

/** The chain reads the proof needs, injectable for tests. Each answers UNKNOWN when it could not read. */
export type OwnershipReads = {
  /** The hub wallet a (relay chain id, encoded address) derives: the factory's, or the router on Sonic. */
  sourceHub: (srcChain: bigint, srcAddress: string) => Promise<Maybe<string>>;
  /** An EVM address's hub wallet on the home chain. */
  homeHub: (address: string) => Promise<Maybe<string>>;
  /** When the intent was placed, epoch ms. */
  intentAt: () => Promise<Maybe<number>>;
  /** The hub transaction that created the intent. */
  funding: () => Promise<Maybe<HubFunding>>;
  /** Whether a token is a SODAX hub asset (the SDK's own config, no read). */
  isHubAsset: (token: string) => boolean;
};

export function sodaxOwnershipReads(
  sodax: Sodax,
  intentAt: () => Promise<Maybe<number>>,
  funding: () => Promise<Maybe<HubFunding>>,
  ms = OWNERSHIP_READ_MS,
): OwnershipReads {
  return {
    funding,
    isHubAsset: (token) => {
      try {
        return !!sodax.config.getXTokenFromHubAsset(token as Hex);
      } catch {
        return false;
      }
    },
    sourceHub: (srcChain, srcAddress) =>
      withTimeout(async () => {
        if (srcChain === HUB_RELAY_CHAIN_ID) {
          return lower(await sodax.hubProvider.getUserHubWalletAddress(sdkAddress(ChainKeys.SONIC_MAINNET, srcAddress), ChainKeys.SONIC_MAINNET));
        }
        const wallet = await sodax.hubProvider.publicClient.readContract({
          address: sodax.hubProvider.chainConfig.addresses.hubWallet,
          abi: walletFactoryAbi,
          functionName: "getDeployedAddress",
          args: [srcChain, srcAddress as Hex],
        });
        return lower(wallet as string);
      }, ms),
    homeHub: (address) => withTimeout(async () => lower(await sodax.hubProvider.getUserHubWalletAddress(sdkAddress(HOME_CHAIN, address), HOME_CHAIN)), ms),
    intentAt,
  };
}

/**
 * The full proof: the reads the facts need, only those, then the judge. A
 * wallet that joined later asks for the intent's time once, and only then.
 * Any read that fails makes the verdict unknown, never a refusal.
 */
export async function proveOwnership({
  direction,
  intent,
  wallets,
  reads,
}: {
  direction: "buy" | "sell";
  intent: OwnershipFacts["intent"];
  wallets: readonly OwnedWallet[];
  reads: OwnershipReads;
}): Promise<OwnershipVerdict> {
  if (wallets.length === 0) return { ok: false, why: "payer not on account" };
  const onSonic = BigInt(intent.srcChain) === HUB_RELAY_CHAIN_ID;
  const selfMade = onSonic && lower(intent.srcAddress) === lower(intent.creator);
  const funding = await reads.funding();
  if (funding === UNKNOWN) return UNKNOWN_VERDICT;
  const sourceHub = selfMade ? null : await reads.sourceHub(BigInt(intent.srcChain), intent.srcAddress);
  const toHub = BigInt(intent.dstChain) === HUB_RELAY_CHAIN_ID;
  const needsHomeHubs = selfMade || (direction === "buy" && toHub && lower(intent.dstAddress) !== lower(intent.creator));
  const homeHubs = needsHomeHubs ? await homeHubsOf(wallets, reads) : [];
  const facts: OwnershipFacts = { direction, intent, wallets, sourceHub, homeHubs, funding, inputIsHubAsset: reads.isHubAsset(intent.inputToken) };
  // The intent's time, read at most once, and only when a span needs it.
  let readAt: Maybe<number> | undefined;
  const intentAt = async () => (readAt ??= await reads.intentAt());
  let verdict = judgeOwnership(facts);
  if (!verdict.ok && verdict.why === "payer linked later") verdict = judgeOwnership({ ...facts, intentAt: await intentAt() });
  if (verdict.ok || verdict.unknown || direction !== "buy" || !GENUINE_BUT_NOT_THEIRS.has(verdict.why)) return verdict;
  // Genuine but not proven the account's: it may still have been delivered
  // to the account, to a hub wallet that was the account's when it was
  // placed, or on Robinhood Chain to an EVM wallet that was.
  if (BigInt(intent.dstChain) === ROBINHOOD_RELAY_CHAIN_ID) {
    const own = robinhoodRecipient(intent, wallets);
    if (own.length === 0) return verdict;
    const at = heldAt(own, undefined) === true ? undefined : await intentAt();
    const timely = heldAt(own, at);
    if (timely === UNKNOWN) return UNKNOWN_VERDICT;
    return timely ? { ...verdict, deliveredToAccount: true } : verdict;
  }
  if (!toHub) return verdict;
  const hubs = needsHomeHubs ? homeHubs : await homeHubsOf(wallets, reads);
  const dst = lower(intent.dstAddress);
  const landed = knownHubs(hubs).filter((hub) => lower(hub.address) === dst);
  if (landed.length === 0) return someUnknown(hubs) ? UNKNOWN_VERDICT : verdict;
  const at = heldAt(landed, undefined) === true ? undefined : await intentAt();
  const timely = heldAt(landed, at);
  if (timely === UNKNOWN) return UNKNOWN_VERDICT;
  return timely ? { ...verdict, deliveredToAccount: true } : verdict;
}


async function homeHubsOf(wallets: readonly OwnedWallet[], reads: OwnershipReads): Promise<Maybe<Hub>[]> {
  // One read per address, however many spans it has.
  const reading = new Map<string, Promise<Maybe<string>>>();
  return Promise.all(
    wallets
      .filter((wallet) => wallet.family === "evm")
      .map(async (wallet) => {
        if (!reading.has(wallet.address)) reading.set(wallet.address, reads.homeHub(wallet.address));
        const address = await reading.get(wallet.address)!;
        return address === UNKNOWN ? UNKNOWN : { address, linkedAt: wallet.linkedAt, unlinkedAt: wallet.unlinkedAt ?? null };
      }),
  );
}

/**
 * Whether a buy landed on Sonic in one of the account's own home chain hub
 * wallets, whoever paid for it and whenever the wallet joined: what is in
 * that hub wallet now is the account's.
 */
export function deliveredToAccount(
  intent: Pick<IntentParties, "dstChain" | "dstAddress">,
  homeHubs: readonly { address: string }[],
): boolean {
  if (BigInt(intent.dstChain) !== HUB_RELAY_CHAIN_ID) return false;
  const dst = lower(intent.dstAddress);
  return homeHubs.some((hub) => lower(hub.address) === dst);
}

/**
 * Proofs only a home wallet is ever recorded with: Privy's own record of
 * the account's wallet, and 'legacy', the backfill's carry over of a users
 * row's wallet and the merge's record of the absorbed row's.
 */
const HOME_PROOFS = new Set(["privy_wallet", "legacy"]);

type IdentityHistoryRow = {
  value: string;
  family: WalletFamily;
  is_home: boolean;
  proof: string;
  created_at: string | Date;
  unlinked_at: string | Date | null;
};
type AuditRow = { action: string; wallet: string | null; from_wallet: string | null; to_wallet: string | null; at: string | Date };

/**
 * The wallet history the proof reads, pure: every identity row the account
 * holds (unlinked ones included) and its account_audit trail of links,
 * unlinks and home changes, as spans of time. A wallet counts at the time
 * an intent was placed, not tonight: unlinking it later, or unlinking and
 * linking it again (which restarts the row's created_at), never takes an
 * earlier order away.
 *
 * A home counts from the start, as it always has: the account's home now,
 * users.wallet_address, any EVM wallet recorded with a home's proof
 * (privy_wallet, legacy), one a home change names (a former home), and a
 * SIWE wallet never linked as a pay-from address (recordHomeWallet writes
 * the home that way, so after a merge or a home change it is a former
 * home, not a wallet that joined late). Everything else counts from when
 * it joined until it left.
 */
export function walletSpans({
  rows,
  audit,
  usersWallet,
  linkedAsPayFrom,
}: {
  rows: readonly IdentityHistoryRow[];
  audit: readonly AuditRow[];
  usersWallet: string | null;
  /** CAIP values some account linked as a pay-from (non-home) wallet, from the audit trail. */
  linkedAsPayFrom: ReadonlySet<string>;
}): OwnedWallet[] {
  const home = normalizeAddress("evm", usersWallet);
  const formerHomes = new Set<string>();
  for (const event of audit) {
    if (event.action !== "home_changed") continue;
    if (event.from_wallet) formerHomes.add(event.from_wallet);
    if (event.to_wallet) formerHomes.add(event.to_wallet);
  }
  const ms = (value: string | Date | null) => (value === null ? null : new Date(value).getTime());
  const out: OwnedWallet[] = [];
  const seen = new Set<string>();
  const parseValue = (value: string) => {
    const colon = value.indexOf(":");
    return colon > 0 ? value.slice(colon + 1) : null;
  };
  const isHomeLike = (value: string, row?: IdentityHistoryRow) => {
    if (!value.startsWith("eip155:")) return false;
    const address = parseValue(value);
    if (row?.is_home || (address && address === home)) return true;
    if (formerHomes.has(value)) return true;
    if (row && HOME_PROOFS.has(row.proof)) return true;
    return row?.proof === "siwe" && !linkedAsPayFrom.has(value);
  };
  for (const row of rows) {
    const address = parseValue(row.value);
    if (!address) continue;
    seen.add(row.value);
    out.push({
      family: row.family,
      address,
      linkedAt: isHomeLike(row.value, row) ? null : ms(row.created_at),
      unlinkedAt: ms(row.unlinked_at),
    });
  }
  // The audit trail: each link to the next unlink, for wallets whose row
  // restarted or went to another account since.
  const open = new Map<string, number>();
  const families: Record<string, WalletFamily> = { eip155: "evm", solana: "solana", bip122: "bitcoin" };
  const push = (value: string, from: number, until: number | null) => {
    const address = parseValue(value);
    const family = families[value.slice(0, value.indexOf(":"))];
    if (!address || !family) return;
    out.push({ family, address, linkedAt: isHomeLike(value) ? null : from, unlinkedAt: until });
  };
  for (const event of [...audit].sort((a, b) => ms(a.at)! - ms(b.at)!)) {
    if (!event.wallet) continue;
    if (event.action === "wallet_linked" && !open.has(event.wallet)) open.set(event.wallet, ms(event.at)!);
    if (event.action === "wallet_unlinked" && open.has(event.wallet)) {
      push(event.wallet, open.get(event.wallet)!, ms(event.at));
      open.delete(event.wallet);
    }
  }
  // A link still open whose row is gone (taken over by another account
  // after the cooldown, without an unlink here): it counts until the row left,
  // which only the row knew; without it, from the link on.
  for (const [value, from] of open) if (!seen.has(value)) push(value, from, null);
  // The home on users.wallet_address alone (an account the backfill never reached).
  if (home && !rows.some((row) => row.value === `eip155:${home}`)) out.unshift({ family: "evm", address: home, linkedAt: null, unlinkedAt: null });
  return out;
}

/**
 * Every wallet the account may prove an intent with, as spans of time
 * (walletSpans): its identity rows, unlinked ones included, and the audit
 * trail of this account and of every account merged into it.
 */
export async function accountOwnedWallets(userId: string, usersWallet: string | null): Promise<OwnedWallet[]> {
  const sql = getSql();
  try {
    const rows = (await sql.query(
      `select value, family, is_home, proof, created_at, unlinked_at from user_identities
        where user_id = $1 and kind = 'wallet' order by created_at, value`,
      [userId],
    )) as IdentityHistoryRow[];
    const audit = (await sql.query(
      `select action, detail->>'wallet' as wallet, detail->>'from' as from_wallet, detail->>'to' as to_wallet, created_at as at
         from account_audit
        where (user_id = $1 or user_id in (select id from users where retired_into = $1))
          and action in ('wallet_linked', 'wallet_unlinked', 'home_changed')`,
      [userId],
    )) as AuditRow[];
    const values = [...new Set([...rows.map((row) => row.value), ...audit.flatMap((event) => [event.wallet, event.from_wallet, event.to_wallet])])].filter(
      (value): value is string => !!value && value.startsWith("eip155:"),
    );
    const payFrom = values.length
      ? ((await sql.query(
          `select distinct detail->>'wallet' as value from account_audit
            where action = 'wallet_linked' and detail->>'wallet' = any($1::text[]) and detail->>'home' = 'false'`,
          [values],
        )) as { value: string }[])
      : [];
    return walletSpans({ rows, audit, usersWallet, linkedAsPayFrom: new Set(payFrom.map((row) => row.value)) });
  } catch {
    // Without the history, the wallets linked now, as before.
    const home = normalizeAddress("evm", usersWallet);
    return (await linkedWallets(userId, usersWallet)).map((wallet) => ({
      family: wallet.family,
      address: wallet.address,
      linkedAt: wallet.isHome || (wallet.family === "evm" && (wallet.address === home || HOME_PROOFS.has(wallet.proof))) ? null : Date.parse(wallet.linkedAt),
      unlinkedAt: null,
    }));
  }
}
