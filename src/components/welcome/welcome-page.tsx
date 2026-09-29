"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Bank, HandHeart, Key, PencilSimpleLine, Wallet } from "@phosphor-icons/react";
import { BerthMark } from "@/components/berth-mark";
import { MarketPreview, NewsFeed } from "@/components/board";
import { ProviderMark } from "@/components/assistant/provider-marks";
import { RankGlyph } from "@/components/rank-glyph";
import { SampleChart } from "@/components/welcome/sample-chart";
import { useCopy } from "@/components/settings-provider";
import { RANKS } from "@/lib/xp";
import { cn } from "@/lib/utils";

/**
 * The front door, laid out like the Seline mockup (2026-09-29): the
 * positioning line with its one highlighted phrase, the way in, a floating
 * preview of the board, then one section per live feature in the order of
 * docs/product/features.md, and a short list of what is coming. The
 * highlighted phrase stays ink on the pale wash, so the email button is the
 * page's one accent. Everything that signs someone in is passed in as
 * `ctas`, so this file only lays the page out.
 */
export function WelcomePage({
  lead,
  invited,
  ctas,
  onSignIn,
}: {
  /** Said instead of the usual lede when the visitor came for one thing. */
  lead?: string;
  invited: boolean;
  /** The way in, drawn under the hero and again at the close. */
  ctas: () => ReactNode;
  onSignIn: () => void;
}) {
  const copy = useCopy();
  const page = copy.welcomePage;
  return (
    <div className="mx-auto w-full max-w-[75rem] px-4 lg:px-10">
      <nav aria-label={page.navLabel} className="flex h-14 items-center justify-between lg:h-16">
        <span className="flex items-center gap-2">
          <BerthMark className="size-[22px]" />
          <span className="font-wordmark text-[19px] leading-none text-foreground">{copy.brand}</span>
        </span>
        <div className="hidden gap-1 md:flex">
          <a href="#how" className={NAV_LINK}>{page.nav.how}</a>
          <a href="#assistant" className={NAV_LINK}>{page.nav.assistant}</a>
          <a href="#ai" className={NAV_LINK}>{page.nav.ai}</a>
        </div>
        <button type="button" onClick={onSignIn} className={cn(PILL, "h-8 px-3.5 text-[13px] font-normal")}>
          {copy.signIn}
        </button>
      </nav>

      <header className="pt-9 lg:pt-[72px]">
        <p className="mb-4 text-[13px] font-medium text-muted-foreground lg:mb-[22px]">{page.eyebrow}</p>
        <h1 className="max-w-[50rem] font-display text-[40px] leading-[1.1] tracking-[-0.028em] text-foreground lg:text-[64px] lg:leading-[1.08] lg:tracking-[-0.03em]">
          {page.headlineLead}
          <span className="rounded-md bg-accent px-[0.1em] text-foreground [-webkit-box-decoration-break:clone] [box-decoration-break:clone]">
            {page.headlineMark}
          </span>
        </h1>
        <p className="mt-[18px] max-w-[37.5rem] text-[15.5px] leading-[1.65] text-muted-foreground lg:mt-6 lg:text-[17px]">
          {lead ?? copy.welcomeLede}
        </p>
        {/* The invitation announces itself before sign-in: name the deal
            while the visitor decides. */}
        {invited && (
          <p className="mt-5 flex w-fit items-center gap-2.5 rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground">
            <HandHeart weight="duotone" className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            {copy.inviteWaiting}
          </p>
        )}
        <div className="mt-[26px] lg:mt-8">{ctas()}</div>
        <p className="mt-3.5 text-[13px] text-muted-foreground">{copy.noSeedPhrases}</p>

        <Preview />
      </header>

      <main className="mt-[72px] lg:mt-[88px]">
        <Feature id="how" n="01" title={page.features.buy.title} body={page.features.buy.body} fine={page.features.buy.fine}>
          <BuyVisual />
        </Feature>
        <Feature n="02" title={page.features.custody.title} body={page.features.custody.body}>
          <CustodyVisual />
        </Feature>
        <Feature n="03" title={page.features.cash.title} body={page.features.cash.body}>
          <CashVisual />
        </Feature>
        <Feature n="04" title={page.features.compare.title} body={page.features.compare.body}>
          <CompareVisual />
        </Feature>
        <Feature n="05" title={page.features.news.title} body={page.features.news.body}>
          {/* The real column, live, as a signed-out visitor may read it. */}
          <NewsFeed limit={2} />
        </Feature>
        <Feature id="assistant" n="06" title={page.features.assistant.title} body={page.features.assistant.body} fine={page.features.assistant.fine}>
          <AssistantVisual />
        </Feature>
        <Feature id="ai" n="07" title={page.features.ai.title} body={page.features.ai.body}>
          <AiVisual />
        </Feature>
        <Feature n="08" title={page.features.ranks.title} body={page.features.ranks.body}>
          <RanksVisual />
        </Feature>
        <Feature n="09" title={page.features.wallets.title} body={page.features.wallets.body}>
          <WalletsVisual />
        </Feature>

        <section className="grid gap-5 border-t border-border py-11 lg:grid-cols-2 lg:gap-16 lg:py-14">
          <h2 className="font-display text-xl leading-tight tracking-[-0.015em] text-foreground">{page.comingTitle}</h2>
          <ul>
            {page.coming.map((item, index) => (
              <li
                key={item.name}
                className={cn(
                  "flex justify-between gap-4 text-sm text-foreground",
                  index === 0 ? "pb-3" : "border-t border-border py-3",
                )}
              >
                <span className="shrink-0">{item.name}</span>
                <span className="text-right text-[13px] text-muted-foreground">{item.line}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <section className="border-t border-border py-14 text-center lg:mt-10 lg:py-[72px]">
        <h2 className="font-display text-[32px] leading-[1.15] tracking-[-0.025em] text-foreground lg:text-[44px]">{copy.tagline}</h2>
        <div className="mt-[26px] flex justify-center lg:mt-8">{ctas()}</div>
      </section>

      <footer className="flex flex-col gap-4 border-t border-border pt-7 pb-12 text-[12.5px] text-muted-foreground sm:flex-row sm:justify-between sm:gap-6">
        <p className="max-w-[40rem] leading-relaxed">{page.legal}</p>
        <div className="flex gap-4 whitespace-nowrap">
          <Link href="/privacy" className="hover:text-foreground">{copy.privacyLink}</Link>
          <Link href="/terms" className="hover:text-foreground">{copy.termsLink}</Link>
        </div>
      </footer>
    </div>
  );
}

const NAV_LINK =
  "inline-flex h-8 items-center rounded-full px-3 text-sm text-muted-foreground transition-colors duration-150 ease-lift hover:text-foreground";

/** The ghost pill, also used by the page's own small controls. */
export const PILL =
  "inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card text-foreground outline-none transition-colors duration-150 ease-lift hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50";

/** The board in a frame, floating: an example account beside the live board. */
function Preview() {
  const copy = useCopy();
  const page = copy.welcomePage;
  return (
    <div
      role="img"
      aria-label={page.previewLabel}
      className="mt-10 rounded-2xl border border-border bg-card p-1.5 shadow-float lg:mt-16 lg:rounded-[18px] lg:p-2"
    >
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <div className="flex h-11 items-center justify-between border-b border-border px-4 lg:px-[18px]">
          <span className="flex items-center gap-2">
            <BerthMark className="size-[17px]" />
            <span className="font-wordmark text-[15px] leading-none text-foreground">{copy.brand}</span>
          </span>
          {/* The figures on the left are an example; the board on the right is live. */}
          <span className="inline-flex h-[26px] items-center rounded-full border border-border bg-card px-2.5 text-[11.5px] font-medium text-muted-foreground">
            {page.previewExample}
          </span>
        </div>
        <div className="grid gap-2.5 p-2.5 lg:grid-cols-[1.25fr_1fr] lg:gap-3 lg:p-3.5" aria-hidden>
          <div className="rounded-[10px] border border-border bg-card px-4 py-4 lg:px-[18px]">
            <p className="text-xs text-muted-foreground">{copy.accountTotalLabel}</p>
            <p className="money mt-1 mb-3 text-[34px] leading-[1.1] font-normal tracking-[-0.03em]! text-foreground lg:text-[40px]">$1,284.60</p>
            <div className="flex gap-[22px] text-[11.5px] text-muted-foreground">
              <SplitFigure label={copy.accountSplitHoldings} value="$1,041.12" />
              <SplitFigure label={copy.cashTitle} value="$203.48" />
              <SplitFigure label={copy.fundsTitle} value="$40.00" />
            </div>
            <Legend you="+6.1%" benchmark={copy.benchmarkNames.SPY} benchmarkPct="+2.4%" className="mt-3.5 mb-1" />
            <div className="[&>div]:h-[110px]! lg:[&>div]:h-[232px]!">
              <SampleChart />
            </div>
          </div>
          <div className="min-w-0 [&_section]:rounded-[10px]">
            <MarketPreview count={4} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SplitFigure({ label, value }: { label: string; value: string }) {
  return (
    <span>
      {label}
      <b className="money block text-[13px] leading-[1.4] font-medium text-foreground">{value}</b>
    </span>
  );
}

function Legend({
  you,
  benchmark,
  benchmarkPct,
  className,
}: {
  you: string;
  benchmark: string;
  benchmarkPct: string;
  className?: string;
}) {
  const copy = useCopy();
  return (
    <p className={cn("flex flex-wrap gap-x-3.5 text-[11.5px] text-foreground", className)}>
      <span>
        <i aria-hidden className="mr-1.5 inline-block w-3 translate-y-[-3px] border-t-[1.5px] border-foreground" />
        {copy.portfolioYou} <span className="money text-good">{you}</span>
      </span>
      <span>
        <i aria-hidden className="mr-1.5 inline-block w-3 translate-y-[-3px] border-t-[1.5px] border-dashed border-muted-foreground" />
        {benchmark} <span className="money text-good">{benchmarkPct}</span>
      </span>
    </p>
  );
}

/** One feature: the words on the left, what it looks like on the right. */
function Feature({
  id,
  n,
  title,
  body,
  fine,
  children,
}: {
  id?: string;
  n: string;
  title: string;
  body: string[];
  fine?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="grid scroll-mt-6 items-center gap-7 border-t border-border py-11 lg:grid-cols-2 lg:gap-16 lg:py-14"
    >
      <div>
        <p className="money mb-[18px] text-[12.5px] text-faint">{n}</p>
        <h2 className="max-w-[30rem] font-display text-[28px] leading-[1.15] tracking-[-0.025em] text-foreground lg:text-[36px]">
          {title}
        </h2>
        {body.map((paragraph) => (
          <p key={paragraph} className="mt-4 max-w-[30rem] text-[15px] leading-[1.7] text-muted-foreground">
            {paragraph}
          </p>
        ))}
        {fine && <p className="mt-3 max-w-[30rem] text-[13px] leading-relaxed text-muted-foreground">{fine}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** The card a visual sits in. */
function Visual({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div aria-hidden className={cn("rounded-2xl border border-border bg-card p-[18px] lg:p-[22px]", className)}>
      {children}
    </div>
  );
}

function Row({ label, value, first }: { label: string; value: ReactNode; first?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3 py-1.5 text-[13px]", !first && "border-t border-border")}>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-foreground">{value}</span>
    </div>
  );
}

const PAY_WITH = [
  { coin: "USDC", network: "Base", usd: "$412.08" },
  { coin: "SOL", network: "Solana", usd: "$96.30" },
  { coin: "Bitcoin", network: "Bitcoin", usd: "$1,120.55" },
  { coin: "Ether", network: "Arbitrum", usd: "$58.14" },
];

function BuyVisual() {
  const copy = useCopy();
  const f = copy.welcomePage.features.buy;
  return (
    <Visual>
      <div className="mb-3 flex items-center justify-between font-display text-[15px] tracking-[-0.01em] text-foreground">
        {f.card}
        <span className="money text-sm">$50.00</span>
      </div>
      {PAY_WITH.map((row, index) => (
        <div key={row.coin} className={cn("flex items-center gap-3 py-2.5 text-[13.5px]", index > 0 && "border-t border-border")}>
          <span
            className={cn(
              "grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px]",
              index === 0 ? "border-foreground" : "border-input",
            )}
          >
            {index === 0 && <span className="size-2 rounded-full bg-foreground" />}
          </span>
          <span className="min-w-0 flex-1 text-foreground">
            {row.coin}
            <small className="block text-xs text-muted-foreground">{copy.welcomePage.onNetwork(row.network)}</small>
          </span>
          <span className="money text-[13px] text-foreground">{row.usd}</span>
        </div>
      ))}
      <div className="mt-3.5 flex h-10 items-center justify-center rounded-full border border-input text-[13.5px] font-medium text-foreground">
        {f.review}
      </div>
    </Visual>
  );
}

function CustodyVisual() {
  const f = useCopy().welcomePage.features.custody;
  return (
    <Visual>
      <div className="rounded-[10px] border border-border bg-background px-4 py-3.5">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Key weight="duotone" className="size-3.5" />
          {f.asks}
        </p>
        <div className="mt-2.5">
          <Row first label={f.buy} value="NVIDIA" />
          <Row label={f.pay} value={<span className="money">50.00 USDC</span>} />
          <Row label={f.get} value={<span className="money">0.2204 NVDA</span>} />
          <Row label={f.held} value={f.you} />
        </div>
      </div>
      <div className="mt-3.5 flex h-10 items-center justify-center rounded-full border border-input text-[13.5px] font-medium text-foreground">
        {f.sign}
      </div>
    </Visual>
  );
}

function CashVisual() {
  const copy = useCopy();
  const f = copy.welcomePage.features.cash;
  return (
    <Visual>
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-secondary-foreground">
          <Bank weight="duotone" className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-display text-base text-foreground">
            {copy.cashTitle} <span className="money text-[15px]">$203.48</span>
          </span>
          <small className="block text-[13px] text-muted-foreground">{f.line}</small>
        </span>
      </div>
      <div className="mt-3 border-t border-border pt-1.5">
        <Row first label={f.counts} value={f.yes} />
        <Row label={f.takeOut} value={f.anyTime} />
      </div>
      <div className="mt-3.5 flex gap-1.5">
        <span className={cn(PILL, "h-7 px-3 text-[12.5px] font-medium")}>{copy.cashParkMore}</span>
        <span className={cn(PILL, "h-7 px-3 text-[12.5px] font-medium")}>{copy.cashTakeOut}</span>
      </div>
    </Visual>
  );
}

function CompareVisual() {
  const copy = useCopy();
  const names = copy.benchmarkNames;
  const chips = [names.SPY, names.QQQ, names.PAXG, names.BTC, names.SGOV];
  return (
    <Visual>
      <div className="mb-3 flex items-center justify-between">
        <span className="font-display text-[15px] text-foreground">
          {copy.portfolioYou} <span className="money text-good">+6.1%</span>
        </span>
        <span className="text-[12.5px] text-muted-foreground">{copy.portfolioSameDays}</span>
      </div>
      <div className="[&>div]:h-[140px]!">
        <SampleChart seed={5} benchmarkSeed={8} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {chips.map((name, index) => (
          <span
            key={name}
            className={cn(
              "inline-flex h-7 items-center rounded-full border px-3 text-[12.5px]",
              index === 0 ? "border-foreground bg-foreground text-background" : "border-border text-secondary-foreground",
            )}
          >
            {name}
          </span>
        ))}
      </div>
    </Visual>
  );
}

function AssistantVisual() {
  const page = useCopy().welcomePage;
  const f = page.features.assistant;
  return (
    <Visual>
      <p className="ml-auto w-fit max-w-[82%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2.5 text-[13.5px] leading-normal text-foreground">
        {f.ask}
      </p>
      <p className="mt-2.5 w-fit max-w-[82%] rounded-2xl rounded-bl-md border border-border px-3.5 py-2.5 text-[13.5px] leading-normal text-foreground">
        {f.answer}
      </p>
      <p className="mt-2.5 ml-auto w-fit max-w-[82%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2.5 text-[13.5px] leading-normal text-foreground">
        {f.askBuy}
      </p>
      <div className="mt-2.5 rounded-[10px] border border-border bg-background px-3.5 py-3">
        <p className="mb-1.5 flex items-center gap-1.5 font-display text-sm text-foreground">
          <PencilSimpleLine weight="duotone" className="size-3.5 text-muted-foreground" />
          {f.draft}
        </p>
        <Row first label={f.buy} value="Apple" />
        <Row label={f.amount} value={<span className="money">$20.00</span>} />
        <Row label={f.payWith} value={`USDC ${page.onNetwork("Base")}`} />
      </div>
    </Visual>
  );
}

function AiVisual() {
  const copy = useCopy();
  const f = copy.welcomePage.features.ai;
  const marks = [
    { id: "claude" as const, name: copy.assistantClaude },
    { id: "chatgpt" as const, name: copy.assistantChatGpt },
    { id: "grok" as const, name: copy.assistantGrok },
  ];
  return (
    <Visual>
      <div className="grid grid-cols-3 gap-2.5">
        {marks.map((mark) => (
          <div
            key={mark.id}
            className="flex h-24 flex-col items-center justify-center gap-2.5 rounded-xl border border-border bg-background text-[13px] text-secondary-foreground"
          >
            <ProviderMark id={mark.id} className="size-7 text-foreground" />
            {mark.name}
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2.5 text-[12.5px] text-muted-foreground">
        <span>{f.reads}</span>
        <i className="flex-1 border-t border-dashed border-input" />
        <span>{f.sign}</span>
      </div>
    </Visual>
  );
}

function RanksVisual() {
  const f = useCopy().welcomePage.features.ranks;
  const now = 5;
  return (
    <Visual>
      <div className="grid grid-cols-5 gap-2">
        {RANKS.map((rank) => (
          <div
            key={rank.level}
            className={cn(
              "rounded-[10px] border px-1.5 pt-2.5 pb-2 text-center",
              rank.level === now ? "border-foreground bg-card" : "border-border bg-background",
              rank.level > now && "opacity-55",
            )}
          >
            <RankGlyph level={rank.level} className="mx-auto size-[22px] text-foreground" />
            <small className="mt-1 block text-[10.5px] leading-tight text-muted-foreground">{rank.name}</small>
          </div>
        ))}
      </div>
      <div className="mt-3.5 flex justify-between text-[12.5px] text-muted-foreground">
        <span>{f.now(RANKS[now - 1].name, now)}</span>
        <span className="money">{f.xp}</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
        <i className="block h-full w-[37%] bg-foreground" />
      </div>
    </Visual>
  );
}

function WalletsVisual() {
  const f = useCopy().welcomePage.features.wallets;
  const rows = [
    { name: f.evm, address: "0x3f2c…a91c", home: true },
    { name: f.solana, address: "7Hq4…Nk2d", home: false },
  ];
  return (
    <Visual>
      {rows.map((row, index) => (
        <div key={row.name} className={cn("flex items-center gap-3 py-2.5", index > 0 && "border-t border-border")}>
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-secondary-foreground">
            <Wallet weight="duotone" className="size-[18px]" />
          </span>
          <span className="min-w-0 flex-1 text-[13.5px] text-foreground">
            {row.name}
            <small className="money block text-xs text-muted-foreground">{row.address}</small>
          </span>
          <span
            className={cn(
              "inline-flex h-6 items-center rounded-full border px-2.5 text-[11.5px]",
              row.home ? "border-foreground text-foreground" : "border-border text-muted-foreground",
            )}
          >
            {row.home ? f.home : f.linked}
          </span>
        </div>
      ))}
    </Visual>
  );
}
