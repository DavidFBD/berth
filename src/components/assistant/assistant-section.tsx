"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowSquareOut, ArrowUpRight, CaretDown, Check, CheckCircle, Copy, DownloadSimple } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { useCopy } from "@/components/settings-provider";
import { useMounted } from "@/hooks/use-mounted";
import { useAssistantGrants, useDisconnectAssistant } from "@/hooks/use-profile";
import { formatTimeAgo } from "@/lib/news";
import { SPRING_SHELF } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { ProviderMark } from "@/components/assistant/provider-marks";
import type { AssistantId } from "@/lib/assistant-party";
import { assistantOpenUrl } from "@/lib/assistant-links";
import { promptUrl } from "@/lib/assistant-prompts";

/**
 * "Your assistant": connect Claude, ChatGPT or Grok to this account through
 * Berth's MCP server (app/mcp), and see or disconnect the ones already
 * connected. One short line on what an assistant can and cannot do, three
 * buttons, and under the chosen one its own steps unfold in place (drawers
 * do not stack): the address to paste with a copy button, two or three
 * plain steps, and the button that opens that assistant's settings.
 *
 * Once an assistant is connected its sheet leads with three prompts that
 * open a new chat there with the words filled in (lib/assistant-prompts),
 * and the setup folds away behind "Connect again".
 *
 * The Claude button uses claude.ai's add connector link with the name and
 * address filled in. It is not documented, so the copy button stays beside
 * it for the day it stops working.
 */

/** How long a first tap on Disconnect waits for the second. */
const DISCONNECT_CONFIRM_MS = 4_000;

type Grant = { id: string; clientName: string; lastUsedAt: string | null; assistant?: AssistantId | null };

export function AssistantSection({
  demoGrants,
  initialOpen = null,
}: {
  /** Dev gallery only: show these as connected instead of asking the server. */
  demoGrants?: Grant[];
  /** Start with one assistant's steps unfolded: the board's card, and the dev gallery. */
  initialOpen?: AssistantId | null;
} = {}) {
  const copy = useCopy();
  const mounted = useMounted();
  const [open, setOpen] = useState<AssistantId | null>(initialOpen);
  const grants = useAssistantGrants(!demoGrants);
  const disconnect = useDisconnectAssistant();
  const connected = demoGrants ?? grants.data ?? [];
  // The address this deployment answers on; the server is at /mcp beside it.
  const mcpUrl = mounted ? `${window.location.origin}/mcp` : "/mcp";

  const assistants: { id: AssistantId; name: string; steps: readonly string[] }[] = [
    { id: "claude", name: copy.assistantClaude, steps: copy.assistantStepsClaude },
    { id: "chatgpt", name: copy.assistantChatGpt, steps: copy.assistantStepsChatGpt },
    { id: "grok", name: copy.assistantGrok, steps: copy.assistantStepsGrok },
  ];
  const chosen = assistants.find((assistant) => assistant.id === open);
  const isConnected = (id: AssistantId) => connected.some((grant) => grant.assistant === id);
  // Which connected sheet has its setup unfolded again, if any.
  const [setupFor, setSetupFor] = useState<AssistantId | null>(null);

  // Copied shows on the button itself for a moment: a toast would sit over
  // Open Claude, the very next thing the person reaches for.
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  const copyAddress = () => {
    void navigator.clipboard.writeText(mcpUrl).then(() => setCopied(true));
  };

  // Disconnect takes a second tap: the first turns the button into the
  // question for a few seconds, no modal.
  const [confirming, setConfirming] = useState<string | null>(null);
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(null), DISCONNECT_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  const drop = async (grant: Grant) => {
    if (confirming !== grant.id) {
      setConfirming(grant.id);
      return;
    }
    setConfirming(null);
    if (demoGrants) return;
    const result = await disconnect.mutateAsync(grant.id).catch(() => null);
    if (result) toast.success(copy.assistantDisconnected(grant.clientName));
    else toast.error(copy.assistantDisconnectFailed);
  };

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          {copy.assistantTitle}
          <InfoTip label={copy.assistantTitle}>
            <p>{copy.assistantWhy}</p>
          </InfoTip>
        </span>
        <p className="text-xs leading-relaxed text-muted-foreground">{copy.assistantBody}</p>
        <a
          href="/assistants"
          target="_blank"
          rel="noopener"
          className="self-start text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          {copy.assistantsLink}
        </a>
      </div>

      <div className="grid grid-cols-3 gap-2" role="group" aria-label={copy.assistantTitle}>
        {assistants.map((assistant) => (
          <Button
            key={assistant.id}
            variant="outline"
            aria-expanded={open === assistant.id}
            aria-label={isConnected(assistant.id) ? copy.assistantButtonConnected(assistant.name) : undefined}
            className={cn("relative h-auto min-w-0 flex-col gap-1.5 rounded-xl px-2 pt-3 pb-2.5 text-[13px]", open === assistant.id && "border-foreground/40 dark:border-foreground/30 dark:bg-input/60")}
            onClick={() => setOpen((current) => (current === assistant.id ? null : assistant.id))}
          >
            <ProviderMark id={assistant.id} className="size-5" />
            <span className="truncate">{assistant.name}</span>
            {isConnected(assistant.id) && (
              <CheckCircle weight="duotone" className="absolute top-1.5 right-1.5 size-4 text-foreground" aria-hidden />
            )}
          </Button>
        ))}
      </div>

      <AnimatePresence initial={false}>
        {chosen && (
          <motion.div
            key={chosen.id}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING_SHELF}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-3">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-foreground">{isConnected(chosen.id) ? chosen.name : copy.assistantSheetTitle(chosen.name)}</span>
                <span className="text-xs text-muted-foreground">
                  {isConnected(chosen.id) ? copy.assistantSheetConnected(chosen.name) : copy.assistantSheetBody}
                </span>
              </div>

              {isConnected(chosen.id) && (
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">{copy.assistantPromptsTitle}</span>
                  <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
                    {copy.assistantPrompts.map((prompt) => (
                      <li key={prompt}>
                        <a
                          href={promptUrl(chosen.id, prompt)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={copy.assistantPromptLabel(chosen.name, prompt)}
                          className="flex min-h-11 items-center gap-3 px-3 py-2 text-[13px] leading-snug text-foreground transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                        >
                          <span className="min-w-0 flex-1">{prompt}</span>
                          <ArrowUpRight weight="duotone" className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        </a>
                      </li>
                    ))}
                  </ul>
                  {chosen.id === "chatgpt" && (
                    <span className="pt-0.5 text-[11px] text-muted-foreground">{copy.assistantPromptHintChatGpt}</span>
                  )}
                </div>
              )}

              {isConnected(chosen.id) && (
                <button
                  type="button"
                  aria-expanded={setupFor === chosen.id}
                  className="flex items-center gap-1 self-start text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  onClick={() => setSetupFor((current) => (current === chosen.id ? null : chosen.id))}
                >
                  {copy.assistantSetupAgain}
                  <CaretDown className={cn("size-3.5 transition-transform", setupFor === chosen.id && "rotate-180")} aria-hidden />
                </button>
              )}

              {(!isConnected(chosen.id) || setupFor === chosen.id) && (
                <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">{copy.assistantAddressLabel}</span>
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
                    <span className="money min-w-0 flex-1 truncate text-[13px] text-foreground">{mcpUrl}</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={copied ? copy.assistantCopied : copy.assistantCopyLabel}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={copyAddress}
                    >
                      {copied ? <Check className="size-4.5 text-foreground" /> : <Copy className="size-4.5" />}
                    </Button>
                    <span className="sr-only" aria-live="polite">
                      {copied ? copy.assistantCopied : ""}
                    </span>
                  </div>
                </div>

                <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-xs leading-relaxed text-foreground marker:text-muted-foreground">
                  {chosen.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>

                {/* ChatGPT's Create MCP App form takes an icon (PNG, 10 KB at
                    most); Berth's app icon is 180 pixels and under 8 KB. */}
                {chosen.id === "chatgpt" && (
                  <a
                    href="/berth-app-icon.png"
                    download="Berth.png"
                    className="flex items-center gap-2 self-start text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    <DownloadSimple className="size-4" aria-hidden />
                    {copy.assistantIconDownload}
                  </a>
                )}

                <Button
                  variant="outline"
                  className="h-10 w-full"
                  render={<a href={assistantOpenUrl(chosen.id, mcpUrl)} target="_blank" rel="noopener noreferrer" />}
                  nativeButton={false}
                >
                  {copy.assistantOpen(chosen.name)}
                  <ArrowSquareOut className="size-4" aria-hidden />
                </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {connected.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">{copy.assistantConnectedTitle}</span>
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
            {connected.map((grant) => (
              <li key={grant.id} className="flex items-center gap-3 px-3 py-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm text-foreground">{grant.clientName}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {grant.lastUsedAt
                      ? copy.assistantLastUsed(formatTimeAgo(Date.parse(grant.lastUsedAt)))
                      : copy.assistantNeverUsed}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={
                    confirming === grant.id
                      ? copy.assistantDisconnectConfirm(grant.clientName)
                      : copy.assistantDisconnectLabel(grant.clientName)
                  }
                  disabled={disconnect.isPending}
                  className={cn(
                    "shrink-0 text-muted-foreground hover:text-destructive",
                    confirming === grant.id && "text-destructive",
                  )}
                  onClick={() => void drop(grant)}
                >
                  {confirming === grant.id ? copy.assistantDisconnectConfirm(grant.clientName) : copy.assistantDisconnect}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
