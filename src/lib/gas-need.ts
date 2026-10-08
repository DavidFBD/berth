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
 * live price (gasNeed), and what a wallet reserves, twice the base fee plus
 * the tip some wallets attach whatever the chain suggests (WALLET_FEE_FLOOR,
 * walletReserve). The floor used to only
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
 * The fee per gas some wallets attach REGARDLESS of what the chain suggests,
 * per chain. It sets the Max button's least buffer
 * (hooks/use-native-gas-buffer) and, through blockingNeed, the least native
 * balance an unsponsored order must find, so a value too high refuses
 * wallets that could pay. Each is the max priority fee common wallets
 * (MetaMask, Rabby, Coinbase Wallet) are seen or known to attach there,
 * rounded up, never the worst outlier:
 *
 * - Base: 2 gwei. Observed twice on our own orders: issue #23 (a deposit
 *   signed at 2 gwei against a 0.001 gwei suggestion) and issue #27 (a
 *   sell reserving 61,401 gas at about 2 gwei). Evidence beats the chain's
 *   own suggestion here.
 * - Optimism: 0.1 gwei. The same OP stack as Base but no order of ours has
 *   shown 2 gwei there; wallets follow eth_maxPriorityFeePerGas, which
 *   answers about 0.001 gwei. 0.1 is a hundredfold margin over that.
 * - Arbitrum and Robinhood Chain (an Arbitrum Orbit chain): 0.1 gwei.
 *   ArbOS ignores the tip, wallets reserve against a 0.01 gwei base fee,
 *   and 0.1 is the larger of the two values seen there (the other was 2
 *   gwei from one wallet, which the insufficient-funds read-out catches).
 * - BSC: 0.1 gwei, the validators' minimum gas price since 2025 and what
 *   wallets sign at by default.
 * - HyperEVM: 0.1 gwei. Base fee of a fraction of a gwei, wallets attach
 *   little or nothing on top.
 * - Avalanche: 1 gwei. Base fee near zero since ACP-176; wallets attach a
 *   tip of up to about 1 gwei.
 * - Ethereum: 2 gwei, MetaMask's market tip, but unused by walletReserve:
 *   wallets there take the chain's suggested tip, which the fee read
 *   already carries (TIP_IN_FEE).
 * - Polygon: 30 gwei, the network's enforced minimum tip.
 * - Sonic: 1 gwei; its own price (tens of gwei) governs in practice.
 * - Any other EVM chain: 2 gwei (DEFAULT_WALLET_FEE_FLOOR), the cautious
 *   value until one is measured, since a new L2 can repeat issue #23.
 */
export const DEFAULT_WALLET_FEE_FLOOR = 2_000_000_000n; // 2 gwei

const GWEI = 1_000_000_000n;

export const WALLET_FEE_FLOOR: Partial<Record<EvmChainKey, bigint>> = {
  [ChainKeys.BASE_MAINNET]: 2n * GWEI,
  [ChainKeys.OPTIMISM_MAINNET]: GWEI / 10n,
  [ChainKeys.ARBITRUM_MAINNET]: GWEI / 10n,
  [ChainKeys.ROBINHOOD_MAINNET]: GWEI / 10n,
  [ChainKeys.BSC_MAINNET]: GWEI / 10n,
  [ChainKeys.HYPEREVM_MAINNET]: GWEI / 10n,
  [ChainKeys.AVALANCHE_MAINNET]: GWEI,
  [ChainKeys.ETHEREUM_MAINNET]: 2n * GWEI,
  [ChainKeys.POLYGON_MAINNET]: 30n * GWEI,
  [ChainKeys.SONIC_MAINNET]: GWEI,
};

export function walletFeeFloor(chainKey: SpokeChainKey): bigint {
  return isEvmChainKeyType(chainKey)
    ? (WALLET_FEE_FLOOR[chainKey as EvmChainKey] ?? DEFAULT_WALLET_FEE_FLOOR)
    : DEFAULT_WALLET_FEE_FLOOR;
}

/**
 * The fee per gas assumed when the live read fails or is still loading: a
 * busy-day maxFee for the chain (roughly twice its usual base fee), so a
 * failed read neither waves through a wallet that cannot pay nor refuses
 * one that plainly can. Unlisted EVM chains assume 1 gwei.
 */
const ASSUMED_FEE_PER_GAS: Partial<Record<EvmChainKey, bigint>> = {
  [ChainKeys.BASE_MAINNET]: GWEI / 50n, // 0.02 gwei
  [ChainKeys.OPTIMISM_MAINNET]: GWEI / 50n,
  [ChainKeys.ARBITRUM_MAINNET]: GWEI / 20n, // 0.05 gwei
  [ChainKeys.ROBINHOOD_MAINNET]: GWEI / 20n,
  [ChainKeys.BSC_MAINNET]: GWEI / 10n,
  [ChainKeys.HYPEREVM_MAINNET]: GWEI,
  [ChainKeys.AVALANCHE_MAINNET]: 2n * GWEI,
  [ChainKeys.ETHEREUM_MAINNET]: 3n * GWEI,
  [ChainKeys.POLYGON_MAINNET]: 100n * GWEI,
  [ChainKeys.SONIC_MAINNET]: 100n * GWEI,
};

/**
 * Chains whose wallets sign at the chain's own suggested tip (MetaMask's
 * market fee on Ethereum), so the fee per gas read (base x 1.2 plus that
 * tip) already holds the tip: walletReserve does not add it twice.
 */
const TIP_IN_FEE: ReadonlySet<SpokeChainKey> = new Set([ChainKeys.ETHEREUM_MAINNET]);

export function assumedFeePerGas(chainKey: SpokeChainKey): bigint {
  return ASSUMED_FEE_PER_GAS[chainKey as EvmChainKey] ?? GWEI;
}

/**
 * The gas a wallet RESERVES for a deposit: the largest limit seen on recent
 * SODAX deposits to the Base asset manager (119k to 229k), with about 9%
 * room. A wallet needs limit x maxFee in hand, not the gas burned.
 */
export const GATE_DEPOSIT_GAS = 250_000n;

/**
 * The gas a wallet reserves for a sell (or a vault withdrawal): one message
 * from the signing chain. Issue #27's sell on Base carried a 61,401 gas
 * limit; 70,000 leaves 14% room. Only the wallet reserve uses it
 * (walletReserve): the chain-priced need keeps the deposit's larger limit,
 * since a hub-side sell has no measured limit of its own.
 */
export const GATE_SELL_GAS = 70_000n;

/** Which transaction the person signs: a buy (a deposit) or a sell. */
export type GasOrder = "buy" | "sell";

/** An ERC-20 approve, measured at 46k to 56k; rounded up. Only when the read allowance needs one. */
export const GATE_APPROVE_GAS = 60_000n;

/** Room on the chain's own price between the read and the signature: 1.5x. */
const GATE_PRICE_SAFETY_NUM = 3n;
const GATE_PRICE_SAFETY_DEN = 2n;

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
 * What a wallet reserves for an order before it will sign: the gas limit
 * times its maxFeePerGas, which wallets set to about twice the base fee
 * plus the tip they attach (`tip`, WALLET_FEE_FLOOR by default). The base
 * fee is bounded by the chain's own maxFee read (`feePerGas`, at least the
 * base fee), so 2 x feePerGas covers the doubled base fee with room; with
 * no read, the chain's assumed busy-day fee stands in. `undefined` off EVM
 * and when Privy pays.
 *
 * Issue #23 on these numbers: 229k gas at a 0.006 gwei base fee and a
 * 2 gwei tip, the wallet reserved 0.000460748 ETH; this asks 250k x
 * (2 x 0.006 + 2) gwei = 0.000503 ETH.
 */
export function walletReserve({
  chainKey,
  feePerGas,
  approval,
  sponsored = false,
  order = "buy",
  tip = walletFeeFloor(chainKey),
}: {
  chainKey: SpokeChainKey;
  feePerGas: bigint | undefined;
  approval: boolean;
  sponsored?: boolean;
  order?: GasOrder;
  tip?: bigint;
}): bigint | undefined {
  if (gasModel(chainKey, sponsored).kind !== "evm") return undefined;
  const gas = (order === "sell" ? GATE_SELL_GAS : GATE_DEPOSIT_GAS) + (approval ? GATE_APPROVE_GAS : 0n);
  const fee = feePerGas ?? assumedFeePerGas(chainKey);
  // Where wallets take the chain's own suggested tip, the fee read already
  // carries it: twice the fee covers twice the base plus the tip, and adding
  // the tip again would refuse wallets that can pay.
  if (TIP_IN_FEE.has(chainKey)) return gas * 2n * fee;
  return gas * (2n * fee + tip);
}

/**
 * What a wallet that attaches the old 2 gwei tip (DEFAULT_WALLET_FEE_FLOOR)
 * would reserve, on a chain whose floor is lower: the top of the band in
 * which an order clears the gate but some wallets may still refuse it.
 * `undefined` where the floor is already 2 gwei or more, off EVM and when
 * Privy pays.
 *
 * Why warn and not block there: on Arbitrum, Optimism, BSC, HyperEVM and
 * Robinhood Chain most wallets attach about 0.1 gwei, and one has been
 * seen attaching 2 gwei. Blocking at 2 gwei would refuse the many to save
 * the few (the per-chain floor was lowered for exactly that); saying
 * nothing would leave the few to be refused in the wallet. A calm line
 * under the button lets the person sign and tells them what to do if
 * their wallet refuses.
 */
export function warnReserve(args: {
  chainKey: SpokeChainKey;
  feePerGas: bigint | undefined;
  approval: boolean;
  sponsored?: boolean;
  order?: GasOrder;
}): bigint | undefined {
  if (walletFeeFloor(args.chainKey) >= DEFAULT_WALLET_FEE_FLOOR) return undefined;
  return walletReserve({ ...args, tip: DEFAULT_WALLET_FEE_FLOOR });
}

/**
 * The native balance that refuses an order: the larger of the chain's own
 * price (gasNeed) and what a wallet reserves (walletReserve). The wallet
 * reserve needs no live read to be told, so while the fee per gas is
 * loading or its read failed the assumed fee stands in, and the pre-sign
 * check reads it afresh. Off EVM and when Privy pays, the chain's need.
 */
export function blockingNeed({
  chainKey,
  feePerGas,
  approval,
  sponsored = false,
  order = "buy",
}: {
  chainKey: SpokeChainKey;
  feePerGas: bigint | undefined;
  approval: boolean;
  sponsored?: boolean;
  order?: GasOrder;
}): bigint | undefined {
  const need = gasNeed({ chainKey, feePerGas, approval, sponsored });
  const reserve = walletReserve({ chainKey, feePerGas, approval, sponsored, order });
  if (reserve === undefined) return need;
  return need !== undefined && need > reserve ? need : reserve;
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
 * balance.
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
  // No slack: the whole need, wallet reserve included, must fit beside the
  // amount, since a wallet refuses anything less. Max (computed from one
  // price read) stays clear because it holds back the reserve at three
  // times the fee (hooks/use-native-gas-buffer), not because the gate bends.
  return nativeBalance < amount + need;
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

/**
 * Whether the order clears the gate (orderGasShort) but not what a wallet
 * attaching 2 gwei would reserve (warnReserve): the person may sign, and is
 * told calmly that some wallets ask for more. Never on a refused order,
 * never with an unknown balance, never when Privy pays.
 */
export function floorWarns({
  chainKey,
  isNative,
  nativeBalance: raw,
  amount,
  need,
  warnNeed,
  sponsored = false,
}: {
  chainKey: SpokeChainKey;
  isNative: boolean;
  nativeBalance: bigint | undefined;
  amount: bigint;
  need: bigint | undefined;
  warnNeed: bigint | undefined;
  sponsored?: boolean;
}): boolean {
  if (warnNeed === undefined || gasModel(chainKey, sponsored).kind === "free") return false;
  const nativeBalance = trustedNativeBalance(chainKey, raw);
  if (nativeBalance === undefined) return false;
  if (orderGasShort({ chainKey, isNative, nativeBalance, amount, need, sponsored })) return false;
  return nativeBalance < (isNative ? amount : 0n) + warnNeed;
}

/**
 * What a paid send needs in hand: its own gas limit times its own max fee
 * plus the value, exactly what the node checks, when the transaction
 * carries them. Whatever it lacks is filled the way the gate fills it: the
 * deposit's gas limit (GATE_DEPOSIT_GAS; the provider cannot tell a buy
 * from a sell, so the larger), and twice the fee per gas plus the chain's
 * wallet tip (walletReserve's rule), with the assumed fee when unread. This
 * is the embedded wallet's paid fallback after Privy declines to sponsor.
 */
export function paidSendNeed({
  chainKey,
  gas,
  maxFeePerGas,
  feePerGas,
  value = 0n,
}: {
  chainKey: SpokeChainKey;
  gas: bigint | undefined;
  maxFeePerGas: bigint | undefined;
  feePerGas: bigint | undefined;
  value?: bigint;
}): bigint {
  const limit = gas ?? GATE_DEPOSIT_GAS;
  const fee = feePerGas ?? assumedFeePerGas(chainKey);
  const perGas = maxFeePerGas ?? (TIP_IN_FEE.has(chainKey) ? 2n * fee : 2n * fee + walletFeeFloor(chainKey));
  return limit * perGas + value;
}

/**
 * The node's own insufficient-funds line, with its numbers, so the paid
 * fallback stopped before sending reads exactly like one the node refused
 * (lib/error-copy insufficientGasError: "add about X").
 */
export class InsufficientFundsForPaidSend extends Error {
  constructor(have: bigint, want: bigint) {
    super(`insufficient funds for gas * price + value: have ${have} want ${want}`);
    this.name = "InsufficientFundsForPaidSend";
  }
}

/**
 * Whether an order paid in the gas token itself is short only because of
 * the amount typed: the balance alone covers the fee, so lowering the
 * amount (or Max) is the fix, not adding more.
 */
export function amountLeavesNoFee({
  isNative,
  nativeBalance,
  need,
}: {
  isNative: boolean;
  nativeBalance: bigint | undefined;
  need: bigint | undefined;
}): boolean {
  return isNative && nativeBalance !== undefined && need !== undefined && nativeBalance >= need;
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
