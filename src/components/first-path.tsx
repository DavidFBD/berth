"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCircle, ShareNetwork } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { useCopy } from "@/components/settings-provider";
import { AvatarPicker } from "@/components/avatar-picker";
import { NamePicker, NamePickerView, type PickerStatus } from "@/components/social/name-picker";
import { AddEmailBlock } from "@/components/rewards-panel";
import { useShareFriendLink } from "@/components/social/social-section";
import { PRIMARY, StepCard, type StepFrame } from "@/components/home-next-step";
import { useFirstPathRecord, useFirstPathWrite, useProfile } from "@/hooks/use-profile";
import { useMySocial } from "@/hooks/use-social";
import { useStoredChoice } from "@/hooks/use-stored-choice";
import {
  finishedStep,
  firstPath,
  stepXp,
  type BuyStepState,
  type PathFacts,
  type PathStep,
  type PathView,
} from "@/lib/first-path";
import { parseHandle } from "@/lib/handle";
import { rankForXp } from "@/lib/xp";
import { EASE_LIFT } from "@/lib/motion";
import { toast } from "@/lib/toast";
import type { FirstPathCopy } from "@/lib/copy";
import { cn } from "@/lib/utils";

/**
 * The guided first path on screen (lib/first-path is the rulebook). One
 * provider per signed-in home works out the one view, and every surface
 * reads it from here: the home's next step, the account drawer's Next step,
 * the nudge line (which stays quiet about what the path says) and the
 * first look, which is the path's buy step. So the path lives in one place
 * and no two surfaces can ask for different things.
 *
 * Each screen shows the current step only, with its one accent. A step a
 * fact finishes closes with a brief Done moment that names the next one,
 * then hands off. A skip is quiet: a toast with Undo, and it can be brought
 * back from "You're set up". Closing that ends the path for good.
 */

export type PathDemo = {
  saveAvatar: (avatarId: string) => void;
  saveName: (name: string) => void;
  share: () => void;
};

export type FirstPathValue = {
  view: PathView;
  facts: PathFacts;
  referred: boolean;
  account: "email" | "wallet";
  canBuy: boolean;
  /** The step a fact just finished, for its Done moment; null otherwise. */
  done: PathStep | null;
  skip: (step: PathStep) => void;
  unskip: (step: PathStep) => void;
  finish: () => void;
  /** The friend link went out: through the share sheet, or copied. */
  shared: (how: "shared" | "copied") => void;
  /** Never on the path (made before it began): the drawer keeps one quiet prompt for it (lib/first-path establishedPrompt). */
  established?: boolean;
  /** How the link last went out on this device, so its Done moment says exactly that. */
  invitedHow?: "shared" | "copied";
  /** Dev galleries only: the step bodies act on fixtures. */
  demo?: PathDemo;
  /** How the first buy step may speak (lib/first-path buyStepState); absent reads as unfunded. */
  buy?: BuyStepState;
  /** From the account drawer to the home's own steps: add money (or the board, for a wallet), the first buy. */
  go?: { money: () => void; firstBuy: () => void };
};

const FirstPathContext = createContext<FirstPathValue | null>(null);

export function FirstPathProvider({ value, children }: { value: FirstPathValue | null; children: ReactNode }) {
  return <FirstPathContext.Provider value={value}>{children}</FirstPathContext.Provider>;
}

/** The path's one view, or null outside a provider (signed out, galleries without one). */
export function useFirstPath(): FirstPathValue | null {
  return useContext(FirstPathContext);
}

/** Whether the path holds the page's one accent right now (a step, its Done moment, or "You're set up"). */
export function pathOnScreen(value: FirstPathValue | null): boolean {
  if (!value) return false;
  return value.done !== null || value.view.kind === "step" || value.view.kind === "complete";
}

/** How long the Done moment stays before the next step takes its place. */
export const DONE_MS = 2_200;

/**
 * The Done moment: the step a fact just finished (lib/first-path
 * finishedStep), held for DONE_MS. A wait in between (balances re-read) is
 * looked through, so the moment is not lost to it.
 */
export function useDoneMoment(view: PathView): PathStep | null {
  const last = useRef<PathView | null>(null);
  const [done, setDone] = useState<PathStep | null>(null);
  const key = view.kind === "step" ? `step:${view.step}` : view.kind;
  const latest = useRef(view);
  useEffect(() => {
    latest.current = view;
  });
  useEffect(() => {
    const now = latest.current;
    if (now.kind === "wait") return;
    const previous = last.current;
    last.current = now;
    if (!previous) return;
    const finished = finishedStep(previous, now);
    if (!finished) return;
    setDone(finished);
    const timer = setTimeout(() => setDone(null), DONE_MS);
    return () => clearTimeout(timer);
  }, [key]);
  return done;
}

/**
 * The live path for the signed-in home. `funded` and `ownsStock` are what
 * the home's stage proves (undefined while unknown); everything else is read
 * here, from the server's record and facts and the profile and social
 * caches, which move first when a step is done on this device.
 */
export function useLiveFirstPath({
  funded,
  ownsStock,
  account,
  canBuy,
  accountKey,
}: {
  funded: boolean | undefined;
  ownsStock: boolean | undefined;
  account: "email" | "wallet";
  canBuy: boolean;
  accountKey: string | null;
}): FirstPathValue {
  const copy = useCopy().firstPath;
  // Remembered per account once the server says the path is not for it, so
  // an established account never holds the step's place while it is asked,
  // and is not asked again: once remembered, the record is never read.
  const [remembered, remember] = useStoredChoice(accountKey ? `berth.first-path.${accountKey.toLowerCase()}` : null);
  const record = useFirstPathRecord(remembered !== "off" && remembered !== "established");
  const write = useFirstPathWrite();
  const profile = useProfile();
  const social = useMySocial();
  const server = record.data;
  const facts: PathFacts = {
    avatarSet: Boolean(server?.facts.avatarSet) || Boolean(profile.data?.avatarId),
    usernameSet: Boolean(server?.facts.usernameSet) || Boolean(social.data?.handle),
    hasEmail: Boolean(server?.facts.hasEmail) || Boolean(profile.data?.hasEmail),
    funded: server?.facts.funded || funded === true ? true : funded,
    firstBuy: server?.facts.firstBuy || ownsStock === true ? true : ownsStock === undefined ? undefined : false,
    inviteSent: Boolean(server?.facts.inviteSent),
  };
  const off = server !== undefined && (!server.eligible || server.finished);
  const view: PathView = server
    ? firstPath({ facts, record: server, context: { account, canBuy } })
    : record.isError || remembered === "off" || remembered === "established"
      ? { kind: "off" }
      : { kind: "wait" };
  // "established" (never on it) and "off" (finished) are kept apart, for whoever reads storage later.
  const settled = off ? (server?.eligible ? "off" : "established") : null;
  useEffect(() => {
    if (settled && remembered !== settled) remember(settled);
  }, [settled, remembered, remember]);

  // Money seen here is told to the server once, so every device knows the step is done.
  const writeMutate = write.mutate;
  const fundedSent = useRef(false);
  const onPath = server !== undefined && server.eligible && !server.finished;
  useEffect(() => {
    if (!onPath || fundedSent.current || funded !== true || server?.facts.funded) return;
    fundedSent.current = true;
    writeMutate({ funded: true });
  }, [onPath, funded, server?.facts.funded, writeMutate]);

  const done = useDoneMoment(view);
  const [invitedHow, setInvitedHow] = useState<"shared" | "copied" | undefined>(undefined);
  const unskip = useCallback((step: PathStep) => writeMutate({ unskip: step }), [writeMutate]);
  return {
    view,
    facts,
    referred: Boolean(server?.referred),
    account,
    canBuy,
    done,
    skip: (step) => {
      writeMutate({ skip: step });
      toast(copy.skipped, { id: "first-path-skip", action: { label: copy.undo, onClick: () => unskip(step) } });
    },
    unskip,
    finish: () => writeMutate({ finish: true }),
    shared: (how) => {
      setInvitedHow(how);
      writeMutate({ invited: true });
    },
    invitedHow,
    established: server ? !server.eligible : remembered === "established",
  };
}

function stepTitle(copy: FirstPathCopy, step: PathStep, account: "email" | "wallet"): string {
  if (step === "money" && account === "wallet") return copy.titles.walletMoney;
  return copy.titles[step];
}

function doneTitle(copy: FirstPathCopy, step: PathStep, account: "email" | "wallet", invitedHow?: "shared" | "copied"): string {
  if (step === "money" && account === "wallet") return copy.done.walletMoney;
  // "Invite sent." only after a real share; a copied link is only copied.
  if (step === "invite" && invitedHow === "copied") return copy.done.inviteCopied;
  return copy.done[step];
}

/** "Step 2 of 5" with a short row of marks, in ink: the accent stays on the step's action. */
export function PathProgress({ view, className }: { view: Extract<PathView, { kind: "step" }>; className?: string }) {
  const copy = useCopy().firstPath;
  return (
    <p className={cn("mb-2.5 flex items-center gap-2.5 text-xs text-muted-foreground", className)}>
      <span>{copy.progress(view.index, view.total)}</span>
      <span aria-hidden className="flex items-center gap-1">
        {view.steps.map((status, index) => (
          <span
            key={status.step}
            className={cn(
              "h-1 w-4 rounded-full",
              // Upcoming marks in a faint ink, not bg-muted, which vanished on the card in both themes.
              index + 1 === view.index ? "bg-foreground" : status.state === "done" ? "bg-foreground/45" : "bg-foreground/15",
            )}
          />
        ))}
      </span>
    </p>
  );
}

/** The quiet skip under a step's action. */
function SkipLink({ onSkip, className }: { onSkip: () => void; className?: string }) {
  const copy = useCopy().firstPath;
  return (
    <div className={cn("flex justify-center px-[18px] pb-3 lg:px-6", className)}>
      <button
        type="button"
        onClick={onSkip}
        className="min-h-11 rounded-full px-3 text-[13px] text-muted-foreground underline-offset-4 outline-none transition-colors duration-150 ease-lift hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {copy.skip}
      </button>
    </div>
  );
}

function XpLine({ children }: { children: ReactNode }) {
  return <p className="text-center text-xs text-muted-foreground">{children}</p>;
}

const UNFUNDED: BuyStepState = { unfunded: true, loading: false, earnsXp: false };

/** What the home lends the path for the two steps that are its own: adding money and the first buy. */
export type HomePathSlots = {
  money: (frame: StepFrame, title: string) => ReactNode;
  firstBuy: (frame: StepFrame, title: string, note: ReactNode, buy: BuyStepState) => ReactNode;
};

/**
 * The path on the home, in the next step's place: the current step's card,
 * its Done moment, or "You're set up". Null while the path is not on screen.
 */
export function HomePathCard({ slots, footnote }: { slots: HomePathSlots; footnote?: ReactNode }) {
  const path = useFirstPath();
  const copy = useCopy().firstPath;
  if (!path) return null;
  const { view } = path;
  return (
    <AnimatedSwap
      id={path.done ? `done:${path.done}` : view.kind === "step" ? view.step : view.kind}
    >
      {path.done ? (
        <DoneMoment step={path.done} footnote={footnote} />
      ) : view.kind === "complete" ? (
        <SetUpCard footnote={footnote} />
      ) : view.kind === "step" ? (
        (() => {
          const frame: StepFrame = {
            eyebrow: <PathProgress view={view} />,
            footer: (
              <>
                <Footnote>{footnote}</Footnote>
                <SkipLink onSkip={() => path.skip(view.step)} />
              </>
            ),
          };
          const title = stepTitle(copy, view.step, path.account);
          if (view.step === "money") return slots.money(frame, title);
          if (view.step === "firstBuy") {
            const buy = path.buy ?? UNFUNDED;
            // The XP line only beside a buy that will earn it; otherwise none.
            const xp = buy.earnsXp ? stepXp("firstBuy", { referred: path.referred }) : null;
            return slots.firstBuy(frame, title, xp ? <XpLine>{copy.xpFirstBuy(xp)}</XpLine> : null, buy);
          }
          return (
            <StepCard title={title} line={stepLine(copy, view.step, path)} frame={frame}>
              {/* A phone's width at most, so the faces stay faces on a desktop. */}
              <div className="px-[18px] pb-1 lg:px-6">
                <div className="max-w-md">
                  <StepBody step={view.step} />
                </div>
              </div>
            </StepCard>
          );
        })()
      ) : null}
    </AnimatedSwap>
  );
}

/**
 * A quiet line under every path card (a campaign's rules or progress,
 * components/board/campaign-line), so a campaign never reads as a second
 * next step and never goes missing while the path is on screen.
 */
function Footnote({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <div className="px-[18px] pb-1 lg:px-6">{children}</div>;
}

function stepLine(copy: FirstPathCopy, step: PathStep, path: FirstPathValue): string {
  switch (step) {
    case "avatar":
      return copy.avatarSub;
    case "username":
      return path.account === "wallet" && !path.facts.hasEmail ? copy.usernameNeedsEmail : copy.usernameSub;
    case "invite":
      return path.facts.usernameSet ? copy.inviteSub : copy.inviteNeedsName;
    default:
      return "";
  }
}

/** The body of the three steps the home and the drawer draw the same way: avatar, username, invite. */
function StepBody({ step }: { step: PathStep }) {
  const path = useFirstPath();
  const profile = useProfile();
  if (!path) return null;
  if (step === "avatar") {
    const level = rankForXp(profile.data?.xp ?? 0).level;
    return <AvatarPicker avatarId={null} level={level} first demoSave={path.demo?.saveAvatar} />;
  }
  if (step === "username") {
    if (path.account === "wallet" && !path.facts.hasEmail) return <AddEmailBlock hasEmail={false} />;
    return path.demo ? <DemoNamePicker onSave={path.demo.saveName} /> : <NamePicker />;
  }
  if (step === "invite") return <InviteBody />;
  return null;
}

function InviteBody() {
  const path = useFirstPath();
  const all = useCopy();
  const copy = all.firstPath;
  const social = useMySocial(!path?.demo);
  if (!path) return null;
  if (!path.facts.usernameSet) {
    return (
      <Button className={PRIMARY} onClick={() => path.unskip("username")}>
        {copy.inviteNeedsNameAction}
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {path.demo ? (
        <Button className={cn(PRIMARY, "gap-2")} onClick={path.demo.share}>
          <ShareNetwork weight="duotone" className="size-4.5" aria-hidden />
          {all.drawer.inviteAction}
        </Button>
      ) : (
        <ShareButton handle={social.data?.handle ?? ""} onShared={path.shared} />
      )}
    </div>
  );
}

function ShareButton({ handle, onShared }: { handle: string; onShared: (how: "shared" | "copied") => void }) {
  const words = useCopy().drawer;
  const { token, share } = useShareFriendLink(handle);
  return (
    <Button
      className={cn(PRIMARY, "gap-2")}
      disabled={!token || !handle}
      onClick={() =>
        void share({ quiet: true }).then((how) => {
          if (how) onShared(how);
        })
      }
    >
      <ShareNetwork weight="duotone" className="size-4.5" aria-hidden />
      {words.inviteAction}
    </Button>
  );
}

/** Dev galleries only: the username picker with every shaped name free, a name already typed so a shot can save it. */
function DemoNamePicker({ onSave }: { onSave: (name: string) => void }) {
  const [value, setValue] = useState("gosia");
  const parsed = parseHandle(value);
  const status: PickerStatus = value.length === 0 ? { kind: "rules" } : parsed.ok ? { kind: "free" } : value.length < 3 ? { kind: "rules" } : { kind: "refused", reason: parsed.reason };
  return <NamePickerView value={value} onChange={setValue} status={status} saving={false} first onSave={() => onSave(value)} />;
}

/** The Done moment: the step that just closed, and what comes next. */
function DoneMoment({ step, compact = false, footnote }: { step: PathStep; compact?: boolean; footnote?: ReactNode }) {
  const path = useFirstPath();
  const copy = useCopy().firstPath;
  if (!path) return null;
  // After the last step, but with steps set aside about to be offered back, it was not the last: say nothing more.
  const next =
    path.view.kind === "step"
      ? copy.doneNext(stepTitle(copy, path.view.step, path.account))
      : path.view.kind === "complete" && path.view.skipped.length > 0
        ? null
        : copy.doneLast;
  return (
    <Panel>
      <div role="status" aria-live="polite" className={cn("flex items-center gap-3", compact ? "p-3" : "px-[18px] py-5 lg:px-6 lg:py-6")}>
        <CheckCircle weight="duotone" aria-hidden className={cn("shrink-0 text-foreground", compact ? "size-6" : "size-8")} />
        <div className="flex min-w-0 flex-col">
          <span className={cn("text-foreground", compact ? "font-heading text-[17px] leading-snug tracking-[-0.02em]" : "font-display text-[22px] leading-[1.15] tracking-[-0.022em] lg:text-[24px]")}>
            {doneTitle(copy, step, path.account, path.invitedHow)}
          </span>
          {next && <span className="text-sm text-muted-foreground">{next}</span>}
        </div>
      </div>
      {footnote && <div className="pb-3">{footnote}</div>}
    </Panel>
  );
}

/** "You're set up": once, with any step set aside offered back, until Done ends the path for good. */
function SetUpCard({ compact = false, footnote }: { compact?: boolean; footnote?: ReactNode }) {
  const path = useFirstPath();
  const copy = useCopy().firstPath;
  if (!path || path.view.kind !== "complete") return null;
  const { skipped } = path.view;
  return (
    <Panel>
      <div className={cn("flex flex-col gap-3", compact ? "p-3" : "px-[18px] pt-5 pb-3 lg:px-6 lg:pt-6 lg:pb-4")}>
        <div className="flex items-start gap-3">
          <CheckCircle weight="duotone" aria-hidden className={cn("mt-0.5 shrink-0 text-foreground", compact ? "size-6" : "size-8")} />
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className={cn("text-foreground", compact ? "font-heading text-[17px] leading-snug tracking-[-0.02em]" : "font-display text-[24px] leading-[1.15] tracking-[-0.022em] lg:text-[28px]")}>
              {copy.setUpTitle}
            </h2>
            <p className="text-[14.5px] leading-[1.55] text-muted-foreground">
              {/* "That is everything." only when nothing was set aside. */}
              {skipped.length > 0 ? copy.setUpLineSome : path.canBuy ? copy.setUpLine : copy.setUpLineAway}
            </p>
          </div>
        </div>
        {skipped.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">{copy.setUpSkipped}</p>
            <ul className="flex flex-wrap gap-1.5">
              {skipped.map((step) => (
                <li key={step}>
                  <Button variant="outline" size="sm" className="rounded-full" onClick={() => path.unskip(step)}>
                    {stepTitle(copy, step, path.account)}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Button className={compact ? "w-full" : PRIMARY} onClick={path.finish}>
          {copy.setUpClose}
        </Button>
        {footnote}
      </div>
    </Panel>
  );
}

/** One card leaves, the next arrives: a short fade and lift, or a plain swap under reduced motion. */
function AnimatedSwap({ id, children }: { id: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={id}
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -4 }}
        transition={{ duration: 0.22, ease: EASE_LIFT }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * The path in the account drawer's Next step: the same current step. The
 * two steps that live on the home (money, the first buy) get a button that
 * goes there instead of a second copy of them.
 */
export function DrawerPathStep() {
  const path = useFirstPath();
  const copy = useCopy();
  const words = copy.firstPath;
  if (!path) return null;
  const { view } = path;
  if (path.done) return <DoneMoment step={path.done} compact />;
  if (view.kind === "complete") return <SetUpCard compact />;
  if (view.kind !== "step") return null;
  const title = stepTitle(words, view.step, path.account);
  const go =
    view.step === "money"
      ? { label: path.account === "wallet" ? words.goWalletMoney : words.goMoney, run: path.go?.money }
      : view.step === "firstBuy"
        ? { label: words.goFirstBuy, run: path.go?.firstBuy }
        : null;
  const line =
    view.step === "money"
      ? path.account === "wallet"
        ? copy.calmHome.walletAddLine
        : copy.calmHome.addLine
      : view.step === "firstBuy"
        ? (path.buy ?? UNFUNDED).unfunded
          ? words.firstUnfunded
          : words.firstFunded
        : stepLine(words, view.step, path);
  return (
    <Panel as="div" className="flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-[11.5px] font-bold tracking-(--tracking-caps) uppercase text-muted-foreground">
          {copy.drawer.nextStep}
        </span>
        <PathProgress view={view} className="mb-0.5" />
        <span className="font-heading text-[17px] leading-snug tracking-[-0.02em] text-foreground">{title}</span>
        <span className="text-sm text-muted-foreground">{line}</span>
      </div>
      {go ? (
        <Button className="w-full" disabled={!go.run} onClick={go.run}>
          {go.label}
        </Button>
      ) : (
        <StepBody step={view.step} />
      )}
      <SkipLink onSkip={() => path.skip(view.step)} className="px-0 pb-0" />
    </Panel>
  );
}
