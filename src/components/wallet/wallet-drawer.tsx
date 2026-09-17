"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCopy } from "@/components/settings-provider";
import {
  sortConnectors,
  useChainGroups,
  useWalletModal,
  useXConnectors,
  useXDisconnect,
  type ChainGroup,
  type IXConnector,
  type WalletModalState,
} from "@sodax/wallet-sdk-react";
import { ArrowLeft, ArrowSquareOut, CaretRight, Check, Plugs, Wallet, Warning } from "@phosphor-icons/react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useMounted } from "@/hooks/use-mounted";
import { shortenAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

/** `ChainType` is not exported from the package roots we may import — derive it. */
type ChainType = ChainGroup["chainType"];

/** Level-B states of the wallet-modal machine (everything that carries a chainType). */
type ConnectorLevelState = Extract<WalletModalState, { chainType: ChainType }>;

const ROW_CLASS =
  "flex h-14 w-full items-center gap-3 rounded-lg px-3 text-left transition-[transform,background-color] duration-150 ease-lift active:scale-[0.99]";

/**
 * Bottom drawer for connecting/managing wallets across all enabled chain
 * families. Level A lists families (with connected address + disconnect);
 * tapping a family shows its connector list (level B). Driven by the
 * headless `useWalletModal` state machine, kept in sync with `open`.
 */
export function WalletDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const mounted = useMounted();
  const { state, open: openModal, close: closeModal, back, selectChain, selectWallet, retry } =
    useWalletModal();
  const groups = useChainGroups();
  const disconnect = useXDisconnect();
  const [disconnecting, setDisconnecting] = useState<ChainType | null>(null);

  // Keep the headless machine in sync with the drawer's open prop. Only close
  // the machine on our own true -> false transition so a second mounted
  // WalletDrawer (open=false) can't fight an open one over the shared slice.
  const prevOpen = useRef(open);
  useEffect(() => {
    if (open && state.kind === "closed") openModal();
    else if (!open && prevOpen.current && state.kind !== "closed") closeModal();
    prevOpen.current = open;
  }, [open, state.kind, openModal, closeModal]);

  // Brief success confirmation, then return to the family list (drawer stays
  // open so the user can connect more families). close -> open lands on
  // chainSelect; both are synchronous store transitions.
  useEffect(() => {
    if (state.kind !== "success") return;
    const t = setTimeout(() => {
      closeModal();
      openModal();
    }, 1400);
    return () => clearTimeout(t);
  }, [state.kind, closeModal, openModal]);

  const atFamilyLevel = state.kind === "closed" || state.kind === "chainSelect";
  const activeGroup = atFamilyLevel
    ? undefined
    : groups.find((g) => g.chainType === state.chainType);

  const handleDisconnect = async (chainType: ChainType) => {
    setDisconnecting(chainType);
    try {
      await disconnect({ xChainType: chainType });
    } finally {
      setDisconnecting(null);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto w-full sm:max-w-lg">
        <DrawerHeader>
          <div className="relative flex items-center justify-center">
            {!atFamilyLevel && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Back"
                className="absolute left-0"
                onClick={back}
              >
                <ArrowLeft />
              </Button>
            )}
            <DrawerTitle>
              {atFamilyLevel
                ? "Wallets"
                : `Connect ${activeGroup?.displayName ?? state.chainType}`}
            </DrawerTitle>
          </div>
          <DrawerDescription>
            {atFamilyLevel
              ? "Connect a wallet for each network you want to deposit from."
              : "Choose a wallet to continue."}
          </DrawerDescription>
        </DrawerHeader>

        <div className="pt-2 pb-[max(env(safe-area-inset-bottom),1rem)]">
          {!mounted || !open ? (
            <DrawerListSkeleton />
          ) : atFamilyLevel ? (
            <FamilyList
              groups={groups}
              disconnecting={disconnecting}
              onSelect={selectChain}
              onDisconnect={handleDisconnect}
            />
          ) : (
            <ConnectorLevel
              state={state}
              onSelectWallet={(connector) => void selectWallet(connector)}
              onRetry={() => void retry()}
              onBack={back}
            />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* Level A — chain families                                            */
/* ------------------------------------------------------------------ */

function FamilyList({
  groups,
  disconnecting,
  onSelect,
  onDisconnect,
}: {
  groups: ChainGroup[];
  disconnecting: ChainType | null;
  onSelect: (chainType: ChainType) => void;
  onDisconnect: (chainType: ChainType) => void;
}) {
  const copy = useCopy();
  return (
    <ScrollArea className="max-h-[55svh]">
      <div className="flex flex-col gap-0.5 px-2">
        {groups.map((group) => {
          // The Privy-bridged embedded wallet surfaces here like any
          // wallet-standard connector, but it's the user's embedded account wallet, not an
          // external wallet: label it as such and hide the unplug (a manual
          // disconnect wouldn't auto-reconnect until the next sign-in, and
          // it would silently blank Solana from the funds sweep).
          const isEmbedded =
            group.connectorId?.toLowerCase().includes("privy") ?? false;
          return group.isConnected ? (
            <div key={group.chainType} className={ROW_CLASS}>
              <FamilyIcon group={group} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {group.displayName}
                  </span>
                  <Badge
                    variant="secondary"
                    className="h-4 gap-1 px-1.5 text-[10px]"
                  >
                    <span
                      aria-hidden
                      className="size-1.5 rounded-full bg-good"
                    />
                    {isEmbedded ? copy.walletEmbeddedLabel : copy.walletConnectedLabel}
                  </Badge>
                </span>
                {group.account?.address && (
                  <span className="truncate font-mono text-xs tabular-nums text-muted-foreground">
                    {shortenAddress(group.account.address)}
                    {isEmbedded ? copy.walletEmbeddedNote : ""}
                  </span>
                )}
              </div>
              {!isEmbedded && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Disconnect ${group.displayName}`}
                  disabled={disconnecting === group.chainType}
                  onClick={() => onDisconnect(group.chainType)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  {disconnecting === group.chainType ? <Spinner /> : <Plugs />}
                </Button>
              )}
            </div>
          ) : (
            <button
              key={group.chainType}
              type="button"
              onClick={() => onSelect(group.chainType)}
              className={cn(ROW_CLASS, "hover:bg-muted active:bg-muted")}
            >
              <FamilyIcon group={group} />
              <span className="flex-1 text-sm font-medium text-foreground">
                {group.displayName}
              </span>
              <CaretRight className="size-4 text-muted-foreground" />
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function FamilyIcon({ group }: { group: ChainGroup }) {
  if (group.iconUrl) {
    return (
      // Icon URLs come from the SDK chain registry (arbitrary hosts / data
      // URIs) — next/image can't optimize these.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={group.iconUrl}
        alt=""
        className="size-8 shrink-0 rounded-full"
      />
    );
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Wallet className="size-4" />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Level B — connectors for one family                                 */
/* ------------------------------------------------------------------ */

function ConnectorLevel({
  state,
  onSelectWallet,
  onRetry,
  onBack,
}: {
  state: ConnectorLevelState;
  onSelectWallet: (connector: IXConnector) => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  const connectors = useXConnectors({ xChainType: state.chainType });
  const sorted = useMemo(() => sortConnectors(connectors), [connectors]);

  if (state.kind === "connecting") {
    const isWalletConnect = state.connector.id === "walletConnect";
    return (
      <StatusPanel
        icon={<ConnectorIcon connector={state.connector} size="lg" />}
        title={
          isWalletConnect
            ? "Continue in your wallet…"
            : `Waiting for ${state.connector.name}…`
        }
        detail={
          isWalletConnect
            ? "Scan the QR code or approve the request in your wallet app."
            : "Approve the connection request in your wallet."
        }
      >
        <Spinner className="size-5 text-muted-foreground" />
        <Button variant="ghost" size="sm" onClick={onBack}>
          Cancel
        </Button>
      </StatusPanel>
    );
  }

  if (state.kind === "error") {
    const { title, detail } = friendlyConnectError(state.error);
    return (
      <StatusPanel
        icon={
          <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Warning className="size-5" />
          </span>
        }
        title={title}
        detail={detail}
      >
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onBack}>
            Choose another wallet
          </Button>
          <Button size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </StatusPanel>
    );
  }

  if (state.kind === "success") {
    return (
      <StatusPanel
        icon={
          <span className="flex size-12 items-center justify-center rounded-full bg-good-soft text-good">
            <Check className="size-5" />
          </span>
        }
        title="Connected"
        detail={
          state.account.address
            ? `${state.connector.name} · ${shortenAddress(state.account.address)}`
            : state.connector.name
        }
      />
    );
  }

  // walletSelect
  if (sorted.length === 0) {
    return (
      <StatusPanel
        icon={
          <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Wallet className="size-5" />
          </span>
        }
        title="No wallets found"
        detail="No wallets are available for this network in your browser."
      >
        <Button variant="outline" size="sm" onClick={onBack}>
          Back
        </Button>
      </StatusPanel>
    );
  }

  return (
    <ScrollArea className="max-h-[55svh]">
      <div className="flex flex-col gap-0.5 px-2">
        {sorted.map((connector) => (
          <ConnectorRow
            key={connector.id}
            connector={connector}
            onSelect={onSelectWallet}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

function ConnectorRow({
  connector,
  onSelect,
}: {
  connector: IXConnector;
  onSelect: (connector: IXConnector) => void;
}) {
  if (!connector.isInstalled && connector.installUrl) {
    return (
      <div className={ROW_CLASS}>
        <ConnectorIcon connector={connector} />
        <span className="flex-1 truncate text-sm font-medium text-muted-foreground">
          {connector.name}
        </span>
        <a
          href={connector.installUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Get
          <ArrowSquareOut className="size-3.5" />
        </a>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={!connector.isInstalled}
      onClick={() => onSelect(connector)}
      className={cn(
        ROW_CLASS,
        "hover:bg-muted active:bg-muted disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      <ConnectorIcon connector={connector} />
      <span className="flex-1 truncate text-sm font-medium text-foreground">
        {connector.name}
      </span>
      <CaretRight className="size-4 text-muted-foreground" />
    </button>
  );
}

function ConnectorIcon({
  connector,
  size = "md",
}: {
  connector: IXConnector;
  size?: "md" | "lg";
}) {
  const sizeClass = size === "lg" ? "size-12" : "size-8";
  if (connector.icon) {
    return (
      // Connector icons are wallet-provided URLs, frequently data: URIs —
      // next/image doesn't support them.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={connector.icon}
        alt={`${connector.name} logo`}
        className={cn(sizeClass, "shrink-0 rounded-md")}
      />
    );
  }
  return (
    <span
      className={cn(
        sizeClass,
        "flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground",
      )}
    >
      <Wallet className={size === "lg" ? "size-5" : "size-4"} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function StatusPanel({
  icon,
  title,
  detail,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
      {icon}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {detail && (
          <p className="line-clamp-3 text-xs break-words text-muted-foreground">
            {detail}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

function DrawerListSkeleton() {
  return (
    <div className="flex flex-col gap-0.5 px-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className={ROW_CLASS}>
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-4 w-28" />
        </div>
      ))}
    </div>
  );
}

function friendlyConnectError(error: Error): {
  title: string;
  detail: string;
} {
  const message = error.message ?? "";
  if (/reject|denied|cancell?ed|dismiss/i.test(message)) {
    return {
      title: "Request cancelled",
      detail: "You dismissed the request in your wallet. Try again when ready.",
    };
  }
  return {
    title: "Connection failed",
    detail: message || "Something went wrong while connecting.",
  };
}
