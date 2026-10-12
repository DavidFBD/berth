import { NextResponse, type NextRequest } from "next/server";
import { createUIMessageStreamResponse, stepCountIs, streamText, toUIMessageStream } from "ai";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";
import { publicOrigin } from "@/lib/server/oauth/config";
import { chatGate } from "@/lib/server/chat/gate";
import { buildHistory } from "@/lib/server/chat/history";
import { CHAT_LIMITS, refusalFor } from "@/lib/server/chat/limits";
import { ChatMeter, firstStepInputEstimate, provisionalTokens } from "@/lib/server/chat/meter";
import { costMicros } from "@/lib/server/chat/prices";
import { chatModel, openAiOptions } from "@/lib/server/chat/model";
import { chatSystem } from "@/lib/server/chat/system-prompt";
import { chatToolContext, chatTools } from "@/lib/server/chat/tools";
import { openChatUsage, recordChatUsage, takeChatPlace, type ChatUsageRow } from "@/lib/server/chat/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby caps a function at 60 s unless Fluid Compute is on, and
// `vercel project inspect berthmarkets` does not say that it is (checked
// 2026-09-28). Five steps with 8 s chain reads usually fit; a message cut
// off here keeps its provisional usage row, so the counts still hold.
export const maxDuration = 60;

/**
 * The in-app assistant: one message in, a streamed answer out.
 *
 * Order of work: who is asking (the same Privy token or wallet session as
 * every account route) → the gate (switched on, a key, the chat rung, the
 * house budget, the person's day) → the message itself (history trimmed,
 * too long refused) → one place in the minute and the day → the model,
 * with the twelve Berth tools and at most five steps → one chat_usage row
 * when the message ends, however it ends. A refusal before the model runs
 * is plain JSON with a code the browser turns into words.
 *
 * Nothing of what was said is stored or logged. The tools read and draft;
 * nothing here can place, sign or send an order.
 */

export type ChatRefusalBody = { code: string };

function refuse(code: string, status: number): NextResponse<ChatRefusalBody> {
  return NextResponse.json({ code }, { status, headers: { "Cache-Control": "no-store" } });
}

const STATUS_FOR: Record<string, number> = {
  disabled: 503,
  unavailable: 503,
  budget: 503,
  locked: 403,
  limit_day: 429,
  limit_month: 429,
  limit_minute: 429,
};

export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;
  const user = resolved.user;

  const gate = await chatGate(user);
  if (!gate.ok) return refuse(gate.code, STATUS_FOR[gate.code] ?? 503);

  const history = buildHistory(read.caller.body.messages);
  if (!history.ok) return refuse(history.code, 400);

  let place: Awaited<ReturnType<typeof takeChatPlace>>;
  try {
    place = await takeChatPlace(user.id);
  } catch (error) {
    console.warn("[chat] place unavailable, closing:", error instanceof Error ? error.name : "error");
    return refuse("unavailable", 503);
  }
  const refusal = refusalFor({ allowance: gate.allowance, costTodayMicros: gate.costToday, ...place });
  if (refusal) return refuse(refusal, 429);

  const started = performance.now();
  const meter = new ChatMeter(gate.provider.model);
  const historyChars = history.messages.reduce((sum, message) => sum + message.content.length, 0);
  const rowOf = (ok: boolean, error: string | null): ChatUsageRow => ({
    userId: user.id,
    provider: gate.provider.kind,
    model: gate.provider.model,
    steps: meter.steps,
    tools: meter.tools,
    inputTokens: meter.tokens.input,
    cacheReadTokens: meter.tokens.cacheRead,
    cacheWriteTokens: meter.tokens.cacheWrite,
    outputTokens: meter.tokens.output,
    reasoningTokens: meter.tokens.reasoning,
    costMicros: meter.costMicros,
    ok,
    error,
    durationMs: performance.now() - started,
  });

  // The row opens before the model runs, priced at the most the message
  // could cost, so a function cut off mid answer still counts against the
  // day and the month; it is settled with the real numbers at the end.
  const estimate = provisionalTokens(historyChars, CHAT_LIMITS.maxSteps, CHAT_LIMITS.maxOutputTokens);
  const provisionalMicros = costMicros(gate.provider.model, estimate);
  let usageId: string;
  try {
    usageId = await openChatUsage({
      ...rowOf(false, "provisional"),
      inputTokens: estimate.input,
      outputTokens: estimate.output,
      costMicros: provisionalMicros,
    });
  } catch (error) {
    console.warn("[chat] usage row unavailable, closing:", error instanceof Error ? error.name : "error");
    return refuse("unavailable", 503);
  }

  let recorded = false;
  const record = (ok: boolean, error: string | null) => {
    if (recorded) return;
    recorded = true;
    // Ended mid step: that step was billed too, and its usage never came.
    if (!ok) meter.chargeInFlight(firstStepInputEstimate(historyChars), CHAT_LIMITS.maxOutputTokens);
    recordChatUsage(usageId, rowOf(ok, error), provisionalMicros);
  };

  const model = await chatModel(gate.provider);
  const origin = publicOrigin(request.headers, request.url);
  const result = streamText({
    model,
    system: chatSystem({ now: new Date(), rankName: gate.rank.name, level: gate.rank.level }),
    messages: history.messages,
    tools: chatTools(chatToolContext(user.id, origin, read.caller.availability)),
    stopWhen: stepCountIs(CHAT_LIMITS.maxSteps),
    maxOutputTokens: CHAT_LIMITS.maxOutputTokens,
    providerOptions: gate.provider.kind === "openai" ? openAiOptions(user.id) : undefined,
    abortSignal: request.signal,
    onStepEnd: (step) => meter.addStep(step),
    onEnd: () => record(true, null),
    onAbort: () => record(false, "stopped"),
    onError: ({ error }) => {
      // A code and the provider's status, never the message text or the request.
      const status = (error as { statusCode?: number } | null)?.statusCode;
      console.warn(`[chat] model failed${status ? ` (${status})` : ""}`);
      record(false, "failed");
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream, onError: () => "failed", sendReasoning: false }),
    headers: { "Cache-Control": "no-store" },
  });
}
