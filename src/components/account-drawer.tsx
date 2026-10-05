"use client";

import { track } from "@/lib/analytics";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  CaretLeft,
  CaretRight,
  At,
  Bell,
  GearSix,
  SignOut,
  Sparkle,
  Trophy,
  User,
  UserCircle,
  UsersThree,
  Wallet,
} from "@phosphor-icons/react";
import type { AssistantId } from "@/lib/assistant-party";
import type { Icon } from "@phosphor-icons/react";
import { AvatarWithRank } from "@/components/rank-glyph";
import { AvatarPicker } from "@/components/avatar-picker";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { useCopy } from "@/components/settings-provider";
import { AddEmailBlock, InviteCorner, Ladder, LedgerRow } from "@/components/rewards-panel";
import { SocialSection } from "@/components/social/social-section";
import { WalletsSection } from "@/components/account-wallets";
import { EmailSection } from "@/components/email-section";
import { AssistantSection } from "@/components/assistant/assistant-section";
import { SettingsBody } from "@/components/settings-drawer";
import { StaffEntry } from "@/components/staff/entry";
import {
  DRAWER_RETURN_KEY,
  DRAWER_RETURN_PARAM,
  DrawerNavContext,
  type DrawerNav,
  type DrawerView,
  useDrawerNav,
} from "@/components/account-drawer-nav";
import { useProfile } from "@/hooks/use-profile";
import { DrawerPathStep, useFirstPath } from "@/components/first-path";
import { establishedPrompt } from "@/lib/first-path";
import { writeMark } from "@/lib/drawer-return";
import { useFriendsList, useMySocial } from "@/hooks/use-social";
import { rankForXp, XP_ACTIONS } from "@/lib/xp";
import { cn } from "@/lib/utils";

/**
 * The account drawer, in two levels (field feedback, 2026-10-01: a new
 * account opened one long scroll of a dozen panels and did not know where
 * to look). The first screen says who you are (face, username, rank and
 * how far to the next), then at most one next step for a young account,
 * in order: choose an avatar, add an email (a wallet account), pick a
 * username, invite a friend. Everything else is a short list of rows, each
 * opening its own screen with a way back. Nothing that lived in the long
 * scroll is gone; see reports/calm-drawer.md for where each part moved.
 */
export type DrawerKind = "email" | "wallet";

export function AccountDrawerScreens({
  kind,
  hasAddress,
  initialView = "main",
  returnScroll = null,
  focusEmail = false,
  money,
  onOpenSettings,
  settingsAddress,
  onSignOut,
  assistant = null,
}: {
  kind: DrawerKind;
  /** An email account whose embedded wallet exists yet: "Your AI" needs it. */
  hasAddress: boolean;
  initialView?: DrawerView;
  /** Back from a page the drawer opened: where the scroll of that screen stood. */
  returnScroll?: number | null;
  /** Opened from the email nudge: the add-email flow is the first screen's one step. */
  focusEmail?: boolean;
  /** The money screen's receive and top up rows, from the account button (a wallet account's own address on Base). */
  money?: ReactNode;
  /**
   * The drawer closed for the recurring plan sheet, retired 2026-10-04. No
   * screen calls it now; it stays only so callers keep compiling, as
   * onOpenSettings does.
   */
  onLeave?: () => void;
  /**
   * The account has Settings (an email account). Settings is a screen of
   * this drawer now; the callback is no longer called and stays only so
   * callers built against the earlier shape keep compiling.
   */
  onOpenSettings?: () => void;
  /** The embedded wallet's address, for Settings' Advanced (key export). */
  settingsAddress?: string;
  onSignOut?: () => void;
  assistant?: AssistantId | null;
}) {
  const [view, setView] = useState<DrawerView>(initialView);
  const scroller = useRef<HTMLDivElement>(null);
  // The first screen's scroll, kept while a second screen is open.
  const mainScroll = useRef(0);
  const pendingScroll = useRef<number | null>(returnScroll);
  // The add-email flow, asked for (the nudge, or a row elsewhere): it takes the step's place.
  const [emailAsked, setEmailAsked] = useState(focusEmail);

  const show = useCallback(
    (next: DrawerView) => {
      if (next !== "main" && next !== view) track("account_screen_opened", { screen: next });
      if (view === "main") mainScroll.current = scroller.current?.scrollTop ?? 0;
      pendingScroll.current = next === "main" ? mainScroll.current : 0;
      setView(next);
    },
    [view],
  );

  // A new screen starts at its top; the first screen comes back where it was.
  useLayoutEffect(() => {
    const target = pendingScroll.current;
    if (target === null || !scroller.current) return;
    scroller.current.scrollTop = target;
    // Data cached a beat late (a list that grows) can push it; try once more.
    const timer = setTimeout(() => {
      if (scroller.current && target > 0) scroller.current.scrollTop = target;
      pendingScroll.current = null;
    }, 120);
    return () => clearTimeout(timer);
  }, [view]);

  const nav: DrawerNav = {
    view,
    show,
    rememberReturn: (target) => {
      try {
        sessionStorage.setItem(
          DRAWER_RETURN_KEY,
          writeMark({ view, scroll: scroller.current?.scrollTop ?? 0, target, at: Date.now() }),
        );
      } catch {
        // Storage refused (a private window): the page offers its usual way home.
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.set(DRAWER_RETURN_PARAM, view);
      window.history.replaceState(null, "", url);
    },
    askEmail: () => {
      setEmailAsked(true);
      if (view !== "main") show("main");
    },
  };

  return (
    <DrawerNavContext.Provider value={nav}>
      <div
        ref={scroller}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4 *:shrink-0 pb-[max(env(safe-area-inset-bottom),1rem)]"
      >
        {view === "main" ? (
          <MainScreen kind={kind} hasAddress={hasAddress} emailAsked={emailAsked} onOpenSettings={onOpenSettings} onSignOut={onSignOut} />
        ) : (
          <SubScreen view={view} kind={kind} money={money} assistant={assistant} settingsAddress={settingsAddress} />
        )}
      </div>
    </DrawerNavContext.Provider>
  );
}

function MainScreen({
  kind,
  hasAddress,
  emailAsked,
  onOpenSettings,
  onSignOut,
}: {
  kind: DrawerKind;
  hasAddress: boolean;
  emailAsked: boolean;
  onOpenSettings?: () => void;
  onSignOut?: () => void;
}) {
  const copy = useCopy();
  const words = copy.drawer;
  const profile = useProfile();
  const social = useMySocial();
  const friends = useFriendsList(true);
  const nav = useRequiredNav();

  const path = useFirstPath();
  const me = social.data;
  const xp = profile.data?.xp ?? 0;
  const rank = rankForXp(xp);
  const friendCount = friends.data?.friends.length ?? 0;
  const requests = me?.requests ?? friends.data?.incoming.length ?? 0;
  // The guided path's username step adds the email itself (components/first-path).
  const pathAsksEmail = path?.view.kind === "step" && path.view.step === "username";
  const quiet = establishedPrompt({
    avatarSet: Boolean(profile.data?.avatarId),
    usernameSet: Boolean(me?.handle),
    hasEmail: Boolean(me?.hasEmail),
  });

  return (
    <>
      <Identity />
      {/* The one Next step is the guided path's (lib/first-path), the same step
          the home shows; an established account, or one past the path, is
          asked nothing here. Adding an email when it was asked for (the email
          nudge, a row offering it) is that flow, not a prompt. */}
      <DrawerPathStep />
      {/* An established account, never on the path: one quiet row for a missing face or username, never an invite. */}
      {path?.established && quiet && (
        <Panel as="div">
          <Row
            icon={quiet === "avatar" ? UserCircle : At}
            title={quiet === "avatar" ? words.avatarTitle : copy.firstPath.titles.username}
            sub={quiet === "avatar" ? copy.firstPath.quietAvatar : copy.firstPath.quietUsername(XP_ACTIONS.username_set.amount)}
            onClick={() => nav.show(quiet === "avatar" ? "avatar" : "friends")}
          />
        </Panel>
      )}
      {kind === "wallet" && emailAsked && profile.data && !profile.data.hasEmail && !pathAsksEmail && (
        <Panel as="div" className="flex flex-col gap-2 p-3">
          <AddEmailBlock hasEmail={false} />
        </Panel>
      )}

      <Panel as="div" className="divide-y divide-border">
        <Row icon={Trophy} title={words.rows.rewards.title} sub={words.rows.rewards.sub(rank.name, rank.level)} onClick={() => nav.show("rewards")} />
        <Row
          icon={UsersThree}
          title={words.rows.friends.title}
          sub={me?.handle ? words.rows.friends.sub(friendCount, requests) : words.rows.friends.subNoName}
          badge={requests > 0 ? requests : undefined}
          onClick={() => nav.show("friends")}
        />
        {kind === "email" ? (
          <Row icon={Wallet} title={words.rows.money.title} sub={words.rows.money.sub} onClick={() => nav.show("money")} />
        ) : (
          <Row icon={Wallet} title={words.rows.wallets.title} sub={words.rows.wallets.sub} onClick={() => nav.show("money")} />
        )}
        <Row icon={Bell} title={words.rows.notifications.title} sub={words.rows.notifications.sub} onClick={() => nav.show("notifications")} />
        {(kind === "wallet" || hasAddress) && (
          <Row icon={Sparkle} title={words.rows.ai.title} sub={words.rows.ai.sub} onClick={() => nav.show("ai")} />
        )}
        {onOpenSettings && <Row icon={GearSix} title={copy.settingsTitle} sub={copy.settingsSub} onClick={() => nav.show("settings")} />}
      </Panel>

      {/* Only for an account on a staff list, by the server's word (components/staff/entry). */}
      <StaffEntry session={kind} />

      {onSignOut && (
        <Button variant="ghost" className="justify-start gap-3 px-3 text-muted-foreground" onClick={onSignOut}>
          <SignOut className="size-5" />
          {copy.accountSignOut}
        </Button>
      )}
    </>
  );
}

/** Every screen below sits inside AccountDrawerScreens. */
function useRequiredNav(): DrawerNav {
  const nav = useDrawerNav();
  if (!nav) throw new Error("Drawer screens need their nav.");
  return nav;
}

/**
 * Who you are, at the top of the first screen: the face (tap it to change
 * it, once there is one), the username or a plain line that there is none,
 * and the rank with its progress, in ink: the accent belongs to the next step.
 */
function Identity() {
  const copy = useCopy();
  const words = copy.drawer;
  const profile = useProfile();
  const social = useMySocial();
  const nav = useRequiredNav();
  if (!profile.data) return null;
  const { xp, avatarId } = profile.data;
  const rank = rankForXp(xp);
  const handle = social.data?.handle ?? null;

  const face = <AvatarWithRank avatarId={avatarId} level={rank.level} size={56} />;
  return (
    <Panel as="div" data-ph-mask className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-3">
        {avatarId ? (
          <button
            type="button"
            aria-label={words.changeAvatar}
            onClick={() => nav.show("avatar")}
            className="shrink-0 rounded-full transition-transform duration-150 ease-lift active:scale-[0.96] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {face}
          </button>
        ) : (
          // No face yet: a plain place for one, clear in both themes, not
          // the first rung's bar (which read as a minus sign on the disc).
          // Still a way to the faces, path or no path (a skipped avatar, an
          // established account).
          <button
            type="button"
            aria-label={words.avatarTitle}
            onClick={() => nav.show("avatar")}
            className="flex size-14 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/45 bg-muted text-muted-foreground outline-none transition-transform duration-150 ease-lift active:scale-[0.96] focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <User weight="duotone" className="size-7" />
          </button>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className={cn("truncate font-heading text-[17px] leading-snug tracking-[-0.02em]", handle ? "text-foreground" : "text-muted-foreground")}>
            {handle ?? words.noUsername}
          </span>
          <span className="text-xs text-muted-foreground">
            {rank.name} · {copy.rankLine(rank.level, xp.toLocaleString())}
          </span>
        </div>
      </div>
      {rank.nextName && (
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full w-full rounded-full bg-foreground/70 transition-transform duration-300 ease-lift"
            style={{ transform: `translateX(-${100 - Math.round(rank.progress * 100)}%)` }}
          />
        </div>
      )}
    </Panel>
  );
}

function Row({
  icon: Glyph,
  title,
  sub,
  badge,
  onClick,
}: {
  icon: Icon;
  title: string;
  sub: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full items-center gap-3 px-3 py-3 text-left transition-[background-color] duration-150 ease-lift hover:bg-muted/60 active:bg-muted"
    >
      <Glyph weight="duotone" className="size-5 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        {/* Fixed copy: may show in a replay (lib/analytics maskText); the sub, with its counts, stays masked. */}
        <span data-ph-unmask className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{sub}</span>
      </span>
      {badge !== undefined && (
        <span className="money flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1.5 text-[11px] font-medium text-background tabular-nums">
          {badge}
        </span>
      )}
      <CaretRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

function SubScreen({
  view,
  kind,
  money,
  assistant,
  settingsAddress,
}: {
  view: Exclude<DrawerView, "main">;
  kind: DrawerKind;
  money?: ReactNode;
  assistant: AssistantId | null;
  settingsAddress?: string;
}) {
  const words = useCopy().drawer;
  const nav = useRequiredNav();
  return (
    <>
      <button
        type="button"
        onClick={() => nav.show("main")}
        className="-mx-1 -mt-1 flex min-h-10 items-center gap-1 self-start rounded-full px-2 text-sm text-muted-foreground transition-colors duration-150 ease-lift hover:bg-muted/60 hover:text-foreground"
      >
        <CaretLeft className="size-4" aria-hidden />
        {words.back}
      </button>
      <SubContent view={view} kind={kind} money={money} assistant={assistant} settingsAddress={settingsAddress} />
    </>
  );
}

function SubContent({
  view,
  kind,
  money,
  assistant,
  settingsAddress,
}: {
  view: Exclude<DrawerView, "main">;
  kind: DrawerKind;
  money?: ReactNode;
  assistant: AssistantId | null;
  settingsAddress?: string;
}) {
  const copy = useCopy();
  const words = copy.drawer;
  const profile = useProfile();
  const nav = useRequiredNav();
  switch (view) {
    case "avatar": {
      if (!profile.data) return null;
      const level = rankForXp(profile.data.xp).level;
      return (
        <Panel as="div" className="flex flex-col gap-3 p-3">
          <div className="flex flex-col gap-0.5">
            <span className="font-heading text-[17px] leading-snug tracking-[-0.02em] text-foreground">{words.avatarChangeTitle}</span>
            <span className="text-sm text-muted-foreground">{words.avatarChangeSub}</span>
          </div>
          <AvatarPicker avatarId={profile.data.avatarId} level={level} first={false} onSaved={() => nav.show("main")} />
        </Panel>
      );
    }
    case "rewards":
      if (!profile.data) return null;
      return (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-3 py-3">
          <span className="text-sm font-medium text-foreground">{words.rows.rewards.title}</span>
          <Ladder xp={profile.data.xp} />
          <InviteCorner xp={profile.data.xp} code={profile.data.referralCode} />
          <LedgerRow />
        </div>
      );
    case "friends":
      return (
        <Panel>
          <SocialSection initialFold="friends" />
        </Panel>
      );
    case "money":
      return (
        <>
          <WalletsSection />
          {money}
        </>
      );
    case "notifications":
      return (
        <Panel>
          <EmailSection heading="row" />
        </Panel>
      );
    case "settings":
      return (
        <Panel as="div" className="flex flex-col gap-3 p-3">
          <span className="text-sm font-medium text-foreground">{copy.settingsTitle}</span>
          <SettingsBody evmAddress={settingsAddress} />
        </Panel>
      );
    case "ai":
      return kind === "wallet" ? (
        <Panel>
          <AssistantSection initialOpen={assistant} />
        </Panel>
      ) : (
        <Panel className="divide-y divide-border">
          <AssistantSection initialOpen={assistant} />
        </Panel>
      );
  }
}
