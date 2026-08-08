"use client";

import { notFound } from "next/navigation";
import { CupArt, PourScene, SteamPlume, TeapotArt } from "@/components/tea/tea-art";
import { Spinner } from "@/components/ui/spinner";

const CUPS = ["earlgrey", "breakfast", "sencha"] as const;
const FILLS = [0, 0.25, 0.5, 0.75, 1];

/**
 * Dev-only tea gallery: every art state on one page, so loading screens can
 * be looked at without a live transaction. Not linked anywhere; 404 in prod.
 */
export default function TeaGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-6 py-10">
      <Section title="Cups by fill">
        {CUPS.map((cup) => (
          <div key={cup} className="flex items-end gap-3">
            {FILLS.map((fill) => (
              <CupArt
                key={fill}
                accent={`var(--cup-${cup})`}
                deep={`var(--cup-${cup}-deep)`}
                fill={fill}
                bowl={cup === "sencha"}
                size={56}
              />
            ))}
          </div>
        ))}
      </Section>

      <Section title="Steam levels 0 to 4">
        <div className="flex items-end gap-6">
          {[0, 1, 2, 3, 4].map((level) => (
            <div key={level} className="flex flex-col items-center">
              <SteamPlume level={level} width={56} height={40} />
              <CupArt fill={0.2 + level * 0.2} size={56} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Teapot">
        <TeapotArt size={96} />
      </Section>

      <Section title="Pour, in progress">
        <PourScene accent="var(--cup-earlgrey)" deep="var(--cup-earlgrey-deep)" />
      </Section>

      <Section title="Pour, done">
        <PourScene accent="var(--cup-sencha)" deep="var(--cup-sencha-deep)" done />
      </Section>

      <Section title="Inline loader">
        <div className="flex items-center gap-6 text-foreground">
          <Spinner className="size-3.5" />
          <Spinner className="size-4" />
          <Spinner className="size-5" />
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-3.5" /> fetching a quote
          </span>
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-xl text-foreground">{title}</h2>
      {children}
    </section>
  );
}
