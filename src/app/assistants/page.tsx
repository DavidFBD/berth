import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { ArrowSquareOut, DownloadSimple } from "@phosphor-icons/react/ssr";
import { BerthMark } from "@/components/berth-mark";
import { ProviderMark } from "@/components/assistant/provider-marks";
import { assistantOpenUrl } from "@/lib/assistant-links";
import type { AssistantId } from "@/lib/assistant-party";
import { COPY, PRIVACY_OPERATOR } from "@/lib/copy";
import { publicOrigin, resourceFor } from "@/lib/server/oauth/config";

export const metadata: Metadata = {
  title: `${COPY.assistantsHelp.title} · Berth`,
  description: COPY.assistantsHelp.intro[0],
  alternates: { canonical: "/assistants" },
};

/**
 * The public help page for assistants: how to connect Claude, ChatGPT and
 * Grok, what an assistant can and cannot do, how to disconnect, and where
 * to write. The documentation and support address for the assistant
 * directories. Server rendered and outside AuthGate, like app/privacy.
 *
 * The steps are the account drawer's own (assistantStepsClaude and its
 * siblings), so there is one set of words to keep true.
 */
export default async function AssistantsPage() {
  const help = COPY.assistantsHelp;
  const origin = publicOrigin(await headers());
  const mcpUrl = resourceFor(origin);
  const assistants: { id: AssistantId; name: string; steps: readonly string[] }[] = [
    { id: "claude", name: COPY.assistantClaude, steps: COPY.assistantStepsClaude },
    { id: "chatgpt", name: COPY.assistantChatGpt, steps: COPY.assistantStepsChatGpt },
    { id: "grok", name: COPY.assistantGrok, steps: COPY.assistantStepsGrok },
  ];

  const list = (items: readonly string[]) => (
    <ul className="flex list-disc flex-col gap-2.5 pl-5 marker:text-muted-foreground">
      {items.map((line) => (
        <li key={line} className="pl-1">
          {line}
        </li>
      ))}
    </ul>
  );

  return (
    <main className="mx-auto w-full max-w-2xl px-5 pt-10 pb-[max(env(safe-area-inset-bottom),3rem)] sm:px-8 sm:pt-14">
      <Link href="/" className="inline-flex items-center gap-2.5 text-foreground" aria-label={help.backHome}>
        <BerthMark className="size-7" title="Berth" />
        <span className="font-wordmark text-lg">{COPY.brand}</span>
      </Link>

      <header className="mt-10 flex flex-col gap-3 border-b border-border pb-8">
        <h1 className="font-display text-3xl tracking-[-0.02em] text-foreground sm:text-4xl">{help.title}</h1>
        {help.intro.map((line) => (
          <p key={line} className="text-base leading-relaxed text-foreground">
            {line}
          </p>
        ))}
      </header>

      <section id="connect" className="scroll-mt-6 border-b border-border py-8">
        <h2 className="font-display text-xl tracking-[-0.02em] text-foreground">{help.connectHeading}</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-foreground">{help.connectBody}</p>
        <div className="mt-5 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{COPY.assistantAddressLabel}</span>
          <code className="money block rounded-lg border border-border bg-card px-3 py-2 text-[14px] break-all text-foreground select-all">
            {mcpUrl}
          </code>
        </div>

        <div className="mt-6 flex flex-col gap-4">
          {assistants.map((assistant) => (
            <div key={assistant.id} id={assistant.id} className="flex scroll-mt-6 flex-col gap-3 rounded-xl border border-border p-4">
              <h3 className="flex items-center gap-2 font-display text-base text-foreground">
                <ProviderMark id={assistant.id} className="size-5" />
                {assistant.name}
              </h3>
              <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed text-foreground marker:text-muted-foreground">
                {assistant.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {assistant.id === "chatgpt" && (
                <a
                  href="/berth-app-icon.png"
                  download="Berth.png"
                  className="flex items-center gap-2 self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  <DownloadSimple className="size-4" aria-hidden />
                  {COPY.assistantIconDownload}
                </a>
              )}
              <a
                href={assistantOpenUrl(assistant.id, mcpUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted"
              >
                {COPY.assistantOpen(assistant.name)}
                <ArrowSquareOut className="size-4" aria-hidden />
              </a>
            </div>
          ))}
        </div>
      </section>

      {[
        { id: "can", heading: help.canHeading, items: help.can },
        { id: "cannot", heading: help.cannotHeading, items: help.cannot },
        { id: "disconnect", heading: help.disconnectHeading, items: help.disconnect },
      ].map((section) => (
        <section key={section.id} id={section.id} className="scroll-mt-6 border-b border-border py-8">
          <h2 className="font-display text-xl tracking-[-0.02em] text-foreground">{section.heading}</h2>
          <div className="mt-3 text-[15px] leading-relaxed text-foreground">{list(section.items)}</div>
        </section>
      ))}

      <section id="privacy" className="scroll-mt-6 border-b border-border py-8">
        <h2 className="font-display text-xl tracking-[-0.02em] text-foreground">{help.moreHeading}</h2>
        <div className="mt-3 flex flex-col gap-3 text-[15px] leading-relaxed text-foreground">
          {help.more.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/privacy" className="text-primary underline underline-offset-4">
              {COPY.privacyPolicy.title}
            </Link>
            <Link href="/terms" className="text-primary underline underline-offset-4">
              {COPY.termsOfUse.title}
            </Link>
          </p>
        </div>
      </section>

      <section id="support" className="py-8">
        <p className="text-[15px] leading-relaxed text-foreground">
          <a href={`mailto:${PRIVACY_OPERATOR.email}`} className="underline underline-offset-4">
            {help.support}
          </a>
        </p>
      </section>

      <p className="text-sm">
        <Link href="/" className="font-medium text-primary underline underline-offset-4">
          {help.backHome}
        </Link>
      </p>
    </main>
  );
}
