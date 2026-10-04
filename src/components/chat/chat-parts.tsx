"use client";

import { ArrowsClockwise, Check, Receipt, WarningCircle } from "@phosphor-icons/react";
import { getToolName, isTextUIPart, isToolUIPart, type UIMessage } from "ai";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import { ThinkingOrb, type OrbState } from "@/components/ui/thinking-orb";
import { isBerthToolName } from "@/lib/berth-tool-names";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DraftSummary } from "@/lib/draft-order";
import { openPlanSheet } from "@/components/recurring/plan-sheet-events";
import { ordinal } from "@/lib/recurring";

/**
 * One message of the chat. A person's words sit in a quiet bubble on the
 * right; an answer is plain text on the left, preceded by one line per
 * tool it read ("Reading your holdings", then "Read your holdings"),
 * folded to a single line once the answer has begun, and followed by a
 * card for each order it drafted.
 */

type ToolLine = { id: string; name: string; state: "running" | "done" | "failed" };

/** What the orb shows while a tool reads: looking something up, working through the numbers, writing an order, or just working. */
export function orbStateForTool(name: string): OrbState {
  switch (name) {
    case "get_market_feed":
    case "get_listing":
      return "searching";
    case "get_performance":
    case "get_holdings":
    case "get_account":
      return "solving";
    case "draft_order":
    case "draft_recurring":
      return "composing";
    default:
      return "working";
  }
}

export type ChatDraft = DraftSummary;

/** A recurring buy draft_recurring checked on the server (lib/server/berth-tools PlanDraftCard). */
export type ChatPlanDraft = { symbol: string; name: string; usd: number; cadence: "weekly" | "monthly"; day: number; dipPct?: number };

function isPlanDraft(value: unknown): value is ChatPlanDraft {
  const plan = value as ChatPlanDraft | undefined;
  return (
    !!plan &&
    typeof plan.symbol === "string" &&
    typeof plan.name === "string" &&
    typeof plan.usd === "number" &&
    (plan.cadence === "weekly" || plan.cadence === "monthly") &&
    Number.isInteger(plan.day)
  );
}

/** The tool lines, draft cards and text of an assistant message, in the order they arrived. */
export function readAssistantParts(message: UIMessage): {
  tools: ToolLine[];
  drafts: { id: string; draft: ChatDraft }[];
  plans: { id: string; plan: ChatPlanDraft }[];
  text: string;
} {
  const tools: ToolLine[] = [];
  const drafts: { id: string; draft: ChatDraft }[] = [];
  const plans: { id: string; plan: ChatPlanDraft }[] = [];
  const texts: string[] = [];
  for (const part of message.parts) {
    if (isTextUIPart(part)) {
      if (part.text.trim()) texts.push(part.text);
      continue;
    }
    if (!isToolUIPart(part)) continue;
    const name = getToolName(part);
    const id = part.toolCallId;
    const failed = part.state === "output-error" || (part.state === "output-available" && Boolean((part.output as { isError?: boolean } | undefined)?.isError));
    const done = part.state === "output-available" || part.state === "output-error";
    tools.push({ id, name, state: failed ? "failed" : done ? "done" : "running" });
    if (name === "draft_order" && part.state === "output-available") {
      const draft = (part.output as { draft?: ChatDraft } | undefined)?.draft;
      if (draft && typeof draft.symbol === "string" && (draft.side === "buy" || draft.side === "sell")) drafts.push({ id, draft });
    }
    if (name === "draft_recurring" && part.state === "output-available") {
      const plan = (part.output as { plan?: unknown } | undefined)?.plan;
      if (isPlanDraft(plan)) plans.push({ id, plan });
    }
  }
  return { tools, drafts, plans, text: texts.join("\n\n") };
}

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-muted px-3 py-2 text-[15px] leading-relaxed text-foreground">
        {text}
      </p>
    </div>
  );
}

export function AssistantMessage({
  message,
  onOpenDraft,
  live = false,
}: {
  message: UIMessage;
  onOpenDraft: (draft: ChatDraft) => void;
  /** The answer still coming in: its newest running tool carries the orb. */
  live?: boolean;
}) {
  const { tools, drafts, plans, text } = readAssistantParts(message);
  // A draft shows as its card; its line only while it is being drafted, or if it failed.
  const lines = tools.filter((tool) => (tool.name !== "draft_order" && tool.name !== "draft_recurring") || tool.state !== "done");
  return (
    <div className="flex flex-col gap-2">
      {lines.length > 0 && <ToolLines tools={lines} folded={text.length > 0} live={live} />}
      {text && (
        <div className="text-[15px] leading-relaxed text-foreground">
          <ChatMarkdown text={text} />
        </div>
      )}
      {drafts.map(({ id, draft }) => (
        <DraftCard key={id} draft={draft} onOpen={() => onOpenDraft(draft)} />
      ))}
      {plans.map(({ id, plan }) => (
        <PlanDraftCard
          key={id}
          plan={plan}
          onOpen={() => openPlanSheet({ symbol: plan.symbol, usd: plan.usd, cadence: plan.cadence, day: plan.day, dipPct: plan.dipPct, via: "assistant" })}
        />
      ))}
    </div>
  );
}

function ToolLines({ tools, folded, live }: { tools: ToolLine[]; folded: boolean; live: boolean }) {
  const copy = useCopy();
  const words = (tool: ToolLine) => {
    if (tool.state === "failed") return copy.chatToolFailed;
    const entry = isBerthToolName(tool.name) ? copy.chatTool[tool.name] : null;
    if (!entry) return null;
    return tool.state === "running" ? entry.doing : entry.done;
  };
  if (folded && tools.every((tool) => tool.state !== "running")) {
    return (
      <p className="flex h-5 items-center gap-1.5 text-xs text-muted-foreground">
        <span className="flex size-5 items-center justify-center" aria-hidden>
          <Check className="size-3.5" />
        </span>
        {copy.chatToolsFolded(tools.length)}
      </p>
    );
  }
  // One orb for the whole answer, on the tool most recently set going.
  const orbOn = live ? tools.findLast((tool) => tool.state === "running" && words(tool))?.id : undefined;
  return (
    <ul className="flex flex-col gap-1" aria-live="polite">
      {tools.map((tool) => {
        const line = words(tool);
        if (!line) return null;
        return (
          <li key={tool.id} className="flex h-5 items-center gap-1.5 text-xs text-muted-foreground">
            {/* Every line keeps a 20px slot, so a line settling from the orb to its tick does not move. */}
            {tool.id === orbOn ? (
              <ThinkingOrb state={orbStateForTool(tool.name)} size={20} decorative />
            ) : (
              <span className="flex size-5 items-center justify-center" aria-hidden>
                {tool.state === "running" ? (
                  <span className="size-1.5 rounded-full bg-muted-foreground" />
                ) : tool.state === "failed" ? (
                  <WarningCircle className="size-3.5" />
                ) : (
                  <Check className="size-3.5" />
                )}
              </span>
            )}
            {line}
          </li>
        );
      })}
    </ul>
  );
}

function trimQuantity(quantity: number): string {
  return String(Number(quantity.toFixed(6)));
}

/**
 * A drafted order, built from the values draft_order computed on the
 * server (a known listing, a bounded amount, a sell no larger than the
 * holding), never from the model's words. Its one button is the
 * composition's one accent, and it only opens the order drawer, filled
 * in: the person checks it there and signs, or closes it.
 */
export function DraftCard({ draft, onOpen, className }: { draft: ChatDraft; onOpen: () => void; className?: string }) {
  const copy = useCopy();
  const amount =
    draft.side === "sell" && draft.quantity !== undefined ? copy.chatDraftShares(trimQuantity(draft.quantity)) : formatUsd(draft.usd ?? 0);
  const about = draft.side === "sell" && draft.quantity !== undefined && draft.approxUsd !== undefined ? copy.chatDraftAbout(formatUsd(draft.approxUsd)) : null;
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border border-border bg-card p-3.5", className)} data-testid="chat-draft-card">
      <div className="flex items-start gap-2.5">
        <Receipt className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{copy.chatDraftLabel}</span>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[15px] font-semibold text-foreground">{draft.side === "buy" ? copy.chatDraftBuy(draft.name) : copy.chatDraftSell(draft.name)}</span>
            <span className="shrink-0 font-mono text-[15px] font-medium text-foreground tabular-nums">{amount}</span>
          </div>
          {about && <span className="self-end font-mono text-xs text-muted-foreground tabular-nums">{about}</span>}
          {draft.limitPrice !== undefined && (
            <span className="self-end font-mono text-xs text-foreground tabular-nums" data-testid="chat-draft-limit">
              {draft.side === "buy" ? copy.chatDraftAtBuy(formatUsd(draft.limitPrice)) : copy.chatDraftAtSell(formatUsd(draft.limitPrice))}
            </span>
          )}
          <span className="text-xs text-muted-foreground">{copy.chatDraftNothingYet}</span>
        </div>
      </div>
      <Button className="h-10 w-full text-sm" onClick={onOpen}>
        {copy.chatDraftOpen}
      </Button>
    </div>
  );
}

/**
 * A drafted recurring buy, from the values draft_recurring checked on the
 * server. Its button opens the plan sheet filled in; nothing is saved until
 * the person saves it there, and nothing is bought until they sign.
 */
export function PlanDraftCard({ plan, onOpen, className }: { plan: ChatPlanDraft; onOpen: () => void; className?: string }) {
  const copy = useCopy();
  const words = copy.recurring;
  const when = plan.cadence === "weekly" ? words.cardWeekly(words.weekdays[plan.day] ?? "") : words.cardMonthly(ordinal(plan.day));
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border border-border bg-card p-3.5", className)} data-testid="chat-plan-card">
      <div className="flex items-start gap-2.5">
        <ArrowsClockwise weight="duotone" className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{words.cardLabel}</span>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[15px] font-semibold text-foreground">{plan.name}</span>
            <span data-ph-mask className="shrink-0 font-mono text-[15px] font-medium text-foreground tabular-nums">{formatUsd(plan.usd)}</span>
          </div>
          <span className="text-xs text-secondary-foreground">
            {when}
            {plan.dipPct !== undefined ? `. ${words.asDip(`${plan.dipPct}%`)}` : ""}
          </span>
          <span className="text-xs text-muted-foreground">{words.cardNothingYet}</span>
        </div>
      </div>
      <Button className="h-10 w-full text-sm" onClick={onOpen}>
        {words.cardOpen}
      </Button>
    </div>
  );
}
