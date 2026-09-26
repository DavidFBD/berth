"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowSquareOut, Check, CheckCircle, Copy } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";
import { useMounted } from "@/hooks/use-mounted";
import { useAssistantGrants, useDisconnectAssistant } from "@/hooks/use-profile";
import { formatTimeAgo } from "@/lib/news";
import { SPRING_SHELF } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { ProviderMark } from "@/components/assistant/provider-marks";
import type { AssistantId } from "@/lib/assistant-party";

/**
 * "Your assistant": connect Claude, ChatGPT or Grok to this account through
 * Berth's MCP server (app/mcp), and see or disconnect the ones already
 * connected. One short line on what an assistant can and cannot do, three
 * buttons, and under the chosen one its own steps unfold in place (drawers
 * do not stack): the address to paste with a copy button, two or three
 * plain steps, and the button that opens that assistant's settings.
 *
 * The Claude button uses claude.ai's add connector link with the name and
 * address filled in. It is not documented, so the copy button stays beside
 * it for the day it stops working.
 */

/** How long a first tap on Disconnect waits for the second. */
const DISCONNECT_CONFIRM_MS = 4_000;

type Grant = { id: string; clientName: string; lastUsedAt: string | null; assistant?: AssistantId | null };

function openUrl(id: AssistantId, mcpUrl: string): string {
  switch (id) {
    case "claude":
      return `https://claude.ai/customize/connectors?modal=add-custom-connector&mcpName=Berth&mcpServerUrl=${encodeURIComponent(mcpUrl)}`;
    case "chatgpt":
      return "https://chatgpt.com/";
    case "grok":
      return "https://grok.com/connectors";
  }
}

export function AssistantSection({
  demoGrants,
  initialOpen = null,
}: {
  /** Dev gallery only: show these as connected instead of asking the server. */
  demoGrants?: Grant[];
  /** Dev gallery only: start with one assistant's steps unfolded. */
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
        <span className="text-sm font-medium text-foreground">{copy.assistantTitle}</span>
        <p className="text-xs leading-relaxed text-muted-foreground">{copy.assistantBody}</p>
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
                <span className="text-sm font-medium text-foreground">{copy.assistantSheetTitle(chosen.name)}</span>
                <span className="text-xs text-muted-foreground">
                  {isConnected(chosen.id) ? copy.assistantSheetConnected(chosen.name) : copy.assistantSheetBody}
                </span>
              </div>

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

              <Button
                variant="outline"
                className="h-10 w-full"
                render={<a href={openUrl(chosen.id, mcpUrl)} target="_blank" rel="noopener noreferrer" />}
                nativeButton={false}
              >
                {copy.assistantOpen(chosen.name)}
                <ArrowSquareOut className="size-4" aria-hidden />
              </Button>
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
