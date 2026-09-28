"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { notFound, useSearchParams } from "next/navigation";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { ChatButton } from "@/components/chat/chat-button";
import { ChatSheetFrame } from "@/components/chat/chat-sheet";
import { HomeHeader } from "@/components/home";
import { RankChip } from "@/components/rewards-panel";
import { ConnectButton } from "@/components/wallet/connect-button";
import { useBerthChat } from "@/components/chat/use-berth-chat";
import type { ChatStatusResponse } from "@/app/api/chat/status/route";

/**
 * Dev-only gallery for Ask, the in-app assistant: the real sheet and panel
 * outside the sign in gate, fed by a scripted transport in the browser
 * (no server, no model, no key), so every state can be shot. Not linked
 * anywhere; 404 in prod. For the real route with the dev mock model, set
 * CHAT_PROVIDER=mock and LOCAL_DATABASE_URL and use the app itself.
 *
 *   /dev/chat?scene=header        the home bar at phone width, with the
 *                                 email account pill and a wallet one
 *   /dev/chat?scene=locked        below the chat rung
 *   /dev/chat?scene=empty         open, nothing asked yet: the prompts
 *   /dev/chat?scene=tool          a question sent, a tool still reading
 *   /dev/chat?scene=answer        a streamed answer after two tools
 *   /dev/chat?scene=draft         a buy drafted: the card
 *   /dev/chat?scene=sell          a sell by quantity drafted
 *   /dev/chat?scene=limit         the day's messages spent
 *   /dev/chat?scene=month         this month's share spent
 *   /dev/chat?scene=left          three messages left today
 *   /dev/chat?scene=minute        the minute's limit, after a send
 *   /dev/chat?scene=budget        the house budget spent
 *   /dev/chat?scene=unavailable   no key, or switched off
 */

const OPEN: ChatStatusResponse = { state: "open", level: 3, unlockLevel: 2, unlockRankName: "Slip", xpToUnlock: 0, left: 22 };

const STATUS: Record<string, ChatStatusResponse> = {
  locked: { state: "locked", level: 1, unlockLevel: 2, unlockRankName: "Slip", xpToUnlock: 75, left: null },
  limit: { ...OPEN, state: "limit_day", left: null },
  left: { ...OPEN, left: 3 },
  budget: { ...OPEN, state: "budget", left: null },
  month: { ...OPEN, state: "limit_month", left: null },
  unavailable: { ...OPEN, state: "unavailable", left: null },
};

const PROMPT: Record<string, string> = {
  tool: "What moved on Berth today, and why?",
  answer: "What moved on Berth today, and why?",
  draft: "Draft a $20 buy of NVIDIA on Berth.",
  sell: "Sell half my Tesla.",
  minute: "And Apple?",
};

const MOVES_ANSWER =
  "Three listings moved more than usual on the last trading day, to the close of 25 September:\n\n" +
  "- **NVIDIA** rose 4.21%, large for it. Around that day, Reuters posted about a new supply agreement.\n" +
  "- **Tesla** fell 3.08%, also large for it.\n" +
  "- **Apple** rose 0.62%, an ordinary day.\n\n" +
  "These say what happened, not why it will happen again. [The Reuters post](https://x.com/Reuters/status/1) has the detail.";

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** A transport that answers from a script, a few words at a time. */
function scriptedTransport(scene: string): ChatTransport<UIMessage> {
  return {
    reconnectToStream: async () => null,
    sendMessages: async ({ abortSignal }) => {
      if (scene === "minute") throw new Error("chat:limit_minute");
      return new ReadableStream<UIMessageChunk>({
        async start(controller) {
          const push = (chunk: UIMessageChunk) => controller.enqueue(chunk);
          const text = async (words: string, delay = 45) => {
            push({ type: "text-start", id: "t" });
            for (const piece of words.split(/(?<= )/)) {
              if (abortSignal?.aborted) break;
              push({ type: "text-delta", id: "t", delta: piece });
              await sleep(delay, abortSignal);
            }
            push({ type: "text-end", id: "t" });
          };
          push({ type: "start" });
          await sleep(700, abortSignal);
          if (scene === "draft" || scene === "sell") {
            const draft =
              scene === "draft"
                ? { symbol: "NVDA", name: "NVIDIA", side: "buy", usd: 20, approxUsd: 20 }
                : { symbol: "TSLA", name: "Tesla", side: "sell", quantity: 0.0412, approxUsd: 18.37 };
            push({ type: "start-step" });
            push({ type: "tool-input-available", toolCallId: "d1", toolName: "draft_order", input: {} });
            await sleep(600, abortSignal);
            push({ type: "tool-output-available", toolCallId: "d1", output: { text: "Draft.", draft } });
            push({ type: "finish-step" });
            push({ type: "start-step" });
            await text(
              scene === "draft"
                ? "I drafted a $20 buy of NVIDIA. Open the order to check the amount and what you pay with. Nothing happens until you sign."
                : "I drafted a sell of half your Tesla, 0.0412 shares, about $18.37 at the current price. Open it to check, then sign if it is right.",
            );
            push({ type: "finish-step" });
          } else {
            push({ type: "start-step" });
            push({ type: "tool-input-available", toolCallId: "m1", toolName: "get_moves", input: {} });
            push({ type: "tool-input-available", toolCallId: "m2", toolName: "get_market_feed", input: {} });
            await sleep(scene === "tool" ? 600 : 900, abortSignal);
            push({ type: "tool-output-available", toolCallId: "m1", output: { text: "Moves." } });
            if (scene === "tool") {
              // Hold the second tool open for the shot.
              await sleep(60_000, abortSignal);
            }
            push({ type: "tool-output-available", toolCallId: "m2", output: { text: "Feed." } });
            push({ type: "finish-step" });
            push({ type: "start-step" });
            await text(MOVES_ANSWER, 30);
            push({ type: "finish-step" });
          }
          push({ type: "finish" });
          controller.close();
        },
      });
    },
  };
}

const SEEDED: UIMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "How did my money do this month?" }] },
  {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "tool-get_performance", toolCallId: "p1", state: "output-available", input: {}, output: { text: "Perf." } } as UIMessage["parts"][number],
      {
        type: "text",
        text: "Over the last month your account rose 2.14%. The same dollars in Gold rose 3.02% and in Bitcoin fell 1.40%. Under about twenty market days, a comparison like this is mostly noise.",
      },
    ],
  },
];

export default function ChatGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={<Skeleton className="m-4 h-40" />}>
      <Gallery />
    </Suspense>
  );
}

function Gallery() {
  const params = useSearchParams();
  if (params.get("scene") === "header") return <HeaderScene />;
  return <SheetScene />;
}

function SheetScene() {
  const params = useSearchParams();
  const scene = params.get("scene") ?? "empty";
  const transport = useMemo(() => scriptedTransport(scene), [scene]);
  const chat = useBerthChat({ storageKey: null, transport, headers: async () => ({}) });
  const [open, setOpen] = useState(true);
  const status = STATUS[scene] ?? OPEN;

  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (scene === "limit" || scene === "left" || scene === "month") chat.setMessages(SEEDED);
    const prompt = PROMPT[scene];
    if (prompt) void chat.send(prompt);
  }, [scene, chat]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-6">
      {/* The dev overlays sit over the composer; the gallery is for looking at it. */}
      <style>{`[data-wallet-diagnostics], nextjs-portal { display: none !important; }`}</style>
      <header className="flex items-center justify-between">
        <h1 className="font-display text-xl text-foreground">Assistant, {scene}</h1>
        <ChatButton onOpen={() => setOpen(true)} />
      </header>
      <ChatSheetFrame
        chat={chat}
        open={open}
        onOpenChange={setOpen}
        status={status}
        onOpenDraft={(draft) => toast(`Would open the ${draft.side} drawer on ${draft.name}`)}
      />
    </div>
  );
}

/** The home bar as a signed in person sees it, without a session: the email pill, and a wallet's chip beside its connect pill. */
function HeaderScene() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-8 px-4 sm:max-w-lg">
      <style>{`[data-wallet-diagnostics], nextjs-portal { display: none !important; }`}</style>
      <HomeHeader onOpenChat={() => {}}>
        <RankChip presence placeholder="Your account" onClick={() => {}} />
      </HomeHeader>
      <HomeHeader onOpenChat={() => {}}>
        <div data-wallet-pill className="flex min-w-0 items-center gap-1.5">
          <RankChip placeholder="Lv 10" onClick={() => {}} />
          <ConnectButton />
        </div>
      </HomeHeader>
    </div>
  );
}
