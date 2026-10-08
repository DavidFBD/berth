import {
  ChainKeys,
  isEvmChainKeyType,
  type EvmChainKey,
  type SpokeChainKey,
} from "@sodax/sdk";

/**
 * Whether the person can pay a network's fee, before they are let near a
 * signature. A real new user picked a pay token three times and each order
 * died in her wallet: tokens on HyperEVM, no HYPE. So a token whose chain
 * cannot pay its own fee is not offered as a way to pay (the picker greys
 * it), and the order machine checks again right before the wallet opens.
 *
 * What refuses is the larger of two needs (blockingNeed): the chain's own
 * live price (gasNeed), and what some wallets attach on top of it whatever
 * the chain suggests (WALLET_FEE_FLOOR, floorNeed). The floor used to only
 * warn; issues #23 and #27 were wallets that paid their own gas, held "a
 * little ETH" on Base, and were refused by the wallet at the very end. So
 * since 2026-10-08 a wallet that pays its own fee is stopped before the
 * flow starts, and told roughly how much to add (gasToAdd). A sponsored
 * order (Privy pays) is never gated by either.
 *
 * Pure: the fee per gas and balances come in as arguments, so a table of
 * inputs pins every branch (gas-need.test.ts). The hook that feeds it live
 * numbers is hooks/use-gas-gate.
 */

/**
 * The fee per gas some wallets attach REGARDLESS of what the chain suggests
 * (issue #23: Base suggested a 0.001 gwei tip, a MetaMask-like wallet signed
 * at 2 gwei; on Arbitrum some wallets attach 2 gwei, others 0.1). It sets
 * the Max button's least buffer (hooks/use-native-gas-buffer) and, through
 * blockingNeed, the least native balance an unsponsored order must find.
 */
export const DEFAULT_WALLET_FEE_FLOOR = 2_000_000_000n; // 2 gwei

export const WALLET_FEE_FLOOR: Partial<Record<EvmChainKey, bigint>> = {
  // Observed: 2 gwei priority on a 0.006 gwei base fee (issue #23).
  [ChainKeys.BASE_MAINNET]: DEFAULT_WALLET_FEE_FLOOR,
};

export function walletFeeFloor(chainKey: SpokeChainKey): bigint {
  return isEvmChainKeyType(chainKey)
    ? (WALLET_FEE_FLOOR[chainKey as EvmChainKey] ?? DEFAULT_WALLET_FEE_FLOOR)
    : DEFAULT_WALLET_FEE_FLOOR;
}

/**
 * The gas a wallet RESERVES for a deposit: the largest limit seen on recent
 * SODAX deposits to the Base asset manager (119k to 229k), rounded up. A
 * wallet needs limit x maxFee in hand, not the gas burned.
 */
export const GATE_DEPOSIT_GAS = 230_000n;

/**
 * The gas a wallet reserves for a sell (or a vault withdrawal): one message
 * from the signing chain. Issue #27's sell on Base carried a 61,401 gas
 * limit; rounded up with room. Only the floor uses it (floorNeed): the
 * chain-priced need keeps the deposit's larger limit.
 */
export const GATE_SELL_GAS = 100_000n;

/** Which transaction the person signs: a buy (a deposit) or a sell. */
export type GasOrder = "buy" | "sell";

/** An ERC-20 approve, measured at 46k to 56k; rounded up. Only when the read allowance needs one. */
export const GATE_APPROVE_GAS = 60_000n;

/** Room on the chain's own price between the read and the signature: 1.5x. */
const GATE_PRICE_SAFETY_NUM = 3n;
const GATE_PRICE_SAFETY_DEN = 2n;

/**
 * Slack on the native token's own order, so Max (computed from one price
 * read) is not refused by the gate a moment later on the next read: the
 * amount plus 97% of the need must fit.
 */
const NATIVE_SLACK_PCT = 97n;

/**
 * What one Solana order costs the fee payer: a signature or two at 5,000
 * lamports and a priority fee, and the payer must stay rent exempt (890,880
 * lamports for a plain account) or the runtime refuses the transaction.
 * The SDK's Solana deposit opens no token account, so no rent beyond that.
 */
export const SOLANA_GATE_LAMPORTS = 1_000_000n; // 0.001 SOL

/** A Sui order's gas budget, which wallets reserve in full: up to 0.02 SUI. */
export const SUI_GATE_MIST = 20_000_000n; // 0.02 SUI

/**
 * How a chain charges for an order the person signs there.
 * - `evm`: native gas, priced live from the chain.
 * - `fixed`: native gas, a known amount in native units (Solana, Sui).
 * - `free`: never gated. Bitcoin pays its fee out of the BTC being sent.
 *   Stellar, NEAR, Injective, ICON and Stacks charge fees far below any
 *   balance worth holding (0.00001 XLM against a locked reserve, 0.001
 *   ICX), and their wallets say so themselves; a guess here would refuse
 *   more working orders than it saves.
 *
 * Sonic is `evm`: a Sonic order is the person's own transaction on Sonic and
 * pays in S. Nothing in @sodax/sdk 2.0.0 sponsors a spoke or hub transaction
 * (no paymaster, no relayer-paid send); the relayer pays only the delivery
 * leg after the person's transaction lands. The person never signs on Sonic
 * to sell, cancel or cash out (those are messages from the home chain);
 * only paying FROM Sonic is a Sonic transaction.
 *
 * `sponsored`: Privy pays this order's fee (lib/gas-sponsor gasSponsored: a
 * chain on NEXT_PUBLIC_GAS_SPONSOR_CHAINS, signed by the embedded wallet),
 * so the chain charges the person nothing and is never gated.
 */
export type GasModel =
  | { kind: "evm" }
  | { kind: "fixed"; units: bigint }
  | { kind: "free" };

export function gasModel(chainKey: SpokeChainKey, sponsored = false): GasModel {
  if (sponsored) return { kind: "free" };
  if (isEvmChainKeyType(chainKey)) return { kind: "evm" };
  if (chainKey === ChainKeys.SOLANA_MAINNET) return { kind: "fixed", units: SOLANA_GATE_LAMPORTS };
  if (chainKey === ChainKeys.SUI_MAINNET) return { kind: "fixed", units: SUI_GATE_MIST };
  return { kind: "free" };
}

function evmGas(approval: boolean): bigint {
  return GATE_DEPOSIT_GAS + (approval ? GATE_APPROVE_GAS : 0n);
}

/**
 * The native balance an order on `chainKey` must find to pay its fee at the
 * chain's own price, in native units; `undefined` when it cannot be priced
 * (the EVM fee per gas is still loading or its read failed). `approval`
 * adds an ERC-20 approve, only when the read allowance needs one.
 */
export function gasNeed({
  chainKey,
  feePerGas,
  approval,
  sponsored = false,
}: {
  chainKey: SpokeChainKey;
  feePerGas: bigint | undefined;
  approval: boolean;
  sponsored?: boolean;
}): bigint | undefined {
  const model = gasModel(chainKey, sponsored);
  switch (model.kind) {
    case "free":
      return 0n;
    case "fixed":
      return model.units;
    case "evm":
      if (feePerGas === undefined) return undefined;
      return (feePerGas * evmGas(approval) * GATE_PRICE_SAFETY_NUM) / GATE_PRICE_SAFETY_DEN;
  }
}

/**
 * What a wallet that attaches the floor (WALLET_FEE_FLOOR) would reserve
 * for the same order; `undefined` off EVM and when Privy pays.
 */
export function floorNeed(
  chainKey: SpokeChainKey,
  approval: boolean,
  sponsored = false,
  order: GasOrder = "buy",
): bigint | undefined {
  if (gasModel(chainKey, sponsored).kind !== "evm") return undefined;
  return walletFeeFloor(chainKey) * (order === "sell" ? GATE_SELL_GAS + (approval ? GATE_APPROVE_GAS : 0n) : evmGas(approval));
}

/**
 * The native balance that refuses an order: the larger of the chain's own
 * price (gasNeed) and the wallet floor (floorNeed). The floor needs no live
 * read, so while the fee per gas is loading the floor alone stands in for
 * it, and the pre-sign check reads the fee afresh. Off EVM and when Privy
 * pays, the chain's need unchanged.
 */
export function blockingNeed({
  chainKey,
  need,
  approval,
  sponsored = false,
  order = "buy",
}: {
  chainKey: SpokeChainKey;
  need: bigint | undefined;
  approval: boolean;
  sponsored?: boolean;
  order?: GasOrder;
}): bigint | undefined {
  const floor = floorNeed(chainKey, approval, sponsored, order);
  if (floor === undefined) return need;
  return need !== undefined && need > floor ? need : floor;
}

/**
 * - `ok`: the chain can pay for this order.
 * - `short`: it cannot; the token is shown but not offered.
 * - `unknown`: a balance is still loading or its read failed. Shown and
 *   offered as normal, and the pre-sign check has the last word.
 */
export type GasStatus = "ok" | "short" | "unknown";

/**
 * A native balance the gate can trust. Off EVM a 0 is not one: the SDK's
 * Solana and Sui reads swallow errors (a 429) and answer 0, and the SOL
 * read can fail while the USDC read beside it succeeds. So a 0 there is
 * unknown, everywhere the gate reads it. On EVM a failed read throws, and
 * a 0 is a 0.
 */
export function trustedNativeBalance(
  chainKey: SpokeChainKey,
  nativeBalance: bigint | undefined,
): bigint | undefined {
  if (nativeBalance === 0n && !isEvmChainKeyType(chainKey)) return undefined;
  return nativeBalance;
}

/**
 * Whether `token` on `chainKey` can pay for an order, given the chain's
 * native balance. The native token pays its own fee, so it needs more than
 * the fee (an order of nothing is no order); any other token needs the fee
 * in native beside it. A zero EVM balance is short even before the fee is
 * priced: any fee is more than nothing.
 */
export function payTokenGas({
  chainKey,
  isNative,
  nativeBalance: raw,
  need,
  sponsored = false,
}: {
  chainKey: SpokeChainKey;
  isNative: boolean;
  nativeBalance: bigint | undefined;
  need: bigint | undefined;
  sponsored?: boolean;
}): GasStatus {
  if (gasModel(chainKey, sponsored).kind === "free") return "ok";
  const nativeBalance = trustedNativeBalance(chainKey, raw);
  if (nativeBalance === undefined) return "unknown";
  if (need === undefined) return nativeBalance === 0n ? "short" : "unknown";
  if (isNative) return nativeBalance > need ? "ok" : "short";
  return nativeBalance >= need ? "ok" : "short";
}

/**
 * Whether an order of `amount` leaves too little native for its fee at the
 * chain's own price: the drawer's gate and the last check before the
 * wallet opens. For the native token the amount comes out of the same
 * balance, with a little slack (NATIVE_SLACK_PCT) so Max is never refused.
 */
export function orderGasShort({
  chainKey,
  isNative,
  nativeBalance: raw,
  amount,
  need,
  sponsored = false,
}: {
  chainKey: SpokeChainKey;
  isNative: boolean;
  nativeBalance: bigint | undefined;
  amount: bigint;
  need: bigint | undefined;
  sponsored?: boolean;
}): boolean {
  if (gasModel(chainKey, sponsored).kind === "free") return false;
  const nativeBalance = trustedNativeBalance(chainKey, raw);
  if (nativeBalance === undefined) return false;
  if (need === undefined) return nativeBalance === 0n;
  if (!isNative) return nativeBalance < need;
  return nativeBalance < amount + (need * NATIVE_SLACK_PCT) / 100n;
}

/** Rounds up to two significant digits: 0.000337 becomes 0.00034. */
function roundUpTwoDigits(value: bigint): bigint {
  const digits = value.toString().length;
  if (digits <= 2) return value;
  const step = 10n ** BigInt(digits - 2);
  return ((value + step - 1n) / step) * step;
}

/**
 * Roughly how much native to add so the order can pay its fee, in native
 * units, rounded up to two significant digits: the number the top-up
 * guidance names. `undefined` when nothing is missing or it cannot be told.
 * Pass the blocking need (blockingNeed).
 */
export function gasToAdd({
  chainKey,
  isNative,
  nativeBalance: raw,
  amount,
  need,
  sponsored = false,
}: {
  chainKey: SpokeChainKey;
  isNative: boolean;
  nativeBalance: bigint | undefined;
  amount: bigint;
  need: bigint | undefined;
  sponsored?: boolean;
}): bigint | undefined {
  if (gasModel(chainKey, sponsored).kind === "free") return undefined;
  const nativeBalance = trustedNativeBalance(chainKey, raw);
  if (nativeBalance === undefined || need === undefined) return undefined;
  const required = (isNative ? amount : 0n) + need;
  return required > nativeBalance ? roundUpTwoDigits(required - nativeBalance) : undefined;
}

/** Sort key: what can pay first, what cannot last, order kept otherwise. */
export function byGasStatus<T>(rows: readonly T[], statusOf: (row: T) => GasStatus): T[] {
  return rows
    .map((row, index) => ({ row, index, short: statusOf(row) === "short" }))
    .sort((a, b) => (a.short === b.short ? a.index - b.index : a.short ? 1 : -1))
    .map(({ row }) => row);
}

/** How long the pre-sign check waits on a read before it counts as unknown. */
export const PREFLIGHT_TIMEOUT_MS = 5_000;

/** A read, or `undefined` once it fails or outlasts `ms`. */
export async function withinOrUnknown<T>(read: Promise<T>, ms = PREFLIGHT_TIMEOUT_MS): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([read.catch(() => undefined), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
