import type { EvmChainKey } from "@sodax/sdk";
import {
  ENTRY_POINTS,
  USER_OPERATION_EVENT,
  markSponsorRefused,
  sponsoredSendOptions,
  type ChainProbe,
  type ReceiptLike,
  type withGasSponsor,
} from "@/lib/gas-sponsor";
import { InsufficientFundsForPaidSend, paidSendNeed, withinOrUnknown } from "@/lib/gas-need";

type SponsorOptions = Parameters<typeof withGasSponsor>[1];

type LogFilter = {
  address: `0x${string}`[];
  fromBlock: `0x${string}`;
  toBlock: `0x${string}`;
  topics: (`0x${string}` | null)[];
};

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
    /** For the chain check after an unclear answer (chainProbe); without them the hold keeps its minute. */
    getBlockNumber?: () => Promise<bigint>;
    getTransactionCount?: (args: { address: `0x${string}`; blockTag: "pending" }) => Promise<number>;
    request?: (args: { method: "eth_getLogs"; params: [LogFilter] }) => Promise<unknown>;
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
    chainProbe: walletChainProbe(client, address),
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

/**
 * The cheap chain check behind an unclear sponsored answer
 * (lib/gas-sponsor watchOutcome), progress only, never a reason to lift
 * the hold: the wallet's pending nonce, and any UserOperationEvent from
 * the canonical EntryPoints with the wallet as sender between the mark and
 * the node's head. Three calls per look.
 */
export function walletChainProbe(
  client: Parameters<typeof privySponsorOptions>[0]["client"],
  address: string,
): ChainProbe | undefined {
  const { getBlockNumber, getTransactionCount, request } = client;
  if (!getBlockNumber || !getTransactionCount || !request) return undefined;
  const sender = address as `0x${string}`;
  const senderTopic: `0x${string}` = `0x${"0".repeat(24)}${sender.slice(2).toLowerCase()}`;
  const nonce = () => getTransactionCount.call(client, { address: sender, blockTag: "pending" });
  return {
    mark: async () => {
      const [block, txCount] = await Promise.all([getBlockNumber.call(client), nonce()]);
      return { block, txCount };
    },
    moved: async (since) => {
      // The head first: a backend behind the mark would answer an empty
      // list for a range it has not reached, so that read proves nothing.
      const head = await getBlockNumber.call(client);
      if (head <= since.block) throw new Error("the node's head is not past the mark yet");
      const [txCount, logs] = await Promise.all([
        nonce(),
        request.call(client, {
          method: "eth_getLogs",
          params: [
            {
              address: [...ENTRY_POINTS] as `0x${string}`[],
              fromBlock: `0x${since.block.toString(16)}`,
              toBlock: `0x${head.toString(16)}`,
              topics: [USER_OPERATION_EVENT as `0x${string}`, null, senderTopic],
            },
          ],
        }),
      ]);
      if (!Array.isArray(logs)) throw new Error("eth_getLogs gave no list");
      return txCount !== since.txCount || logs.length > 0;
    },
  };
}
