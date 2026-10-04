import { getAddress } from "viem";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { PARTNER_FEE } from "@/lib/sodax-config";
import { PAYOUT_CHAIN, USDC_BASE, USDC_DECIMALS, usdcRaw } from "@/lib/server/campaigns/usdc";

/**
 * Where a campaign's money goes, the client safe half (the staff Funding
 * block on /staff/campaigns). A sponsor sends USDC on Base to the payout
 * wallet, a wallet David controls outside Berth; David pays rewards from
 * it by hand. Berth never holds funds. Nothing here changes the payout
 * check (lib/server/campaigns/usdc), it only says it plainly: which
 * network, which token, which address, and whether what is there covers
 * the budget.
 */

export const FUNDING_NETWORK = PAYOUT_CHAIN.name;
export const FUNDING_TOKEN = { symbol: "USDC", address: getAddress(USDC_BASE) } as const;
export const BASESCAN = "https://basescan.org";

export const basescanAddress = (address: string) => `${BASESCAN}/address/${address}`;
export const basescanToken = (token: string = FUNDING_TOKEN.address) => `${BASESCAN}/token/${token}`;
/** The USDC token page filtered to one holder: its transfers in and out. */
export const basescanHolding = (holder: string) => `${BASESCAN}/token/${FUNDING_TOKEN.address}?a=${holder}`;

/** The Intents contract on Sonic (lib/server/pour-ownership INTENTS_CONTRACT); a test keeps the two equal. */
export const INTENTS_CONTRACT_ADDRESS = "0x6382d6ccd780758c5e8a6123c33ee8f4472f96ef";

export type BerthAddressKind = "usdc_contract" | "fee_wallet" | "intents_contract" | "listing_token";

/** Addresses that belong to Berth or its contracts: USDC sent there does not reach a campaign. */
export function berthAddressKind(address: string): BerthAddressKind | null {
  const lower = address.toLowerCase();
  if (lower === USDC_BASE) return "usdc_contract";
  if (lower === PARTNER_FEE.address.toLowerCase()) return "fee_wallet";
  if (lower === INTENTS_CONTRACT_ADDRESS) return "intents_contract";
  if (TOKEN_LISTINGS.some((listing) => listing.address.toLowerCase() === lower)) return "listing_token";
  return null;
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type PayoutAddressJudgement =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "bad_checksum" }
  | { kind: "zero" }
  | { kind: "ok"; address: string; berth: BerthAddressKind | null };

/**
 * What a typed payout address is. A valid one comes back EIP-55
 * checksummed for display. All lowercase or all uppercase hex carries no
 * checksum and is taken as it is; mixed case that does not check out is a
 * typo. The zero address is never a wallet. One of Berth's own addresses
 * is valid but warned about: funds sent there do not reach the campaign.
 */
export function judgePayoutAddress(value: string): PayoutAddressJudgement {
  const trimmed = value.trim();
  if (!trimmed) return { kind: "empty" };
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return { kind: "invalid" };
  const hex = trimmed.slice(2);
  const mixed = hex !== hex.toLowerCase() && hex !== hex.toUpperCase();
  let checksummed: string;
  try {
    checksummed = getAddress(trimmed.toLowerCase());
  } catch {
    return { kind: "invalid" };
  }
  if (mixed && checksummed !== trimmed) return { kind: "bad_checksum" };
  if (checksummed.toLowerCase() === ZERO_ADDRESS) return { kind: "zero" };
  return { kind: "ok", address: checksummed, berth: berthAddressKind(checksummed) };
}

/** Raw USDC units as dollars and cents, rounded down: 12345678 -> "$12.34". */
export function formatUsdcRaw(raw: bigint): string {
  const cents = raw / 10n ** BigInt(USDC_DECIMALS - 2);
  const dollars = cents / 100n;
  const rest = (cents % 100n).toString().padStart(2, "0");
  return `$${dollars.toLocaleString("en-US")}.${rest}`;
}

export type FundingCover = {
  /** Whole rewards the balance pays for at the campaign's amount. */
  rewards: number;
  /** What the budget still asks of the wallet: the budget less what is already paid, in dollars. */
  neededUsd: number;
  /** Whole rewards the remaining budget is for. */
  neededRewards: number;
  /** How far the balance falls short of the remaining budget, in raw units; 0 when it covers it. */
  shortRaw: bigint;
};

/**
 * The balance against the budget. Rewards paid already left the wallet,
 * so they count against the budget, not the balance. Pure.
 */
export function fundingCover({
  balanceRaw,
  amountUsd,
  budgetUsd,
  paidUsd = 0,
}: {
  balanceRaw: bigint;
  amountUsd: number;
  budgetUsd: number;
  paidUsd?: number;
}): FundingCover {
  const amountRaw = amountUsd > 0 ? usdcRaw(amountUsd) : 0n;
  const balance = balanceRaw > 0n ? balanceRaw : 0n;
  const neededRaw = budgetUsd > paidUsd ? usdcRaw(budgetUsd - paidUsd) : 0n;
  return {
    rewards: amountRaw > 0n ? Number(balance / amountRaw) : 0,
    neededUsd: Number(neededRaw) / 10 ** USDC_DECIMALS,
    neededRewards: amountRaw > 0n ? Number(neededRaw / amountRaw) : 0,
    shortRaw: neededRaw > balance ? neededRaw - balance : 0n,
  };
}
