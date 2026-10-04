"use client";

import { notFound } from "next/navigation";
import { ChainKeys, type SpokeChainKey } from "@sodax/sdk";
import { useCopy } from "@/components/settings-provider";
import { LimitSummary } from "@/components/flow/limit-price";
import { PayTokenRow } from "@/components/flow/pay-token-row";
import { TokenLogo } from "@/components/flow/token-picker";
import { DEPOSIT_SOURCE_CHAINS, getChainName } from "@/lib/chains";
import {
  GAS_SPONSOR_CHAIN_IDS,
  gasSponsored,
  joinNames,
  sponsoredChainNames,
} from "@/lib/gas-sponsor";

/**
 * Dev-only: how Berth says "no network fee" when Privy sponsors gas
 * (lib/gas-sponsor). Reads the real NEXT_PUBLIC_GAS_SPONSOR_CHAINS, so run
 * `NEXT_PUBLIC_GAS_SPONSOR_CHAINS=8453,42161,10,137,56 pnpm dev` to see it
 * on; with the list empty every line below disappears, as in the app.
 * Left column an email user (embedded wallet), right an external wallet,
 * which is never promised anything. Not linked anywhere; 404 in prod.
 */
export default function GasSponsorGallery() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Gallery />;
}

const ROWS: { chainKey: SpokeChainKey; symbol: string }[] = [
  { chainKey: ChainKeys.BASE_MAINNET, symbol: "USDC" },
  { chainKey: ChainKeys.ARBITRUM_MAINNET, symbol: "USDC" },
  { chainKey: ChainKeys.POLYGON_MAINNET, symbol: "POL" },
  { chainKey: ChainKeys.SONIC_MAINNET, symbol: "S" },
];

function Gallery() {
  const copy = useCopy();
  const names = sponsoredChainNames(DEPOSIT_SOURCE_CHAINS, getChainName);
  const listed = [...GAS_SPONSOR_CHAIN_IDS].join(", ") || "empty, sponsorship off";

  const column = (emailSession: boolean) => {
    const sponsored = (chainKey: SpokeChainKey) => gasSponsored(chainKey, emailSession);
    const base = ChainKeys.BASE_MAINNET;
    return (
      <section className="flex min-w-0 flex-1 flex-col gap-4">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {emailSession ? "Email (embedded wallet)" : "External wallet"}
        </h2>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="mb-2 text-xs text-muted-foreground">First buy step note</p>
          {emailSession && names.length > 0 ? (
            <p className="text-center text-xs text-muted-foreground">
              {copy.gasCoveredChains(joinNames(names, copy.listAnd))}
            </p>
          ) : (
            <p className="text-center text-xs text-muted-foreground/50">(nothing)</p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card p-1">
          <p className="px-2 pt-2 text-xs text-muted-foreground">What you hold</p>
          {ROWS.map(({ chainKey, symbol }) => (
            <PayTokenRow
              key={chainKey}
              logo={<TokenLogo symbol={symbol} chainKey={chainKey} />}
              title={symbol}
              subtitle={`on ${getChainName(chainKey)}`}
              note={sponsored(chainKey) ? copy.noNetworkFeeNote : undefined}
              gasHelpLabel={copy.gasHelpLabel}
              onSelect={() => {}}
            />
          ))}
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="mb-2 text-xs text-muted-foreground">Buy drawer footer, paying on Base</p>
          {sponsored(base) ? (
            <p className="text-center text-xs leading-relaxed text-muted-foreground">
              {copy.noNetworkFeeOn(getChainName(base))}
            </p>
          ) : (
            <p className="text-center text-xs text-muted-foreground/50">(nothing)</p>
          )}
        </div>
        <LimitSummary
          side="buy"
          name="NVIDIA"
          priceLabel="$180.00"
          putLabel="$50.00 (50 USDC)"
          getLabel="0.277 NVIDIA"
          feeLabel="0.2 USDC"
          noGasChain={sponsored(base) ? getChainName(base) : undefined}
          placeLabel={copy.limitPlace}
          onBack={() => {}}
          onPlace={() => {}}
        />
      </section>
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 text-sm">
      <div>
        <h1 className="font-display text-xl text-foreground">Gas sponsorship</h1>
        <p className="text-xs text-muted-foreground">NEXT_PUBLIC_GAS_SPONSOR_CHAINS: {listed}</p>
      </div>
      <div className="flex flex-col gap-6 sm:flex-row">
        {column(true)}
        {column(false)}
      </div>
    </div>
  );
}
