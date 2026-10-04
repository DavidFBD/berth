"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, LockSimple, Stop } from "@phosphor-icons/react";
import { isTextUIPart, isToolUIPart, type UIMessage } from "ai";
import { Button } from "@/components/ui/button";
import { ThinkingOrb } from "@/components/ui/thinking-orb";
import { useCopy } from "@/components/settings-provider";
import { AssistantMessage, UserBubble, readAssistantParts, type ChatDraft } from "@/components/chat/chat-parts";
import type { BerthChat, ChatErrorCode } from "@/components/chat/use-berth-chat";
import type { ChatStatusResponse } from "@/app/api/chat/status/route";
import { isBerthToolName } from "@/lib/berth-tool-names";
import { cn } from "@/lib/utils";
import { CHAT_UNLOCK_LEVEL, RANKS } from "@/lib/xp";

/**
 * The chat itself, inside whatever sheet holds it (components/chat/chat-sheet;
 * the dev gallery shows it bare). Mobile first: the messages scroll, the
 * composer stays at the bottom, and the line under it says what the model
 * is, that it shares facts and not advice, and that Berth keeps no copy.
 *
 * What is shown is decided in one place, `stateOf`: locked below the chat
 * rung, closed for the day, the month or everyone, otherwise the chat.
 */

/** How many messages left before the count is shown. */
const SHOW_LEFT_UNDER = 5;

const MESSAGE_CHARS = 2_000;

/**
 * Whether the generic Thinking line (with its "working" orb) shows. The orb
 * shows while something is being worked on and hides once words are
 * streaming: a running tool with its own line carries it there (by tool),
 * otherwise it sits on the Thinking line, before the first token, between a
 * tool finishing and the words that follow it, and beside a tool newer than
 * the copy, which has no line of its own.
 */
export function thinkingShown(status: BerthChat["status"], answering: UIMessage | undefined): boolean {
  if (status === "submitted") return true;
  if (status !== "streaming") return false;
  const toolRunning = answering
    ? readAssistantParts(answering).tools.some((tool) => tool.state === "running" && isBerthToolName(tool.name))
    : false;
  const tail = answering?.parts.filter((part) => isTextUIPart(part) || isToolUIPart(part)).at(-1);
  const writing = tail !== undefined && isTextUIPart(tail) && tail.text.trim().length > 0;
  return !toolRunning && !writing;
}

export type ChatView = "locked" | "unavailable" | "budget" | "limit_month" | "limit_day" | "open";

export function stateOf(status: ChatStatusResponse | undefined, errorCode: ChatErrorCode | null): ChatView {
  if (errorCode === "locked" || status?.state === "locked") return "locked";
  if (errorCode === "budget" || status?.state === "budget") return "budget";
  if (errorCode === "unavailable" || errorCode === "disabled" || status?.state === "unavailable" || status?.state === "disabled") return "unavailable";
  if (errorCode === "limit_month" || status?.state === "limit_month") return "limit_month";
  if (errorCode === "limit_day" || status?.state === "limit_day") return "limit_day";
  return "open";
}

export function ChatPanel({
  chat,
  status,
  prompts,
  onOpenDraft,
}: {
  chat: BerthChat;
  status: ChatStatusResponse | undefined;
  prompts: readonly string[];
  onOpenDraft: (draft: ChatDraft) => void;
}) {
  const copy = useCopy();
  const view = stateOf(status, chat.errorCode);
  const busy = chat.status === "submitted" || chat.status === "streaming";
  const scroller = useRef<HTMLDivElement>(null);

  // Follow the answer as it streams, unless the person has scrolled up to read.
  const pinned = useRef(true);
  useEffect(() => {
    const element = scroller.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [chat.messages, chat.status]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy || view !== "open") return;
    pinned.current = true;
    void chat.send(trimmed);
  };

  const last = chat.messages.at(-1);
  const answering = last?.role === "assistant" ? last : undefined;
  const waiting = thinkingShown(chat.status, answering);

  if (view === "locked") {
    return (
      <Shell footer={null}>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <LockSimple className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-display text-lg text-foreground">{copy.chatLockedTitle(status?.unlockRankName ?? RANKS[CHAT_UNLOCK_LEVEL - 1].name)}</p>
          <p className="max-w-xs text-sm text-muted-foreground">{copy.chatLockedBody(status?.xpToUnlock ?? 0)}</p>
        </div>
      </Shell>
    );
  }

  if (view === "unavailable" || view === "budget") {
    return (
      <Shell footer={null}>
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <p className="max-w-xs text-sm text-muted-foreground">{view === "budget" ? copy.chatBudget : copy.chatUnavailable}</p>
        </div>
      </Shell>
    );
  }

  const left = view === "open" && status?.left != null && status.left < SHOW_LEFT_UNDER ? status.left : null;

  return (
    <Shell
      footer={
        view === "limit_day" || view === "limit_month" ? (
          <p className="rounded-lg bg-muted px-3 py-2.5 text-center text-sm text-muted-foreground">
            {view === "limit_month" ? copy.chatLimitMonth : copy.chatLimitDay}
          </p>
        ) : (
          <Composer busy={busy} onSend={send} onStop={() => void chat.stop()} />
        )
      }
      left={left}
    >
      <div
        ref={scroller}
        data-ph-mask
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 pt-2 pb-4"
      >
        {chat.messages.length === 0 ? (
          <EmptyState prompts={prompts} onPick={send} />
        ) : (
          chat.messages.map((message) =>
            message.role === "user" ? (
              <UserBubble
                key={message.id}
                text={message.parts
                  .filter(isTextUIPart)
                  .map((part) => part.text)
                  .join("\n")}
              />
            ) : message.role === "assistant" ? (
              <AssistantMessage key={message.id} message={message} onOpenDraft={onOpenDraft} live={busy && message === answering} />
            ) : null,
          )
        )}
        {waiting && (
          <p className="flex h-5 items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
            <ThinkingOrb state="working" size={20} decorative />
            {copy.chatThinking}
          </p>
        )}
        {chat.errorCode && chat.errorCode !== "limit_day" && chat.errorCode !== "limit_month" && (
          <ChatError
            code={chat.errorCode}
            onRetry={
              chat.errorCode === "failed"
                ? () => void chat.retry()
                : undefined
            }
          />
        )}
      </div>
    </Shell>
  );
}

function Shell({ children, footer, left }: { children: React.ReactNode; footer: React.ReactNode; left?: number | null }) {
  const copy = useCopy();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {children}
      <div className="flex shrink-0 flex-col gap-2 border-t border-border/70 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        {footer}
        {left != null && <p className="text-center text-xs text-muted-foreground">{copy.chatLeft(left)}</p>}
        <p className="text-center text-[11px] leading-snug text-muted-foreground">
          {copy.chatNotAdvice(copy.chatModelName)} {copy.chatNoCopyKept}
        </p>
      </div>
    </div>
  );
}

function EmptyState({ prompts, onPick }: { prompts: readonly string[]; onPick: (prompt: string) => void }) {
  const copy = useCopy();
  return (
    <div className="flex flex-1 flex-col justify-end gap-3 pb-1">
      <p className="text-sm text-muted-foreground">{copy.chatEmpty}</p>
      <div className="flex flex-col gap-2">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPick(prompt)}
            className="rounded-xl border border-border bg-background px-3.5 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatError({ code, onRetry }: { code: ChatErrorCode; onRetry?: () => void }) {
  const copy = useCopy();
  const words =
    code === "limit_minute" ? copy.chatLimitMinute : code === "too_long" ? copy.chatTooLong : copy.chatFailed;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground" role="status">
      <span>{words}</span>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {copy.chatRetry}
        </Button>
      )}
    </div>
  );
}

function Composer({ busy, onSend, onStop }: { busy: boolean; onSend: (text: string) => void; onStop: () => void }) {
  const copy = useCopy();
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  // One to five lines, growing with what is typed.
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 132)}px`;
  }, [text]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || !text.trim()) return;
    onSend(text);
    setText("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  };

  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <textarea
        ref={area}
        rows={1}
        value={text}
        maxLength={MESSAGE_CHARS}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={copy.chatPlaceholder}
        aria-label={copy.chatPlaceholder}
        enterKeyHint="send"
        // 16px keeps iOS from zooming the page when the field takes focus.
        className="min-h-10 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-base leading-6 text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      />
      {busy ? (
        <Button type="button" variant="secondary" size="icon-lg" className="size-10 rounded-xl" aria-label={copy.chatStop} onClick={onStop}>
          <Stop className="size-4" />
        </Button>
      ) : (
        <Button
          type="submit"
          variant="secondary"
          size="icon-lg"
          className={cn("size-10 rounded-xl", !text.trim() && "opacity-60")}
          aria-label={copy.chatSend}
          disabled={!text.trim()}
        >
          <ArrowUp className="size-4" />
        </Button>
      )}
    </form>
  );
}
