"use client";

import { Button } from "@/components/ui/button";
import { Panel, SectionHeading } from "@/components/ui/panel";
import { useCopy } from "@/components/settings-provider";
import { ProviderMark } from "@/components/assistant/provider-marks";
import type { AssistantId } from "@/lib/assistant-party";

/**
 * "Your assistant" on the board: one line and three buttons, each opening
 * the account drawer on that assistant's steps (AssistantSection), where
 * connecting, the prompts and disconnecting all live. Nothing is connected
 * from here.
 */
export function AssistantCard({ onChoose }: { onChoose: (assistant: AssistantId) => void }) {
  const copy = useCopy();
  const assistants: { id: AssistantId; name: string }[] = [
    { id: "claude", name: copy.assistantClaude },
    { id: "chatgpt", name: copy.assistantChatGpt },
    { id: "grok", name: copy.assistantGrok },
  ];
  return (
    <Panel>
      <SectionHeading title={copy.assistantTitle} hint={copy.assistantWhy} className="pb-1" />
      <p className="px-[18px] pb-3.5 text-[13.5px] leading-relaxed text-muted-foreground lg:px-6">{copy.assistantCardBody}</p>
      <div className="grid grid-cols-3 gap-1.5 px-[18px] pb-5 lg:px-6 lg:pb-[22px]">
        {assistants.map((assistant) => (
          <Button
            key={assistant.id}
            variant="outline"
            className="h-9 min-w-0 gap-1.5 px-2"
            aria-label={copy.assistantSheetTitle(assistant.name)}
            onClick={() => onChoose(assistant.id)}
          >
            <ProviderMark id={assistant.id} className="size-4" />
            <span className="truncate">{assistant.name}</span>
          </Button>
        ))}
      </div>
    </Panel>
  );
}
