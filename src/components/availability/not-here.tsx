"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { GlobeHemisphereWest } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useCopy } from "@/components/settings-provider";
import { PILL } from "@/components/ui/pill";
import { useAvailability } from "@/components/availability/availability-context";
import type { Availability } from "@/lib/availability";
import { PRIVACY_OPERATOR } from "@/lib/copy";
import { cn } from "@/lib/utils";

/**
 * The landing's surfaces (lib/availability): the card, the drawer that
 * stands in for a buy or a plan, and the traveller's banner. Nothing here
 * touches a wallet, so it renders anywhere, tests included.
 */

export function ReasonLine({ availability, className }: { availability: Availability; className?: string }) {
  const copy = useCopy().unavailable;
  if (availability.available) return null;
  return <p className={className}>{copy.reason[availability.reason]}</p>;
}

export function SupportLine() {
  const copy = useCopy().unavailable;
  return (
    <p className="text-[13px] leading-relaxed text-muted-foreground">
      {copy.support}{" "}
      <a href={`mailto:${PRIVACY_OPERATOR.email}`} className="text-foreground underline underline-offset-4">
        {PRIVACY_OPERATOR.email}
      </a>
      .
    </p>
  );
}

/**
 * What an excluded visitor reads in place of the way in: a flat white card
 * with one hairline, never an error. `signIn` offers the sign in to an
 * account that already exists (someone who travels can always see, sell
 * and withdraw); a new one is refused by the server and none is made.
 * `welcomeHref` is where "How Berth works" goes: on the welcome page itself,
 * down the page.
 */
export function NotHereCard({
  availability,
  signIn,
  welcomeHref = "/",
  anonymous = true,
  className,
}: {
  availability: Availability;
  /**
   * The way in for an account that already exists, every one the welcome
   * page offers (email and each wallet), so a wallet only account can
   * sign in abroad too. Absent: no sign in is offered.
   */
  signIn?: ReactNode;
  welcomeHref?: string;
  /**
   * Whether the reader is surely no one yet (the welcome page, before any
   * sign in): only then does it say nothing about them was stored. The
   * consent screen cannot know, and says its own line instead.
   */
  anonymous?: boolean;
  className?: string;
}) {
  const copy = useCopy().unavailable;
  // A sanctioned place gets no sign in and no service at all (lib/server/availability refuseSanctioned).
  const sanctioned = !availability.available && availability.reason === "sanctions";
  const links = [
    { href: welcomeHref, label: copy.links.welcome },
    { href: "/terms", label: copy.links.terms },
    { href: "/privacy", label: copy.links.privacy },
    { href: "/assistants", label: copy.links.assistants },
  ];
  return (
    <section
      data-testid="not-here"
      aria-labelledby="not-here-title"
      className={cn("w-full max-w-[34rem] rounded-lg border border-border bg-card", className)}
    >
      <div className="flex flex-col gap-3 px-5 pt-5 pb-5 lg:px-6 lg:pt-6">
        <GlobeHemisphereWest weight="duotone" className="size-6 text-muted-foreground" aria-hidden />
        <h2 id="not-here-title" className="font-display text-xl leading-tight tracking-[-0.02em] text-foreground">
          {sanctioned ? copy.sanctionsTitle : copy.title}
        </h2>
        <ReasonLine availability={availability} className="text-[14.5px] leading-relaxed text-foreground" />
        {sanctioned ? (
          <p className="text-[14.5px] leading-relaxed text-muted-foreground">{copy.fundsStay}</p>
        ) : (
          anonymous && <p className="text-[14.5px] leading-relaxed text-muted-foreground">{copy.nothingKept}</p>
        )}
      </div>
      <div className="flex flex-col gap-3 border-t border-border px-5 py-4 lg:px-6">
        <p className="text-[13px] text-muted-foreground">{copy.readOn}</p>
        <div className="flex flex-wrap gap-2">
          {links.map((link) => (
            <Link key={link.label} href={link.href} className={cn(PILL, "h-9 px-3.5 text-[13px]")}>
              {link.label}
            </Link>
          ))}
        </div>
        <SupportLine />
      </div>
      {signIn && !sanctioned && (
        <div id="not-here-sign-in" data-testid="not-here-sign-in" className="flex flex-col gap-3 border-t border-border px-5 py-4 lg:px-6">
          <p className="text-[13px] leading-relaxed text-muted-foreground">{copy.haveAccount}</p>
          {signIn}
        </div>
      )}
    </section>
  );
}

/**
 * In place of the buy drawer or the plan sheet, where Berth is not
 * available: the same words, and a way out. Selling is never replaced.
 */
export function NotHereDrawer({
  availability,
  open,
  onOpenChange,
}: {
  availability: Availability;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const copy = useCopy().unavailable;
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent data-testid="not-here-drawer">
        <DrawerHeader>
          <DrawerTitle>{copy.drawerTitle}</DrawerTitle>
          <DrawerDescription>{copy.drawerBody}</DrawerDescription>
        </DrawerHeader>
        <NotHereDrawerBody availability={availability} />
        <DrawerFooter>
          <Button variant="outline" className="h-12 w-full text-base" onClick={() => onOpenChange(false)}>
            {copy.close}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

/** What the drawer says, inside the signed in app. */
export function NotHereDrawerBody({ availability }: { availability: Availability }) {
  const copy = useCopy().unavailable;
  return (
    <div className="flex flex-col gap-3 px-4 pb-2">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-4">
        <GlobeHemisphereWest weight="duotone" className="size-6 text-muted-foreground" aria-hidden />
        <ReasonLine availability={availability} className="text-[14.5px] leading-relaxed text-foreground" />
        {/* An account is kept, as it always is: never "nothing about you was stored" here. */}
        <p className="text-[14.5px] leading-relaxed text-muted-foreground">{copy.accountKept}</p>
      </div>
      <SupportLine />
    </div>
  );
}

/** The quiet line an existing account sees while it is somewhere Berth is not available. */
export function NotHereBanner() {
  const availability = useAvailability();
  const copy = useCopy().unavailable;
  if (availability.available) return null;
  return (
    <p
      data-testid="not-here-banner"
      className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-4 py-3 text-[13.5px] leading-relaxed text-muted-foreground"
    >
      <GlobeHemisphereWest weight="duotone" className="mt-0.5 size-[18px] shrink-0" aria-hidden />
      {copy.banner}
    </p>
  );
}

