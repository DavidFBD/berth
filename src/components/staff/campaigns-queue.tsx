"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowSquareOut, CaretRight } from "@phosphor-icons/react";
import { QRCodeSVG } from "qrcode.react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, buttonVariants } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import { useCopy } from "@/components/settings-provider";
import { usePrivy } from "@privy-io/react-auth";
import { activationGaps, campaignLinkUrl, campaignUsd, localDateTime, normalizeCampaignCode, REJECT_REASONS, suggestedAction } from "@/lib/campaigns";
import { cn, scrollIntoViewGently } from "@/lib/utils";
import type { StaffCampaignsResponse } from "@/app/api/staff/campaigns/route";
import type { CampaignMeter, QueueClaim } from "@/lib/server/campaigns/queue";
import { formatUsdcRaw, fundingLineState, judgePayoutAddress } from "@/lib/campaign-funding";
import { campaignStats, campaignStatus, claimGroups, needsYou, type CampaignStats } from "@/lib/campaign-stats";
import { CopyButton, FundingBlock, PayoutAddressField, PayoutAddressNote, useFundingBalance } from "@/components/staff/campaign-funding";

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
  | { action: "activate"; campaignId: string; counselReviewed: true; fundingChecked: true }
  | { action: "pause"; campaignId: string }
  | { action: "announce"; campaignId: string; on: boolean }
  | { action: "delete"; campaignId: string; reason: string }
  | { action: "rename"; campaignId: string; code: string; reason: string }
  | { action: "create"; campaign: Record<string, string> }
  | { action: "reveal"; claimId: string; field: "email" | "wallets" }
  | { action: "add_source"; campaignId: string; address: string; reason: string }
  | { action: "remove_source"; sourceId: string; reason: string };

/** Fields shown in full after an audited reveal, by claim. */
export type Revealed = Record<
  string,
  { email?: string | null; wallets?: QueueClaim["wallets"]; payout?: string | null }
>;

type Fetched = { status: "missing" } | { status: "stale" } | { status: "ready"; data: StaffCampaignsResponse };

export function StaffCampaigns() {
  const copy = useCopy().campaign.staff;
  // The staff session cookie carries who this is (lib/server/staff-auth); no token needed.
  const key = "staff";
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [revealed, setRevealed] = useState<Revealed>({});
  /** The campaign a create just made, so its own card can say so instead of a message out of view. */
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  /** Bumped after a successful create to remount the form closed and empty. */
  const [createFormKey, setCreateFormKey] = useState(0);
  const privy = usePrivy();

  const post = async (body: Record<string, unknown>): Promise<Fetched> => {
    const response = await fetch("/api/staff/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 404) return { status: "missing" };
    if (response.status === 401) return { status: "stale" };
    if (!response.ok) throw new Error(`staff campaigns ${response.status}`);
    return { status: "ready", data: (await response.json()) as StaffCampaignsResponse };
  };

  const queue = useQuery({
    queryKey: ["staff-campaigns", key],
    retry: false,
    queryFn: () => post({ action: "queue" }),
  });
  const act = useMutation({
    mutationFn: (action: StaffAction) => post(action),
    onSuccess: (answer, action) => {
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
      // A created campaign says so on its own card, scrolled into view, rather
      // than in a message at the top of a long page the person has scrolled past.
      if (action.action === "create" && result?.ok) {
        setJustCreatedId(typeof result.detail?.id === "string" ? (result.detail.id as string) : null);
        setCreateFormKey((value) => value + 1);
        setMessage(null);
        return;
      }
      setMessage(
        result && !result.ok
          ? (copy.refusals[result.refusal] ?? result.refusal)
          : result?.ok && action.action === "delete"
            ? copy.deleted(String(result.detail?.code ?? ""))
            : null,
      );
    },
    onError: () => setMessage(copy.failed),
  });

  if (queue.data?.status === "missing") return <StaffShell>{copy.nothingHere}</StaffShell>;
  if (queue.isError) return <StaffShell>{copy.failed}</StaffShell>;
  if (queue.data?.status !== "ready") return <StaffShell>{copy.loading}</StaffShell>;
  return (
    <CampaignsQueueView
      queue={queue.data.data}
      busy={act.isPending}
      message={message}
      revealed={revealed}
      justCreatedId={justCreatedId}
      createFormResetKey={createFormKey}
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
  createPrefill,
  justCreatedId = null,
  createFormResetKey = 0,
}: {
  queue: StaffCampaignsResponse;
  /** The dev gallery opens the create form prefilled, to show its Funding block. */
  createPrefill?: Record<string, string>;
  revealed?: Revealed;
  onSignInAgain?: () => void;
  busy?: boolean;
  message?: string | null;
  onAction: (action: StaffAction) => void;
  /** The campaign to show the "just created" line on. The real page tracks this itself; the dev gallery can force it with ?created=. */
  justCreatedId?: string | null;
  /** Bumped by the caller after a successful create, to remount the create form closed and empty. */
  createFormResetKey?: number;
}) {
  const copy = useCopy().campaign.staff;
  const messageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Any message (success or refusal) says something where the person is,
    // not only at the top of a page they may have scrolled away from.
    if (!message) return;
    scrollIntoViewGently(messageRef.current);
    messageRef.current?.focus({ preventScroll: true });
  }, [message]);
  // A card's Review or Pay narrows the claims below to that campaign, until Show all.
  const [only, setOnly] = useState<{ campaignId: string; section: "qualified" | "approved" } | null>(null);
  const onlyCampaign = only ? queue.campaigns.find((campaign) => campaign.id === only.campaignId) ?? null : null;
  const groups = claimGroups(queue.claims, onlyCampaign?.id ?? null);
  // The do-not-pay warning counts every campaign's approved claims, whatever is shown below.
  const ineligibleApproved = queue.claims.filter((claim) => claim.state === "approved" && claim.staffIneligibleAt).length;
  useEffect(() => {
    if (only) scrollIntoViewGently(document.getElementById(`claims-${only.section}`), { block: "start" });
  }, [only]);
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8" data-testid="staff-campaigns">
      <header>
        <h1 className="font-display text-xl text-foreground">{copy.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{copy.lede}</p>
      </header>
      {message && (
        <div
          ref={messageRef}
          role="status"
          tabIndex={-1}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground outline-none"
        >
          <span className="min-w-0 flex-1">{message}</span>
          {onSignInAgain && (
            <Button size="xs" onClick={onSignInAgain}>
              {copy.signInAgain}
            </Button>
          )}
        </div>
      )}
      {ineligibleApproved > 0 && (
        <div role="alert" data-testid="ineligible-approved" className="rounded-lg border border-warn/50 bg-warn-soft px-4 py-3 text-sm text-foreground">
          {copy.ineligibleApproved(ineligibleApproved)}
        </div>
      )}
      {queue.campaigns.map((campaign) => (
        <CampaignCard
          key={campaign.id}
          campaign={campaign}
          busy={busy}
          onAction={onAction}
          justCreated={campaign.id === justCreatedId}
          onReview={(section) => setOnly({ campaignId: campaign.id, section })}
        />
      ))}
      <CreateCampaign key={createFormResetKey} busy={busy} onAction={onAction} prefill={createPrefill} />
      {onlyCampaign && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground" data-testid="claims-only">
          <span>{copy.claimsOf(onlyCampaign.title)}</span>
          <Button size="xs" variant="outline" onClick={() => setOnly(null)}>
            {copy.showAllClaims}
          </Button>
        </div>
      )}
      {(Object.keys(groups) as (keyof typeof groups)[]).map((group) => (
        <div key={group} id={`claims-${group}`} className="flex scroll-mt-6 flex-col gap-3">
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

function CampaignCard({
  campaign,
  busy,
  onAction,
  justCreated = false,
  onReview,
}: {
  campaign: CampaignMeter;
  busy: boolean;
  onAction: (action: StaffAction) => void;
  /** This campaign is the one a create just made this session. */
  justCreated?: boolean;
  /** Shows only this campaign's claims below, at that section. */
  onReview: (section: "qualified" | "approved") => void;
}) {
  const copy = useCopy().campaign.staff;
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [fundingChecked, setFundingChecked] = useState(false);
  const fundingCopy = useCopy().campaign.staff.funding;
  const wallet = campaign.payoutSources[0]?.address ?? null;
  const gaps = activationGaps({ wallet, fundingChecked, reviewed });
  const stats = campaignStats(campaign);
  const status = campaignStatus(campaign);
  const waiting = needsYou(stats);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Bring the new campaign's own card to the person, rather than leaving
    // them to find it in a list they have already scrolled past.
    if (justCreated) scrollIntoViewGently(cardRef.current);
  }, [justCreated]);
  return (
    <div ref={cardRef} data-testid="campaign-card" data-campaign-code={campaign.code} data-status={status}>
      <Panel className="flex flex-col gap-5 p-4 sm:p-5">
        {justCreated && (
          <p role="status" className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground" data-testid="created-status">
            {copy.create.createdLine(campaign.title)}
          </p>
        )}

        {/* 1. Header: name, status, dates in the reader's own time. */}
        <header className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="min-w-0 font-display text-lg leading-tight text-foreground">{campaign.title}</h2>
            <span
              data-testid="campaign-status"
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs",
                status === "live" ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground",
              )}
            >
              {copy.status[status]}
            </span>
          </div>
          <p className="text-sm text-muted-foreground" data-testid="campaign-dates">
            {copy.span(zonedWhen(campaign.startsAt), zonedWhen(campaign.endsAt))}
          </p>
          <p className="text-xs text-muted-foreground">
            {campaign.kind === "signup" ? copy.terms(campaignUsd(campaign.amountUsd), campaign.stayDays) : copy.retired}
          </p>
        </header>

        {/* 2. The share link: the card's main action. */}
        <ShareLink campaign={campaign} busy={busy} onAction={onAction} />

        {/* 3. The numbers at a glance. */}
        <CampaignStatsRow stats={stats} />

        {/* 4. Only when something waits on staff. */}
        {waiting.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-foreground/70 px-3 py-2.5" data-testid="needs-you">
            {waiting.map((item, index) => (
              <div key={item.kind} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-foreground">{item.kind === "approve" ? copy.needsYou.approve(item.count) : copy.needsYou.pay(item.count)}</span>
                <Button
                  size="sm"
                  variant={index === 0 ? "default" : "outline"}
                  onClick={() => onReview(item.kind === "approve" ? "qualified" : "approved")}
                >
                  {item.kind === "approve" ? copy.needsYou.review : copy.needsYou.pay_button}
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Switching it on stays in view: for a draft or a paused campaign it is the next step. */}
        {campaign.kind === "signup" && !campaign.active && confirming && (
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3" data-testid="activate-confirm">
            <p className="text-sm text-foreground">{copy.activateConfirm(campaign.title)}</p>
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input type="checkbox" className="mt-0.5" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
              {copy.activateCheck}
            </label>
            {wallet ? (
              <label className="flex items-start gap-2 text-sm text-foreground" data-testid="funding-check">
                <input type="checkbox" className="mt-0.5" checked={fundingChecked} onChange={(event) => setFundingChecked(event.target.checked)} />
                <span>
                  {fundingCopy.fundingCheck}
                  <span className="mt-0.5 block font-mono text-xs break-all text-muted-foreground">
                    {checksummedOrSame(wallet)}
                  </span>
                </span>
              </label>
            ) : (
              <p className="text-sm text-muted-foreground">{copy.refusals.no_funding_wallet}</p>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy || gaps.length > 0}
                onClick={() => {
                  onAction({ action: "activate", campaignId: campaign.id, counselReviewed: true, fundingChecked: true });
                  setConfirming(false);
                  setReviewed(false);
                  setFundingChecked(false);
                }}
              >
                {copy.confirm}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                {copy.cancel}
              </Button>
            </div>
            {gaps.includes("reviewed") && <p className="text-xs text-muted-foreground">{copy.activateNeedsReviewed}</p>}
            {gaps.includes("funding") && <p className="text-xs text-muted-foreground">{copy.activateNeedsFunding}</p>}
          </div>
        )}
        {campaign.kind === "signup" && !campaign.active && !confirming && (
          <div>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(true)}>
              {copy.activate}
            </Button>
          </div>
        )}

        {/* 5. Funding, one line until opened; the full block unchanged inside. */}
        <FundingRow campaign={campaign} wallet={wallet} />

        {/* 6. Settings, folded: payout wallets, Announce on X, Pause, Delete. */}
        <Fold testId="campaign-settings" summary={<span className="text-sm text-foreground">{copy.settings.heading}</span>} more={copy.settings.more} less={copy.settings.less}>
          <div className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground" data-testid="budget-meter">
              {copy.meter(
                campaignUsd(campaign.reservedUsd),
                campaignUsd(campaign.paidUsd),
                campaignUsd(campaign.budgetUsd),
                campaign.slots,
                campaign.maxClaims,
              )}{" "}
              {copy.waiting(campaign.counts.attributed)}
            </p>
            <PayoutSources campaign={campaign} busy={busy} onAction={onAction} />
            {campaign.kind === "signup" && (
              <label className="flex items-start gap-2 border-t border-border pt-3 text-sm text-foreground" data-testid="announce-on-x">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={campaign.announceOnX}
                  disabled={busy}
                  onChange={(event) => onAction({ action: "announce", campaignId: campaign.id, on: event.target.checked })}
                />
                <span>
                  {copy.announce}
                  <span className="mt-0.5 block text-xs text-muted-foreground">{copy.announceHint}</span>
                </span>
              </label>
            )}
            {campaign.kind === "signup" && campaign.active && (
              <div>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction({ action: "pause", campaignId: campaign.id })}>
                  {copy.deactivate}
                </Button>
              </div>
            )}
            {campaign.deletable && !confirming && deleting && (
              <div className="flex flex-col gap-3 rounded-lg border border-border p-3" data-testid="delete-confirm">
                <p className="text-sm text-foreground">{copy.deleteConfirm(campaign.title, campaign.code)}</p>
                <Input
                  aria-label={copy.deleteReason}
                  placeholder={copy.deleteReason}
                  value={deleteReason}
                  onChange={(event) => setDeleteReason(event.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy || !deleteReason.trim()}
                    onClick={() => {
                      onAction({ action: "delete", campaignId: campaign.id, reason: deleteReason.trim() });
                      setDeleting(false);
                      setDeleteReason("");
                    }}
                  >
                    {copy.delete}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(false)}>
                    {copy.cancel}
                  </Button>
                </div>
              </div>
            )}
            {campaign.deletable && !confirming && !deleting && (
              <div>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeleting(true)}>
                  {copy.delete}
                </Button>
              </div>
            )}
          </div>
        </Fold>
      </Panel>
    </div>
  );
}

/** "11 Oct at 00:00 CEST": each date with its own zone, since a summer time change can fall between the two. */
const zonedWhen = (iso: string) => localDateTime(iso);

/** The campaign's link in full, to copy, open or scan, and to change. */
function ShareLink({ campaign, busy, onAction }: { campaign: CampaignMeter; busy: boolean; onAction: (action: StaffAction) => void }) {
  const copy = useCopy().campaign.staff.share;
  const renameCopy = useCopy().campaign.staff.rename;
  const url = campaignLinkUrl(campaign.code);
  const [renaming, setRenaming] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3" data-testid="share-link">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="text-xs text-muted-foreground">{copy.heading}</span>
          <span className="font-mono text-base break-all text-foreground sm:text-lg" data-testid="share-url">
            {url}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <CopyButton value={url} label={copy.copy} testId="share-copy" />
            <a
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              className={buttonVariants({ size: "xs", variant: "outline" })}
              data-testid="share-open"
            >
              <ArrowSquareOut className="size-3.5" weight="duotone" aria-hidden />
              {copy.open}
            </a>
            {campaign.kind === "signup" && !renaming && (
              <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={() => setRenaming(true)} data-testid="rename-open">
                {renameCopy.change}
              </Button>
            )}
          </span>
          {campaign.aliases.length > 0 && (
            <span className="text-xs text-muted-foreground" data-testid="share-aliases">
              {copy.aliases(campaign.aliases.map((alias) => `/c/${alias}`).join(", "))}
            </span>
          )}
        </div>
        <div className="w-fit shrink-0 rounded-md border border-border bg-white p-1.5" role="img" aria-label={copy.qrLabel}>
          <QRCodeSVG value={url} size={76} marginSize={0} />
        </div>
      </div>
      {renaming && (
        <RenameLink
          campaign={campaign}
          busy={busy}
          onCancel={() => setRenaming(false)}
          onSubmit={(code, reason) => {
            onAction({ action: "rename", campaignId: campaign.id, code, reason });
            setRenaming(false);
          }}
        />
      )}
    </div>
  );
}

/** The new code, judged as it is typed with the create form's own rule, and a reason for the audit log. */
function RenameLink({
  campaign,
  busy,
  onCancel,
  onSubmit,
}: {
  campaign: CampaignMeter;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (code: string, reason: string) => void;
}) {
  const copy = useCopy().campaign.staff.rename;
  const cancel = useCopy().campaign.staff.cancel;
  const [raw, setRaw] = useState(campaign.code);
  const [reason, setReason] = useState("");
  const code = normalizeCampaignCode(raw);
  const changed = code !== null && code !== campaign.code;
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3" data-testid="rename-form">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span className="text-foreground">{copy.label}</span>
        <Input value={raw} onChange={(event) => setRaw(event.target.value)} className="font-mono text-xs" spellCheck={false} autoComplete="off" aria-invalid={raw.trim() !== "" && !code} />
        <span>{copy.hint}</span>
      </label>
      {changed && (
        <p className="text-xs text-muted-foreground">
          <span className="font-mono break-all text-foreground">{copy.preview(campaignLinkUrl(code))}</span>
          <span className="mt-0.5 block">{copy.keepsWorking(`/c/${campaign.code}`)}</span>
        </p>
      )}
      <Input aria-label={copy.reason} placeholder={copy.reason} value={reason} onChange={(event) => setReason(event.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !changed || !reason.trim()} onClick={() => code && onSubmit(code, reason.trim())}>
          {copy.submit}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {cancel}
        </Button>
      </div>
    </div>
  );
}

/** The numbers at a glance: big, each with one tiny label, explained behind one (i). */
function CampaignStatsRow({ stats }: { stats: CampaignStats }) {
  const copy = useCopy().campaign.staff.stats;
  const cells: [string, string, string][] = [
    ["opens", copy.opens, String(stats.opens)],
    ["signed-up", copy.signedUp, String(stats.signedUp)],
    ["set-up", copy.setUp, String(stats.setUp)],
    ["staying", copy.staying, String(stats.staying)],
    ["qualified", copy.qualified, String(stats.qualified)],
    ["paid", copy.paid, String(stats.paid)],
    ["places-left", copy.placesLeft, String(stats.placesLeft)],
    ["budget-left", copy.budgetLeft, campaignUsd(stats.budgetLeftUsd)],
  ];
  return (
    <div className="relative" data-testid="campaign-stats">
      <InfoTip label={copy.label} className="absolute top-0 right-0">
        {copy.explain}
      </InfoTip>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 pr-6 sm:grid-cols-4">
        {cells.map(([key, label, value]) => (
          <div key={key} className="flex min-w-0 flex-col-reverse gap-0.5" data-testid={`stat-${key}`}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-mono text-2xl leading-none text-foreground tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** A section folded to one line, opened with its own button. */
function Fold({
  summary,
  actions,
  more,
  less,
  testId,
  children,
}: {
  summary: ReactNode;
  actions?: ReactNode;
  more: string;
  less: string;
  testId: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3" data-testid={testId} data-open={open || undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? less : more}
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <CaretRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-90")} weight="bold" aria-hidden />
          <span className="min-w-0">{summary}</span>
        </button>
        {actions}
      </div>
      {open && <div id={bodyId}>{children}</div>}
    </div>
  );
}

/** Funding in one line (network, what the payout wallet holds, how many rewards that pays), the full block when opened. */
function FundingRow({ campaign, wallet }: { campaign: CampaignMeter; wallet: string | null }) {
  const copy = useCopy().campaign.staff;
  const judged = wallet ? judgePayoutAddress(wallet) : null;
  // A Berth address is never read as a payout wallet: the full block warns about it instead.
  const readable = judged?.kind === "ok" && !judged.berth ? judged.address : null;
  const { balance, read, cover } = useFundingBalance(readable, {
    amountUsd: campaign.amountUsd,
    budgetUsd: campaign.budgetUsd,
    paidUsd: campaign.paidUsd,
  });
  const state = fundingLineState({ address: wallet, retired: campaign.kind !== "signup", read: read !== null && cover !== null, fetching: balance.isFetching });
  const line =
    state === "read" && read !== null && cover
      ? copy.fundingLine.line(formatUsdcRaw(read), copy.funding.enoughFor(cover.rewards))
      : {
          none: copy.fundingLine.noWallet,
          none_retired: copy.fundingLine.noWalletRetired,
          berth: copy.fundingLine.berth,
          not_a_wallet: copy.fundingLine.notAWallet,
          read: copy.fundingLine.reading,
          reading: copy.fundingLine.reading,
          unreadable: copy.fundingLine.unreadable,
        }[state];
  return (
    <Fold
      testId="funding-row"
      more={copy.fundingLine.more}
      less={copy.fundingLine.less}
      summary={
        <span className="text-sm text-foreground" data-testid="funding-line">
          {line}
        </span>
      }
      actions={
        readable ? (
          <Button size="xs" variant="outline" disabled={balance.isFetching} onClick={() => void balance.refetch()}>
            {balance.isFetching ? copy.funding.reading : copy.funding.refresh}
          </Button>
        ) : null
      }
    >
      <FundingBlock
        address={wallet}
        amountUsd={campaign.amountUsd}
        budgetUsd={campaign.budgetUsd}
        paidUsd={campaign.paidUsd}
        otherWallets={Math.max(0, campaign.payoutSources.length - 1)}
      />
    </Fold>
  );
}

const checksummedOrSame = (address: string) => {
  const judged = judgePayoutAddress(address);
  return judged.kind === "ok" ? judged.address : address;
};

/** The claim with whatever was revealed for it put back in full. */
function withRevealed(claim: QueueClaim, shown: Revealed[string] | undefined): QueueClaim {
  if (!shown) return claim;
  return {
    ...claim,
    email: shown.email !== undefined ? shown.email : claim.email,
    wallets: shown.wallets ?? claim.wallets,
    payout: shown.payout !== undefined ? { ...claim.payout, address: shown.payout } : claim.payout,
  };
}

function PayoutSources({ campaign, busy, onAction }: { campaign: CampaignMeter; busy: boolean; onAction: (action: StaffAction) => void }) {
  const copy = useCopy().campaign.staff.sources;
  const [address, setAddress] = useState("");
  const [reason, setReason] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const judged = judgePayoutAddress(address);
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3" data-testid="payout-sources">
      <p className="text-sm text-foreground">{copy.heading}</p>
      {campaign.payoutSources.length === 0 ? (
        <p className="text-xs text-muted-foreground">{copy.none}</p>
      ) : (
        campaign.payoutSources.map((source) => (
          <div key={source.id} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Mono>{checksummedOrSame(source.address)}</Mono>
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
          disabled={busy || judged.kind !== "ok" || !reason.trim()}
          onClick={() => {
            onAction({ action: "add_source", campaignId: campaign.id, address: address.trim(), reason: reason.trim() });
            setAddress("");
            setReason("");
          }}
        >
          {copy.add}
        </Button>
      </div>
      {judged.kind !== "empty" && <PayoutAddressNote judged={judged} />}
      <p className="text-xs text-muted-foreground">{copy.fallback}</p>
    </div>
  );
}

function WalletList({ wallets }: { wallets: QueueClaim["wallets"] }) {
  const copy = useCopy().campaign.staff;
  if (wallets.length === 0) return <>{copy.empty}</>;
  return (
    <>
      {wallets.map((wallet) => (
        <span key={wallet.address} className="block">
          <Mono>{wallet.address}</Mono> <span className="text-xs text-muted-foreground">{wallet.family}{wallet.linked ? "" : `, ${copy.unlinked}`}</span>
        </span>
      ))}
    </>
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
        {claim.onboardedAt && (
          <Fact label={copy.labels.setUp}>
            {copy.setUpLine(when(claim.onboardedAt), when(claim.eligibleAt))}
          </Fact>
        )}
        <Fact label={copy.labels.lastSeen}>{claim.lastSeenAt ? when(claim.lastSeenAt) : copy.empty}</Fact>
        <Fact label={copy.labels.wallets}>
          {revealed?.wallets === undefined && claim.wallets.length > 0 && (
            <Button size="xs" variant="ghost" className="mb-1 text-muted-foreground" disabled={busy} onClick={() => onAction({ action: "reveal", claimId: claim.id, field: "wallets" })}>
              {copy.revealWallets}
            </Button>
          )}
          <WalletList wallets={claim.wallets} />
        </Fact>
        <Fact label={copy.labels.signals}>
          {claim.signals.length === 0 ? copy.noSignals : claim.signals.map((signal) => <span key={signal} className="block">{copy.signals[signal]}</span>)}
          <span className="block text-xs text-muted-foreground">{copy.noDeviceSignals}</span>
          {suggestedAction(claim) === "reject" && (
            <span className="mt-1 block text-foreground" data-testid="suggest-reject">
              {copy.suggestRejectUnknownCountry}
            </span>
          )}
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
      {claim.staffIneligibleAt && (claim.state === "approved" || claim.state === "qualified" || claim.state === "holding") && (
        <p role="alert" data-testid="claim-ineligible" className="rounded-md border border-warn/50 bg-warn-soft px-3 py-2 text-sm font-medium text-foreground">
          {copy.ineligibleClaim(when(claim.staffIneligibleAt))}
        </p>
      )}
      {claim.state === "approved" && claim.eligibilityNow && (
        <p role="alert" data-testid="claim-since-approval" className="rounded-md border border-warn/50 bg-warn-soft px-3 py-2 text-sm font-medium text-foreground">
          {copy.sinceApproval[claim.eligibilityNow]}
        </p>
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

function CreateCampaign({ busy, onAction, prefill }: { busy: boolean; onAction: (action: StaffAction) => void; prefill?: Record<string, string> }) {
  const copy = useCopy().campaign.staff.create;
  const domain = useCopy().og.domain;
  const fundingCopy = useCopy().campaign.staff.funding;
  const [fields, setFields] = useState<Record<string, string>>({
    code: "",
    title: "",
    amountUsd: "5",
    budgetUsd: "100",
    maxClaims: "20",
    stayDays: "14",
    startsAt: "",
    endsAt: "",
    payoutAddress: "",
    ...prefill,
  });
  const judged = judgePayoutAddress(fields.payoutAddress);
  const number = (value: string) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const code = normalizeCampaignCode(fields.code);
  const places = Math.max(0, Math.floor(number(fields.maxClaims)));
  const total = Math.round(number(fields.amountUsd) * 100) * places;
  const overBudget = total > Math.round(number(fields.budgetUsd) * 100);
  const field = (name: string, label: string, hint: string, type = "text", extra?: ReactNode) => (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span className="text-foreground">{label}</span>
      <Input type={type} value={fields[name]} onChange={(event) => setFields({ ...fields, [name]: event.target.value })} />
      <span>{hint}</span>
      {extra}
    </label>
  );
  return (
    <details className="rounded-lg border border-border bg-card p-4" open={prefill ? true : undefined} data-testid="create-campaign">
      <summary className="cursor-pointer text-sm text-foreground">{copy.heading}</summary>
      <p className="mt-2 text-xs text-muted-foreground">{copy.note}</p>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {field(
          "code",
          copy.code,
          copy.hints.code,
          "text",
          code ? <span className="font-mono text-foreground">{copy.link(`${domain}/c/${code}`)}</span> : null,
        )}
        {field("title", copy.title, copy.hints.title)}
        {field("amountUsd", copy.amount, copy.hints.amount, "number")}
        {field(
          "budgetUsd",
          copy.budget,
          copy.hints.budget,
          "number",
          places > 0 && total > 0 ? (
            <span className={overBudget ? "text-foreground" : undefined} data-testid="budget-check">
              {overBudget ? copy.overBudget(campaignUsd(total / 100)) : copy.fits(campaignUsd(total / 100), places)}
            </span>
          ) : null,
        )}
        {field("maxClaims", copy.maxClaims, copy.hints.maxClaims, "number")}
        {field("stayDays", copy.stayDays, copy.hints.stayDays, "number")}
        {field("startsAt", copy.starts, copy.hints.starts, "datetime-local")}
        {field("endsAt", copy.ends, copy.hints.ends, "datetime-local")}
        <PayoutAddressField value={fields.payoutAddress} onChange={(payoutAddress) => setFields({ ...fields, payoutAddress })} />
      </div>
      <div className="mt-3">
        <FundingBlock
          address={judged.kind === "ok" ? judged.address : null}
          amountUsd={number(fields.amountUsd)}
          budgetUsd={number(fields.budgetUsd)}
        />
      </div>
      {judged.kind !== "ok" && <p className="mt-3 text-xs text-muted-foreground">{fundingCopy.createNeedsWallet}</p>}
      <Button
        size="sm"
        className="mt-3"
        disabled={busy || judged.kind !== "ok" || overBudget}
        onClick={() =>
          onAction({
            action: "create",
            campaign: {
              ...fields,
              payoutAddress: judged.kind === "ok" ? judged.address : "",
              startsAt: fields.startsAt ? new Date(fields.startsAt).toISOString() : "",
              endsAt: fields.endsAt ? new Date(fields.endsAt).toISOString() : "",
            },
          })
        }
      >
        {copy.submit}
      </Button>
      <p className="mt-1.5 text-xs text-muted-foreground">{copy.submitHint}</p>
    </details>
  );
}
