"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, CaretDown, EnvelopeSimple, ShareNetwork, Trophy } from "@phosphor-icons/react";
import { AvatarWithRank } from "@/components/rank-glyph";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { useCopy } from "@/components/settings-provider";
import { NamePicker } from "@/components/social/name-picker";
import { FindFriend, type FindResult } from "@/components/social/find-friend";
import { useBlocked, useFriendLink, useFriendsList, useMySocial, useSetVisible, useSocialAction } from "@/hooks/use-social";
import type { BlockedName, FriendsList, MySocial, Person } from "@/lib/social-types";
import { SPRING_SHELF } from "@/lib/motion";
import { rankForXp } from "@/lib/xp";
import { cn } from "@/lib/utils";

/**
 * "Your profile" in the account drawer: a few ruled rows. Without an email,
 * one row that points at adding one. With an email and no username, the
 * picker. With a username: the name (view, change), friend requests when
 * there are any, friends and the friend link folded, the friends board, the
 * hide switch, and blocked people folded. One (i), on the title.
 */

export type SocialDemo = {
  me: MySocial;
  friends?: FriendsList;
  blocked?: BlockedName[];
  token?: string;
  open?: "friends" | "blocked" | "change";
  find?: { value: string; result: FindResult };
};

/** Where the rewards panel's add email row lives, so the no-email row can bring it into view. */
export const ADD_EMAIL_ANCHOR = "add-email";

export function SocialSection({ demo }: { demo?: SocialDemo } = {}) {
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
      {!social.hasEmail ? <NoEmailRow /> : !social.handle ? <FirstPick /> : <Named social={social} demo={demo} />}
    </div>
  );
}

function NoEmailRow() {
  const copy = useCopy().social;
  return (
    <button
      type="button"
      className="flex min-h-14 w-full items-center gap-3 px-3 py-3 text-left transition-[background-color] duration-150 ease-lift hover:bg-muted/60 active:bg-muted"
      onClick={() => {
        const target = document.getElementById(ADD_EMAIL_ANCHOR);
        target?.scrollIntoView({ block: "center", behavior: "smooth" });
        target?.querySelector("button")?.click();
      }}
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

function Named({ social, demo }: { social: MySocial; demo?: SocialDemo }) {
  const copy = useCopy().social;
  const [open, setOpen] = useState<"friends" | "blocked" | "change" | null>(demo?.open ?? null);
  const toggle = (which: "friends" | "blocked" | "change") => setOpen((current) => (current === which ? null : which));
  const friends = useFriendsList(!demo);
  const list = demo?.friends ?? friends.data;
  const visible = useSetVisible();
  const handle = social.handle!;

  return (
    <div className="flex flex-col divide-y divide-border">
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <div className="flex min-h-9 items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{handle}</span>
          <Button variant="ghost" size="sm" render={<Link href={`/u/${handle}`} />} nativeButton={false}>
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
        href="/friends"
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
      <ul className="flex flex-col">
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

function FriendsFold({ list, demo, handle }: { list: FriendsList | undefined; demo?: SocialDemo; handle: string }) {
  const copy = useCopy().social;
  const link = useFriendLink(!demo);
  const token = demo?.token ?? link.data;
  const share = async () => {
    if (!token) return;
    const url = `${window.location.origin}/f/${token}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ url, text: copy.shareLinkText(handle) });
        return;
      } catch {
        // Dismissed, or not allowed here: fall back to copying.
      }
    }
    await navigator.clipboard.writeText(url).then(
      () => toast.success(copy.linkCopied),
      () => toast.error(copy.actionFailed),
    );
  };
  return (
    <div className="flex flex-col gap-2 pb-2.5">
      <div className="px-3 pt-0.5 pb-1.5">
        <FindFriend demo={demo ? (demo.find ?? { value: "", result: null }) : undefined} />
      </div>
      {list && list.friends.length === 0 && <p className="px-3 text-xs text-muted-foreground">{copy.friendsNone}</p>}
      {list && list.friends.length > 0 && (
        <ul className="flex flex-col px-3">
          {list.friends.map((person) => (
            <li key={person.handle} className="flex min-h-11 items-center">
              <PersonLink person={person} />
            </li>
          ))}
        </ul>
      )}
      {list && list.outgoing.length > 0 && (
        <ul className="flex flex-col px-3">
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
          disabled={!token || link.fresh.isPending}
          onClick={() => {
            if (demo) return;
            link.fresh.mutate(undefined, {
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

function BlockedFold({ demo }: { demo?: SocialDemo }) {
  const copy = useCopy().social;
  const blocked = useBlocked(!demo);
  const action = useSocialAction();
  const people = demo?.blocked ?? blocked.data ?? [];
  return (
    <ul className="flex flex-col px-3 pb-2.5">
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

function PersonLink({ person }: { person: Person }) {
  const level = rankForXp(person.xp).level;
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
    <Link href={`/u/${person.handle}`} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1 hover:text-foreground">
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
