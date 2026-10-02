"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMounted } from "@/hooks/use-mounted";
import {
  useConnectedChains,
  useXAccount,
  useXAccounts,
  useXConnect,
  useXConnectorsByChain,
  useXDisconnect,
  type IXConnector,
} from "@sodax/wallet-sdk-react";
import {
  anchorWalletSession,
  rememberWallet,
  revokeWalletSessions,
  subscribeWalletSessions,
  walletRecord,
  walletSessionsVersion,
} from "@/hooks/use-wallet-session";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import { PRIVY_ENABLED } from "@/components/privy-provider";
import { WalletDrawer } from "@/components/wallet/wallet-drawer";
import {
  RESTORE_GRACE_MS,
  reconnectCandidates,
  rememberedFor,
  restorableAnchor,
  restorePhase,
  type RestorePhase,
} from "@/lib/wallet-restore";

/**
 * The browser half of lib/wallet-restore: a refresh keeps a wallet sign in.
 * `<WalletRestore />` (mounted once, in components/providers) quietly
 * reconnects the extension the person signed in with, as it announces
 * itself; the hooks below let the gate and the account's readers see the
 * pocketed session's address while the extension is away.
 */

// One restore per page load: whether the quiet attempts are over.
let settled = false;
const listeners = new Set<() => void>();
function setSettled(value: boolean) {
  if (settled === value) return;
  settled = value;
  for (const listener of listeners) listener();
}
function subscribeSettled(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The wallet drawer a wake opens when the wallet cannot be asked directly.
let drawerOpen = false;
const drawerListeners = new Set<() => void>();
function setDrawerOpen(open: boolean) {
  drawerOpen = open;
  for (const listener of drawerListeners) listener();
}
function subscribeDrawer(listener: () => void) {
  drawerListeners.add(listener);
  return () => drawerListeners.delete(listener);
}

/**
 * Where this load stands (lib/wallet-restore `restorePhase`), the address a
 * pocketed session proves, and the wallet to ask to open for a signature.
 */
export function useWalletRestore(): {
  phase: RestorePhase;
  /** The session's address while the extension is away (`restoring`, `session`). */
  address: string | undefined;
  /** The wallet this browser signed in with, when remembered. */
  wallet: { id: string; name: string } | null;
} {
  useSyncExternalStore(subscribeWalletSessions, walletSessionsVersion, () => 0);
  const isSettled = useSyncExternalStore(subscribeSettled, () => settled, () => false);
  const connected = useConnectedChains();
  const privy = usePrivyEmbeddedWallet();
  const live = connected.chains.find((chain) => chain.chainType === "EVM")?.account.address;
  // Server render and hydration: nothing is pocketed yet as far as React knows.
  const mounted = useMounted();
  const anchor = mounted ? anchorWalletSession() : null;
  const record = mounted ? walletRecord() : null;
  // An email session is its own account: it never borrows a wallet's.
  const emailSession = PRIVY_ENABLED && privy.authenticated && !privy.walletAccountSession;
  const restorable = restorableAnchor({ anchor, record, emailSession });
  const identityReady = !PRIVY_ENABLED || privy.ready;
  const phase = restorePhase({
    anchor: restorable,
    liveEvm: live,
    hydrated: mounted && connected.status === "ready",
    settled: isSettled,
    identityReady,
  });
  // No stand-in address before the email session is known: it may be an
  // email account, whose readers must never see a wallet's address.
  const away = identityReady && (phase === "restoring" || phase === "session");
  return {
    phase,
    address: away ? (restorable ?? undefined) : undefined,
    wallet: rememberedFor(record, restorable),
  };
}

/**
 * The SDK's `useXAccount`, with the pocketed session's address standing in
 * for EVM while the extension is away: a read needs no signature, so the
 * account, its holdings and its history show from the session alone.
 * Signing still needs the live wallet (`useWalletProvider` stays empty).
 */
export function useAccountXAccount(
  ...args: Parameters<typeof useXAccount>
): ReturnType<typeof useXAccount> {
  const account = useXAccount(...args);
  const { address } = useWalletRestore();
  const standIn = !account.address && !!address && account.xChainType === "EVM";
  return useMemo(() => (standIn ? { ...account, address } : account), [standIn, account, address]);
}

/** `useXAccounts`, with the same stand-in for EVM. */
export function useAccountXAccounts(): ReturnType<typeof useXAccounts> {
  const accounts = useXAccounts();
  const { address } = useWalletRestore();
  const standIn = !!address && !accounts.EVM?.address;
  return useMemo(() => (standIn ? { ...accounts, EVM: { address, xChainType: "EVM" as const } } : accounts), [standIn, accounts, address]);
}

/**
 * Forget every wallet sign in this browser holds, here and on the server
 * (hooks/use-wallet-session revokeWalletSessions): a refresh must not bring
 * it back, and the tokens stop working everywhere.
 */
export function forgetWalletSignIn(): void {
  revokeWalletSessions();
}

/**
 * Sign out entirely: every wallet session ended (server and here), every
 * connected wallet family disconnected, and the email session too when
 * there is one. For a Sign out the person tapped; the add-an-email flow's
 * own Privy logouts never come through here, since they must not sign a
 * wallet account out (hooks/use-link-email).
 */
export function useSignOut(): (options?: { email?: boolean }) => Promise<void> {
  const { chains } = useConnectedChains();
  const disconnect = useXDisconnect();
  const privy = usePrivyEmbeddedWallet();
  const { logout } = privy;
  return useCallback(
    async ({ email = false } = {}) => {
      forgetWalletSignIn();
      for (const chainType of new Set(chains.map((chain) => chain.chainType))) {
        await disconnect({ xChainType: chainType }).catch(() => undefined);
      }
      if (email) await logout().catch(() => undefined);
    },
    [chains, disconnect, logout],
  );
}

/**
 * Ask the remembered wallet to open, for a signature: the one prompt the
 * restore ever causes, and only when the person asked for something that
 * needs it. When the wallet is not here to ask (not announced, or no record
 * of which it was) the wallet drawer opens instead, so the button always
 * leads somewhere. False only when the person dismissed the wallet.
 */
export function useWakeWallet(): { asleep: boolean; name: string | null; wake: () => Promise<boolean> } {
  const { phase, wallet } = useWalletRestore();
  const byChain = useXConnectorsByChain();
  const { mutateAsync: connect } = useXConnect();
  const asleep = phase === "session";
  const connector = wallet ? (byChain.EVM ?? []).find((c) => c.id === wallet.id) : undefined;
  const wake = useCallback(async () => {
    if (!connector) {
      setDrawerOpen(true);
      return true;
    }
    try {
      await connect(connector);
      return true;
    } catch {
      return false;
    }
  }, [connect, connector]);
  return { asleep, name: wallet?.name ?? null, wake };
}

/**
 * The slice of wagmi's connector (the SDK's EvmXConnector carries it as
 * `connector`) the quiet reconnect drives: the same three steps wagmi's own
 * `reconnect` takes, so the SDK's EvmHydrator picks the connection up from
 * wagmi exactly as after a reconnect it made itself.
 */
type WagmiConnector = {
  isAuthorized: () => Promise<boolean>;
  connect: (parameters: { isReconnecting: boolean }) => Promise<{ accounts: readonly string[]; chainId: number }>;
  emitter: { emit: (event: "connect", data: { accounts: readonly string[]; chainId: number }) => void };
};

function wagmiOf(candidate: IXConnector): WagmiConnector | null {
  const wagmi = (candidate as IXConnector & { connector?: Partial<WagmiConnector> }).connector;
  return wagmi && typeof wagmi.isAuthorized === "function" && typeof wagmi.connect === "function" && wagmi.emitter
    ? (wagmi as WagmiConnector)
    : null;
}

/** How often, and how many times, a try that wagmi ignored (it was busy reconnecting) is repeated. */
const RETRY_MS = 600;
const MAX_RETRIES = 8;

/**
 * The quiet reconnect. While a fresh session is pocketed and the extension
 * is not connected, every EVM connector that arrives (lib/wallet-restore
 * `reconnectCandidates`) is asked whether this site is already authorised
 * (`eth_accounts`, which never opens a prompt); one that says yes is
 * reconnected the way wagmi reconnects on mount, never through the connect
 * flow, whose permission request would open the wallet. After
 * RESTORE_GRACE_MS the load settles on the session alone, and a wallet that
 * announces later is still picked up. Also remembers which wallet a live
 * sign in is on, so the next load tries that one alone.
 */
export function WalletRestore() {
  const { phase } = useWalletRestore();
  const connected = useConnectedChains();
  const byChain = useXConnectorsByChain();
  const tried = useRef(new Set<string>());
  const busy = useRef(false);
  const retries = useRef(0);
  const [retry, setRetry] = useState(0);

  const evm = connected.chains.find((chain) => chain.chainType === "EVM");
  const live = useRef<string | undefined>(undefined);
  useEffect(() => {
    live.current = evm?.account.address;
    if (!evm?.account.address) return;
    rememberWallet({ address: evm.account.address, id: evm.connectorId, name: evm.connectorName ?? evm.connectorId });
  }, [evm?.account.address, evm?.connectorId, evm?.connectorName]);

  // The grace period starts with the first load that has something to
  // restore. Once the account has shown it never goes back to the splash.
  useEffect(() => {
    if (phase === "live") return setSettled(true);
    if (phase !== "restoring") return;
    const timer = setTimeout(() => setSettled(true), RESTORE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "restoring" && phase !== "session") return;
    if (busy.current) return;
    const remembered = rememberedFor(walletRecord(), anchorWalletSession()?.address);
    const candidates = reconnectCandidates(byChain.EVM ?? [], remembered?.id, tried.current);
    if (candidates.length === 0) return;
    busy.current = true;
    void (async () => {
      try {
        for (const candidate of candidates) {
          tried.current.add(candidate.id);
          const wagmi = wagmiOf(candidate);
          if (!wagmi) continue;
          const authorized = await wagmi.isAuthorized().catch(() => false);
          if (!authorized) continue;
          const data = await wagmi.connect({ isReconnecting: true }).catch(() => null);
          if (!data?.accounts.length) continue;
          wagmi.emitter.emit("connect", { accounts: data.accounts, chainId: data.chainId });
          // wagmi ignores a connect while its own reconnect is still running:
          // look again shortly, and try this wallet once more if it did.
          await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
          if (!live.current && retries.current < MAX_RETRIES) {
            retries.current += 1;
            tried.current.delete(candidate.id);
            setTimeout(() => setRetry((n) => n + 1), RETRY_MS);
          }
          break;
        }
      } finally {
        busy.current = false;
      }
    })();
  }, [phase, byChain.EVM, retry]);

  const open = useSyncExternalStore(subscribeDrawer, () => drawerOpen, () => false);
  return <WalletDrawer open={open} onOpenChange={setDrawerOpen} />;
}
