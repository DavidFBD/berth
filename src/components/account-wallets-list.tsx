"use client";

import { useState } from "react";
import { PlusCircle, Wallet } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";
import { shortenAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * "Wallets" in the account drawer (docs/plans/account-linking.md, phase 2):
 * the addresses linked to the account by network, which one is home (buys
 * land in its hub wallet), and the three acts, each one free signature
 * asked for only on a press: add a wallet, make one home, remove one.
 * This module only draws (the dev gallery and the tests draw every state
 * from fixtures); components/account-wallets wires it to the account.
 */

export type WalletRow = {
  address: string;
  isHome: boolean;
  /** Its hub wallet still holds listings (removing it warns). */
  holds: boolean;
};

type Confirming = { kind: "home" | "remove"; address: string } | null;

export function WalletsList({
  wallets,
  signedInWith,
  unlinked,
  homeCanSign,
  allowHomeSwitch,
  emailSession,
  busy,
  initialConfirm = null,
  onAdd,
  onDismiss,
  onMakeHome,
  onRemove,
}: {
  wallets: WalletRow[];
  /** The address this browser's wallet session proves; it cannot be removed here. */
  signedInWith: string | null;
  /** A connected wallet not on the account yet, for the quiet prompt. */
  unlinked: string | null;
  /** Whether the home wallet can sign in this browser (home and remove need it). */
  homeCanSign: boolean;
  /** Make home is offered only where a sell from the new home can be signed. */
  allowHomeSwitch: boolean;
  emailSession: boolean;
  busy: boolean;
  initialConfirm?: Confirming;
  onAdd?: () => void;
  onDismiss?: () => void;
  onMakeHome?: (address: string) => void;
  onRemove?: (address: string) => void;
}) {
  const copy = useCopy();
  const [confirming, setConfirming] = useState<Confirming>(initialConfirm);
  const [hintOpen, setHintOpen] = useState(false);
  const home = wallets.find((wallet) => wallet.isHome);

  return (
    <div>
      <div className="flex flex-col px-3 pt-3 pb-1">
        <span className="text-sm font-medium text-foreground">{copy.accountWalletsTitle}</span>
        <span className="text-xs text-muted-foreground">{copy.accountWalletsSub}</span>
      </div>

      {unlinked && (
        <UnlinkedWalletLine address={unlinked} busy={busy} onAdd={onAdd} onDismiss={onDismiss} className="mx-3 my-2" />
      )}

      <div className="px-3 pt-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {copy.walletsNetworkEvm}
      </div>
      <ul className="divide-y divide-border">
        {wallets.map((wallet) => {
          const short = shortenAddress(wallet.address, 4);
          const open = confirming?.address === wallet.address ? confirming.kind : null;
          return (
            <li key={wallet.address} className="px-3 py-2.5">
              <div className="flex min-h-10 items-center gap-3">
                <Wallet className="size-5 shrink-0 text-primary" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="money text-sm text-foreground">{short}</span>
                    {wallet.isHome && (
                      <span className="rounded-md border border-border px-1.5 text-[11px] leading-5 text-muted-foreground">
                        {copy.walletsHomeTag}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {wallet.isHome ? copy.walletsHomeNote : copy.walletsPayFromNote}
                  </span>
                </div>
                {!wallet.isHome && !open && (
                  <div className="flex shrink-0 gap-1">
                    {allowHomeSwitch && (
                      <Button variant="ghost" size="xs" onClick={() => setConfirming({ kind: "home", address: wallet.address })}>
                        {copy.walletsMakeHome}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground"
                      onClick={() => setConfirming({ kind: "remove", address: wallet.address })}
                    >
                      {copy.walletsRemove}
                    </Button>
                  </div>
                )}
              </div>
              {open && (
                <Confirm
                  kind={open}
                  short={short}
                  holds={wallet.holds}
                  signedIn={signedInWith === wallet.address}
                  homeShort={home ? shortenAddress(home.address, 4) : ""}
                  homeCanSign={homeCanSign}
                  busy={busy}
                  onCancel={() => setConfirming(null)}
                  onConfirm={() => {
                    if (open === "home") onMakeHome?.(wallet.address);
                    else onRemove?.(wallet.address);
                    setConfirming(null);
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        aria-expanded={hintOpen}
        onClick={() => (unlinked ? onAdd?.() : setHintOpen((value) => !value))}
        className="flex min-h-12 w-full items-center gap-3 border-t border-border px-3 py-2.5 text-left transition-[background-color] duration-150 ease-lift hover:bg-muted/60 active:bg-muted"
      >
        <PlusCircle className="size-5 shrink-0 text-primary" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-foreground">{copy.walletsAdd}</span>
          {hintOpen && !unlinked && (
            <span className="text-xs text-muted-foreground">
              {emailSession ? copy.walletsAddHintEmail : copy.walletsAddHint}
            </span>
          )}
        </div>
      </button>
    </div>
  );
}

function Confirm({
  kind,
  short,
  holds,
  signedIn,
  homeShort,
  homeCanSign,
  busy,
  onCancel,
  onConfirm,
}: {
  kind: "home" | "remove";
  short: string;
  holds: boolean;
  signedIn: boolean;
  homeShort: string;
  homeCanSign: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = useCopy();
  // Removing is confirmed by the home or by the wallet itself; making home
  // only by the current home.
  // A hub wallet still holding stocks stays: selling or moving them home
  // comes first, and nothing does that on its own.
  const blocked =
    kind === "remove" && holds ? copy.walletsRemoveHolds : kind === "remove" && signedIn ? copy.walletsRemoveSignedIn : null;
  const needsHome = kind === "home" && !homeCanSign;
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl bg-muted/60 p-3">
      <p className="text-sm text-foreground">
        {kind === "home" ? copy.walletsMakeHomeConfirm(short) : copy.walletsRemoveConfirm(short)}
      </p>
      {blocked && <p className="text-xs text-muted-foreground">{blocked}</p>}
      {needsHome && <p className="text-xs text-muted-foreground">{copy.walletsNeedHomeSigner(homeShort)}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !!blocked || needsHome} onClick={onConfirm}>
          {copy.walletsSignToConfirm}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {copy.walletsCancel}
        </Button>
      </div>
    </div>
  );
}

/** The quiet one line: this connected wallet is not on the account. Never acts on its own. */
export function UnlinkedWalletLine({
  address,
  busy,
  onAdd,
  onDismiss,
  className,
}: {
  address: string;
  busy: boolean;
  onAdd?: () => void;
  onDismiss?: () => void;
  className?: string;
}) {
  const copy = useCopy();
  return (
    <div
      role="status"
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border px-3 py-2", className)}
    >
      <span className="min-w-0 flex-1 text-sm text-foreground">
        {copy.walletNotLinkedPrompt} <span className="money text-xs text-muted-foreground">{shortenAddress(address, 4)}</span>
      </span>
      <span className="flex shrink-0 gap-1">
        <Button size="xs" disabled={busy || !onAdd} onClick={onAdd}>
          {copy.walletNotLinkedAdd}
        </Button>
        <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={onDismiss}>
          {copy.walletNotLinkedDismiss}
        </Button>
      </span>
    </div>
  );
}


/**
 * Wallet mode, a new extension address with no session here: who is signed
 * in and who is connected, nothing of the account itself. Signing in with
 * the connected wallet is the default; adding it to the signed in account
 * comes second.
 */
export function SignedInAsLine({
  signedIn,
  connected,
  busy,
  onSignIn,
  onAdd,
  className,
}: {
  signedIn: string;
  connected: string;
  busy: boolean;
  onSignIn?: () => void;
  onAdd?: () => void;
  className?: string;
}) {
  const copy = useCopy();
  return (
    <div role="status" className={cn("flex flex-col gap-2 rounded-xl border border-border px-3 py-2.5", className)}>
      <span className="flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
        <span className="whitespace-nowrap">{copy.signedInAsWallet(shortenAddress(signedIn, 4))}</span>
        <span aria-hidden>·</span>
        <span className="whitespace-nowrap text-foreground">{copy.connectedWallet(shortenAddress(connected, 4))}</span>
      </span>
      <span className="flex flex-wrap gap-1.5">
        <Button size="sm" disabled={busy} onClick={onSignIn}>
          {copy.signInWithWallet(shortenAddress(connected, 4))}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy || !onAdd} onClick={onAdd}>
          {copy.addToThisAccount}
        </Button>
      </span>
    </div>
  );
}
