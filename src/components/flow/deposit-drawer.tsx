"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { ChainKeys, type LeverageYieldVault, type SpokeChainKey, type XToken } from "@sodax/sdk";
import { useQuote, useStatus, useXBalances } from "@sodax/dapp-kit";
import {
  getXChainType,
  isNativeToken,
  useEvmSwitchChain,
  useWalletProvider,
  useXAccount,
  useXService,
} from "@sodax/wallet-sdk-react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { DEPOSIT_SOURCE_CHAINS, getChainName } from "@/lib/chains";
import { DEFAULT_SLIPPAGE_PCT } from "@/lib/sodax-config";
import { getVaultMeta } from "@/lib/vaults-meta";
import { applySlippage, formatTokenAmount, parseAmount } from "@/lib/format";
import { useVaultAction } from "@/hooks/use-vault-action";
import { ActionStepper, IntentTracking } from "./action-stepper";
import { ChainLogo, TokenPicker } from "./token-picker";

/**
 * Full mobile deposit flow in one bottom drawer: pick source chain + token,
 * enter an amount against a live quote, then drive the build → approve → sign
 * pipeline and track the solver fill.
 */
export function DepositDrawer({
  vault,
  open,
  onOpenChange,
  onConnectWallet,
}: {
  vault: LeverageYieldVault | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional: lets the CTA open the app's wallet drawer when disconnected. */
  onConnectWallet?: () => void;
}) {
  const [srcChainKey, setSrcChainKey] = useState<SpokeChainKey>(
    DEPOSIT_SOURCE_CHAINS[0],
  );
  const [token, setToken] = useState<XToken | null>(null);
  const [amount, setAmount] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const meta = vault ? getVaultMeta(vault.name) : null;
  const action = useVaultAction();
  const pending =
    action.step === "building" ||
    action.step === "approving" ||
    action.step === "signing";

  const account = useXAccount({ xChainId: srcChainKey });
  const walletProvider = useWalletProvider({ xChainId: srcChainKey });
  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({
    xChainId: srcChainKey,
  });

  const xService = useXService({ xChainType: getXChainType(srcChainKey) });
  const balancesQuery = useXBalances({
    params: {
      xService,
      xChainId: srcChainKey,
      xTokens: token ? [token] : [],
      address: token ? account.address : undefined,
    },
  });
  // A settled balances record can omit the key entirely: the EVM adapter
  // drops ZERO native balances (`if (balance) map[address] = balance`), so a
  // missing key on settled data means 0n, not "still loading".
  const balance = token
    ? balancesQuery.data
      ? (balancesQuery.data[token.address] ?? 0n)
      : undefined
    : undefined;

  const parsed = token ? parseAmount(amount, token.decimals) : undefined;

  const quoteQuery = useQuote({
    params: {
      payload:
        open && vault && token && parsed
          ? {
              token_src: token.address,
              token_src_blockchain_id: srcChainKey,
              token_dst: vault.vault,
              token_dst_blockchain_id: ChainKeys.SONIC_MAINNET,
              amount: parsed,
              quote_type: "exact_input",
            }
          : undefined,
    },
    queryOptions: { retry: false },
  });
  const quoted = quoteQuery.data?.ok
    ? quoteQuery.data.value.quoted_amount
    : undefined;
  const noRoute = quoteQuery.data ? !quoteQuery.data.ok : false;
  const minReceived =
    quoted !== undefined
      ? applySlippage(quoted, DEFAULT_SLIPPAGE_PCT)
      : undefined;

  // Fill tracking after the intent lands on the hub.
  const statusQuery = useStatus({
    params: {
      intentTxHash: action.response
        ? (action.response.intentDeliveryInfo.dstTxHash as `0x${string}`)
        : undefined,
    },
  });
  const statusCode = statusQuery.data?.ok
    ? statusQuery.data.value.status
    : undefined;
  const fillTxHash = statusQuery.data?.ok
    ? statusQuery.data.value.fill_tx_hash
    : undefined;

  const toastedRef = useRef(false);
  useEffect(() => {
    if (toastedRef.current) return;
    if (statusCode === 3) {
      toastedRef.current = true;
      toast.success("Deposit filled", {
        description: "Shares delivered to your Sonic hub wallet.",
      });
    } else if (statusCode === 4) {
      toastedRef.current = true;
      toast.error("Deposit fill failed", {
        description: "The solver couldn't fill this order. Please try again.",
      });
    }
  }, [statusCode]);

  const finish = () => {
    action.reset();
    setAmount("");
    toastedRef.current = false;
    setTrackingTimedOut(false);
  };

  // Dismissing mid-tracking would drop the intent hash and the only progress
  // view — fills take under a minute, so keep the drawer up until terminal.
  // But the status poll can legitimately never turn terminal (NOT_FOUND / a
  // failing endpoint), so release the lock after a bounded wait rather than
  // trapping the user forever.
  const [trackingTimedOut, setTrackingTimedOut] = useState(false);
  useEffect(() => {
    if (action.step !== "done") return;
    const timer = setTimeout(() => setTrackingTimedOut(true), 90_000);
    return () => clearTimeout(timer);
  }, [action.step]);
  const trackingActive =
    action.step === "done" &&
    statusCode !== 3 &&
    statusCode !== 4 &&
    !trackingTimedOut;

  const handleOpenChange = (next: boolean) => {
    if (!next && (pending || trackingActive)) return;
    onOpenChange(next);
    if (!next) finish();
  };

  const handleMax = () => {
    if (!token || balance === undefined) return;
    let max = balance;
    if (isNativeToken(token)) {
      // Leave fee headroom when spending the native token. Bitcoin fees are
      // sat-scale — 0.01 BTC would withhold a fortune — so buffer per chain.
      const buffer =
        srcChainKey === ChainKeys.BITCOIN_MAINNET
          ? 3_000n // sats
          : parseUnits("0.01", token.decimals);
      max = max > buffer ? max - buffer : 0n;
    }
    if (max <= 0n) {
      toast.info("Balance too low to cover network fees");
      return;
    }
    setAmount(formatUnits(max, token.decimals));
  };

  const handleDeposit = async () => {
    if (
      !vault ||
      !token ||
      !parsed ||
      minReceived === undefined ||
      !account.address ||
      !walletProvider
    ) {
      return;
    }
    await action.runDeposit({
      vault: vault.vault,
      srcChainKey,
      srcAddress: account.address,
      token,
      inputAmount: parsed,
      minOutputAmount: minReceived,
      walletProvider,
    });
  };

  type Cta = {
    label: string;
    disabled: boolean;
    busy?: boolean;
    onClick?: () => void;
  };
  // Token-first: a user whose only wallet is on another family (e.g. Phantom)
  // must be routed to the picker, not told to "connect" while already
  // connected — the source chain defaults to Ethereum until they pick.
  const cta: Cta = !token
    ? {
        label: "Select a token",
        disabled: false,
        onClick: () => setPickerOpen(true),
      }
    : !account.address
      ? {
          label: `Connect ${getChainName(srcChainKey)} wallet`,
          disabled: !onConnectWallet,
          onClick: onConnectWallet,
        }
      : !parsed
        ? { label: "Enter amount", disabled: true }
        : balance === undefined
          ? { label: "Checking balance…", disabled: true, busy: true }
          : parsed > balance
            ? { label: "Insufficient balance", disabled: true }
            : isWrongChain
              ? {
                  label: "Switch network",
                  disabled: false,
                  onClick: handleSwitchChain,
                }
              : noRoute
                ? { label: "No route for this pair", disabled: true }
                : quoted === undefined ||
                    minReceived === undefined ||
                    !walletProvider
                  ? { label: "Fetching quote…", disabled: true, busy: true }
                  : {
                      label: "Deposit",
                      disabled: false,
                      onClick: () => void handleDeposit(),
                    };

  const showTracking = action.step === "done" && action.response !== null;

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={handleOpenChange}
        disablePointerDismissal={pending || trackingActive}
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>
              {meta ? `Deposit into ${meta.title}` : "Deposit"}
            </DrawerTitle>
            <DrawerDescription>
              {vault
                ? `Swap any token into ${vault.name} shares on Sonic.`
                : "Select a vault to deposit."}
            </DrawerDescription>
          </DrawerHeader>

          {vault && showTracking ? (
            <div className="p-4">
              <IntentTracking
                statusCode={statusCode}
                fillTxHash={fillTxHash}
                successTitle="Deposited!"
                successBody="Shares delivered to your Sonic hub wallet."
                onDone={() => {
                  onOpenChange(false);
                  finish();
                }}
              />
            </div>
          ) : vault && pending ? (
            <div className="p-4">
              <ActionStepper
                step={action.step}
                approveNeeded={action.approveRequired ?? true}
              />
            </div>
          ) : vault ? (
            <>
              <div className="flex flex-col gap-4 overflow-y-auto p-4">
                {/* Source chain + token */}
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted active:bg-muted"
                >
                  {token ? (
                    <>
                      <ChainLogo chainKey={srcChainKey} />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="text-sm font-medium text-foreground">
                          {token.symbol}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          on {getChainName(srcChainKey)}
                        </span>
                      </div>
                    </>
                  ) : (
                    <span className="flex-1 text-sm text-muted-foreground">
                      Select chain &amp; token
                    </span>
                  )}
                  <ChevronDown className="size-4 text-muted-foreground" />
                </button>

                {/* Amount */}
                <div className="flex flex-col gap-1.5">
                  <input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode="decimal"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="0"
                    aria-label="Deposit amount"
                    disabled={!token}
                    className={cn(
                      "w-full bg-transparent text-4xl font-semibold text-foreground tabular-nums outline-none",
                      "placeholder:text-muted-foreground/40 disabled:opacity-50",
                    )}
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {token && account.address
                        ? balance !== undefined
                          ? `Balance: ${formatTokenAmount(balance, token.decimals)} ${token.symbol}`
                          : "Balance: —"
                        : " "}
                    </span>
                    {token && balance !== undefined && balance > 0n && (
                      <Button variant="ghost" size="xs" onClick={handleMax}>
                        Max
                      </Button>
                    )}
                  </div>
                </div>

                {/* Live quote */}
                {token && parsed ? (
                  <div className="flex flex-col gap-1 rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
                    {noRoute ? (
                      <span className="text-destructive">
                        No route for this pair
                      </span>
                    ) : quoted !== undefined && minReceived !== undefined ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            You receive
                          </span>
                          <span className="font-medium text-foreground tabular-nums">
                            ≈ {formatTokenAmount(quoted, 18)} {vault.name}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Min after {DEFAULT_SLIPPAGE_PCT}% slippage</span>
                          <span className="tabular-nums">
                            {formatTokenAmount(minReceived, 18)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Spinner className="size-3.5" /> Fetching quote…
                      </div>
                    )}
                  </div>
                ) : null}

                {action.step === "error" && action.error && (
                  <p
                    role="alert"
                    className={cn(
                      "rounded-xl px-3 py-2.5 text-sm",
                      action.error === "Cancelled in wallet"
                        ? "bg-muted/50 text-muted-foreground"
                        : "bg-destructive/10 text-destructive",
                    )}
                  >
                    {action.error}
                  </p>
                )}
              </div>

              <DrawerFooter>
                <Button
                  className="h-12 w-full text-base"
                  disabled={cta.disabled}
                  onClick={cta.onClick}
                >
                  {cta.busy && <Spinner className="size-4" />}
                  {cta.label}
                </Button>
              </DrawerFooter>
            </>
          ) : null}
        </DrawerContent>
      </Drawer>

      <TokenPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(chainKey, selected) => {
          setSrcChainKey(chainKey);
          setToken(selected);
          setAmount("");
        }}
      />
    </>
  );
}
