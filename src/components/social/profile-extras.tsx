"use client";

import { useId, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { AvatarWithRank, RankGlyph } from "@/components/rank-glyph";
import { useCopy } from "@/components/settings-provider";
import { RANKS, rankForXp } from "@/lib/xp";
import { ChartLineUp, HandPalm, Sailboat, UsersThree } from "@phosphor-icons/react";
import { STOCK_LISTINGS, rowName } from "@/lib/listings";
import { monthLabel } from "@/components/social/profile-card";
import { avatarShelf, compareXp, dayLabel } from "@/lib/profile-more";
import type { CardAnswer, Card, Moment, ProfileMore } from "@/lib/social-types";
import { cn } from "@/lib/utils";

/**
 * The profile page's sections under the card (components/social/profile-card
 * renders them when the answer carries `more`): each a flat card of its own
 * with a plain heading, so every line sits with what it is about. No accent
 * here: on a profile the accent belongs to the next friend step.
 */

export function ProfileSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex w-full flex-col gap-3 rounded-lg border border-border bg-card px-5 py-4">
      <h2 id={id} className="font-display text-base leading-tight tracking-[-0.02em] text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * All ten rungs in one row: their face above the rung they hold, reached
 * rungs in ink and the rest muted, a hollow dot under the viewer's own rung,
 * and their progress to the next rung as a thin ink bar.
 */
export function RankLadder({ card, more, self }: { card: Card; more: ProfileMore; self: boolean }) {
  const copy = useCopy().social;
  const rank = rankForXp(card.xp);
  const yours = !self && more.yourXp !== undefined ? rankForXp(more.yourXp).level : null;
  const standing = !self && more.yourXp !== undefined ? compareXp(more.yourXp, card.xp) : null;

  return (
    <ProfileSection title={copy.profileLadderTitle}>
      <div className="flex flex-col gap-2">
        <ol aria-label={copy.profileLadderTitle} className="grid grid-cols-10">
          {RANKS.map((rung) => {
            const theirs = rung.level === rank.level;
            return (
              <li
                key={rung.level}
                aria-label={copy.profileRungAria(rung.name, rung.xp.toLocaleString("en-US"), theirs, rung.level === yours)}
                aria-current={theirs ? "step" : undefined}
                className="flex flex-col items-center gap-1.5"
              >
                <span className="flex h-7 items-end justify-center">
                  {theirs && <AvatarWithRank avatarId={card.avatarId} level={rank.level} size={26} />}
                </span>
                <RankGlyph
                  level={rung.level}
                  className={cn("size-4", rung.level <= rank.level ? "text-foreground" : "text-muted-foreground/60")}
                />
                <span
                  aria-hidden
                  className={cn("size-1.5 rounded-full border", rung.level === yours ? "border-foreground" : "border-transparent")}
                />
              </li>
            );
          })}
        </ol>
        {rank.nextName && (
          <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className="h-full w-full rounded-full bg-foreground"
              style={{ transform: `translateX(-${100 - Math.round(rank.progress * 100)}%)` }}
            />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        <p>
          {rank.nextName
            ? copy.profileLadderNext(rank.name, (rank.span - rank.into).toLocaleString("en-US"), rank.nextName)
            : copy.profileLadderTop(rank.name)}
        </p>
        {standing && (
          <p data-ladder-compare className="flex items-center gap-1.5">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full border border-foreground" />
            {standing.kind === "ahead"
              ? copy.profileAhead(standing.xp.toLocaleString("en-US"))
              : standing.kind === "behind"
                ? copy.profileBehind(standing.xp.toLocaleString("en-US"))
                : copy.profileLevel}
          </p>
        )}
      </div>
    </ProfileSection>
  );
}

/**
 * The faces this person has opened, and the rest as their own flat
 * silhouettes with the rung that opens them beneath (the brand's locked
 * face: no padlock). The one they wear carries a thin ink ring.
 */
export function AvatarShelf({ card }: { card: Card }) {
  const copy = useCopy().social;
  const faces = avatarShelf(card.xp, card.avatarId);
  const open = faces.filter((face) => face.open).length;
  return (
    <ProfileSection title={copy.profileShelfTitle}>
      <ul className="grid grid-cols-6 gap-x-2 gap-y-3">
        {faces.map((face) => (
          <li
            key={face.id}
            aria-label={face.open ? copy.profileShelfFace(face.label, face.wearing) : copy.profileShelfLocked(face.label, face.opensAt ?? "")}
            className="flex flex-col items-center gap-1"
          >
            <Image
              src={face.src}
              alt=""
              width={40}
              height={40}
              className={cn(
                "size-10 rounded-full",
                face.open ? "bg-avatar-disc" : "opacity-80",
                face.wearing && "ring-2 ring-foreground ring-offset-2 ring-offset-card",
              )}
            />
            {face.opensAt && <span className="text-center text-[10px] leading-tight text-muted-foreground">{face.opensAt}</span>}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{copy.profileShelfCount(open, faces.length)}</p>
    </ProfileSection>
  );
}

/**
 * A short timeline, newest first, the month they joined last: rungs
 * reached, the day the two became friends, the Salutes between them. The
 * server sends it only between friends and on the viewer's own card.
 */
export function Moments({ card, moments }: { card: Card; moments: Moment[] }) {
  const copy = useCopy().social;
  const glyph = "size-4 shrink-0 text-muted-foreground";
  return (
    <ProfileSection title={copy.profileMomentsTitle}>
      <ol className="flex flex-col">
        {moments.map((moment, index) => {
          const [icon, words, when] =
            moment.kind === "rank"
              ? [<RankGlyph key="i" level={moment.level} className={glyph} />, copy.profileMomentRank(RANKS[moment.level - 1]?.name ?? ""), moment.on]
              : moment.kind === "friends"
                ? [<UsersThree key="i" weight="duotone" className={glyph} aria-hidden />, copy.profileMomentFriends, moment.on]
                : moment.kind === "salute"
                  ? [
                      <HandPalm key="i" weight="duotone" className={glyph} aria-hidden />,
                      moment.from === "you" ? copy.profileMomentSaluteYou(card.handle) : copy.profileMomentSaluteThem(card.handle),
                      moment.on,
                    ]
                  : [<Sailboat key="i" weight="duotone" className={glyph} aria-hidden />, copy.profileMomentJoined(monthLabel(moment.month)), null];
          return (
            <li
              key={`${moment.kind}-${index}`}
              data-moment={moment.kind}
              className="flex min-h-10 items-center gap-3 border-b border-border py-2 text-sm text-foreground last:border-b-0"
            >
              {icon}
              <span className="min-w-0 flex-1 break-words">{words}</span>
              {when && <span className="shrink-0 text-xs text-muted-foreground">{dayLabel(when)}</span>}
            </li>
          );
        })}
      </ol>
    </ProfileSection>
  );
}

/**
 * What the viewer and this friend share: the day they became friends, the
 * friends they both have (faces link to their profiles), and the stocks and
 * funds both hold, by name, only when both share. Friends only: the server
 * sends none of it otherwise.
 */
export function InCommon({ more }: { more: ProfileMore }) {
  const copy = useCopy().social;
  if (!more.friendsSince) return null;
  const glyph = "size-4 shrink-0 text-muted-foreground";
  const names = (more.bothHold ?? []).flatMap((symbol) => {
    const listing = STOCK_LISTINGS.find((candidate) => candidate.symbol === symbol);
    return listing ? [rowName(listing)] : [];
  });
  const mutualCount = more.mutual ? more.mutual.faces.length + more.mutual.more : 0;
  return (
    <ProfileSection title={copy.profileInCommonTitle}>
      <ul className="flex flex-col text-sm text-foreground">
        <li className="flex min-h-10 items-center gap-3 border-b border-border py-2 last:border-b-0">
          <UsersThree weight="duotone" className={glyph} aria-hidden />
          {copy.profileFriendsSince(dayLabel(more.friendsSince))}
        </li>
        {more.mutual && mutualCount > 0 && (
          <li data-in-common="mutual" className="flex min-h-10 items-center gap-3 border-b border-border py-2 last:border-b-0">
            <span className="flex shrink-0 items-center">
              {more.mutual.faces.map((face, index) => (
                <Link
                  key={face.handle}
                  href={`/u/${encodeURIComponent(face.handle)}`}
                  aria-label={copy.profileFaceLink(face.handle)}
                  className={cn("rounded-full ring-2 ring-card outline-none focus-visible:ring-ring", index > 0 && "-ml-2")}
                >
                  {/* A hairline keeps a face with no avatar (the rank glyph on a muted disc) a disc in the overlap. */}
                  <AvatarWithRank avatarId={face.avatarId} level={face.level} size={28} className="rounded-full border border-input" />
                </Link>
              ))}
              {more.mutual.more > 0 && (
                <span
                  aria-label={copy.profileMutualMoreAria(more.mutual.more)}
                  className="-ml-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground ring-2 ring-card"
                >
                  <span aria-hidden>{copy.profileMutualMore(more.mutual.more)}</span>
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">{copy.profileMutual(mutualCount)}</span>
          </li>
        )}
        {names.length > 0 && (
          <li data-in-common="holds" className="flex min-h-10 items-center gap-3 border-b border-border py-2 last:border-b-0">
            <ChartLineUp weight="duotone" className={glyph} aria-hidden />
            <span className="min-w-0 flex-1">{copy.profileBothHold(names)}</span>
          </li>
        )}
      </ul>
    </ProfileSection>
  );
}

/**
 * Everything the page shows under the card, in reading order. Renders
 * nothing for an answer without extras (Find a friend's card).
 */
export function ProfileExtras({ answer }: { answer: Extract<CardAnswer, { found: true }> }) {
  const { more } = answer;
  if (!more) return null;
  const self = answer.viewer.relation === "self";
  return (
    <>
      <RankLadder card={answer.card} more={more} self={self} />
      <InCommon more={more} />
      {more.moments && more.moments.length > 0 && <Moments card={answer.card} moments={more.moments} />}
      <AvatarShelf card={answer.card} />
    </>
  );
}
