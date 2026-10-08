import type { EvmChainKey } from "@sodax/sdk";
import {
  markSponsorRefused,
  sponsoredSendOptions,
  type ReceiptLike,
  type withGasSponsor,
} from "@/lib/gas-sponsor";
import { InsufficientFundsForPaidSend, paidSendNeed, withinOrUnknown } from "@/lib/gas-need";

type SponsorOptions = Parameters<typeof withGasSponsor>[1];

/**
 * How the Privy embedded wallet hands its sends to withGasSponsor
 * (hooks/use-privy-evm-wallet): the sponsored send itself, the receipt
 * read, the token refresh after a lapsed session, the gas check before a
 * paid fallback, and what a fallback does to the session's sponsorship.
 * Pure of React, so the wiring is tested on its own.
 */
export function privySponsorOptions({
  chainId,
  chainKey,
  address,
  client,
  readFeePerGas,
  send,
  getAccessToken,
  markRefused = markSponsorRefused,
  active,
}: {
  chainId: number;
  chainKey: EvmChainKey;
  /** The embedded wallet's address. */
  address: string;
  /** The pinned public client for `chainKey`. */
  client: {
    getBalance: (args: { address: `0x${string}` }) => Promise<bigint>;
    waitForTransactionReceipt: (args: { hash: `0x${string}`; timeout: number }) => Promise<ReceiptLike>;
  };
  /** The chain's fee per gas now, for a paid send that carries none. */
  readFeePerGas: (chainKey: EvmChainKey) => Promise<bigint>;
  /** Privy's useSendTransaction().sendTransaction, as it is now. */
  send: (
    tx: Parameters<SponsorOptions["sendSponsored"]>[0],
    options: ReturnType<typeof sponsoredSendOptions>,
  ) => Promise<{ hash: string }>;
  /** Privy's getAccessToken, as it is now: refreshes a stale token. */
  getAccessToken: () => Promise<string | null>;
  /** Drops the chain's sponsorship for the session; lib/gas-sponsor's by default. */
  markRefused?: (chainId: number) => void;
  active: () => boolean;
}): SponsorOptions {
  return {
    chainId,
    address,
    active,
    // The bundle's own success flag for our call (lib/gas-sponsor
    // sponsoredCallSucceeded). Short: Privy answers after inclusion.
    readReceipt: (hash) =>
      client.waitForTransactionReceipt({ hash, timeout: 30_000 }).catch((error: unknown) => {
        console.warn(`[privy-wallet] could not read the sponsored receipt ${hash}; trusting the hash`, error);
        return undefined;
      }),
    sendSponsored: (tx) => send(tx, sponsoredSendOptions(address)),
    beforePaidSend: async (tx) => {
      const hex = (value: string | undefined) => (value ? BigInt(value) : undefined);
      const [balance, feePerGas] = await Promise.all([
        withinOrUnknown(client.getBalance({ address: address as `0x${string}` })),
        hex(tx.maxFeePerGas ?? tx.gasPrice) === undefined
          ? withinOrUnknown(readFeePerGas(chainKey))
          : Promise.resolve(undefined),
      ]);
      const want = paidSendNeed({
        chainKey,
        gas: hex(tx.gas),
        maxFeePerGas: hex(tx.maxFeePerGas ?? tx.gasPrice),
        feePerGas,
        value: hex(tx.value),
      });
      // Unknown never stops a send: the node has the last word.
      if (balance !== undefined && balance < want) {
        throw new InsufficientFundsForPaidSend(balance, want);
      }
    },
    // A lapsed session or expired request (classifySponsorError "auth"):
    // a fresh token, then the sponsored send once more.
    refreshAuth: async () => Boolean(await getAccessToken()),
    onFallback: (error, kind) => {
      // Two 429s in a row pay this once but keep the chain sponsored.
      if (kind === "refused") markRefused(chainId);
      console.warn(
        `[privy-wallet] gas sponsorship ${kind} on ${chainKey}; sending the ordinary way, paid by the wallet`,
        error,
      );
    },
  };
}
