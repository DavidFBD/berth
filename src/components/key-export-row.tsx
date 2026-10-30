"use client";

import { useReducer, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useExportWallet } from "@privy-io/react-auth";
import {
  useExportWallet as useExportSolanaWallet,
  useWallets as useSolanaWallets,
} from "@privy-io/react-auth/solana";
import { CaretDown, CheckSquare, Key, Square } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { useCopy } from "@/components/settings-provider";
import { SPRING_SHELF } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  canExportKeys,
  initialKeyExportGateState,
  keyExportGateReducer,
} from "@/lib/key-export-gate";

/**
 * Settings' collapsed "Advanced" section: closed by default and never
 * remembered open (a plain useState, not the board's persisted disclosure),
 * so a newcomer scrolling the settings drawer doesn't land on private key
 * export by accident. Embedded-wallet accounts only, same as before this
 * moved out of the account drawer: a wallet-connect account has no Privy
 * key to export in the first place.
 */
export function AdvancedSection({ evmAddress }: { evmAddress?: string }) {
  const copy = useCopy();
  const [open, setOpen] = useState(false);

  if (!evmAddress) return null;

  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={ADVANCED_PANEL_ID}
        onClick={() => setOpen((current) => !current)}
        className="hit-y flex items-center gap-1.5 self-start text-[11.5px] font-bold tracking-(--tracking-caps) uppercase text-muted-foreground transition-colors hover:text-foreground"
      >
        {copy.advancedSectionLabel}
        <CaretDown
          weight="duotone"
          aria-hidden
          className={cn("size-3.5 transition-transform duration-200 ease-lift", open && "rotate-180")}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={ADVANCED_PANEL_ID}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING_SHELF}
            className="overflow-hidden"
          >
            <Panel>
              <KeyExportRow evmAddress={evmAddress} />
            </Panel>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

const ADVANCED_PANEL_ID = "settings-advanced";

/**
 * The way out, moved from the account drawer behind Advanced. Funds has no
 * send screen by design, which holds up while every asset can be traded and
 * traps the ones that can't: a withdraw delivered SOL to Solana had nowhere
 * to land, and the balance sat there unreachable (field-found 2026-09-01).
 * Export answers that without building a send flow, and Privy renders the
 * key in an iframe on its own domain, so this app never touches it.
 *
 * Tapping the row opens a confirmation with the risk spelled out; the two
 * export buttons stay disabled until "I understand" is ticked
 * (lib/key-export-gate). Closing the row resets the tick, so it is never
 * armed on a later visit.
 *
 * Needs wallet export enabled for the app in the Privy dashboard; with the
 * toggle off, Privy explains that inside its own modal.
 */
function KeyExportRow({ evmAddress }: { evmAddress: string }) {
  const copy = useCopy();
  const { exportWallet: exportEvmWallet } = useExportWallet();
  const { exportWallet: exportSolanaWallet } = useExportSolanaWallet();
  const solanaAddress = usePrivySolanaAddress();
  const [gate, dispatch] = useReducer(keyExportGateReducer, initialKeyExportGateState);
  const enabled = canExportKeys(gate);

  return (
    <div>
      <button
        type="button"
        aria-expanded={gate.confirming}
        onClick={() => dispatch({ type: gate.confirming ? "close" : "open" })}
        className="flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left transition-[background-color] duration-150 ease-lift hover:bg-muted/60 active:bg-muted"
      >
        <Key className="size-5 shrink-0 text-primary" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-foreground">{copy.exportKeysTitle}</span>
          <span className="text-xs text-muted-foreground">{copy.exportKeysSub}</span>
        </div>
        <CaretDown
          weight="duotone"
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-lift",
            gate.confirming && "rotate-180",
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {gate.confirming && (
          <motion.div
            data-ph-block
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING_SHELF}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-3 px-3 pb-3">
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs leading-relaxed text-foreground">
                {copy.exportConfirmWarning}
              </p>

              <button
                type="button"
                role="checkbox"
                aria-checked={gate.acknowledged}
                onClick={() => dispatch({ type: "acknowledge", value: !gate.acknowledged })}
                className="flex items-start gap-2.5 text-left text-xs text-foreground"
              >
                {gate.acknowledged ? (
                  <CheckSquare weight="duotone" aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
                ) : (
                  <Square aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                )}
                {copy.exportConfirmCheckboxLabel}
              </button>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={!enabled}
                  onClick={() => {
                    void exportEvmWallet({ address: evmAddress }).catch(() => {
                      // Rejection includes plain user exit, and a disabled
                      // export toggle is something Privy reports in its own
                      // modal.
                    });
                  }}
                >
                  {copy.exportEvmLabel}
                </Button>
                {solanaAddress && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={!enabled}
                    onClick={() => {
                      void exportSolanaWallet({ address: solanaAddress }).catch(() => {
                        // See above.
                      });
                    }}
                  >
                    {copy.exportSolanaLabel}
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The embedded Solana wallet's address, or undefined when Privy hasn't
 * surfaced one. Duck-typed: the d.ts exports PrivyStandardWallet but the
 * runtime module doesn't (Privy build mismatch), so check the class's getter
 * directly. Copied from account-button's identical helper — kept local so
 * this module has no dependency back onto the account drawer.
 */
function usePrivySolanaAddress(): string | undefined {
  const { wallets } = useSolanaWallets();
  return wallets.find(
    (wallet) =>
      (wallet.standardWallet as { isPrivyWallet?: boolean }).isPrivyWallet ===
      true,
  )?.address;
}
