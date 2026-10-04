/**
 * Read only: times every read the signed-in home waits on, the way the
 * browser makes them (viem's defaults, the app's pinned endpoints): each
 * swept network's balance sweep, the hub endpoints, the oracles, and the
 * production routes the home calls. Used for the fast home round
 * (2026-10-04) to find which read held the page.
 *
 *   pnpm home:reads                     # a burn address
 *   ADDR=0x… pnpm home:reads            # an account's own address
 *   POLYGON_RPC=https://… pnpm home:reads
 */
import { createPublicClient, http, erc20Abi, getAddress, isAddress } from "viem";
import { mainnet, arbitrum, base, optimism, polygon, bsc, avalanche, sonic, lightlinkPhoenix, kaia, redbellyMainnet } from "viem/chains";
import { ChainKeys, spokeChainConfig } from "@sodax/sdk";
import { getDepositTokens } from "@/lib/chains";

const ADDR = process.env.ADDR ?? "0x000000000000000000000000000000000000dEaD";
const hyper = { id: 999, name: "HyperEVM", nativeCurrency: { decimals: 18, name: "HYPE", symbol: "HYPE" }, rpcUrls: { default: { http: ["https://rpc.hyperliquid.xyz/evm"] } }, contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } } };
const CHAINS = [
  [ChainKeys.ETHEREUM_MAINNET, mainnet, "https://ethereum-rpc.publicnode.com"],
  [ChainKeys.ARBITRUM_MAINNET, arbitrum, "https://arb1.arbitrum.io/rpc"],
  [ChainKeys.BASE_MAINNET, base, "https://mainnet.base.org"],
  [ChainKeys.OPTIMISM_MAINNET, optimism, "https://mainnet.optimism.io"],
  [ChainKeys.POLYGON_MAINNET, polygon, process.env.POLYGON_RPC ?? "https://polygon.drpc.org"],
  [ChainKeys.BSC_MAINNET, bsc, "https://bsc-dataseed.bnbchain.org"],
  [ChainKeys.AVALANCHE_MAINNET, avalanche, "https://api.avax.network/ext/bc/C/rpc"],
  [ChainKeys.SONIC_MAINNET, sonic, "https://sonic-rpc.publicnode.com"],
  [ChainKeys.HYPEREVM_MAINNET, hyper, undefined],
  [ChainKeys.LIGHTLINK_MAINNET, lightlinkPhoenix, undefined],
  [ChainKeys.KAIA_MAINNET, kaia, undefined],
  [ChainKeys.REDBELLY_MAINNET, redbellyMainnet, undefined],
];
const fix = (a) => (!a.startsWith("0x") || isAddress(a) ? a : getAddress(a.toLowerCase()));
async function timeChain([key, chain, url]) {
  // viem's defaults, as wagmi's http() uses them: 10 s timeout, 3 retries.
  const client = createPublicClient({ chain, transport: http(url) });
  const tokens = getDepositTokens(key);
  const native = spokeChainConfig[key]?.nativeToken;
  const erc = tokens.filter((t) => t.address !== native);
  const t0 = performance.now();
  try {
    await Promise.all([
      client.getBalance({ address: ADDR }),
      erc.length && chain.contracts?.multicall3
        ? client.multicall({ contracts: erc.map((t) => ({ abi: erc20Abi, address: fix(t.address), functionName: "balanceOf", args: [ADDR] })) })
        : Promise.all(erc.map((t) => client.readContract({ abi: erc20Abi, address: fix(t.address), functionName: "balanceOf", args: [ADDR] }))),
    ]);
    return { chain: key, ms: Math.round(performance.now() - t0), tokens: tokens.length, ok: true };
  } catch (e) {
    return { chain: key, ms: Math.round(performance.now() - t0), tokens: tokens.length, ok: false, err: String(e.shortMessage ?? e.message).slice(0, 90) };
  }
}
async function timeFetch(name, url, init) {
  const t0 = performance.now();
  try { const r = await fetch(url, init); await r.arrayBuffer(); return { name, ms: Math.round(performance.now() - t0), status: r.status }; }
  catch (e) { return { name, ms: Math.round(performance.now() - t0), err: String(e.message).slice(0, 80) }; }
}
const t0 = performance.now();
const [chains, others] = await Promise.all([
  Promise.all(CHAINS.map(timeChain)),
  Promise.all([
    timeFetch("solana getBalance", "https://solana-rpc.publicnode.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: ["11111111111111111111111111111111"] }) }),
    timeFetch("solver oracle (direct)", "https://api.sodax.com/v1/intent/oracle"),
    timeFetch("prod /api/listing-prices", "https://www.berthmarkets.com/api/listing-prices"),
    timeFetch("prod /api/listing-performance", "https://www.berthmarkets.com/api/listing-performance"),
    timeFetch("prod /api/token-prices", "https://www.berthmarkets.com/api/token-prices"),
    timeFetch("prod /api/treasury-rate", "https://www.berthmarkets.com/api/treasury-rate"),
    ...["https://sonic-rpc.publicnode.com", "https://sonic.drpc.org", "https://rpc.soniclabs.com"].map((url) =>
      timeFetch(`hub ${new URL(url).host} getBalance`, url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [ADDR, "latest"] }) }),
    ),
    timeFetch("robinhood rpc blockNumber", "https://rpc.mainnet.chain.robinhood.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) }),
  ]),
]);
console.log(JSON.stringify({ wallClockMs: Math.round(performance.now() - t0), chains, others }, null, 1));
