import { ChainKeys, type LeverageYieldSwapPayload, type SpokeChainKey } from "@sodax/sdk";
import type { Address } from "viem";
import { sdkAddress } from "@/lib/chains";

/**
 * A sell from the person's own wallet on Robinhood Chain (plan P3a): the
 * native Robinhood token a buy delivered there, sold back to any asset on
 * any network. Unlike a sell from the Berth account, which spends the hub
 * wallet with one `sendMessage` signature (`hubWalletSwap`), this is a
 * source chain intent from the robinhood spoke, the same shape as a buy
 * paid from Base: the wallet approves the robinhood asset manager for
 * exactly the amount, then the SDK's intent creation deposits the token
 * there, and the relay carries it to Sonic.
 *
 * Pure: the order machine (hooks/use-vault-action) and the sell sheet
 * (components/flow/withdraw-drawer) call these; the tests pin them.
 */

export const ROBINHOOD_CHAIN_KEY = ChainKeys.ROBINHOOD_MAINNET as SpokeChainKey;

/**
 * How long a sell from Robinhood Chain stays fillable after hub time: 45
 * minutes (review B1). The SDK's default is five (`resolveDeadline`, hub
 * time + INTENT_DEADLINE_BUFFER_SECONDS), sized for a relay from a fast
 * chain. A deposit on Robinhood Chain reaches Sonic through the relay, and
 * an intent that arrives after its deadline cannot be filled: its tokens
 * would then wait as the hub asset in the hub wallet derived for
 * (robinhood, the wallet), which only a recovery can move. The minimum
 * output is still the quote's, so a late fill never pays less than shown.
 */
export const ROBINHOOD_SELL_DEADLINE_SECONDS = 45 * 60;

/** The deadline of a sell from Robinhood Chain, from the hub's latest block time. */
export function robinhoodSellDeadline(hubTime: bigint): bigint {
  if (!(hubTime > 0n)) throw new Error("no hub time to set the sell's deadline from");
  return hubTime + BigInt(ROBINHOOD_SELL_DEADLINE_SECONDS);
}

/**
 * The intent payload of a sell from Robinhood Chain, from the SDK's own
 * withdraw build (`sodax.leverageYield.withdraw`, which sets the deadline
 * from hub time, the solver, `allowPartialFill: false`, `data` and the
 * recipient, exactly as for a sell from the account): three fields
 * replaced, as the Robinhood Chain buy replaces three (lib/delivery-client
 * robinhoodParams), and `hubWalletSwap` dropped, so createVaultIntent
 * takes the spoke path (an asset manager deposit on 4663) instead of
 * spending the hub wallet.
 *
 * - `srcChainKey`: Robinhood Chain, where the wallet signs.
 * - `srcAddress`: the wallet that holds the tokens, checksummed.
 * - `inputToken`: the listing's native token there (`rhAddress`), which the
 *   SDK maps to its hub asset for the intent.
 * - `deadline`: `sell.deadline` (robinhoodSellDeadline), never the SDK's
 *   five minute default, which a relay from Robinhood Chain can outlast.
 *
 * Throws on a build that is not the withdraw of this listing, that would
 * accept nothing (the minimum stays the quote's, never zero), or whose
 * signer is not the wallet the sheet chose to sell from (`owner`): the
 * order must spend exactly the tokens the sheet showed and capped.
 */
export function robinhoodSellPayload(
  built: LeverageYieldSwapPayload,
  sell: { vault: string; rhAddress: Address; srcAddress: string; owner: string; deadline: bigint },
): LeverageYieldSwapPayload {
  const { params } = built;
  if (sell.owner.toLowerCase() !== sell.srcAddress.toLowerCase()) {
    throw new Error("the signer is not the wallet chosen to sell from");
  }
  if (built.hubWalletSwap !== true || params.inputToken.toLowerCase() !== sell.vault.toLowerCase()) {
    throw new Error("not the withdraw build of this listing");
  }
  if (!(params.inputAmount > 0n) || !(params.minOutputAmount > 0n)) {
    throw new Error("a sell must spend something and accept a minimum above zero");
  }
  // A market sell always ends: 0n would mean "until cancelled", a limit's.
  if (!(sell.deadline > 0n) || params.deadline !== sell.deadline) {
    throw new Error("a sell from Robinhood Chain must carry its own deadline");
  }
  return {
    params: {
      ...params,
      srcChainKey: ROBINHOOD_CHAIN_KEY,
      srcAddress: sdkAddress(ROBINHOOD_CHAIN_KEY, sell.srcAddress),
      inputToken: sell.rhAddress,
    },
    ...(built.partnerFee !== undefined && { partnerFee: built.partnerFee }),
  };
}

/**
 * Where a sell can come from: a hub wallet in the Berth account
 * (lib/account-wallets sellSources), or one of the account's own wallets on
 * Robinhood Chain. One order spends one place, never two added together.
 */
export type SellSource = {
  /** One per place: `hub:<address>` or `robinhood:<address>`. */
  key: string;
  chain: "hub" | "robinhood";
  /** The EVM address that signs for it: the hub wallet's owner, or the wallet on Robinhood Chain itself. */
  spoke: string;
  hubWallet?: string;
  isHome: boolean;
  balance: bigint;
  /** Whether this session's wallet can sign for it. */
  canSign: boolean;
};

export const sellSourceKey = (chain: SellSource["chain"], spoke: string) => `${chain}:${spoke.toLowerCase()}`;

/** The Berth account's sources (lib/account-wallets sellSources), keyed. */
export function hubSellSources(
  sources: readonly { spoke: string; hubWallet: string; isHome: boolean; balance: bigint; canSign: boolean }[],
): SellSource[] {
  return sources.map((source) => ({ ...source, key: sellSourceKey("hub", source.spoke), chain: "hub" as const }));
}

/**
 * The account's wallets on Robinhood Chain that hold the listing, each with
 * its own balance. Only the wallet itself signs for its tokens, so only
 * the session's signer can sell from one.
 */
export function robinhoodSellSources(
  held: readonly { owner: string; balance: bigint }[],
  signer: string | undefined,
): SellSource[] {
  return held.flatMap(({ owner, balance }) =>
    balance > 0n
      ? [
          {
            key: sellSourceKey("robinhood", owner),
            chain: "robinhood" as const,
            spoke: owner.toLowerCase(),
            isHome: false,
            balance,
            canSign: !!signer && signer.toLowerCase() === owner.toLowerCase(),
          },
        ]
      : [],
  );
}

/**
 * Which source the sheet opens on (rh-ux-sec M2): one this session can
 * sign for AND pay the network fee for (`payable`, false when unknown),
 * the wallet on Robinhood Chain first (plan P3a: the leg there is sold
 * first), and, for a drafted quantity, the first such that holds all of
 * it. When the wallet there cannot pay its fee, the Berth account it can
 * sell from comes first. Then the home, then the first. The person can
 * still pick any place; this is only where the sheet starts.
 *
 * A drafted limit (`limit`, review M2 sell) waits on the hub and is
 * placed from the home hub wallet only (lib/server/limit-orders), so it
 * opens there when this session can sign for it: never on a wallet on
 * Robinhood Chain, where it would silently become a market sell.
 */
export function defaultSellSource(
  sources: readonly SellSource[],
  wanted?: bigint,
  payable: (source: SellSource) => boolean = () => true,
  { limit = false }: { limit?: boolean } = {},
): SellSource | undefined {
  if (limit) {
    const home = sources.find((source) => source.chain === "hub" && source.isHome && source.canSign);
    if (home) return home;
  }
  const signable = [
    ...sources.filter((source) => source.canSign && source.chain === "robinhood"),
    ...sources.filter((source) => source.canSign && source.chain === "hub"),
  ];
  const ready = signable.filter(payable);
  const order = [...ready, ...sources.filter((source) => source.canSign && source.chain === "hub" && !ready.includes(source)), ...signable];
  if (wanted !== undefined && wanted > 0n) {
    const covers = order.find((source) => source.balance >= wanted);
    if (covers) return covers;
  }
  return order[0] ?? sources.find((source) => source.chain === "hub" && source.isHome) ?? sources[0];
}

/**
 * Whether the sell sheet should say selling from Robinhood Chain is
 * paused (review: the kill switch left a dead Sell): no wallet there may
 * be offered (`sellFromWallet` false, ROBINHOOD_SELL=off or no Berth
 * delivery there on record), and nothing the sheet can sell from holds
 * any, so whatever the person holds is in their wallet there.
 */
export function robinhoodSellPaused(sources: readonly SellSource[], sellFromWallet: boolean): boolean {
  return !sellFromWallet && sources.every((source) => source.balance === 0n);
}
