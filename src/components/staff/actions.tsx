"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCopy } from "@/components/settings-provider";
import { FreshPrompt } from "@/components/staff/fresh";

/**
 * A staff write or reveal: the button, then in place a confirmation with
 * a reason (it goes in the audit log), then the request. A stale proof
 * turns into the "Confirm it is you" prompt and the same request goes
 * again after it. Nothing happens on a single tap.
 */

type Outcome = { ok: true; body: Record<string, unknown> } | { ok: false; status: number };

async function send(path: string, body: Record<string, unknown>): Promise<Outcome> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!response) return { ok: false, status: 0 };
  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
}

function ConfirmWithReason({
  title,
  body,
  confirm,
  onDone,
  onCancel,
  request,
}: {
  title: string;
  body: string;
  confirm: string;
  onDone: (result: Record<string, unknown>) => void;
  onCancel: () => void;
  request: (reason: string) => Promise<Outcome>;
}) {
  const words = useCopy().staff;
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "working" | "stale" | "failed" | "short" | "admin" | "limit">("idle");
  const go = async () => {
    if (reason.trim().length < 4) {
      setState("short");
      return;
    }
    setState("working");
    const outcome = await request(reason.trim());
    if (outcome.ok) onDone(outcome.body);
    else setState(outcome.status === 401 ? "stale" : outcome.status === 403 ? "admin" : outcome.status === 429 ? "limit" : "failed");
  };
  if (state === "stale") return <FreshPrompt onFresh={() => void go()} onCancel={onCancel} />;
  return (
    <div className="flex w-full max-w-md flex-col gap-2 rounded-lg border border-border bg-secondary px-4 py-3">
      <p className="text-[14px] font-medium text-foreground">{title}</p>
      <p className="text-[13px] leading-relaxed text-muted-foreground">{body}</p>
      <label className="flex flex-col gap-1 text-[12.5px] text-muted-foreground">
        {words.confirm.reasonLabel}
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={words.confirm.reasonHint}
          maxLength={300}
          autoFocus
          className="bg-card"
        />
      </label>
      {state === "short" && <p className="text-[13px] text-foreground">{words.confirm.reasonShort}</p>}
      {state === "failed" && <p className="text-[13px] text-foreground">{words.confirm.failed}</p>}
      {state === "admin" && <p className="text-[13px] text-foreground">{words.confirm.adminOnly}</p>}
      {state === "limit" && <p className="text-[13px] text-foreground">{words.confirm.revealLimit}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void go()} disabled={state === "working"}>
          {confirm}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {words.confirm.cancel}
        </Button>
      </div>
    </div>
  );
}

export type ActionName = "suppress" | "unsuppress" | "hide" | "unhide" | "revoke" | "retry" | "ineligible" | "eligible";

/** One audited write from lib/server/staff/actions, by name. */
export function StaffAction({ action, payload, disabled }: { action: ActionName; payload: Record<string, unknown>; disabled?: boolean }) {
  const words = useCopy().staff;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  if (open) {
    return (
      <ConfirmWithReason
        title={words.actions.title[action]}
        body={words.actions.body[action]}
        confirm={words.actions[action]}
        onCancel={() => setOpen(false)}
        onDone={() => {
          setOpen(false);
          setDone(true);
          router.refresh();
        }}
        request={(reason) => send("/api/staff/actions", { action, reason, ...payload })}
      />
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="xs" variant="outline" onClick={() => setOpen(true)} disabled={disabled}>
        {words.actions[action]}
      </Button>
      {done && <span className="text-[12px] text-muted-foreground">{words.confirm.done}</span>}
    </span>
  );
}

/** A masked value with its audited reveal. */
export function RevealField({
  masked,
  what,
  payload,
  canReveal,
}: {
  masked: string;
  what: "email" | "wallet";
  payload: Record<string, unknown>;
  canReveal: boolean;
}): ReactNode {
  const words = useCopy().staff;
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string | null>(null);
  if (value) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="font-money break-all text-foreground">{value}</span>
        <Button size="xs" variant="ghost" onClick={() => setValue(null)}>
          {words.reveal.hide}
        </Button>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-start gap-2">
      <span className="inline-flex items-center gap-2">
        <span className="font-money text-foreground">{masked}</span>
        {canReveal && !open && (
          <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
            {words.reveal.action}
          </Button>
        )}
      </span>
      {open && (
        <ConfirmWithReason
          title={words.reveal.title(words.reveal[what])}
          body={words.reveal.body}
          confirm={words.reveal.confirm}
          onCancel={() => setOpen(false)}
          onDone={(body) => {
            setOpen(false);
            setValue(typeof body.value === "string" ? body.value : null);
          }}
          request={(reason) => send("/api/staff/reveal", { ...payload, reason })}
        />
      )}
    </span>
  );
}

/** A service's balance and alert level, saved with a reason (the Budgets page). */
export function BudgetForm({ service, balance, threshold, withBalance = true, thresholdUnit }: { service: string; balance: number | null; threshold: number | null; withBalance?: boolean; thresholdUnit?: string }) {
  const words = useCopy().staff;
  const router = useRouter();
  const [balanceText, setBalance] = useState(balance === null ? "" : String(balance));
  const [thresholdText, setThreshold] = useState(threshold === null ? "" : String(threshold));
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        {withBalance && (
          <label className="flex w-52 flex-col gap-1 text-[12px] text-muted-foreground">
            {words.budgets.balanceLabel}
            <Input value={balanceText} onChange={(event) => setBalance(event.target.value)} inputMode="decimal" className="bg-card font-money" />
          </label>
        )}
        <label className="flex w-36 flex-col gap-1 text-[12px] text-muted-foreground">
          {thresholdUnit ? words.budgets.thresholdLabelUnit(thresholdUnit) : words.budgets.thresholdLabel}
          <Input value={thresholdText} onChange={(event) => setThreshold(event.target.value)} inputMode="decimal" className="bg-card font-money" />
        </label>
        {!open && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {words.budgets.save}
          </Button>
        )}
      </div>
      {open && (
        <ConfirmWithReason
          title={words.actions.title.budget}
          body={words.actions.body.budget}
          confirm={words.budgets.save}
          onCancel={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            router.refresh();
          }}
          request={(reason) => send("/api/staff/actions", { action: "budget", service, balanceUsd: withBalance ? balanceText : "", threshold: thresholdText, reason })}
        />
      )}
    </div>
  );
}
