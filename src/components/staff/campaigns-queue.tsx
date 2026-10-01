"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import { useCopy } from "@/components/settings-provider";
import { useAccountHeaders } from "@/hooks/use-profile";
import { usePrivy } from "@privy-io/react-auth";
import { campaignUsd, REJECT_REASONS } from "@/lib/campaigns";
import { cn } from "@/lib/utils";
import type { StaffCampaignsResponse } from "@/app/api/staff/campaigns/route";
import type { CampaignMeter, QueueClaim } from "@/lib/server/campaigns/queue";

/**
 * The staff review queue for campaigns (/staff/campaigns). A plain,
 * self contained section with no navigation of its own, so it can sit
 * inside the staff shell. Every read and write goes through
 * /api/staff/campaigns, which answers only accounts on STAFF_ADMIN_IDS;
 * this component holds no data of its own until the server says yes.
 */

export type StaffAction =
  | { action: "approve"; claimId: string }
  | { action: "reject"; claimId: string; reason: string; note: string }
  | { action: "paid"; claimId: string; txHash: string }
  | { action: "activate"; campaignId: string; counselReviewed: true }
  | { action: "pause"; campaignId: string }
  | { action: "create"; campaign: Record<string, string> }
  | { action: "reveal"; claimId: string; field: "email" | "wallets" }
  | { action: "add_source"; campaignId: string; address: string; reason: string }
  | { action: "remove_source"; sourceId: string; reason: string };

/** Fields shown in full after an audited reveal, by claim. */
export type Revealed = Record<string, { email?: string | null; wallets?: QueueClaim["wallets"]; payout?: string | null; payer?: string | null; deliveredTo?: string | null }>;

type Fetched = { status: "missing" } | { status: "stale" } | { status: "ready"; data: StaffCampaignsResponse };

export function StaffCampaigns() {
  const copy = useCopy().campaign.staff;
  const { key, headers } = useAccountHeaders();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [revealed, setRevealed] = useState<Revealed>({});
  const privy = usePrivy();

  const post = async (body: Record<string, unknown>): Promise<Fetched> => {
    const auth = await headers();
    if (!auth) return { status: "missing" };
    const response = await fetch("/api/staff/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify(body),
    });
    if (response.status === 404) return { status: "missing" };
    if (response.status === 403) return { status: "stale" };
    if (!response.ok) throw new Error(`staff campaigns ${response.status}`);
    return { status: "ready", data: (await response.json()) as StaffCampaignsResponse };
  };

  const queue = useQuery({
    queryKey: ["staff-campaigns", key],
    enabled: key !== null,
    retry: false,
    queryFn: () => post({ action: "queue" }),
  });
  const act = useMutation({
    mutationFn: (action: StaffAction) => post(action),
    onSuccess: (answer) => {
      if (answer.status === "stale") {
        setStale(true);
        setMessage(copy.refusals.fresh_session);
        return;
      }
      setStale(false);
      queryClient.setQueryData(["staff-campaigns", key], answer);
      const result = answer.status === "ready" ? answer.data.result : undefined;
      if (result?.ok && result.detail?.field) {
        const { claimId, values } = result.detail as { claimId: string; values: Revealed[string] };
        setRevealed((previous) => ({ ...previous, [claimId]: { ...previous[claimId], ...values } }));
      }
      setMessage(result && !result.ok ? (copy.refusals[result.refusal] ?? result.refusal) : null);
    },
    onError: () => setMessage(copy.failed),
  });

  if (key === null || queue.data?.status === "missing") return <StaffShell>{copy.nothingHere}</StaffShell>;
  if (queue.isError) return <StaffShell>{copy.failed}</StaffShell>;
  if (queue.data?.status !== "ready") return <StaffShell>{copy.loading}</StaffShell>;
  return (
    <CampaignsQueueView
      queue={queue.data.data}
      busy={act.isPending}
      message={message}
      revealed={revealed}
      onSignInAgain={
        stale
          ? () => {
              void privy.logout().then(() => privy.login());
            }
          : undefined
      }
      onAction={(action) => act.mutate(action)}
    />
  );
}

function StaffShell({ children }: { children: ReactNode }) {
  const copy = useCopy().campaign.staff;
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="font-display text-xl text-foreground">{copy.title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{children}</p>
    </section>
  );
}

const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "?";

/** The queue, given the data: the page and the dev gallery (/dev/campaigns) both render this. */
export function CampaignsQueueView({
  queue,
  busy = false,
  message = null,
  revealed = {},
  onSignInAgain,
  onAction,
}: {
  queue: StaffCampaignsResponse;
  revealed?: Revealed;
  onSignInAgain?: () => void;
  busy?: boolean;
  message?: string | null;
  onAction: (action: StaffAction) => void;
}) {
  const copy = useCopy().campaign.staff;
  const groups = {
    qualified: queue.claims.filter((claim) => claim.state === "qualified"),
    approved: queue.claims.filter((claim) => claim.state === "approved"),
    holding: queue.claims.filter((claim) => claim.state === "holding"),
    paid: queue.claims.filter((claim) => claim.state === "paid"),
    closed: queue.claims.filter((claim) => claim.state === "rejected" || claim.state === "expired"),
  };
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8" data-testid="staff-campaigns">
      <header>
        <h1 className="font-display text-xl text-foreground">{copy.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{copy.lede}</p>
      </header>
      {message && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground">
          <span className="min-w-0 flex-1">{message}</span>
          {onSignInAgain && (
            <Button size="xs" onClick={onSignInAgain}>
              {copy.signInAgain}
            </Button>
          )}
        </div>
      )}
      {queue.campaigns.map((campaign) => (
        <CampaignCard key={campaign.id} campaign={campaign} busy={busy} onAction={onAction} />
      ))}
      <CreateCampaign busy={busy} onAction={onAction} />
      {(Object.keys(groups) as (keyof typeof groups)[]).map((group) => (
        <div key={group} className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-foreground">
            {copy.sections[group]} <span className="text-muted-foreground">{groups[group].length}</span>
          </h2>
          {groups[group].length === 0 ? (
            <p className="text-sm text-muted-foreground">{copy.empty}</p>
          ) : (
            groups[group].map((claim) => <ClaimCard key={claim.id} claim={withRevealed(claim, revealed[claim.id])} revealed={revealed[claim.id]} busy={busy} onAction={onAction} />)
          )}
        </div>
      ))}
    </section>
  );
}

function CampaignCard({ campaign, busy, onAction }: { campaign: CampaignMeter; busy: boolean; onAction: (action: StaffAction) => void }) {
  const copy = useCopy().campaign.staff;
  const [confirming, setConfirming] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const reservedPct = Math.min(100, (campaign.reservedUsd / campaign.budgetUsd) * 100);
  const paidPct = Math.min(100 - reservedPct, (campaign.paidUsd / campaign.budgetUsd) * 100);
  return (
    <Panel className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base text-foreground">{campaign.title}</p>
          <p className="font-mono text-xs text-muted-foreground">
            /c/{campaign.code} · {copy.span(when(campaign.startsAt), when(campaign.endsAt))}
          </p>
        </div>
        <span
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-xs",
            campaign.active ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground",
          )}
        >
          {campaign.active ? copy.active : copy.inactive}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        {copy.terms(campaignUsd(campaign.amountUsd), campaignUsd(campaign.minBuyUsd), campaign.holdDays)}
      </p>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full bg-primary" style={{ width: `${paidPct}%` }} />
        <div className="h-full bg-primary/40" style={{ width: `${reservedPct}%` }} />
      </div>
      <p className="text-sm text-foreground" data-testid="budget-meter">
        {copy.meter(
          campaignUsd(campaign.reservedUsd),
          campaignUsd(campaign.paidUsd),
          campaignUsd(campaign.budgetUsd),
          campaign.slots,
          campaign.maxClaims,
        )}
      </p>
      <p className="text-xs text-muted-foreground">{copy.waiting(campaign.counts.attributed, campaign.counts.buying)}</p>
      <PayoutSources campaign={campaign} busy={busy} onAction={onAction} />
      {campaign.active ? (
        <div>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction({ action: "pause", campaignId: campaign.id })}>
            {copy.deactivate}
          </Button>
        </div>
      ) : confirming ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3" data-testid="activate-confirm">
          <p className="text-sm text-foreground">{copy.activateConfirm(campaign.title)}</p>
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input type="checkbox" className="mt-0.5" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
            {copy.activateCheck}
          </label>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || !reviewed}
              onClick={() => {
                onAction({ action: "activate", campaignId: campaign.id, counselReviewed: true });
                setConfirming(false);
                setReviewed(false);
              }}
            >
              {copy.confirm}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              {copy.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(true)}>
            {copy.activate}
          </Button>
        </div>
      )}
    </Panel>
  );
}

/** The claim with whatever was revealed for it put back in full. */
function withRevealed(claim: QueueClaim, shown: Revealed[string] | undefined): QueueClaim {
  if (!shown) return claim;
  return {
    ...claim,
    email: shown.email !== undefined ? shown.email : claim.email,
    wallets: shown.wallets ?? claim.wallets,
    payout: shown.payout !== undefined ? { ...claim.payout, address: shown.payout } : claim.payout,
    buy: claim.buy && shown.wallets ? { ...claim.buy, payer: shown.payer ?? null, deliveredTo: shown.deliveredTo ?? null } : claim.buy,
  };
}

function PayoutSources({ campaign, busy, onAction }: { campaign: CampaignMeter; busy: boolean; onAction: (action: StaffAction) => void }) {
  const copy = useCopy().campaign.staff.sources;
  const [address, setAddress] = useState("");
  const [reason, setReason] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3" data-testid="payout-sources">
      <p className="text-sm text-foreground">{copy.heading}</p>
      {campaign.payoutSources.length === 0 ? (
        <p className="text-xs text-muted-foreground">{copy.none}</p>
      ) : (
        campaign.payoutSources.map((source) => (
          <div key={source.id} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Mono>{source.address}</Mono>
              {removing !== source.id && (
                <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={() => setRemoving(source.id)}>
                  {copy.remove}
                </Button>
              )}
            </div>
            <span className="text-xs text-muted-foreground">{copy.added(when(source.addedAt), source.reason)}</span>
            {removing === source.id && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input aria-label={copy.removeReason} placeholder={copy.removeReason} value={removeReason} onChange={(event) => setRemoveReason(event.target.value)} />
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy || !removeReason.trim()}
                  onClick={() => {
                    onAction({ action: "remove_source", sourceId: source.id, reason: removeReason.trim() });
                    setRemoving(null);
                    setRemoveReason("");
                  }}
                >
                  {copy.remove}
                </Button>
              </div>
            )}
          </div>
        ))
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input aria-label={copy.address} placeholder={copy.address} value={address} onChange={(event) => setAddress(event.target.value)} className="font-mono text-xs" />
        <Input aria-label={copy.reason} placeholder={copy.reason} value={reason} onChange={(event) => setReason(event.target.value)} />
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !address.trim() || !reason.trim()}
          onClick={() => {
            onAction({ action: "add_source", campaignId: campaign.id, address: address.trim(), reason: reason.trim() });
            setAddress("");
            setReason("");
          }}
        >
          {copy.add}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{copy.fallback}</p>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words text-foreground">{children}</dd>
    </div>
  );
}

const Mono = ({ children }: { children: ReactNode }) => <span className="font-mono text-xs break-all">{children}</span>;

function ClaimCard({
  claim,
  revealed,
  busy,
  onAction,
}: {
  claim: QueueClaim;
  revealed?: Revealed[string];
  busy: boolean;
  onAction: (action: StaffAction) => void;
}) {
  const copy = useCopy().campaign.staff;
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [txHash, setTxHash] = useState(claim.paid?.tx ?? "");
  const rejectable = claim.state === "holding" || claim.state === "qualified" || claim.state === "approved";
  return (
    <Panel className="flex flex-col gap-3 p-4" data-testid="claim">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex items-center gap-2 text-sm text-foreground">
          {claim.email ?? claim.userId}
          {claim.email && revealed?.email === undefined && (
            <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={() => onAction({ action: "reveal", claimId: claim.id, field: "email" })}>
              {copy.reveal}
            </Button>
          )}
        </p>
        <span className="text-xs text-muted-foreground">
          {copy.states[claim.state]} · /c/{claim.campaignCode}
        </span>
      </div>
      <dl className="flex flex-col gap-2">
        <Fact label={copy.labels.account}>
          <Mono>{claim.userId}</Mono>
        </Fact>
        <Fact label={copy.labels.signup}>
          {copy.signupLine(when(claim.signupAt), when(claim.attributedAt))}
        </Fact>
        {claim.buy && (
          <Fact label={copy.labels.order}>
            {copy.buyLine(
              claim.buy.usd === null ? "?" : campaignUsd(Math.round(claim.buy.usd * 100) / 100),
              claim.buy.listing,
              claim.buy.quantity ?? "?",
              when(claim.buy.filledAt),
            )}
            <br />
            <Mono>{claim.buy.intentTx}</Mono>
            <br />
            <span className="text-xs text-muted-foreground">
              {copy.paidFrom} <Mono>{claim.buy.payer ?? "?"}</Mono>, {copy.deliveredTo} <Mono>{claim.buy.deliveredTo ?? "?"}</Mono>
            </span>
          </Fact>
        )}
        {claim.holdingSince && (
          <Fact label={copy.labels.holding}>
            {copy.span(when(claim.holdingSince), when(claim.eligibleAt))}
          </Fact>
        )}
        {claim.unreadableSince && <Fact label={copy.labels.holdCheck}>{copy.unreadableSince(when(claim.unreadableSince))}</Fact>}
        {claim.hold && (
          <Fact label={copy.labels.holdCheck}>
            {when(claim.hold.checkedAt)}. {copy.holdSeen(claim.hold.lowestRaw ?? claim.hold.balanceRaw ?? copy.unread, claim.hold.needed ?? "?", claim.hold.outflows ?? 0)}
          </Fact>
        )}
        <Fact label={copy.labels.wallets}>
          {revealed?.wallets === undefined && claim.wallets.length > 0 && (
            <Button size="xs" variant="ghost" className="mb-1 text-muted-foreground" disabled={busy} onClick={() => onAction({ action: "reveal", claimId: claim.id, field: "wallets" })}>
              {copy.revealWallets}
            </Button>
          )}
          {claim.wallets.length === 0
            ? copy.empty
            : claim.wallets.map((wallet) => (
                <span key={wallet.address} className="block">
                  <Mono>{wallet.address}</Mono> <span className="text-xs text-muted-foreground">{wallet.family}{wallet.linked ? "" : `, ${copy.unlinked}`}</span>
                </span>
              ))}
        </Fact>
        <Fact label={copy.labels.signals}>
          {claim.signals.length === 0 ? copy.noSignals : claim.signals.map((signal) => <span key={signal} className="block">{copy.signals[signal]}</span>)}
          <span className="block text-xs text-muted-foreground">{copy.noDeviceSignals}</span>
        </Fact>
        {(claim.state === "qualified" || claim.state === "approved") && (
          <Fact label={copy.labels.payTo}>
            {copy.payTo(campaignUsd(claim.payout.amountUsd), claim.payout.chain)}
            <br />
            <Mono>{claim.payout.address ?? "?"}</Mono>
          </Fact>
        )}
        {claim.paid && (
          <Fact label={copy.labels.paid}>
            {when(claim.paid.at)}. {claim.paid.verified ? copy.verified : copy.unverified}
            <br />
            <Mono>{claim.paid.tx}</Mono>
          </Fact>
        )}
        {claim.reason && (
          <Fact label={copy.labels.reason}>
            {(copy.rejectReasons as Record<string, string>)[claim.reason] ??
              (copy.expireReasons as Record<string, string>)[claim.reason] ??
              (copy.systemReasons as Record<string, string>)[claim.reason] ??
              claim.reason}
          </Fact>
        )}
      </dl>

      {claim.state === "qualified" && !rejecting && (
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => onAction({ action: "approve", claimId: claim.id })}>
            {copy.approve}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting(true)}>
            {copy.reject}
          </Button>
        </div>
      )}
      {claim.state === "approved" && <p className="text-xs text-muted-foreground">{copy.batchNote}</p>}
      {claim.state === "approved" && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label={copy.txHash}
            placeholder={copy.txHash}
            value={txHash}
            onChange={(event) => setTxHash(event.target.value)}
            className="font-mono text-xs"
          />
          <Button size="sm" disabled={busy || !txHash.trim()} onClick={() => onAction({ action: "paid", claimId: claim.id, txHash: txHash.trim() })}>
            {claim.paid?.tx && claim.paid.tx === txHash.trim().toLowerCase() ? copy.recheck : copy.markPaid}
          </Button>
        </div>
      )}
      {rejectable && claim.state !== "qualified" && !rejecting && (
        <div>
          <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={() => setRejecting(true)}>
            {copy.reject}
          </Button>
        </div>
      )}
      {rejecting && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <select
            aria-label={copy.labels.reason}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
          >
            <option value="">{copy.labels.reason}</option>
            {REJECT_REASONS.map((value) => (
              <option key={value} value={value}>
                {copy.rejectReasons[value]}
              </option>
            ))}
          </select>
          <Input aria-label={copy.rejectNote} placeholder={copy.rejectNote} value={note} onChange={(event) => setNote(event.target.value)} />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={busy || !reason}
              onClick={() => {
                onAction({ action: "reject", claimId: claim.id, reason, note });
                setRejecting(false);
              }}
            >
              {copy.reject}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              {copy.cancel}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function CreateCampaign({ busy, onAction }: { busy: boolean; onAction: (action: StaffAction) => void }) {
  const copy = useCopy().campaign.staff.create;
  const [fields, setFields] = useState<Record<string, string>>({
    code: "",
    title: "",
    amountUsd: "5",
    budgetUsd: "100",
    maxClaims: "20",
    minBuyUsd: "10",
    holdDays: "7",
    startsAt: "",
    endsAt: "",
  });
  const field = (name: string, label: string, type = "text") => (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Input type={type} value={fields[name]} onChange={(event) => setFields({ ...fields, [name]: event.target.value })} />
    </label>
  );
  return (
    <details className="rounded-lg border border-border bg-card p-4">
      <summary className="cursor-pointer text-sm text-foreground">{copy.heading}</summary>
      <p className="mt-2 text-xs text-muted-foreground">{copy.note}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field("code", copy.code)}
        {field("title", copy.title)}
        {field("amountUsd", copy.amount, "number")}
        {field("budgetUsd", copy.budget, "number")}
        {field("maxClaims", copy.maxClaims, "number")}
        {field("minBuyUsd", copy.minBuy, "number")}
        {field("holdDays", copy.holdDays, "number")}
        <span />
        {field("startsAt", copy.starts, "datetime-local")}
        {field("endsAt", copy.ends, "datetime-local")}
      </div>
      <Button
        size="sm"
        className="mt-3"
        disabled={busy}
        onClick={() =>
          onAction({
            action: "create",
            campaign: {
              ...fields,
              startsAt: fields.startsAt ? new Date(fields.startsAt).toISOString() : "",
              endsAt: fields.endsAt ? new Date(fields.endsAt).toISOString() : "",
            },
          })
        }
      >
        {copy.submit}
      </Button>
    </details>
  );
}
