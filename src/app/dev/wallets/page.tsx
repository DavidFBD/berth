"use client";

import { notFound } from "next/navigation";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useXConnectorsByChain } from "@sodax/wallet-sdk-react";
import { WalletDrawer } from "@/components/wallet";
import { useInstalledWallets } from "@/hooks/use-installed-wallets";
import { useMounted } from "@/hooks/use-mounted";

/**
 * Dev-only connector dump: what the wallet SDK reports for this browser,
 * family by family, next to what the welcome screen would offer. Exists
 * because "installed" means different things per family (a probe of the
 * page for Bitcoin and Solana, a plain `true` for web wallets), and the only
 * way to see the difference is to look. Not linked anywhere; 404 in prod.
 * `?drawer=1` opens the wallet drawer for a look at its layout without
 * connecting anything.
 */
export default function WalletsInspectorPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8 text-sm">
      <h1 className="font-display text-xl text-foreground">Wallet connectors</h1>
      <Suspense fallback={null}>
        <Inspector />
      </Suspense>
    </div>
  );
}

function Inspector() {
  const mounted = useMounted();
  const byChain = useXConnectorsByChain();
  const offered = useInstalledWallets();
  const drawerOpen = useSearchParams().get("drawer") === "1";
  if (!mounted) return null;

  return (
    <>
      <WalletDrawer open={drawerOpen} onOpenChange={() => {}} />
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-2 text-[11.5px] font-bold tracking-(--tracking-caps) uppercase text-muted-foreground">
          Offered on the welcome screen
        </div>
        {offered.wallets.length === 0 ? (
          <p className="text-muted-foreground">none</p>
        ) : (
          <ul className="money flex flex-col gap-1 text-xs">
            {offered.wallets.map((wallet) => (
              <li key={wallet.name}>
                {wallet.name} · {wallet.connectors.map((c) => c.xChainType).join(", ")} · primary {wallet.primary.id}
              </li>
            ))}
          </ul>
        )}
      </section>
      {Object.entries(byChain).map(([family, connectors]) => (
        <section key={family} className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 text-[11.5px] font-bold tracking-(--tracking-caps) uppercase text-muted-foreground">
            {family} · {connectors?.length ?? 0}
          </div>
          <ul className="money flex flex-col gap-1 text-xs">
            {(connectors ?? []).map((connector) => (
              <li key={`${family}:${connector.id}`}>
                {connector.isInstalled ? "installed" : "absent   "} · {connector.id} · {connector.name}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
