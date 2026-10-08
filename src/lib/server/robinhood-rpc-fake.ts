import { decodeFunctionData, encodeFunctionResult, erc20Abi, multicall3Abi, parseUnits, type Hex } from "viem";
import { ROBINHOOD_CHAIN_ADDRESS_BY_SYMBOL } from "@/lib/market-ids";
import { MULTIPLIER_ONE, type MultiplierChange } from "@/lib/token-multiplier";

/**
 * A stand-in for Robinhood Chain's RPC in tests (lib/server/token-
 * multipliers, lib/server/robinhood-balances): answers the batched
 * `eth_blockNumber`, `uiMultiplier()`, `eth_getBlockByNumber` and
 * `eth_getLogs` calls from a table of multipliers, one block a second from
 * `genesisSeconds`, and a Multicall3 `aggregate3` of balanceOf reads from
 * `balances` (owner, lowercased, to symbol to whole tokens; a symbol in
 * `failing` answers as a failed call). Every request counts into
 * `requests`; the first `throttle` requests answer 429. Anything not an RPC
 * request goes to `otherwise`.
 */
export function robinhoodRpcFake({
  multipliers = {},
  changes = {},
  latestBlock = 25_000_000,
  genesisSeconds = 1_765_000_000,
  balances = {},
  failing = [],
  throttle = 0,
  requests = { count: 0, calls: 0 },
  otherwise,
}: {
  balances?: Record<string, Record<string, number>>;
  failing?: string[];
  throttle?: number;
  requests?: { count: number; calls: number };
  multipliers?: Record<string, number>;
  changes?: Record<string, MultiplierChange[]>;
  latestBlock?: number;
  genesisSeconds?: number;
  otherwise?: (url: string, init?: RequestInit) => Promise<Response>;
} = {}) {
  const bySymbolAddress = new Map(
    Object.entries(ROBINHOOD_CHAIN_ADDRESS_BY_SYMBOL).map(([symbol, address]) => [address.toLowerCase(), symbol]),
  );
  const word = (value: bigint) => value.toString(16).padStart(64, "0");
  const fixed = (value: number) => BigInt(Math.round(value * 1e9)) * (MULTIPLIER_ONE / 1_000_000_000n);
  return async (url: string | URL, init?: RequestInit): Promise<Response> => {
    if (!String(url).includes("rpc.mainnet.chain.robinhood.com")) {
      if (otherwise) return otherwise(String(url), init);
      return new Response("not found", { status: 404 });
    }
    requests.count += 1;
    if (requests.count <= throttle) return new Response("too many requests", { status: 429 });
    type Param = { to?: string; address?: string; fromBlock?: string; toBlock?: string; data?: string };
    const calls = JSON.parse(String(init?.body)) as { id: number; method: string; params: [Param | string, ...unknown[]] }[];
    requests.calls += calls.length;
    const answers = calls.map((call) => {
      if (call.method === "eth_blockNumber") return { id: call.id, result: `0x${latestBlock.toString(16)}` };
      if (call.method === "eth_getBlockByNumber") {
        const number = Number.parseInt(String(call.params[0]), 16);
        return { id: call.id, result: { timestamp: `0x${(genesisSeconds + number).toString(16)}` } };
      }
      const param = (typeof call.params[0] === "object" ? call.params[0] : {}) as Param;
      if (call.method === "eth_call" && String(param.to).toLowerCase() === "0xca11bde05977b3631167028862be2a173976ca11") {
        const { args } = decodeFunctionData({ abi: multicall3Abi, data: param.data as Hex });
        const inner = (args[0] as readonly { target: string; callData: Hex }[]).map(({ target, callData }) => {
          const symbol = bySymbolAddress.get(target.toLowerCase()) ?? "";
          if (failing.includes(symbol)) return { success: false, returnData: "0x" as Hex };
          const decoded = decodeFunctionData({ abi: erc20Abi, data: callData });
          const owner = String(decoded.args?.[0]).toLowerCase();
          const amount = parseUnits(String(balances[owner]?.[symbol] ?? 0), 18);
          return { success: true, returnData: `0x${word(amount)}` as Hex };
        });
        return { id: call.id, result: encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: inner }) };
      }
      const symbol = bySymbolAddress.get(String(param.to ?? param.address).toLowerCase()) ?? "";
      if (call.method === "eth_call") return { id: call.id, result: `0x${word(fixed(multipliers[symbol] ?? 1))}` };
      if (call.method === "eth_getLogs") {
        const from = Number.parseInt(String(param.fromBlock), 16);
        const to = Number.parseInt(String(param.toBlock), 16);
        const logs = (changes[symbol] ?? [])
          .filter((change) => {
            const block = change.effectiveAt - genesisSeconds;
            return block >= from && block <= to;
          })
          .map((change) => ({ data: `0x${word(fixed(change.from))}${word(fixed(change.to))}${word(BigInt(change.effectiveAt))}` }));
        return { id: call.id, result: logs };
      }
      return { id: call.id, error: { message: "unknown method" } };
    });
    return new Response(JSON.stringify(answers));
  };
}
