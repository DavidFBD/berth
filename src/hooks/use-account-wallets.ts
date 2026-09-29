"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useChainGroups, useConnectedChains, useXAccount, useXSignMessage, type ChainGroup } from "@sodax/wallet-sdk-react";
import { toHex } from "viem";
import { useCopy } from "@/components/settings-provider";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import { useAccountWallets, useIdentityLabel, useWaitingIdentity, useWalletAct } from "@/hooks/use-profile";
import {
  keepSeparate,
  keptSeparate,
  subscribeWalletSessions,
  walletSessionsVersion,
} from "@/hooks/use-wallet-session";
import { shortenAddress } from "@/lib/format";
import { walletActMessage } from "@/lib/account-wallets";
import { offerWalletMerge, type MergeOfferWire } from "@/hooks/use-account-merge";
import {
  LINKABLE,
  NETWORK_ORDER,
  addWalletRows,
  addressKey,
  solanaSignatureBytes,
  type AddRow,
} from "@/lib/add-wallet-list";
import { base58Encode } from "@/lib/identity/caip";

/**
 * The account's wallet acts in the browser, over app/api/account/wallets:
 * which connected wallet is not on the account, and the signatures that add
 * one, make one home, or remove one. Each is asked for only on a press.
 */

type Sign = (message: string) => Promise<string | null>;

/** How long a link waits for the person to switch their extension back to the home wallet. */
const SWITCH_WAIT_MS = 5 * 60_000;

/**
 * Ways to sign with an address in this browser: the connected extension
 * when it is the connected EVM wallet, the email account's embedded wallet
 * when it is that. `signerFor` is null when neither can now; `waitingSigner`
 * waits (up to SWITCH_WAIT_MS) for the extension to switch to the address,
 * for a link's second signature by the home.
 */
export function useSigners() {
  const external = useXAccount({ xChainType: "EVM" });
  const privy = usePrivyEmbeddedWallet();
  const { mutateAsync: signExternal } = useXSignMessage();
  const connected = useRef<string | undefined>(undefined);
  useEffect(() => {
    connected.current = external.address?.toLowerCase();
  }, [external.address]);

  const signWithExtension = useCallback(
    async (message: string) => {
      const signature = await signExternal({ xChainType: "EVM", message });
      return typeof signature === "string" && signature.startsWith("0x") ? signature : null;
    },
    [signExternal],
  );

  const signerFor = useCallback(
    (address: string | undefined): Sign | null => {
      if (!address) return null;
      const target = address.toLowerCase();
      if (external.address?.toLowerCase() === target) return signWithExtension;
      const embedded = privy.authenticated ? privy.embedded : undefined;
      if (embedded && embedded.address.toLowerCase() === target) {
        return async (message) => {
          const provider = (await embedded.getEthereumProvider()) as {
            request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
          };
          const signature = await provider.request({ method: "personal_sign", params: [toHex(message), embedded.address] });
          return typeof signature === "string" ? signature : null;
        };
      }
      return null;
    },
    [external.address, privy.authenticated, privy.embedded, signWithExtension],
  );

  const waitingSigner = useCallback(
    (address: string, onWait: () => void, onDone: () => void, onTimeout?: () => void): Sign =>
      async (message) => {
        const target = address.toLowerCase();
        if (connected.current !== target) {
          onWait();
          const until = Date.now() + SWITCH_WAIT_MS;
          while (connected.current !== target) {
            if (Date.now() > until) {
              onDone();
              onTimeout?.();
              return null;
            }
            await new Promise((resolve) => setTimeout(resolve, 400));
          }
          onDone();
        }
        return signWithExtension(message);
      },
    [signWithExtension],
  );

  return { signerFor, waitingSigner };
}

/** The home address of the account a wallet session belongs to, or null when it cannot be read. */
async function homeOf(session: string): Promise<string | null> {
  try {
    const response = await fetch("/api/account/wallets", {
      method: "POST",
      headers: { "content-type": "application/json", "x-wallet-session": session },
      body: "{}",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { wallets?: { address: string; family: string; isHome: boolean }[] };
    return data.wallets?.find((wallet) => wallet.family === "evm" && wallet.isHome)?.address ?? null;
  } catch {
    return null;
  }
}

export { walletActMessage };

/** Back compat for callers that only need "can this address sign here now". */
export function useSignerFor(): (address: string | undefined) => Sign | null {
  return useSigners().signerFor;
}

/**
 * The connected EVM wallet that is not on the account and waits for the
 * person: while a new extension address has no session here and an earlier
 * account's does (wallet mode, `mode: "wallet"`: no account data shows
 * until they choose), or, in an email session, a connected external wallet
 * the list does not hold (`mode: "email"`). Null once they said "Not now".
 */
export function useUnlinkedWallet(): { address: string; mode: "wallet" | "email"; anchor: string | null } | null {
  useSyncExternalStore(subscribeWalletSessions, walletSessionsVersion, () => 0);
  const { pending, anchor } = useWaitingIdentity();
  const { email } = useIdentityLabel();
  const external = useXAccount({ xChainType: "EVM" });
  const list = useAccountWallets(!!email);
  if (pending && anchor) return { address: pending, mode: "wallet", anchor: anchor.address };
  if (!email) return null;
  const wallets = list.data?.wallets;
  const candidate = external.address?.toLowerCase();
  if (!wallets || !wallets.some((wallet) => wallet.isHome) || !candidate || keptSeparate(candidate)) return null;
  return wallets.some((wallet) => wallet.address === candidate) ? null : { address: candidate, mode: "email", anchor: null };
}

/**
 * Whether the unlinked-wallet prompt is showing right now, without pulling
 * in the full `useAddConnectedWallet` (its signers and mutation). Shared
 * with the email nudge's priority (lib/email-nudge): this strip outranks
 * it, since it is about an account mix-up rather than a suggestion.
 */
export function useUnlinkedWalletShowing(hidden: boolean): boolean {
  const waiting = useUnlinkedWallet();
  return Boolean(waiting) && !hidden;
}

/**
 * "Add to this account" and "Sign in with it" for the waiting wallet.
 * Adding needs two signatures in wallet mode: the new wallet's, then the
 * earlier account's home (the person switches the extension back when
 * asked); in an email session one signature and a recent email code.
 * "Sign in with it" (wallet mode) or "Not now" (email) keeps it separate.
 */
export function useAddConnectedWallet() {
  const copy = useCopy();
  const waiting = useUnlinkedWallet();
  const { anchor } = useWaitingIdentity();
  const privy = usePrivyEmbeddedWallet();
  const { signerFor, waitingSigner } = useSigners();
  const act = useWalletAct();
  const address = waiting?.address ?? null;

  // Start again, from an expired or changed merge offer, runs the link
  // once more: new signatures, a new offer.
  const addAgain = useRef<() => Promise<void>>(async () => {});
  const add = useCallback(async () => {
    const sign = signerFor(address ?? undefined);
    if (!waiting || !address || !sign) return;
    // Wallet mode: the account confirms with its HOME, which need not be the
    // wallet this browser last signed in with. Ask the server which it is.
    let home: string | null = null;
    if (waiting.mode === "wallet" && anchor) {
      home = await homeOf(anchor.token);
      if (!home) {
        toast(copy.walletsFailed);
        return;
      }
    }
    let homeMissed = false;
    const confirm =
      home !== null
        ? {
            signer: home,
            sign: waitingSigner(
              home,
              () => toast(copy.walletsConfirmWithHome(shortenAddress(home!, 4)), { id: "wallet-switch", duration: SWITCH_WAIT_MS }),
              () => toast.dismiss("wallet-switch"),
              () => {
                homeMissed = true;
              },
            ),
          }
        : undefined;
    const result = await act.mutateAsync({
      act: "link",
      target: address,
      signer: address,
      sign,
      confirm,
      asSession: waiting.mode === "wallet" ? anchor?.token : undefined,
    });
    if (!result.ok) {
      if (result.reason === "reauth") {
        toast(copy.walletsSignInAgain, {
          action: {
            label: copy.walletsSignInAgainAction,
            onClick: () => void privy.logout().then(() => privy.login()),
          },
        });
      } else if (homeMissed && home) toast(copy.walletsHomeMissing(shortenAddress(home, 4)));
      else toast(walletActMessage(result.reason, copy));
      return;
    }
    const state = result.response.state;
    if (state === "linked" || state === "already") toast.success(copy.walletsLinkedToast, { description: shortenAddress(address, 6) });
    else if (state === "cooling") toast(copy.walletsCooling);
    else {
      // Both accounts were just proved (this wallet's signature, and the
      // account's confirmation), so the server offers to make them one.
      const merge = (result.response as { merge?: MergeOfferWire }).merge;
      if (merge) offerWalletMerge(merge, address, waiting.mode === "wallet" ? anchor?.token : undefined, () => addAgain.current());
      else toast(copy.walletsOtherAccount);
    }
  }, [act, address, anchor, copy, privy, signerFor, waiting, waitingSigner]);

  useEffect(() => {
    addAgain.current = add;
  }, [add]);

  /** Wallet mode: sign in as the new wallet (a signature, as before). Email mode: stop asking. */
  const keepApart = useCallback(() => {
    if (address) keepSeparate(address);
  }, [address]);

  return { waiting, address, add, keepApart, busy: act.isPending, canSign: !!signerFor(address ?? undefined) };
}

// ------------------------------------------------------------ Add a wallet

/** What a link answered in this browser, by address key: shown only after that address signed. */
const outcomes = new Map<string, "other_account" | "cooling">();
const outcomeListeners = new Set<() => void>();
let outcomesVersion = 0;
function rememberOutcome(key: string, state: "other_account" | "cooling"): void {
  outcomes.set(key, state);
  outcomesVersion += 1;
  for (const listener of outcomeListeners) listener();
}
function subscribeOutcomes(listener: () => void): () => void {
  outcomeListeners.add(listener);
  return () => outcomeListeners.delete(listener);
}

/**
 * The drawer's "Add a wallet" list, wired: every network the wallet SDK
 * has enabled, the address its extension has open there (a multichain
 * extension shows up once per network), and the one press that adds it.
 * EVM goes through the phase 2 flow (useAddConnectedWallet) when it is the
 * waiting wallet; a Solana address signs Sign-In With Solana in its own
 * extension and the account confirms with its home, or, for an email
 * account, a recent code. `connect` opens the wallet drawer at a network.
 */
export function useAddWallets() {
  const copy = useCopy();
  useSyncExternalStore(subscribeOutcomes, () => outcomesVersion, () => 0);
  const groups = useChainGroups({ order: NETWORK_ORDER as unknown as ChainGroup["chainType"][] });
  const { chains } = useConnectedChains();
  const list = useAccountWallets();
  const add = useAddConnectedWallet();
  const privy = usePrivyEmbeddedWallet();
  const { signerFor, waitingSigner } = useSigners();
  const act = useWalletAct();
  const { mutateAsync: signMessage } = useXSignMessage();
  const [busyAddress, setBusyAddress] = useState<string | null>(null);

  const { rows, comingSoon } = addWalletRows({
    networks: groups.map((group) => ({
      network: group.chainType,
      name: group.chainType === "EVM" ? copy.walletsNetworkEvm : group.displayName,
      address: group.account?.address,
      extension: chains.find((chain) => chain.chainType === group.chainType)?.connectorName ?? null,
    })),
    linked: list.data?.wallets ?? [],
    outcomes,
  });

  const addRowAgain = useRef<(row: AddRow) => Promise<void>>(async () => {});
  const addRow = useCallback(
    async (row: AddRow) => {
      const address = row.address;
      if (!address || busyAddress) return;
      const family = LINKABLE[row.network];
      if (!family) return;
      if (family === "evm" && add.waiting && add.address === address.toLowerCase()) {
        await add.add();
        return;
      }
      const sign: Sign | null =
        family === "solana"
          ? async (message) => {
              const bytes = solanaSignatureBytes(await signMessage({ xChainType: "SOLANA", message }));
              return bytes ? base58Encode(bytes) : null;
            }
          : signerFor(address);
      if (!sign) {
        toast(copy.walletsFailed);
        return;
      }
      // The account confirms with its home: signed here when it can be,
      // else the extension is switched to it when asked. An email account
      // with no home to sign with confirms with a recent code instead.
      const home = list.data?.wallets.find((wallet) => wallet.family === "evm" && wallet.isHome)?.address ?? null;
      let homeMissed = false;
      const homeSigner = home ? signerFor(home) : null;
      const confirm = home
        ? {
            signer: home,
            sign:
              homeSigner ??
              waitingSigner(
                home,
                () => toast(copy.walletsConfirmWithHome(shortenAddress(home, 4)), { id: "wallet-switch", duration: SWITCH_WAIT_MS }),
                () => toast.dismiss("wallet-switch"),
                () => {
                  homeMissed = true;
                },
              ),
          }
        : undefined;
      setBusyAddress(address);
      try {
        const result = await act.mutateAsync({
          act: "link",
          target: address,
          family,
          signer: address,
          signerFamily: family,
          sign,
          confirm,
        });
        if (!result.ok) {
          if (result.reason === "reauth") {
            toast(copy.walletsSignInAgain, {
              action: { label: copy.walletsSignInAgainAction, onClick: () => void privy.logout().then(() => privy.login()) },
            });
          } else if (homeMissed && home) toast(copy.walletsHomeMissing(shortenAddress(home, 4)));
          else toast(walletActMessage(result.reason, copy));
          return;
        }
        const state = result.response.state;
        if (state === "linked" || state === "already") toast.success(copy.walletsLinkedToast, { description: shortenAddress(address, 6) });
        else if (state === "cooling" || state === "other_account") {
          rememberOutcome(addressKey(row.network, address), state);
          // Both accounts were just proved, so the server offers to make them one.
          const merge = state === "other_account" ? (result.response as { merge?: MergeOfferWire }).merge : undefined;
          if (merge) offerWalletMerge(merge, address, undefined, () => addRowAgain.current(row));
          else toast(state === "cooling" ? copy.walletsCooling : copy.walletsOtherAccount);
        } else toast(copy.walletsFailed);
      } finally {
        setBusyAddress(null);
      }
    },
    [act, add, busyAddress, copy, list.data?.wallets, privy, signMessage, signerFor, waitingSigner],
  );

  useEffect(() => {
    addRowAgain.current = addRow;
  }, [addRow]);

  return { rows, comingSoon, busyAddress: busyAddress ?? (add.busy ? add.address : null), add: addRow };
}
