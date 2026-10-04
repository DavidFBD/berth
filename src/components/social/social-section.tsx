"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "@/lib/toast";
import { track } from "@/lib/analytics";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, CaretDown, EnvelopeSimple, ShareNetwork, Trophy } from "@phosphor-icons/react";
import { AvatarWithRank } from "@/components/rank-glyph";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { useCopy } from "@/components/settings-provider";
import { NamePicker } from "@/components/social/name-picker";
import { FindFriend, type FindResult } from "@/components/social/find-friend";
import {
  useBlocked,
  useFriendLink,
  useFriendsHolding,
  useFriendsList,
  useMySocial,
  useSetLinkFace,
  useSetShareHoldings,
  useSetVisible,
  useSocialAction,
} from "@/hooks/use-social";
import { TickerTile } from "@/components/board/holdings-list";
import { STOCK_LISTINGS, rowName } from "@/lib/listings";
import { FRIEND_FACES_SHOWN, type FriendFace, type FriendsHolding } from "@/lib/social-proof";
import type { BlockedName, FriendsList, MySocial, Person } from "@/lib/social-types";
import { SPRING_SHELF } from "@/lib/motion";
import { rankForXp } from "@/lib/xp";
import { cn } from "@/lib/utils";
import { FROM_DRAWER_PARAM, FROM_DRAWER_VALUE, focusAddEmail, useDrawerNav } from "@/components/account-drawer-nav";
import { isPlainClick } from "@/lib/drawer-return";

/**
 * "Your profile" in the account drawer: a few ruled rows. Without an email,
 * one row that points at adding one. With an email and no username, the
 * picker. With a username: the name (view, change), friend requests when
 * there are any, friends and the friend link folded, the friends board, the
 * hide switch, the link picture switch, "Your friends hold" folded with its
 * sharing switch (off by default), and blocked people folded. One (i), on the title.
 */

export type SocialDemo = {
  me: MySocial;
  friends?: FriendsList;
  blocked?: BlockedName[];
  token?: string;
  open?: "friends" | "blocked" | "change" | "holding";
  /** Stands in for the "holding" op's answer. */
  holding?: FriendsHolding[];
  find?: { value: string; result: FindResult };
};

/** Where the rewards panel's add email row lives, so the no-email row can bring it into view. */
export const ADD_EMAIL_ANCHOR = "add-email";

export function SocialSection({ demo, initialFold }: { demo?: SocialDemo; initialFold?: "friends" } = {}) {
  const copy = useCopy().social;
  const me = useMySocial(!demo);
  const social = demo?.me ?? me.data;
  if (!social) return null;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 px-3 pt-3 pb-1">
        <span className="text-sm font-medium text-foreground">{copy.sectionTitle}</span>
        <InfoTip label={copy.sectionTitle}>
          <p>{copy.sectionWhy}</p>
        </InfoTip>
      </div>
      {!social.hasEmail ? <NoEmailRow /> : !social.handle ? <FirstPick /> : <Named social={social} demo={demo} initialFold={initialFold} />}
    </div>
  );
}

function NoEmailRow() {
  const copy = useCopy().social;
  const nav = useDrawerNav();
  return (
    <button
      type="button"
      className="flex min-h-14 w-full items-center gap-3 px-3 py-3 text-left transition-[background-color] duration-150 ease-lift hover:bg-muted/60 active:bg-muted"
      onClick={() => focusAddEmail(nav, ADD_EMAIL_ANCHOR)}
    >
      <EnvelopeSimple weight="duotone" className="size-5 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm text-foreground">{copy.addEmail}</span>
        <span className="text-xs text-muted-foreground">{copy.addEmailSub}</span>
      </span>
    </button>
  );
}

function FirstPick() {
  const copy = useCopy().social;
  return (
    <div className="px-3 pt-1 pb-3">
      <NamePicker title={{ title: copy.pickTitle, sub: copy.pickSub }} />
    </div>
  );
}

function Named({ social, demo, initialFold }: { social: MySocial; demo?: SocialDemo; initialFold?: "friends" }) {
  const copy = useCopy().social;
  const [open, setOpen] = useState<"friends" | "blocked" | "change" | "holding" | null>(demo?.open ?? initialFold ?? null);
  const toggle = (which: "friends" | "blocked" | "change" | "holding") => setOpen((current) => (current === which ? null : which));
  const friends = useFriendsList(!demo);
  const list = demo?.friends ?? friends.data;
  const visible = useSetVisible();
  const linkFace = useSetLinkFace();
  const shareHoldings = useSetShareHoldings();
  const handle = social.handle!;
  const own = useDrawerLink(`/u/${handle}`);
  const board = useDrawerLink("/friends");

  return (
    <div className="flex flex-col divide-y divide-border">
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <div data-ph-block className="flex min-h-9 items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{handle}</span>
          <Button variant="ghost" size="sm" render={<Link href={own.href} onClick={own.onClick} />} nativeButton={false}>
            {copy.view}
          </Button>
          <Button variant="ghost" size="sm" aria-expanded={open === "change"} onClick={() => toggle("change")}>
            {copy.change}
          </Button>
        </div>
        {open === "change" && (
          <NamePicker current={handle} nextChangeAt={social.nextChangeAt} onDone={() => setOpen(null)} onCancel={() => setOpen(null)} />
        )}
      </div>

      {list && list.incoming.length > 0 && <Requests people={list.incoming} demo={Boolean(demo)} />}

      <Fold
        open={open === "friends"}
        onToggle={() => toggle("friends")}
        title={copy.friends}
        count={list ? list.friends.length : undefined}
      >
        <FriendsFold list={list} demo={demo} handle={handle} />
      </Fold>

      <Link
        href={board.href}
        onClick={board.onClick}
        className="flex min-h-14 items-center gap-3 px-3 py-2.5 transition-[background-color] duration-150 ease-lift hover:bg-muted/60 active:bg-muted"
      >
        <Trophy weight="duotone" className="size-5 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm text-foreground">{copy.boardRow}</span>
          <span className="text-xs text-muted-foreground">{copy.boardRowSub}</span>
        </span>
        <ArrowRight weight="duotone" className="size-4 text-muted-foreground" aria-hidden />
      </Link>

      <div className="flex min-h-14 items-center gap-3 px-3 py-2.5">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm text-foreground">{copy.hide}</span>
          <span className="text-xs text-muted-foreground">{copy.hideSub}</span>
        </span>
        <Toggle
          label={copy.hide}
          on={!social.visible}
          disabled={visible.isPending}
          onChange={(hidden) => {
            if (demo) return;
            visible.mutate(!hidden, { onError: () => toast.error(copy.actionFailed) });
          }}
        />
      </div>

      <div className="flex min-h-14 items-center gap-3 px-3 py-2.5">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm text-foreground">{copy.linkFace}</span>
          <span className="text-xs text-muted-foreground">{copy.linkFaceSub}</span>
        </span>
        <Toggle
          label={copy.linkFace}
          on={social.linkFace}
          disabled={linkFace.isPending}
          onChange={(on) => {
            if (demo) return;
            linkFace.mutate(on, { onError: () => toast.error(copy.actionFailed) });
          }}
        />
      </div>

      <Fold open={open === "holding"} onToggle={() => toggle("holding")} title={copy.holdingTitle}>
        <HoldingFold sharing={social.shareHoldings && social.visible} demo={demo} />
      </Fold>

      <div className="flex min-h-14 items-center gap-3 px-3 py-2.5">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm text-foreground">{copy.shareHoldings}</span>
          <span className="text-xs text-muted-foreground">{copy.shareHoldingsSub}</span>
        </span>
        <Toggle
          label={copy.shareHoldings}
          on={social.shareHoldings}
          disabled={shareHoldings.isPending}
          onChange={(on) => {
            if (demo) return;
            shareHoldings.mutate(on, { onError: () => toast.error(copy.actionFailed) });
          }}
        />
      </div>

      <Fold open={open === "blocked"} onToggle={() => toggle("blocked")} title={copy.blocked}>
        <BlockedFold demo={demo} />
      </Fold>
    </div>
  );
}

function Requests({ people, demo }: { people: Person[]; demo: boolean }) {
  const copy = useCopy().social;
  const action = useSocialAction();
  const act = (handle: string, which: "accept" | "decline") => {
    if (demo) return;
    action.mutate(
      { kind: "friend", handle, action: which },
      {
        onSuccess: (result) => {
          if (which === "accept" && result.done) toast.success(copy.youAreFriends(handle));
        },
        onError: () => toast.error(copy.actionFailed),
      },
    );
  };
  return (
    <div className="flex flex-col gap-1 px-3 py-2.5">
      <span className="text-xs text-muted-foreground">{copy.requestsTitle}</span>
      <p className="text-xs text-muted-foreground">{copy.acceptHoldingsNote}</p>
      <ul data-ph-block className="flex flex-col">
        {people.map((person) => (
          <li key={person.handle} className="flex min-h-11 items-center gap-2.5">
            <PersonLink person={person} />
            <Button variant="outline" size="sm" disabled={action.isPending} onClick={() => act(person.handle, "accept")}>
              {copy.accept}
            </Button>
            <Button variant="ghost" size="sm" disabled={action.isPending} onClick={() => act(person.handle, "decline")}>
              {copy.decline}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The friend link and a way to send it: the system share sheet where there
 * is one, the clipboard where there is not (or it was dismissed).
 */
export function useShareFriendLink(handle: string, demoToken?: string) {
  const copy = useCopy().social;
  const link = useFriendLink(demoToken === undefined);
  const token = demoToken ?? link.data;
  /**
   * How the link went out: through the share sheet, or copied (the
   * fallback, also after a dismissed sheet); null when it did not. `quiet`
   * leaves the "Link copied" toast to a caller that says it itself (the
   * guided path's Done moment).
   */
  const share = async ({ quiet = false }: { quiet?: boolean } = {}): Promise<"shared" | "copied" | null> => {
    if (!token) return null;
    const url = `${window.location.origin}/f/${token}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ url, text: copy.shareLinkText(handle) });
        track("invite_link_shared", { surface: "friend_link" });
        return "shared";
      } catch {
        // Dismissed, or not allowed here: fall back to copying.
      }
    }
    return navigator.clipboard.writeText(url).then(
      () => {
        if (!quiet) toast.success(copy.linkCopied);
        track("invite_link_copied", { surface: "friend_link" });
        return "copied" as const;
      },
      () => {
        toast.error(copy.actionFailed);
        return null;
      },
    );
  };
  return { token, share, fresh: link.fresh };
}

function FriendsFold({ list, demo, handle }: { list: FriendsList | undefined; demo?: SocialDemo; handle: string }) {
  const copy = useCopy().social;
  const { token, share, fresh } = useShareFriendLink(handle, demo?.token);
  return (
    <div className="flex flex-col gap-2 pb-2.5">
      <div className="px-3 pt-0.5 pb-1.5">
        <FindFriend demo={demo ? (demo.find ?? { value: "", result: null }) : undefined} />
      </div>
      {list && list.friends.length === 0 && <p className="px-3 text-xs text-muted-foreground">{copy.friendsNone}</p>}
      {list && list.friends.length > 0 && (
        <ul data-ph-block className="flex flex-col px-3">
          {list.friends.map((person) => (
            <li key={person.handle} className="flex min-h-11 items-center">
              <PersonLink person={person} />
            </li>
          ))}
        </ul>
      )}
      {list && list.outgoing.length > 0 && (
        <ul data-ph-block className="flex flex-col px-3">
          {list.outgoing.map((person) => (
            <li key={person.handle} className="flex min-h-11 items-center gap-2">
              <PersonLink person={person} />
              <span className="text-xs text-muted-foreground">{copy.sentLabel}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mx-3 flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
        <ShareNetwork weight="duotone" className="size-5 shrink-0 text-muted-foreground" />
        <button type="button" className="flex min-w-0 flex-1 flex-col text-left" onClick={() => void share()} disabled={!token}>
          <span className="text-sm text-foreground">{copy.shareLink}</span>
          <span className="text-xs text-muted-foreground">{copy.shareLinkSub}</span>
        </button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!token || fresh.isPending}
          onClick={() => {
            if (demo) return;
            fresh.mutate(undefined, {
              onSuccess: () => toast.success(copy.newLinkDone),
              onError: () => toast.error(copy.actionFailed),
            });
          }}
        >
          {copy.newLink}
        </Button>
      </div>
    </div>
  );
}

/**
 * "Your friends hold": which board listings friends who share hold, as a
 * count, named when one or two. Read only: no row buys or opens a buy, and
 * nothing here says how much. Empty, with the reason, unless the viewer
 * shares too (lib/server/social-proof).
 */
function HoldingFold({ sharing, demo }: { sharing: boolean; demo?: SocialDemo }) {
  const copy = useCopy();
  const fetched = useFriendsHolding(!demo && sharing);
  const lines = demo ? (demo.holding ?? []) : [...fetched.values()];
  if (!sharing) return <p className="px-3 pb-3 text-xs text-muted-foreground">{copy.social.holdingOff}</p>;
  const rows = lines.flatMap((line) => {
    const listing = STOCK_LISTINGS.find((candidate) => candidate.symbol === line.symbol);
    return listing ? [{ listing, line }] : [];
  });
  if (rows.length === 0) return <p className="px-3 pb-3 text-xs text-muted-foreground">{copy.social.holdingNone}</p>;
  return (
    <ul data-friends-hold data-ph-mask className="flex flex-col px-3 pb-2.5">
      {rows.map(({ listing, line }) => (
        <li key={listing.address} className="flex min-h-12 items-center gap-2.5 py-1">
          <TickerTile symbol={listing.symbol} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm text-foreground">{rowName(listing)}</span>
            <span className="truncate text-xs text-muted-foreground">{copy.friendsHold(line.count, line.names)}</span>
            <FriendFaces faces={line.faces ?? []} count={line.count} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The faces of the friends behind a "Your friends hold" row, small and
 * overlapping, each labelled with the friend's username; past
 * FRIEND_FACES_SHOWN, "+N" for the rest of the count. Still: no motion,
 * and never a button, so nothing here opens a buy.
 */
export function FriendFaces({ faces, count }: { faces: readonly FriendFace[]; count: number }) {
  const copy = useCopy();
  const shown = faces.slice(0, FRIEND_FACES_SHOWN);
  if (shown.length === 0) return null;
  const more = Math.max(0, count - shown.length);
  return (
    <span data-friend-faces className="mt-1 flex items-center">
      <span className="flex -space-x-1.5">
        {shown.map((face) => (
          <span key={face.handle} role="img" aria-label={face.handle} className="rounded-full ring-2 ring-card">
            <AvatarWithRank avatarId={face.avatarId} level={face.level} size={22} />
          </span>
        ))}
      </span>
      {more > 0 && (
        <span aria-hidden className="pl-1.5 font-mono text-xs text-muted-foreground">
          {copy.friendsHoldMore(more)}
        </span>
      )}
    </span>
  );
}

function BlockedFold({ demo }: { demo?: SocialDemo }) {
  const copy = useCopy().social;
  const blocked = useBlocked(!demo);
  const action = useSocialAction();
  const people = demo?.blocked ?? blocked.data ?? [];
  return (
    <ul data-ph-block className="flex flex-col px-3 pb-2.5">
      {people.map((person) => (
        <li key={person.handle} className="flex min-h-11 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{person.handle}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={action.isPending}
            onClick={() => {
              if (demo) return;
              action.mutate({ kind: "block", handle: person.handle, on: false }, { onError: () => toast.error(copy.actionFailed) });
            }}
          >
            {copy.unblock}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * A link from inside the account drawer to a page that offers a way back
 * to it (lib/drawer-return): the page is asked with ?from=account, and a
 * plain left click leaves the drawer's mark. Outside the drawer, the plain link.
 */
function useDrawerLink(path: string): { href: string; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void } {
  const nav = useDrawerNav();
  if (!nav) return { href: path };
  return {
    href: `${path}?${FROM_DRAWER_PARAM}=${FROM_DRAWER_VALUE}`,
    onClick: (event) => {
      if (isPlainClick(event)) nav.rememberReturn(path);
    },
  };
}

function PersonLink({ person }: { person: Person }) {
  const level = rankForXp(person.xp).level;
  const link = useDrawerLink(`/u/${person.handle}`);
  // A hidden profile: the name they had, and nothing to open.
  if (person.hidden) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2.5 py-1">
        <span aria-hidden className="size-7 shrink-0 rounded-full bg-muted" />
        <span className="truncate text-sm text-muted-foreground">{person.handle}</span>
      </span>
    );
  }
  return (
    <Link
      href={link.href}
      onClick={link.onClick}
      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1 hover:text-foreground"
    >
      <AvatarWithRank avatarId={person.avatarId} level={level} size={28} />
      <span className="truncate text-sm text-foreground">{person.handle}</span>
    </Link>
  );
}

function Fold({ open, onToggle, title, count, children }: { open: boolean; onToggle: () => void; title: string; count?: number; children: ReactNode }) {
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-12 w-full items-center gap-3 px-3 py-2.5 text-left transition-[background-color] duration-150 ease-lift hover:bg-muted/60 active:bg-muted"
      >
        <span className="flex-1 text-sm text-foreground">{title}</span>
        {count !== undefined && <span className="money text-xs text-muted-foreground tabular-nums">{count}</span>}
        <CaretDown className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING_SHELF}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A plain on/off switch (here, on means hidden; the Email section reuses it). */
export function Toggle({ label, on, onChange, disabled }: { label: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-border transition-colors duration-150 ease-lift outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
        on ? "bg-foreground" : "bg-muted",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block size-4.5 rounded-full bg-background shadow-sm transition-transform duration-150 ease-lift",
          on ? "translate-x-[1.15rem]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
