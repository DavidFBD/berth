"use client";

import { useWallets } from "@privy-io/react-auth";
import { useXAccount } from "@sodax/wallet-sdk-react";

import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import { useEmbeddedHoldings } from "@/hooks/use-embedded-holdings";
import { shortenAddress } from "@/lib/format";

/**
 * Dev-only overlay: why the holdings list is showing what it is.
 *
 * Exists because "my wallet is empty" has several very different causes that
 * look identical on screen — no embedded wallet in `useWallets()`, `emailMode`
 * off, a dead Solana bridge, or per-chain balance reads failing closed. This
 * names which one it is. Never mounted in production.
 */
export function WalletDiagnostics() {
  const privy = usePrivyEmbeddedWallet();
  const { wallets } = useWallets();
  const solana = useXAccount({ xChainType: "SOLANA" });
  const holdings = useEmbeddedHoldings();

  const rows: Array<[string, string]> = [
    ["privy enabled", String(privy.enabled)],
    ["ready / auth", `${privy.ready} / ${privy.authenticated}`],
    [
      "useWallets()",
      wallets.length === 0
        ? "EMPTY"
        : wallets
            .map((w) => `${w.walletClientType}:${shortenAddress(w.address, 3)}`)
            .join(", "),
    ],
    [
      "embedded EVM",
      privy.embedded ? shortenAddress(privy.embedded.address, 4) : "MISSING",
    ],
    ["solana bridge", solana.address ? shortenAddress(solana.address, 4) : "MISSING"],
    ["emailMode", String(holdings.emailMode)],
    ["loading", String(holdings.isLoading)],
    ["holdings", String(holdings.holdings.length)],
    [
      "errored chains",
      holdings.erroredChains.length ? holdings.erroredChains.join(", ") : "none",
    ],
    ["total usd", holdings.totalUsd === undefined ? "undefined" : `$${holdings.totalUsd.toFixed(2)}`],
  ];

  return (
    // Bottom-RIGHT: Next.js pins its dev-tools button bottom-left and was
    // sitting on top of the panel.
    <div data-wallet-diagnostics className="pointer-events-none fixed right-2 bottom-2 z-9999 max-w-75 rounded-lg bg-black/85 p-2 font-mono text-[10px] leading-[1.45] text-lime-300 shadow-lg">
      <div className="mb-1 font-bold text-lime-200">wallet diagnostics (dev)</div>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-2">
          <span className="text-lime-500">{label}</span>
          <span className="text-right break-all">{value}</span>
        </div>
      ))}
    </div>
  );
}
