"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCopy } from "@/components/settings-provider";
import { FreshPrompt } from "@/components/staff/fresh";
import { Muted, StaffSection, Table, Tag, type Column } from "@/components/staff/ui";
import { DRAFT_LIMITS, wordsProblem, type DraftWords } from "@/lib/new-listings-draft";
import type { StaffAnnouncement, StaffEmailsPreview, StaffEmailsResponse, StaffEmailsResult, StaffEmailsState, StaffRecipient } from "@/lib/staff-emails-types";
import { cn } from "@/lib/utils";

/**
 * The staff page for the New stocks email (/staff/emails). Berth spots new
 * listings by itself; here a person lines up one email, edits its words,
 * ticks its stocks, takes people off its list, sends themselves a test, and
 * presses send, which queues it and sends the day's share at once; each
 * later press of "Send today's share now" sends the next share, and the
 * morning run adds a few. Everything goes through /api/staff/emails, which answers
 * only staff. The page never holds a full address or an account id.
 */

/** The day a new email may be queued: 7 days after the last one. */
const untilDate = (iso: string | null) => (iso ? date(new Date(new Date(iso).getTime() + 7 * 86_400_000).toISOString()) : "?");

const date = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso)) : "?");

/** Posts an act; answers its result, or null when it did not go through (stale sign in, a failure). */
type Act = (body: Record<string, unknown>) => Promise<StaffEmailsResult | null>;

export function StaffEmails() {
  const copy = useCopy().staff.emails;
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [retry, setRetry] = useState<Record<string, unknown> | null>(null);

  const post = async (body: Record<string, unknown>): Promise<Response> =>
    fetch("/api/staff/emails", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  const query = useQuery({
    queryKey: ["staff-emails"],
    retry: false,
    queryFn: async () => {
      const response = await post({ action: "state" });
      if (!response.ok) throw new Error(`staff emails ${response.status}`);
      return ((await response.json()) as StaffEmailsResponse).state;
    },
  });

  const refetch = () => void queryClient.invalidateQueries({ queryKey: ["staff-emails"] });

  const act: Act = async (body) => {
    setBusy(true);
    setMessage(null);
    setProblems([]);
    try {
      const response = await post(body);
      if (response.status === 401) {
        setStale(true);
        setRetry(body);
        return null;
      }
      if (!response.ok) throw new Error("failed");
      setStale(false);
      const answer = (await response.json()) as StaffEmailsResponse;
      // The server's state is the truth: when it could not be read, ask again.
      if (answer.state) queryClient.setQueryData(["staff-emails"], answer.state);
      else refetch();
      const result = answer.result;
      if (result && !result.ok) {
        setMessage(copy.refusals[result.reason ?? "error"] ?? copy.failed);
        setProblems(result.problems ?? []);
      } else if (body.action === "test") setMessage(copy.testSent);
      else if (body.action === "queue") setMessage(copy.started(Number(result?.detail?.sentNow ?? 0)));
      else if (body.action === "send_now") setMessage(copy.sentNow(Number(result?.detail?.sentNow ?? 0)));
      return result ?? { ok: true };
    } catch {
      // A timeout or a dropped connection: the act may still have happened, so show what the server holds now.
      setMessage(copy.failed);
      refetch();
      return null;
    } finally {
      setBusy(false);
    }
  };

  const loadPreview = async (body: Record<string, unknown>): Promise<StaffEmailsPreview | null> => {
    const response = await post({ action: "preview", ...body }).catch(() => null);
    return response?.ok ? ((await response.json()) as StaffEmailsPreview) : null;
  };

  if (query.isError) return <p className="text-[14px] text-muted-foreground">{copy.failed}</p>;
  if (!query.data) return <p className="text-[14px] text-muted-foreground">{copy.loading}</p>;
  return (
    <>
      {stale && (
        <FreshPrompt
          onFresh={() => {
            setStale(false);
            if (retry) void act(retry);
          }}
          onCancel={() => setStale(false)}
        />
      )}
      <StaffEmailsView state={query.data} busy={busy} message={message} problems={problems} act={act} loadPreview={loadPreview} />
    </>
  );
}

/** The page given its data: the real page and the dev gallery (/dev/staff-emails) both render this. */
export function StaffEmailsView({
  state,
  busy = false,
  message = null,
  problems = [],
  act,
  loadPreview,
}: {
  state: StaffEmailsState;
  busy?: boolean;
  message?: string | null;
  problems?: string[];
  act: Act;
  loadPreview: (body: Record<string, unknown>) => Promise<StaffEmailsPreview | null>;
}) {
  const copy = useCopy().staff.emails;
  const current = state.current;
  const recentlyQueued = state.recentlyQueued;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-[26px] leading-tight tracking-[-0.022em] text-foreground lg:text-[30px]">{copy.title}</h1>
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">{copy.sub}</p>
      </div>
      {!state.switchOn && <p className="rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-[14px] text-foreground">{copy.switchOff}</p>}
      {!state.production && <p className="rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-[14px] text-foreground">{copy.notProduction}</p>}
      {message && (
        <p role="status" className="rounded-lg border border-border bg-card px-4 py-3 text-[14px] text-foreground">
          {message}
        </p>
      )}
      {problems.length > 0 && (
        <ul className="list-disc rounded-lg border border-border bg-card py-3 pr-4 pl-8 text-[13.5px] text-foreground">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {!current && (
        <StaffSection title={copy.detectedHeading}>
          <div className="flex flex-col gap-3">
            {state.detected.length > 0 ? (
              <>
                <p className="text-[13.5px] text-foreground">{state.detected.map((stock) => stock.name).join(", ")}</p>
                {recentlyQueued && <p className="text-[13px] text-muted-foreground">{copy.recent(date(state.lastQueuedAt), untilDate(state.lastQueuedAt))}</p>}
                <Button className="self-start" size="lg" disabled={busy || !state.production} onClick={() => void act({ action: "line_up" })}>
                  {copy.lineUp(state.detected.length)}
                </Button>
              </>
            ) : state.baselineRecorded ? (
              <Button className="self-start" size="lg" variant="secondary" disabled aria-disabled>
                {copy.nothingNew}
              </Button>
            ) : (
              <p className="text-[13.5px] text-muted-foreground">{copy.noBaseline}</p>
            )}
            <Muted>{copy.today(state.today.used, state.today.cap)}</Muted>
          </div>
        </StaffSection>
      )}
      {current?.status === "draft" && (
        <DraftView
          draft={current}
          cap={state.today.cap}
          busy={busy}
          act={act}
          loadPreview={loadPreview}
          warning={recentlyQueued ? copy.recent(date(state.lastQueuedAt), untilDate(state.lastQueuedAt)) : null}
          canSend={state.production && state.switchOn && !recentlyQueued}
        />
      )}
      {current?.status === "sending" && <SendingView sending={current} cap={state.today.cap} used={state.today.used} act={act} busy={busy} canSend={state.production && state.switchOn} />}
      <StaffSection title={copy.historyHeading}>
        {state.history.length === 0 ? (
          <Muted>{copy.historyNone}</Muted>
        ) : (
          <ul className="flex flex-col gap-2 text-[13.5px]">
            {state.history.map((past) => (
              <li key={past.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-foreground">{copy.historyRow(date(past.queuedAt ?? past.createdAt), past.stocks.filter((stock) => stock.ticked).length)}</span>
                <Tag tone={past.status === "done" ? "good" : "plain"}>{copy.status[past.status]}</Tag>
                <span className="text-muted-foreground">
                  {copy.progress.sent} {past.progress.sent}
                  {past.progress.notSent.count > 0 && `, ${copy.progress.notSent.toLowerCase()} ${past.progress.notSent.count}`}
                  {past.progress.notReached !== null && `, ${copy.progress.notReached.toLowerCase()} ${past.progress.notReached}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </StaffSection>
    </div>
  );
}

const fieldClass =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-[14px] outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive";

function DraftView({
  draft,
  cap,
  busy,
  act,
  loadPreview,
  warning,
  canSend,
}: {
  draft: NonNullable<StaffEmailsState["current"]>;
  cap: number;
  busy: boolean;
  act: Act;
  loadPreview: (body: Record<string, unknown>) => Promise<StaffEmailsPreview | null>;
  warning: string | null;
  canSend: boolean;
}) {
  const copy = useCopy().staff.emails;
  const email = useCopy().email;
  const [fields, setFields] = useState<DraftWords>(draft.words);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<StaffEmailsPreview | null>(null);
  // What the server confirmed holding, and how many saves are in flight: a field counts as saved only after its update succeeded.
  const [saved, setSaved] = useState<DraftWords>(draft.words);
  const [saving, setSaving] = useState(0);
  const [seen, setSeen] = useState(JSON.stringify(draft.words));
  const ticked = useMemo(() => draft.stocks.filter((stock) => stock.ticked).map((stock) => stock.symbol), [draft.stocks]);

  // The server may rewrite words that were still the defaults when the stocks ticked changed:
  // when what it holds changes, the fields follow (adjusted during render, not in an effect).
  const held = JSON.stringify(draft.words);
  if (held !== seen) {
    setSeen(held);
    setFields(draft.words);
    setSaved(draft.words);
  }

  // The preview follows what is typed, a moment after the typing stops.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPreview({ announcementId: draft.id, ...fields, chosen: ticked }).then((next) => next && setPreview(next));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [fields, ticked, draft.id, loadPreview]);

  const save = async (field: keyof DraftWords) => {
    const value = fields[field];
    if (value === saved[field]) return;
    setSaving((n) => n + 1);
    const result = await act({ action: "update", announcementId: draft.id, [field]: value });
    setSaving((n) => n - 1);
    if (result?.ok) setSaved((now) => ({ ...now, [field]: value }));
  };
  const problem = (field: keyof DraftWords) => wordsProblem(field, fields[field]);
  // What staff read is what is sent: send waits while any field differs from the words the server holds,
  // has a problem, or is still saving.
  const unsaved = (["subject", "preview", "intro", "extra"] as const).some((field) => fields[field] !== draft.words[field]);
  const invalid = (["subject", "preview", "intro", "extra"] as const).some((field) => wordsProblem(field, fields[field]) !== null);
  const ready = canSend && !busy && saving === 0 && !unsaved && !invalid && ticked.length > 0 && draft.sendCount > 0;
  const label = { subject: copy.subject, preview: copy.preview, intro: copy.intro, extra: copy.extra } as const;

  const recipientColumns: Column<StaffRecipient>[] = [
    { key: "person", label: copy.colPerson, render: (row) => row.label ?? <span className="text-muted-foreground">{copy.noName}</span> },
    { key: "address", label: copy.colAddress, mono: true, render: (row) => row.masked },
    { key: "why", label: copy.colWhy, render: (row) => row.why },
    {
      key: "send",
      label: copy.colSend,
      align: "right",
      render: (row) => (
        <input
          type="checkbox"
          aria-label={`${copy.colSend}: ${row.masked}`}
          checked={!row.excluded}
          disabled={busy}
          onChange={(event) => void act({ action: event.target.checked ? "include" : "exclude", announcementId: draft.id, key: row.key })}
          className="size-4 accent-foreground"
        />
      ),
    },
  ];

  return (
    <>
      <StaffSection title={copy.draftHeading}>
        <div className="flex flex-col gap-4">
          {warning && <p className="text-[13px] text-foreground">{warning}</p>}
          {(["subject", "preview", "intro"] as const).map((field) => (
            <label key={field} className="flex flex-col gap-1 text-[13px] text-muted-foreground">
              {label[field]}
              <Input
                value={fields[field]}
                maxLength={DRAFT_LIMITS[field] + 40}
                aria-invalid={problem(field) !== null}
                onChange={(event) => setFields({ ...fields, [field]: event.target.value })}
                onBlur={() => void save(field)}
              />
              {problem(field) && <span className="text-[12.5px] text-destructive">{problem(field)}</span>}
            </label>
          ))}
          <label className="flex flex-col gap-1 text-[13px] text-muted-foreground">
            {copy.extra}
            <textarea
              rows={4}
              value={fields.extra}
              aria-invalid={problem("extra") !== null}
              onChange={(event) => setFields({ ...fields, extra: event.target.value })}
              onBlur={() => void save("extra")}
              className={fieldClass}
            />
            <span className="text-[12px]">{copy.extraHint}</span>
            {problem("extra") && <span className="text-[12.5px] text-destructive">{problem("extra")}</span>}
          </label>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-[13px] text-muted-foreground">{copy.stocks}</legend>
            {draft.stocks.map((stock) => (
              <label key={stock.symbol} className="inline-flex items-center gap-2 text-[14px] text-foreground">
                <input
                  type="checkbox"
                  checked={stock.ticked}
                  disabled={busy}
                  className="size-4 accent-foreground"
                  onChange={(event) =>
                    void act({
                      action: "update",
                      announcementId: draft.id,
                      chosen: draft.stocks.filter((other) => (other.symbol === stock.symbol ? event.target.checked : other.ticked)).map((other) => other.symbol),
                    })
                  }
                />
                {stock.name}
              </label>
            ))}
          </fieldset>
        </div>
      </StaffSection>
      <StaffSection title={copy.fixedHeading}>
        <dl className="flex flex-col gap-2 text-[13px] leading-relaxed">
          {[
            [copy.fixedSender, email.sender],
            [copy.fixedRisk, email.newListings.notAdvice],
            [copy.fixedWhy, email.why.listings],
            [copy.fixedUnsubscribe, email.unsubscribe],
          ].map(([term, text]) => (
            <div key={term} className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground">{term}</dt>
              <dd className="text-foreground">{text}</dd>
            </div>
          ))}
        </dl>
      </StaffSection>
      <StaffSection title={copy.previewHeading}>
        {preview ? (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-muted-foreground">{preview.subject}</p>
            <iframe title={copy.previewHeading} srcDoc={preview.html} sandbox="" className="h-[640px] w-full rounded-xl border border-border bg-white" />
          </div>
        ) : (
          <Muted>{copy.previewLoading}</Muted>
        )}
      </StaffSection>
      <StaffSection title={copy.recipientsHeading} hint={copy.recipientsSub}>
        {draft.recipientTotal > draft.recipients.length && <p className="mb-2 text-[13px] text-muted-foreground">{copy.recipientsCut(draft.recipients.length, draft.recipientTotal)}</p>}
        <Table columns={recipientColumns} rows={draft.recipients} rowKey={(row) => row.key} empty={copy.noRecipients} />
      </StaffSection>
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-4">
        {confirming ? (
          <>
            <p className="text-[14px] leading-relaxed text-foreground">{copy.confirm(draft.sendCount, cap)}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!ready}
                onClick={() => {
                  setConfirming(false);
                  void act({ action: "queue", announcementId: draft.id, hash: draft.hash });
                }}
              >
                {copy.confirmYes}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {copy.confirmNo}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="lg" disabled={!ready} onClick={() => setConfirming(true)}>
              {copy.sendTo(draft.sendCount)}
            </Button>
            <Button size="lg" variant="outline" disabled={busy || !canSend} onClick={() => void act({ action: "test", announcementId: draft.id })}>
              {copy.test}
            </Button>
            <Button size="lg" variant="ghost" disabled={busy} onClick={() => void act({ action: "cancel", announcementId: draft.id })}>
              {copy.cancelDraft}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

function SendingView({
  sending,
  cap,
  used,
  act,
  busy,
  canSend,
}: {
  sending: StaffAnnouncement & { recipients: StaffRecipient[] };
  cap: number;
  used: number;
  act: Act;
  busy: boolean;
  canSend: boolean;
}) {
  const copy = useCopy().staff.emails;
  const p = sending.progress;
  return (
    <StaffSection title={copy.sendingHeading} hint={copy.sendingNote(cap)}>
      <div className="flex flex-col gap-4">
        <div className={cn("grid grid-cols-3 gap-3")}>
          {(
            [
              [copy.progress.sent, p.sent],
              [copy.progress.waiting, p.waiting],
              [copy.progress.notSent, p.notSent.count],
            ] as const
          ).map(([name, value]) => (
            <div key={name} className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3">
              <span className="text-[12.5px] text-muted-foreground">{name}</span>
              <span className="font-money text-[20px] leading-tight text-foreground tabular-nums">{value}</span>
            </div>
          ))}
        </div>
        {p.notSent.count > 0 && (
          <Muted>
            {Object.entries(p.notSent.reasons)
              .map(([reason, count]) => `${count} ${copy.notSentReasons[reason] ?? copy.notSentReasons.other}`)
              .join(", ")}
          </Muted>
        )}
        <Muted>{copy.today(used, cap)}</Muted>
        <p className="text-[13px] text-muted-foreground">{sending.words.subject}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy || !canSend || used >= cap} onClick={() => void act({ action: "send_now", announcementId: sending.id })}>
            {copy.sendNow}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void act({ action: "cancel", announcementId: sending.id })}>
            {copy.stopSending}
          </Button>
          {busy && <span className="text-[13px] text-muted-foreground">{copy.sendNowWait}</span>}
        </div>
        {used >= cap && <Muted>{copy.shareUsed}</Muted>}
      </div>
    </StaffSection>
  );
}
