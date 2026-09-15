"use client";

import Link from "next/link";
import { Robot, Sparkle, Wrench } from "@phosphor-icons/react";
import { CupArt, SteamPlume, TeapotArt } from "@/components/tea/tea-art";
import { SILK_CUP } from "@/components/tea/silk";
import { useCopy } from "@/components/settings-provider";
import { useMounted } from "@/hooks/use-mounted";
import { COPY, DEFAULT_MODE } from "@/lib/copy";
import { FEE_PCT_LABEL } from "@/lib/sodax-config";
import { VAULTS_META } from "@/lib/vaults-meta";

/* eslint-disable @next/next/no-img-element -- tiny local brand mark */

/**
 * The legend, long-form: the info drawer's story given a whole page and the
 * shape of a scroll. Everything visual is borrowed from the app itself (cup
 * art, steam, the mode's silk already behind the page), so the legend always
 * looks like the tea house currently telling it.
 */
export function LorePage() {
  const liveCopy = useCopy();
  const mounted = useMounted();
  // This is the app's only VOICED page that prerenders (everything else
  // waits behind the auth splash). next-themes knows the visitor's mode
  // synchronously on the client, but the static HTML speaks Original — so
  // the first client render must speak Original too, or hydration tears.
  // The visitor's own voice takes over one frame later.
  const copy = mounted ? liveCopy : COPY[DEFAULT_MODE];

  const stats = [
    { icon: Robot, stat: copy.infoAgentsStat, detail: copy.infoAgentsDetail },
    { icon: Wrench, stat: copy.infoMcpStat, detail: copy.infoMcpDetail },
    { icon: Sparkle, stat: copy.infoTimeStat, detail: copy.infoTimeDetail },
  ];

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-6 pb-14 sm:max-w-lg">
      <header className="flex items-center justify-between py-4">
        <Link href="/" className="flex items-center gap-2">
          <img src="/lsteatime-mark.svg" alt="" aria-hidden width={26} height={26} />
          <span className="font-display text-lg text-foreground">LSTeaTime</span>
        </Link>
      </header>

      <div className="mt-6 flex flex-col items-center gap-3 text-center">
        <SteamPlume level={2} width={64} height={38} />
        <h1 className="font-display text-4xl leading-tight text-foreground">
          {copy.loreTitle}
        </h1>
        <p className="text-[15px] text-muted-foreground">{copy.loreSub}</p>
      </div>

      <Chapter title={copy.loreFoundingTitle}>
        <div className="mb-4 flex justify-center">
          <TeapotArt size={72} />
        </div>
        <p>{copy.loreFoundingBody}</p>
      </Chapter>

      <Chapter title={copy.loreBlendsTitle}>
        <p>{copy.loreBlendsBody}</p>
        <div className="mt-5 flex flex-col gap-3">
          {Object.values(VAULTS_META).map((blend) => (
            <div
              key={blend.teaName}
              className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3"
            >
              <CupArt
                accent={`var(--cup-${blend.cupKey})`}
                deep={`var(--cup-${blend.cupKey}-deep)`}
                fill={0.7}
                bowl={blend.bowl}
                size={52}
                silk={SILK_CUP[blend.cupKey]}
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-display text-base text-foreground">
                  {blend.teaName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {blend.flavour} · {blend.assetLine}
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {blend.strategy}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Chapter>

      <Chapter title={copy.loreKitchenTitle}>
        <p>{copy.loreKitchenBody}</p>
      </Chapter>

      <Chapter title={copy.loreHouseTitle}>
        <p>{copy.loreHouseBody}</p>
        <p className="mt-3 text-xs text-muted-foreground">
          {copy.infoHouseRules(FEE_PCT_LABEL)}
        </p>
        <div className="mt-5 flex flex-col gap-4">
          {stats.map(({ icon: StatIcon, stat, detail }) => (
            <div key={stat} className="flex gap-3">
              <StatIcon className="mt-0.5 size-6 shrink-0 text-primary" />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground">
                  {stat}
                </span>
                <span className="text-sm text-muted-foreground">{detail}</span>
              </div>
            </div>
          ))}
        </div>
      </Chapter>

      <Link
        href="/"
        className="mt-10 flex h-13 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground transition-opacity hover:opacity-90"
      >
        {copy.loreCta}
      </Link>

      <footer className="mt-9 text-center text-xs text-muted-foreground">
        {copy.mottoLead}{" "}
        <span className="font-display text-foreground/70">
          {copy.mottoDisplay}
        </span>
      </footer>
    </div>
  );
}

function Chapter({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 font-display text-2xl text-foreground">{title}</h2>
      <div className="text-[15px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
