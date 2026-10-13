"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu } from "@base-ui/react/menu";
import { CheckCircle, DotsThree, HandPalm, UserPlus, UsersThree } from "@phosphor-icons/react";
import { AvatarWithRank } from "@/components/rank-glyph";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";
import { rankForXp } from "@/lib/xp";
import { STOCK_LISTINGS, rowName } from "@/lib/listings";
import { REPORT_REASONS, type CardAnswer, type FriendAction, type ReportReason } from "@/lib/social-types";
import { saluteDirection } from "@/lib/profile-more";
import { cn } from "@/lib/utils";

/**
 * A profile, as one phone screen: face wearing its rank, username, rank
 * name, three figures (XP, Salutes, the month they joined), and the
 * viewer's side of it. Nothing else: no money, no wallets, no friends and
 * no friend count. Holdings only between friends who both share them,
 * and then only which listings, by name, never how much (answer.holds).
 * The founder's card (card.founder) adds one line under them: for
 * comparison, not advice. No card ever carries a buy.
 *
 * Presentational: the page (profile-page) and the dev gallery hand it an
 * answer and callbacks. The accent goes to one thing only, the next friend
 * step (add, accept), or signing in for a visitor. Salute is the quiet
 * outline beside it.
 */

/** "2026-09" as a short month: "Sep 2026". */
export function monthLabel(month: string, style: "short" | "long" = "short"): string {
  const [year, index] = month.split("-").map(Number);
  if (!year || !index) return month;
  return new Date(Date.UTC(year, index - 1, 1)).toLocaleString("en-US", { month: style, year: "numeric", timeZone: "UTC" });
}

export type CardHandlers = {
  /** May answer whether the Salute landed, so a refused one never plays the tick. */
  onSalute: (on: boolean) => void | Promise<boolean>;
  onFriend: (action: FriendAction) => void;
  onBlock: () => void;
  onReport: (reason: ReportReason) => void;
  busy?: boolean;
};

/** How long "Remove" waits for its second tap. */
const CONFIRM_MS = 4_000;

export function ProfileCardView({
  answer,
  handlers,
  hidden = false,
  heading: Heading = "h1",
}: {
  answer: Extract<CardAnswer, { found: true }>;
  handlers: CardHandlers;
  /** The viewer's own card is hidden: say so. */
  hidden?: boolean;
  /** h1 on its own page; h2 where the card sits inside another screen (Find a friend). */
  heading?: "h1" | "h2";
}) {
  const copy = useCopy().social;
  const { card, viewer } = answer;
  const rank = rankForXp(card.xp);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [removing, setRemoving] = useState(false);
  // Set by the tap that gives a Salute, so its tick settles in once: never
  // for a Salute that was already standing when the page opened.
  const [acked, setAcked] = useState(false);
  const salutedNow = viewer.saluted;
  useEffect(() => {
    if (!acked || !salutedNow) return;
    const timer = setTimeout(() => setAcked(false), 1_500);
    return () => clearTimeout(timer);
  }, [acked, salutedNow]);
  useEffect(() => {
    if (!removing) return;
    const timer = setTimeout(() => setRemoving(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [removing]);

  const other = viewer.relation !== "self";

  return (
    <div data-ph-mask className="flex flex-col items-center gap-5 rounded-lg border border-border bg-card px-5 pt-7 pb-5">
      <div className="flex flex-col items-center gap-3">
        <AvatarWithRank avatarId={card.avatarId} level={rank.level} size={88} />
        <div className="flex flex-col items-center gap-0.5">
          <Heading className="font-display text-2xl leading-tight tracking-[-0.02em] break-all text-foreground">{card.handle}</Heading>
          <p className="text-sm text-muted-foreground">{rank.name}</p>
        </div>
      </div>

      <dl className="grid w-full grid-cols-3 divide-x divide-border rounded-xl border border-border">
        <Figure label={copy.xpLabel} value={card.xp.toLocaleString("en-US")} />
        <Figure label={copy.salutesLabel} value={card.salutes.toLocaleString("en-US")} />
        <Figure label={copy.sinceLabel} value={monthLabel(card.memberSince)} plain />
      </dl>

      {answer.holds && answer.holds.length > 0 && (
        <p data-card-holds className="w-full rounded-xl border border-border px-4 py-3 text-center text-sm text-muted-foreground">
          {copy.cardHolds(
            answer.holds.flatMap((symbol) => {
              const listing = STOCK_LISTINGS.find((candidate) => candidate.symbol === symbol);
              return listing ? [rowName(listing)] : [];
            }),
          )}
        </p>
      )}

      {/* The founder's card (lib/server/social/founder): one line, never a call to buy. */}
      {card.founder && answer.holds && answer.holds.length > 0 && (
        <p data-founder-note className="-mt-2 text-center text-xs text-muted-foreground">
          {copy.founderHoldsNote}
        </p>
      )}
      {card.founder && viewer.relation === "friends" && !viewer.sharesHoldings && (
        <p data-founder-share-hint className="text-center text-xs text-muted-foreground">
          {copy.founderShareHint}
        </p>
      )}

      {viewer.relation === "self" && (
        <p className="text-center text-sm text-muted-foreground">{hidden ? copy.hiddenNote : copy.selfNote}</p>
      )}

      {other && (
        <div className="flex w-full flex-col gap-3">
          <FriendRow
            relation={viewer.relation as Exclude<typeof viewer.relation, "self">}
            can={viewer.hasEmail && viewer.hasHandle}
            removing={removing}
            onRemoveTap={() => {
              if (!removing) setRemoving(true);
              else {
                setRemoving(false);
                handlers.onFriend("remove");
              }
            }}
            handlers={handlers}
          />
          {/* A new friend who shares too will see what the viewer holds: said at the moment it would start. */}
          {viewer.sharesHoldings && viewer.relation !== "friends" && (
            <p data-card-share-note className="text-center text-xs text-muted-foreground">{copy.cardShareNote}</p>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-10 flex-1 gap-2"
              disabled={!viewer.hasEmail || handlers.busy}
              aria-pressed={viewer.saluted}
              aria-label={viewer.saluted ? copy.saluteUndoLabel(card.handle) : undefined}
              onClick={() => {
                const giving = !viewer.saluted;
                setAcked(giving);
                const landed = handlers.onSalute(giving);
                // Refused (a 429, a network error): no tick later, without a tap.
                if (giving && landed) void landed.then((ok) => !ok && setAcked(false));
              }}
            >
              {viewer.saluted ? (
                <CheckCircle weight="duotone" className="size-4.5" aria-hidden data-salute-ack={acked ? "" : undefined} />
              ) : (
                <HandPalm weight="duotone" className="size-4.5" aria-hidden />
              )}
              {viewer.saluted ? copy.saluted : copy.salute}
            </Button>
            <MoreMenu
              onBlock={() => {
                setReporting(false);
                setConfirmBlock(true);
              }}
              onReport={() => {
                setConfirmBlock(false);
                setReporting(true);
              }}
            />
          </div>
          {answer.more?.salutesBetween !== undefined && (
            <p data-salutes-between className="text-center text-xs text-muted-foreground">
              {copy.profileSalutesBetween(saluteDirection(answer.more.salutesBetween, viewer.saluted), card.handle)}
            </p>
          )}
          <span aria-live="polite" className="sr-only">
            {acked && viewer.saluted ? copy.profileSaluteDone(card.handle) : ""}
          </span>
          {!viewer.hasEmail ? (
            <p className="text-center text-xs text-muted-foreground">{copy.saluteNeedsEmail}</p>
          ) : !viewer.hasHandle && viewer.relation === "none" ? (
            <p className="text-center text-xs text-muted-foreground">{copy.needHandle}</p>
          ) : null}

          {confirmBlock && (
            <div className="flex flex-col gap-2 rounded-xl bg-muted/60 p-3">
              <p className="text-sm text-foreground">{copy.blockConfirm(card.handle)}</p>
              <div className="flex gap-2">
                <Button variant="destructive" size="sm" onClick={() => handlers.onBlock()} disabled={handlers.busy}>
                  {copy.block}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmBlock(false)}>
                  {copy.cancel}
                </Button>
              </div>
            </div>
          )}

          {reporting && (
            <div className="flex flex-col gap-1 rounded-xl bg-muted/60 p-2">
              {REPORT_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  className="min-h-10 rounded-lg px-2.5 text-left text-sm text-foreground hover:bg-muted"
                  onClick={() => {
                    setReporting(false);
                    handlers.onReport(reason);
                  }}
                >
                  {copy.reportReasons[reason]}
                </button>
              ))}
              <Button variant="ghost" size="sm" className="self-start" onClick={() => setReporting(false)}>
                {copy.cancel}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, plain = false }: { label: string; value: string; plain?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-2 py-2.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("text-[15px] font-medium text-foreground", !plain && "money tabular-nums")}>{value}</dd>
    </div>
  );
}

function FriendRow({
  relation,
  can,
  removing,
  onRemoveTap,
  handlers,
}: {
  relation: "none" | "sent" | "received" | "friends";
  can: boolean;
  removing: boolean;
  onRemoveTap: () => void;
  handlers: CardHandlers;
}) {
  const copy = useCopy().social;
  if (relation === "none") {
    return (
      <Button className="h-10 w-full gap-2" disabled={!can || handlers.busy} onClick={() => handlers.onFriend("request")}>
        <UserPlus weight="duotone" className="size-4.5" aria-hidden />
        {copy.addFriend}
      </Button>
    );
  }
  if (relation === "received") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-center text-sm text-foreground">{copy.relation.received}</p>
        <div className="flex gap-2">
          <Button className="h-10 flex-1" disabled={handlers.busy} onClick={() => handlers.onFriend("accept")}>
            {copy.accept}
          </Button>
          <Button variant="ghost" className="h-10 flex-1" disabled={handlers.busy} onClick={() => handlers.onFriend("decline")}>
            {copy.decline}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 rounded-xl border border-border px-3">
      <span className="flex items-center gap-2 text-sm text-foreground">
        {relation === "friends" ? (
          <UsersThree weight="duotone" className="size-4.5 text-muted-foreground" aria-hidden />
        ) : (
          <CheckCircle weight="duotone" className="size-4.5 text-muted-foreground" aria-hidden />
        )}
        {copy.relation[relation]}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className={cn("text-muted-foreground", removing && "text-destructive")}
        disabled={handlers.busy}
        onClick={relation === "friends" ? onRemoveTap : () => handlers.onFriend("cancel")}
      >
        {relation === "friends" ? (removing ? copy.removeConfirm : copy.removeFriend) : copy.cancel}
      </Button>
    </div>
  );
}

function MoreMenu({ onBlock, onReport }: { onBlock: () => void; onReport: () => void }) {
  const copy = useCopy().social;
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={copy.moreLabel}
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground outline-none transition-colors duration-150 ease-lift hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:bg-muted dark:border-input dark:bg-input/30"
      >
        <DotsThree weight="duotone" className="size-5" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={16} className="z-50">
          <Menu.Popup className="min-w-40 origin-[var(--transform-origin)] rounded-xl border border-border bg-popover p-1 text-sm text-popover-foreground shadow-raised outline-none transition-[opacity,transform] duration-150 ease-lift data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0">
            <Menu.Item onClick={onBlock} className="flex cursor-default rounded-lg px-2.5 py-2 outline-none select-none data-[highlighted]:bg-muted">
              {copy.block}
            </Menu.Item>
            <Menu.Item onClick={onReport} className="flex cursor-default rounded-lg px-2.5 py-2 outline-none select-none data-[highlighted]:bg-muted">
              {copy.report}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * A signed out visitor's one screen, for every name, whoever it belongs
 * to: no face, no name, no figures. Signing out cannot get round a block.
 */
export function SignInCard({ href = "/" }: { href?: string }) {
  const copy = useCopy().social;
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card px-5 py-10 text-center">
      <p className="font-display text-lg text-foreground">{copy.signInLine}</p>
      <Button render={<Link href={href} />} nativeButton={false} className="h-10 w-full max-w-64">
        {copy.signIn}
      </Button>
    </div>
  );
}

/** "No one by that name." The one screen for every card that cannot be shown. */
export function NotFoundCard() {
  const copy = useCopy().social;
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card px-5 py-10 text-center">
      <p className="font-display text-lg text-foreground">{copy.notFound}</p>
      <p className="max-w-64 text-sm text-muted-foreground">{copy.notFoundSub}</p>
    </div>
  );
}
