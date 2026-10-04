"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowSquareOut, Check, Copy, Warning } from "@phosphor-icons/react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCopy } from "@/components/settings-provider";
import { campaignUsd } from "@/lib/campaigns";
import {
  basescanAddress,
  basescanHolding,
  basescanToken,
  formatUsdcRaw,
  FUNDING_TOKEN,
  fundingCover,
  judgePayoutAddress,
  type PayoutAddressJudgement,
} from "@/lib/campaign-funding";
import type { StaffBalanceResponse } from "@/app/api/staff/campaigns/route";

/**
 * The Funding block of /staff/campaigns: where a sponsor's USDC goes, said
 * so it cannot be misread. The network and the token with its contract,
 * the payout wallet in full with a copy button, a Basescan link and a QR
 * code, one plain line for the sponsor, and the wallet's USDC on Base read
 * live, against the campaign's budget. Berth never holds the funds.
 */

export type BalanceRead = StaffBalanceResponse["balance"];
export type BalanceReader = (address: string) => Promise<BalanceRead>;

/** The staff page reads through /api/staff/campaigns; the dev gallery puts a fixture in its place. */
const readThroughApi: BalanceReader = async (address) => {
  const response = await fetch("/api/staff/campaigns", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "balance", address }),
  });
  if (!response.ok) return { outcome: "unreachable", error: `http ${response.status}` };
  return ((await response.json()) as StaffBalanceResponse).balance;
};

const BalanceReaderContext = createContext<BalanceReader>(readThroughApi);
export const BalanceReaderProvider = ({ reader, children }: { reader: BalanceReader; children: ReactNode }) => (
  <BalanceReaderContext.Provider value={reader}>{children}</BalanceReaderContext.Provider>
);

const clock = (ms: number) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(ms));

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-foreground underline underline-offset-2">
      {children}
      <ArrowSquareOut className="size-3.5" weight="duotone" aria-hidden />
    </a>
  );
}

function CopyButton({ value }: { value: string }) {
  const copy = useCopy().campaign.staff.funding;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      size="xs"
      variant="outline"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
    >
      {copied ? <Check className="size-3.5" weight="duotone" aria-hidden /> : <Copy className="size-3.5" weight="duotone" aria-hidden />}
      {copied ? copy.copied : copy.copy}
    </Button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-[8rem_1fr] sm:gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm text-foreground">{children}</dd>
    </div>
  );
}

/** A warning line in the house's warn colours. */
export function FundingWarning({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md border border-warn/50 bg-warn-soft px-3 py-2 text-sm text-foreground">
      <Warning className="mt-0.5 size-4 shrink-0 text-warn" weight="duotone" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function FundingBlock({
  address,
  amountUsd,
  budgetUsd,
  paidUsd = 0,
  otherWallets = 0,
}: {
  /** The payout wallet, checksummed. Null when the campaign has none yet. */
  address: string | null;
  amountUsd: number;
  budgetUsd: number;
  paidUsd?: number;
  otherWallets?: number;
}) {
  const copy = useCopy().campaign.staff.funding;
  const judged = address ? judgePayoutAddress(address) : null;
  const shown = judged?.kind === "ok" ? judged.address : address;
  // One of Berth's own addresses: never told to a sponsor, never called a wallet you control.
  const berth = judged?.kind === "ok" ? judged.berth : null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-foreground/70 bg-card p-4" data-testid="funding-block">
      <p className="text-sm font-medium text-foreground">{copy.heading}</p>
      <dl className="flex flex-col gap-2">
        <Row label={copy.network}>{copy.networkValue}</Row>
        <Row label={copy.token}>
          {copy.tokenValue}
          <span className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs break-all text-muted-foreground" title={copy.tokenContract}>
              {FUNDING_TOKEN.address}
            </span>
            <ExternalLink href={basescanToken()}>{copy.basescan}</ExternalLink>
          </span>
        </Row>
        <Row label={copy.wallet}>
          {shown ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="font-mono text-sm break-all text-foreground" data-testid="funding-address">
                  {shown}
                </span>
                {berth ? <FundingWarning>{copy.berthAddress[berth]}</FundingWarning> : <span className="text-xs text-muted-foreground">{copy.controlledBy}</span>}
                <span className="flex flex-wrap items-center gap-3">
                  <CopyButton value={shown} />
                  <ExternalLink href={basescanAddress(shown)}>{copy.basescan}</ExternalLink>
                </span>
              </div>
              {!berth && (
                <div className="w-fit shrink-0 rounded-md border border-border bg-white p-1.5" role="img" aria-label={copy.qrLabel}>
                  <QRCodeSVG value={shown} size={104} marginSize={0} />
                </div>
              )}
            </div>
          ) : (
            <FundingWarning>{copy.noWallet}</FundingWarning>
          )}
        </Row>
      </dl>
      {shown && !berth && (
        <>
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-foreground" data-testid="funding-instruction">
            {copy.instruction}
          </p>
          <p className="text-xs text-muted-foreground">{copy.berthHolds}</p>
          <FundingBalance address={shown} amountUsd={amountUsd} budgetUsd={budgetUsd} paidUsd={paidUsd} />
          {otherWallets > 0 && <p className="text-xs text-muted-foreground">{copy.moreWallets(otherWallets)}</p>}
        </>
      )}
    </div>
  );
}

function FundingBalance({ address, amountUsd, budgetUsd, paidUsd }: { address: string; amountUsd: number; budgetUsd: number; paidUsd: number }) {
  const copy = useCopy().campaign.staff.funding;
  const reader = useContext(BalanceReaderContext);
  const balance = useQuery({
    queryKey: ["staff-usdc-balance", address.toLowerCase()],
    queryFn: () => reader(address),
    staleTime: Infinity,
    retry: false,
  });
  const read = balance.data?.outcome === "read" ? BigInt(balance.data.raw) : null;
  const cover = read !== null ? fundingCover({ balanceRaw: read, amountUsd, budgetUsd, paidUsd }) : null;
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3" data-testid="funding-balance">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{copy.balance}</span>
        <span className="flex items-center gap-3">
          <ExternalLink href={basescanHolding(address)}>{copy.basescan}</ExternalLink>
          <Button size="xs" variant="outline" disabled={balance.isFetching} onClick={() => void balance.refetch()}>
            {balance.isFetching ? copy.reading : copy.refresh}
          </Button>
        </span>
      </div>
      {read !== null && cover ? (
        <>
          <p className="font-mono text-lg text-foreground">{formatUsdcRaw(read)}</p>
          <p className="text-sm text-foreground">
            {copy.enoughFor(cover.rewards)}{" "}
            <span className="text-muted-foreground">
              {copy.budgetNeeds(campaignUsd(cover.neededUsd), cover.neededRewards)}{" "}
              {cover.shortRaw === 0n ? copy.covered : copy.short(formatUsdcRaw(cover.shortRaw))}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">{copy.readAt(clock(balance.dataUpdatedAt))}</p>
        </>
      ) : balance.isFetching ? (
        <p className="text-sm text-muted-foreground">{copy.reading}</p>
      ) : (
        <p className="text-sm text-muted-foreground">{copy.unreadable}</p>
      )}
    </div>
  );
}

/** What the typed address is, said under the field. */
export function PayoutAddressNote({ judged, berth = true }: { judged: PayoutAddressJudgement; berth?: boolean }) {
  const copy = useCopy().campaign.staff.funding;
  if (judged.kind === "empty") return <p className="text-xs text-muted-foreground">{copy.addressHint}</p>;
  if (judged.kind !== "ok") return <FundingWarning>{copy.judgements[judged.kind]}</FundingWarning>;
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {copy.checksummed}: <span className="font-mono break-all text-foreground">{judged.address}</span>.{judged.berth ? "" : ` ${copy.controlledBy}`}
      </p>
      {berth && judged.berth && <FundingWarning>{copy.berthAddress[judged.berth]}</FundingWarning>}
    </>
  );
}

/** The payout wallet field of the create form, judged as it is typed. */
export function PayoutAddressField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const copy = useCopy().campaign.staff.funding;
  const judged = judgePayoutAddress(value);
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">
      {copy.addressLabel}
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="font-mono text-xs"
        spellCheck={false}
        autoComplete="off"
        aria-invalid={judged.kind !== "empty" && judged.kind !== "ok"}
        data-testid="payout-address-input"
      />
      {/* The Funding block under the form says a Berth address out loud; said once. */}
      <PayoutAddressNote judged={judged} berth={false} />
    </label>
  );
}
