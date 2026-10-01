"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import { CheckCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCopy } from "@/components/settings-provider";
import { useHandleCheck, useSetHandle } from "@/hooks/use-social";
import { HANDLE_MAX, parseHandle, type HandleRefusal } from "@/lib/handle";
import { cn } from "@/lib/utils";

/**
 * "Pick a username": one field, the rules in one line, and a live answer
 * under it. Shape is checked here from the rulebook (lib/handle) without a
 * request; a name of the right shape is asked about a beat after typing
 * stops (the check is rate limited, and it is itself an oracle, so it only
 * runs for a signed in account with a verified email).
 */

export type PickerStatus =
  | { kind: "rules" }
  | { kind: "checking" }
  | { kind: "free" }
  | { kind: "refused"; reason: HandleRefusal; nextChange?: string };

function readableDate(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

export function NamePickerView({
  value,
  onChange,
  status,
  onSave,
  saving,
  onCancel,
  title,
}: {
  value: string;
  onChange: (value: string) => void;
  status: PickerStatus;
  onSave: () => void;
  saving: boolean;
  onCancel?: () => void;
  /** Shown above the field for a first pick; a change needs none. */
  title?: { title: string; sub: string };
}) {
  const copy = useCopy().social;
  const line =
    status.kind === "rules"
      ? copy.pickRules
      : status.kind === "checking"
        ? copy.pickChecking
        : status.kind === "free"
          ? copy.pickFree
          : copy.refusal(status.reason, status.nextChange);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (status.kind === "free" && !saving) onSave();
      }}
    >
      {title && (
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">{title.title}</span>
          <span className="text-xs text-muted-foreground">{title.sub}</span>
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
          placeholder={copy.pickPlaceholder}
          aria-label={copy.pickTitle}
          aria-invalid={status.kind === "refused" || undefined}
          aria-describedby="name-picker-line"
          maxLength={HANDLE_MAX + 2}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          className="h-10 flex-1"
        />
        <Button type="submit" className="h-10" disabled={status.kind !== "free" || saving}>
          {copy.pickSave}
        </Button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p
          id="name-picker-line"
          aria-live="polite"
          className={cn(
            "flex items-center gap-1 text-xs",
            status.kind === "refused" ? "text-destructive" : status.kind === "free" ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {status.kind === "free" && <CheckCircle weight="duotone" className="size-3.5" aria-hidden />}
          {line}
        </p>
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {copy.cancel}
          </Button>
        )}
      </div>
    </form>
  );
}

/** The picker, live: shape from the rulebook, availability from the server, then save. */
export function NamePicker({
  current,
  nextChangeAt,
  onDone,
  onCancel,
  title,
}: {
  current?: string | null;
  nextChangeAt?: string | null;
  onDone?: () => void;
  onCancel?: () => void;
  title?: { title: string; sub: string };
}) {
  const copy = useCopy().social;
  const [value, setValue] = useState("");
  const parsed = parseHandle(value);
  const same = Boolean(current) && value === current;
  const check = useHandleCheck(value, parsed.ok && !same);
  const save = useSetHandle();

  let status: PickerStatus = { kind: "rules" };
  if (value.trim().length === 0 || same) status = { kind: "rules" };
  else if (!parsed.ok) status = value.trim().length < 3 && parsed.reason === "short" ? { kind: "rules" } : { kind: "refused", reason: parsed.reason };
  else if (check.pending || !check.data) status = check.isError ? { kind: "rules" } : { kind: "checking" };
  else status = check.data.ok ? { kind: "free" } : { kind: "refused", reason: check.data.reason, nextChange: readableDate(nextChangeAt) };

  return (
    <NamePickerView
      value={value}
      onChange={setValue}
      status={status}
      saving={save.isPending}
      onCancel={onCancel}
      title={title}
      onSave={() => {
        save.mutate(value, {
          onSuccess: (result) => {
            if (result.ok) {
              toast.success(copy.saved(result.social.handle ?? value));
              setValue("");
              onDone?.();
            } else if (result.reason === "failed") toast.error(copy.saveFailed);
            else toast.error(copy.refusal(result.reason, readableDate(nextChangeAt)));
          },
          onError: () => toast.error(copy.saveFailed),
        });
      }}
    />
  );
}
