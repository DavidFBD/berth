"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useWalletModal, type ChainGroup } from "@sodax/wallet-sdk-react";
import { Panel } from "@/components/ui/panel";
import { useCopy } from "@/components/settings-provider";
import { AddWalletList, SignedInAsLine, UnlinkedWalletLine, WalletsList } from "@/components/account-wallets-list";
import { WalletDrawer } from "@/components/wallet";
import { useAddConnectedWallet, useAddWallets, useSignerFor, walletActMessage } from "@/hooks/use-account-wallets";
import { MergeCard } from "@/components/account-merge";
import { useWalletMerge } from "@/hooks/use-account-merge";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { useAccountWallets, useIdentityLabel, useWalletAct } from "@/hooks/use-profile";
import { shortenAddress } from "@/lib/format";

/**
 * "Wallets" in the account drawer, wired to the account: the list from
 * /api/account/wallets, the holdings behind each hub wallet (so removing
 * one that still holds listings warns), and the signatures each act needs.
 * The drawing lives in components/account-wallets-list.
 */

/**
 * The board's line for a connected wallet that is not on the account.
 * Wallet mode: nothing of the earlier account shows until the person
 * chooses, so the line says who is signed in and who is connected, and
 * the default is to sign in with the connected wallet. Email mode: the
 * quiet "Add it?" prompt. One surface at a time: `hidden` while the account
 * drawer, which carries its own copy, is open.
 */
export function UnlinkedWalletPrompt({ hidden = false }: { hidden?: boolean }) {
  const add = useAddConnectedWallet();
  const merge = useWalletMerge();
  if (hidden) return null;
  // A link that found the wallet on another account: the merge offer takes the line's place.
  if (merge.step !== "idle") return <MergeCard />;
  if (!add.waiting) return null;
  if (add.waiting.mode === "wallet" && add.waiting.anchor) {
    return (
      <SignedInAsLine
        signedIn={add.waiting.anchor}
        connected={add.waiting.address}
        busy={add.busy}
        onSignIn={add.keepApart}
        onAdd={add.canSign ? () => void add.add() : undefined}
      />
    );
  }
  return (
    <UnlinkedWalletLine
      address={add.waiting.address}
      busy={add.busy}
      onAdd={add.canSign ? () => void add.add() : undefined}
      onDismiss={add.keepApart}
    />
  );
}

/** The drawer's Wallets section, wired to the account. Nothing until the list has answered. */
export function WalletsSection() {
  const copy = useCopy();
  const list = useAccountWallets();
  const { email } = useIdentityLabel();
  const account = useHubAccount();
  const holdings = useHubHoldings(account.hubWallets);
  const add = useAddConnectedWallet();
  const signerFor = useSignerFor();
  const act = useWalletAct();
  const addable = useAddWallets();
  const connect = useConnectNetwork();

  const all = list.data?.wallets ?? [];
  const evm = all.filter((wallet) => wallet.family === "evm");
  // An account with no EVM row yet (an email account) still gets Add a
  // wallet: a Solana address joins it with a recent email code.
  if (!list.data) return null;
  const home = evm.find((wallet) => wallet.isHome);
  const holdsAt = (address: string) => {
    const hub = account.wallets.find((wallet) => wallet.spoke === address)?.hubWallet;
    const read = hub && holdings.byWallet.find((wallet) => wallet.hubWallet.toLowerCase() === hub.toLowerCase());
    return !!read && read.balances.some((balance) => balance > 0n);
  };

  const run = async (kind: "home" | "unlink", address: string) => {
    // Home and remove are confirmed by the current home; an EVM wallet may
    // also confirm its own removal. A Solana address is removed by the home.
    const family = all.find((wallet) => wallet.address === address)?.family === "solana" ? "solana" : "evm";
    const signerAddress = signerFor(home?.address)
      ? home?.address
      : kind === "unlink" && family === "evm" && signerFor(address)
        ? address
        : undefined;
    const sign = signerFor(signerAddress);
    if (!signerAddress || !sign) {
      toast(family === "solana" && home ? copy.walletsNeedHomeSigner(shortenAddress(home.address, 4)) : copy.walletsFailed);
      return;
    }
    const result = await act.mutateAsync({ act: kind, target: address, family, signer: signerAddress, sign });
    if (!result.ok) {
      toast(walletActMessage(result.reason, copy));
      return;
    }
    const state = result.response.state;
    if (state === "home" || state === "already") toast.success(copy.walletsHomeToast);
    else if (state === "unlinked") toast.success(copy.walletsRemovedToast);
    else if (state === "is_home") toast(copy.walletsRemoveHomeFirst);
    else if (state === "signed_in") toast(copy.walletsRemoveSignedIn);
    else if (state === "holds") toast(copy.walletsRemoveHolds);
    else toast(copy.walletsFailed);
  };

  return (
    <Panel>
    <MergeCard />
    <WalletsList
      wallets={all
        .filter((wallet) => wallet.family === "evm" || wallet.family === "solana")
        .map((wallet) => ({
          address: wallet.address,
          family: wallet.family,
          isHome: wallet.isHome,
          holds: wallet.family === "evm" && holdsAt(wallet.address),
        }))}
      signedInWith={list.data?.signedInWith ?? null}
      // The drawer carries the email prompt; wallet mode never reaches here
      // with a waiting wallet (no account shows until the person chooses).
      unlinked={add.waiting?.mode === "email" ? add.address : null}
      homeCanSign={!!signerFor(home?.address)}
      // An email session signs with its embedded wallet, so a sell from an
      // external home could not be signed here: its home stays put.
      allowHomeSwitch={!email}
      emailSession={!!email}
      busy={act.isPending || add.busy}
      onAdd={add.canSign ? () => void add.add() : undefined}
      onDismiss={add.keepApart}
      onMakeHome={(address) => void run("home", address)}
      onRemove={(address) => void run("unlink", address)}
      addList={
        <AddWalletList
          rows={addable.rows}
          comingSoon={addable.comingSoon}
          busyAddress={addable.busyAddress}
          onAdd={(row) => void addable.add(row)}
          onConnect={(row) => connect.open(row.network as ChainGroup["chainType"])}
        />
      }
    />
    {connect.drawer}
    </Panel>
  );
}

/**
 * "Connect Solana" from the Add a wallet list: the app's own wallet drawer,
 * opened straight at that network's wallets.
 */
function useConnectNetwork() {
  const modal = useWalletModal();
  const [target, setTarget] = useState<ChainGroup["chainType"] | null>(null);
  const picked = useRef(false);
  const { state, selectChain } = modal;
  useEffect(() => {
    if (target && !picked.current && state.kind === "chainSelect") {
      picked.current = true;
      selectChain(target);
    }
  }, [target, state.kind, selectChain]);
  return {
    open: (chainType: ChainGroup["chainType"]) => {
      picked.current = false;
      setTarget(chainType);
    },
    drawer: <WalletDrawer open={target !== null} onOpenChange={(next) => !next && setTarget(null)} />,
  };
}
