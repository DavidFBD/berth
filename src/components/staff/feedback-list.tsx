"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCopy } from "@/components/settings-provider";
import { FreshPrompt } from "@/components/staff/fresh";
import type { FeedbackRow } from "@/lib/server/feedback";
import { shortId, when } from "@/lib/staff/format";
import { cn } from "@/lib/utils";

/**
 * The staff Feedback list (/staff/feedback, and the dev gallery from
 * fixtures): each message in full, who sent it by username, the context the
 * sheet said it sends, whether they asked for a reply, and its status. An
 * admin marks it read in one tap, or fixed with an optional note; a fixed
 * message whose writer asked for a reply emails them once (the server's
 * rule, lib/server/feedback markFeedback). Writes need a fresh proof like
 * every staff write; a stale one turns into "Confirm it is you".
 */
export function FeedbackList({ rows, canAct, demo = false }: { rows: readonly FeedbackRow[]; canAct: boolean; demo?: boolean }) {
  const words = useCopy().staff.feedback;
  if (rows.length === 0) return <p className="py-2 text-[13.5px] text-muted-foreground">{words.empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border">
      {rows.map((row) => (
        <FeedbackItem key={row.id} row={row} canAct={canAct} demo={demo} />
      ))}
    </ul>
  );
}

function FeedbackItem({ row, canAct, demo }: { row: FeedbackRow; canAct: boolean; demo: boolean }) {
  const words = useCopy().staff.feedback;
  const context = row.context;
  const facts: { label: string; value: string }[] = [
    { label: words.path, value: context.path ?? "…" },
    { label: words.viewport, value: context.viewport ?? "…" },
    { label: words.build, value: context.build ?? "…" },
  ];
  if (context.order) {
    facts.push({
      label: words.order,
      value: `${words.orderKind[context.order.kind]}, ${context.order.id ? shortId(context.order.id) : words.orderNotFound}`,
    });
  }
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-1 last:pb-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
        <StatusPill status={row.status} />
        <span className="font-money">{when(row.createdAt)}</span>
        <Link href={`/staff/users/${row.userId}`} className="text-foreground underline-offset-4 hover:underline">
          {row.username ?? words.noUsername}
        </Link>
        <span className="font-money">{shortId(row.userId)}</span>
        <span className={cn(row.mayReply ? "text-foreground" : undefined)}>
          {row.mayReply ? words.mayReply : words.mayReplyNo}
          {row.mayReply && !row.hasEmail ? `, ${words.noEmail}` : ""}
        </span>
        {row.replied && <span>{words.replied}</span>}
      </div>
      <p className="max-w-[72ch] whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-foreground">{row.body}</p>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
        {facts.map((fact) => (
          <div key={fact.label} className="flex gap-1.5">
            <dt className="text-muted-foreground">{fact.label}</dt>
            <dd className="font-money text-foreground">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {context.userAgent && (
        <p className="max-w-[90ch] break-words font-money text-[12px] leading-relaxed text-muted-foreground">
          {words.userAgent} {context.userAgent}
        </p>
      )}
      {row.staffNote && (
        <p className="text-[13px] text-secondary-foreground">
          <span className="text-muted-foreground">{words.note}: </span>
          {row.staffNote}
        </p>
      )}
      {canAct && row.status !== "fixed" && <FeedbackActions row={row} demo={demo} />}
    </li>
  );
}

function StatusPill({ status }: { status: FeedbackRow["status"] }) {
  const words = useCopy().staff.feedback;
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-2 text-[11.5px]",
        status === "new" ? "bg-foreground text-background" : "border border-border text-secondary-foreground",
      )}
    >
      {words.status[status]}
    </span>
  );
}

type Outcome = { ok: true } | { ok: false; status: number };

async function mark(body: { id: string; action: "read" | "fixed"; note?: string }): Promise<Outcome> {
  const response = await fetch("/api/staff/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!response) return { ok: false, status: 0 };
  return response.ok ? { ok: true } : { ok: false, status: response.status };
}

function FeedbackActions({ row, demo }: { row: FeedbackRow; demo: boolean }) {
  const words = useCopy().staff.feedback;
  const router = useRouter();
  const [fixing, setFixing] = useState(false);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "working" | "failed" | "stale">("idle");
  const [pending, setPending] = useState<{ action: "read" | "fixed"; note?: string } | null>(null);

  const go = async (action: "read" | "fixed", text?: string) => {
    if (demo) return;
    setPending({ action, note: text });
    setState("working");
    const outcome = await mark({ id: row.id, action, ...(text ? { note: text } : {}) });
    if (outcome.ok) {
      setState("idle");
      setFixing(false);
      router.refresh();
    } else setState(outcome.status === 401 ? "stale" : "failed");
  };

  if (state === "stale") {
    return (
      <FreshPrompt
        onFresh={() => void (pending ? go(pending.action, pending.note) : setState("idle"))}
        onCancel={() => setState("idle")}
      />
    );
  }

  if (fixing) {
    return (
      <div className="flex w-full max-w-md flex-col gap-2 rounded-lg border border-border bg-secondary px-4 py-3">
        <label className="flex flex-col gap-1 text-[12.5px] text-muted-foreground">
          {words.noteLabel}
          <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder={words.noteHint} maxLength={300} autoFocus className="bg-card" />
        </label>
        {row.mayReply && row.hasEmail && <p className="text-[13px] text-foreground">{words.fixedWillEmail}</p>}
        {state === "failed" && <p className="text-[13px] text-foreground">{words.failed}</p>}
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void go("fixed", note.trim() || undefined)} disabled={state === "working"}>
            {state === "working" ? words.working : words.confirmFixed}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setFixing(false)}>
            {words.cancel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {row.status === "new" && (
        <Button size="xs" variant="outline" onClick={() => void go("read")} disabled={state === "working"}>
          {words.markRead}
        </Button>
      )}
      <Button size="xs" variant="outline" onClick={() => setFixing(true)} disabled={state === "working"}>
        {words.markFixed}
      </Button>
      {state === "failed" && <span className="text-[12px] text-foreground">{words.failed}</span>}
    </div>
  );
}
