"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { HandHeart, PencilSimpleLine, Trophy } from "@phosphor-icons/react";
import { BerthMark } from "@/components/berth-mark";
import { MarketPreview } from "@/components/board";
import { HeroPhone, WallStreetFilm } from "@/components/welcome/welcome-films";
import { useCopy } from "@/components/settings-provider";
import { cn } from "@/lib/utils";
import { PILL } from "@/components/ui/pill";

/**
 * The front door, short on purpose (2026-09-30): the positioning line and
 * the way in on the left, the habit film in its phone on the right (under
 * the way in on a phone), then three short sections a stranger needs to
 * decide, what it is, what you pay with, whose custody, and the Wall Street
 * film before the close. Friends, ranks and the Monday habit are carried by
 * the hero film, so they have no section of their own. The highlighted
 * phrase stays ink on the pale wash, so the email button is the page's one
 * accent, and the Colosseum entry sits under the way in, not above the
 * headline. Everything that signs someone in is passed in as `ctas`, so this
 * file only lays the page out.
 */
export function WelcomePage({
  lead,
  invited,
  ctas,
  notice,
  onSignIn,
}: {
  /** Said instead of the usual lede when the visitor came for one thing. */
  lead?: string;
  invited: boolean;
  /** The way in, drawn in the hero and again at the close. */
  ctas: () => ReactNode;
  /**
   * Where Berth is not available (lib/availability): drawn in place of the
   * way in under the hero, and the closing way in is left out.
   */
  notice?: ReactNode;
  /** Absent where no sign in is offered at all (a comprehensively sanctioned place). */
  onSignIn?: () => void;
}) {
  const copy = useCopy();
  const page = copy.welcomePage;
  const sections = page.sections;
  return (
    <div className="mx-auto w-full max-w-[75rem] px-4 lg:px-10">
      <nav aria-label={page.navLabel} className="flex h-14 items-center justify-between lg:h-16">
        <span className="flex items-center gap-2">
          <BerthMark className="size-[22px]" />
          <span className="font-wordmark text-[19px] leading-none text-foreground">{copy.brand}</span>
        </span>
        {onSignIn && (
          <button type="button" onClick={onSignIn} className={cn(PILL, "h-8 px-3.5 text-[13px] font-normal")}>
            {copy.signIn}
          </button>
        )}
      </nav>

      <header className="grid gap-8 pt-7 pb-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-16 lg:pt-10 lg:pb-16">
        <div>
          <p className="mb-4 text-[13px] font-medium text-muted-foreground lg:mb-[22px]">{page.eyebrow}</p>
          <h1 className="max-w-[50rem] font-display text-[40px] leading-[1.1] tracking-[-0.028em] text-foreground lg:text-[60px] lg:leading-[1.08] lg:tracking-[-0.03em]">
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
          {invited && !notice && (
            <p className="mt-5 flex w-fit items-center gap-2.5 rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground">
              <HandHeart weight="duotone" className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              {copy.inviteWaiting}
            </p>
          )}
          {notice ? (
            <div className="mt-6 lg:mt-8">{notice}</div>
          ) : (
            <>
              <div className="mt-6 lg:mt-8">{ctas()}</div>
              <p className="mt-3.5 text-[13px] text-muted-foreground">{copy.noSeedPhrases}</p>
            </>
          )}
          {/* After the way in, not before the headline (2026-10-01): the
              first read is the line, then the one button. */}
          <div>
          <a
            href={page.colosseum.href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[12px] font-medium text-muted-foreground transition-colors duration-150 ease-lift hover:text-foreground"
          >
            <Trophy weight="duotone" className="size-3.5 shrink-0" aria-hidden />
            {page.colosseum.label}
          </a>
          </div>
        </div>
        <HeroPhone />
      </header>

      <main>
        <Section id="how" title={sections.what.title} line={sections.what.line}>
          {/* The real board, live, as a signed-out visitor may read it. */}
          <div className="[&_section]:rounded-2xl">
            <MarketPreview count={3} />
          </div>
        </Section>
        <Section title={sections.pay.title} line={sections.pay.line}>
          <PayVisual />
        </Section>
        <Section title={sections.custody.title} line={sections.custody.line}>
          <CustodyVisual />
        </Section>

        <div className="border-t border-border py-11 lg:py-14">
          <WallStreetFilm />
        </div>
      </main>

      <section className="border-t border-border py-14 text-center lg:py-[72px]">
        <h2 className="font-display text-[32px] leading-[1.15] tracking-[-0.025em] text-foreground lg:text-[44px]">{copy.tagline}</h2>
        {!notice && <div className="mt-[26px] flex justify-center lg:mt-8">{ctas()}</div>}
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

/** The ghost pill, also used by the page's own small controls (components/ui/pill). */
export { PILL };

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

/** One short section: a one line headline and a line under it, what it looks like beside. */
function Section({ id, title, line, children }: { id?: string; title: string; line: string; children: ReactNode }) {
  return (
    <section
      id={id}
      className="grid scroll-mt-6 items-center gap-6 border-t border-border py-10 lg:grid-cols-2 lg:gap-16 lg:py-12"
    >
      <div>
        <h2 className="max-w-[30rem] font-display text-[26px] leading-[1.18] tracking-[-0.022em] text-foreground lg:text-[32px]">
          {title}
        </h2>
        <p className="mt-3 max-w-[30rem] text-[15px] leading-[1.65] text-muted-foreground">{line}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** One buy as the order sheet shows it: the stock, the amount, the coin and its network. */
function PayVisual() {
  const page = useCopy().welcomePage;
  const f = page.sections.pay;
  return (
    <Visual>
      <p className="mb-1.5 flex items-center gap-1.5 font-display text-sm text-foreground">
        <PencilSimpleLine weight="duotone" className="size-3.5 text-muted-foreground" />
        {f.draft}
      </p>
      <Row first label={f.buy} value="Apple" />
      <Row label={f.amount} value={<span className="money">$20.00</span>} />
      <Row label={f.payWith} value={`USDC ${page.onNetwork("Base")}`} />
    </Visual>
  );
}

/** Who holds what: the keys, the funds and the signature are all the visitor's. */
function CustodyVisual() {
  const f = useCopy().welcomePage.sections.custody;
  return (
    <Visual>
      <Row first label={f.keys} value={f.withYou} />
      <Row label={f.funds} value={f.withYou} />
      <Row label={f.orders} value={f.signedByYou} />
    </Visual>
  );
}
