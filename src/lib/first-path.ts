import type { NudgeKind } from "@/lib/nudge";
import { XP_ACTIONS } from "@/lib/xp";

/**
 * The guided first path (2026-10-02): a new account is led through five
 * steps, one at a time, in one place in the code. This module is the whole
 * rulebook, pure, so every transition is a unit test; the server keeps the
 * progress record (lib/server/first-path) and the home, the account drawer,
 * the nudge line and the first look all read the one view it answers
 * (components/first-path).
 *
 *   1. avatar     choose your avatar
 *   2. username   pick a username (a wallet account adds an email first)
 *   3. friends    turn on all friend features, once, for its XP (2026-10-11)
 *   4. money      add money, or for a wallet account pay from your wallet
 *   5. firstBuy   the first buy of a stock or fund
 *   6. invite     invite a friend
 *
 * Each step is done by a fact, never by a click alone: the avatar is set,
 * the username exists, the account holds enough to place an order, a buy
 * filled, an invite went out. So the path never asks for something already
 * done, and facts that arrive out of order (a buy before an avatar) simply
 * close the steps they prove. A skip is quiet and reversible: it only moves
 * a step aside until it is unskipped, and a fact that later proves it done
 * makes it done. Where Berth cannot take an order (the soft landing,
 * lib/availability) there is no money step and no buy step. When every step
 * is done or set aside the path says "You're set up" once, and once that is
 * closed it is finished on the account and never shows again. Accounts made
 * before the path existed are not on it.
 */

export const PATH_STEPS = ["avatar", "username", "friends", "money", "firstBuy", "invite"] as const;
export type PathStep = (typeof PATH_STEPS)[number];

export function isPathStep(value: unknown): value is PathStep {
  return typeof value === "string" && (PATH_STEPS as readonly string[]).includes(value);
}

/**
 * Accounts created from this moment on walk the path; every account made
 * before it is established and never sees it.
 */
export const PATH_SINCE = Date.parse("2026-10-02T00:00:00Z");

export function pathEligible(createdAt: number): boolean {
  return createdAt >= PATH_SINCE;
}

/** What is true of the account. Undefined is unknown, never false. */
export type PathFacts = {
  avatarSet: boolean;
  usernameSet: boolean;
  hasEmail: boolean;
  /** Enough to place an order is (or was once proven) in the account. */
  funded: boolean | undefined;
  /** A buy of a stock or fund has filled. */
  firstBuy: boolean | undefined;
  /** A friend link or invite went out, or a friend joined through one. */
  inviteSent: boolean;
  /**
   * Every friend feature is on, or "Turn on all friend features" was used
   * once (its XP is in the ledger): either way the friends step is done.
   */
  friendsOn: boolean;
};

/** The server's record of the path for one account. */
export type PathRecord = {
  /** Made since the path began (PATH_SINCE). */
  eligible: boolean;
  skipped: readonly PathStep[];
  /** "You're set up" was closed: the path is over for good. */
  finished: boolean;
};

export type PathContext = {
  /** An email account adds money; a wallet account pays from its wallet. */
  account: "email" | "wallet";
  /** Berth can take an order here (lib/availability); false drops the money and buy steps. */
  canBuy: boolean;
};

export type StepState = "done" | "skipped" | "open" | "unknown";

export type StepStatus = { step: PathStep; state: StepState };

export type PathView =
  /** Not on the path: established, finished, or the record says so. */
  | { kind: "off" }
  /** What decides the current step is not known yet: hold its place. */
  | { kind: "wait" }
  | { kind: "step"; step: PathStep; index: number; total: number; steps: readonly StepStatus[] }
  /** Every step done or set aside: "You're set up", until it is closed. */
  | { kind: "complete"; skipped: readonly PathStep[]; total: number; steps: readonly StepStatus[] };

/** What /api/first-path answers (lib/server/first-path): the record and the facts the server holds. */
export type FirstPathResponse = {
  eligible: boolean;
  skipped: PathStep[];
  finished: boolean;
  /** Came on a friend's invite: the first buy also pays invite_accepted. */
  referred: boolean;
  facts: {
    avatarSet: boolean;
    usernameSet: boolean;
    hasEmail: boolean;
    /** Enough to buy was seen in the account once, on any device. */
    funded: boolean;
    /** A buy of a stock or fund filled (the ledger). */
    firstBuy: boolean;
    inviteSent: boolean;
    /** Every friend feature on, or the friends_all_on XP paid once. */
    friendsOn: boolean;
  };
};

/** The steps this account walks, in order. */
export function stepsFor(context: PathContext): readonly PathStep[] {
  return context.canBuy ? PATH_STEPS : PATH_STEPS.filter((step) => step !== "money" && step !== "firstBuy");
}

/** Whether a fact proves the step, before any skip is counted. */
function factState(step: PathStep, facts: PathFacts): "done" | "open" | "unknown" {
  switch (step) {
    case "avatar":
      return facts.avatarSet ? "done" : "open";
    case "username":
      return facts.usernameSet ? "done" : "open";
    case "friends":
      // Like the invite: without a username the step is open with nothing to
      // turn on yet, and the card offers the username.
      return facts.friendsOn ? "done" : "open";
    case "money":
      // A filled buy proves there was money; otherwise the balances decide.
      if (facts.firstBuy === true || facts.funded === true) return "done";
      return facts.funded === undefined ? "unknown" : "open";
    case "firstBuy":
      if (facts.firstBuy === true) return "done";
      return facts.firstBuy === undefined ? "unknown" : "open";
    case "invite":
      // A friend link needs a username. Without one the step is open but
      // has nothing to share yet; the card says so and offers the username.
      return facts.inviteSent ? "done" : "open";
  }
}

export function stepStates(facts: PathFacts, record: Pick<PathRecord, "skipped">, context: PathContext): StepStatus[] {
  return stepsFor(context).map((step) => {
    const state = factState(step, facts);
    // A fact beats a skip: a step proven done is done, however it was set aside.
    if (state !== "done" && record.skipped.includes(step)) return { step, state: "skipped" };
    return { step, state };
  });
}

/**
 * The one view of the path. `record` undefined means the server has not
 * answered yet: wait rather than guess, so an established account is never
 * shown a step and a new one never flashes the plain home first.
 */
export function firstPath({
  facts,
  record,
  context,
}: {
  facts: PathFacts;
  record: PathRecord | undefined;
  context: PathContext;
}): PathView {
  if (record === undefined) return { kind: "wait" };
  if (!record.eligible || record.finished) return { kind: "off" };
  const steps = stepStates(facts, record, context);
  const total = steps.length;
  const current = steps.findIndex((status) => status.state === "open" || status.state === "unknown");
  if (current === -1) {
    return { kind: "complete", skipped: steps.filter((s) => s.state === "skipped").map((s) => s.step), total, steps };
  }
  if (steps[current].state === "unknown") return { kind: "wait" };
  return { kind: "step", step: steps[current].step, index: current + 1, total, steps };
}

/** Whether the path is on screen (a step, or "You're set up"). */
export function pathLive(view: PathView): view is Extract<PathView, { kind: "step" | "complete" }> {
  return view.kind === "step" || view.kind === "complete";
}

/** The record after a skip. Skipping twice is skipping once. */
export function withSkip(skipped: readonly PathStep[], step: PathStep): PathStep[] {
  return skipped.includes(step) ? [...skipped] : [...skipped, step];
}

/** The record after an unskip: the step comes back to its place in the order. */
export function withoutSkip(skipped: readonly PathStep[], step: PathStep): PathStep[] {
  return skipped.filter((other) => other !== step);
}

/**
 * The step that was just finished, when the view moved on because a fact
 * proved it (the Done moment). A skip, a step that was never current, or a
 * view that did not move answers null.
 */
export function finishedStep(previous: PathView, next: PathView): PathStep | null {
  if (previous.kind !== "step") return null;
  if (next.kind === "step" && next.step === previous.step) return null;
  if (next.kind !== "step" && next.kind !== "complete") return null;
  const status = next.steps.find((s) => s.step === previous.step);
  return status?.state === "done" ? previous.step : null;
}

/**
 * The XP a step earns, from the existing award paths only (lib/xp): the path
 * itself pays nothing, so nothing is ever paid twice. The first avatar pays
 * avatar_set, the first username username_set, turning on every friend
 * feature friends_all_on (paid by the act itself, once); the first buy pays pour_in, and invite_accepted too for an
 * account that came on a friend's invite. The invite step shares the friend
 * link, which pays no XP (friend_links); friend_stayed belongs to the invite
 * code, which opens at level 3 (ADR-0002, ADR-0004), so the step promises
 * none. Adding money pays nothing.
 */
export function stepXp(step: PathStep, { referred }: { referred: boolean }): number | null {
  switch (step) {
    case "avatar":
      return XP_ACTIONS.avatar_set.amount;
    case "username":
      return XP_ACTIONS.username_set.amount;
    case "friends":
      return XP_ACTIONS.friends_all_on.amount;
    case "firstBuy":
      return XP_ACTIONS.pour_in.amount + (referred ? XP_ACTIONS.invite_accepted.amount : 0);
    default:
      return null;
  }
}

/**
 * An established account (never on the path) keeps one quiet drawer
 * prompt for what it lacks: a face, then a username (which needs an email
 * on the account). Never an invite, never more than one, and nothing for a
 * path account, whose drawer step is the path's own.
 */
export function establishedPrompt(facts: Pick<PathFacts, "avatarSet" | "usernameSet" | "hasEmail">): "avatar" | "username" | null {
  if (!facts.avatarSet) return "avatar";
  if (facts.hasEmail && !facts.usernameSet) return "username";
  return null;
}

/**
 * What the home draws in the path's place (components/home HomeTracks):
 * its card while it is on screen, a held place while it is read, so
 * nothing below it moves when it lands (in every stage, the total and what
 * is owned included), or nothing.
 */
export function pathPlace(path: { shown: boolean; waiting: boolean } | undefined): "card" | "hold" | null {
  if (!path) return null;
  if (path.shown) return "card";
  return path.waiting ? "hold" : null;
}

/** How the path's first buy step may speak (components/first-path, components/home). */
export type BuyStepState = {
  /** No spendable money is known: say "you can add money there", never claim money. */
  unfunded: boolean;
  /** The balances are still being read: hold the line's place. */
  loading: boolean;
  /** The buy will earn its XP, so the XP line may stand beside Buy. */
  earnsXp: boolean;
};

/**
 * `everFunded` is the path's fact (money seen once, on any device, never
 * cleared); `stage` is the home's decided stage and `liveStage` what this
 * visit's balances prove. Money seen once but not spendable now (parked as
 * cash, waiting in a limit order, withdrawn, funded elsewhere) is unfunded,
 * so the step never shows a line that waits for good. The XP line stands
 * only when this visit proved spendable money in the account's own wallets,
 * which are the payers a buy's XP is paid for (lib/server/pour-ownership);
 * otherwise no line promises it.
 */
export function buyStepState({
  everFunded,
  stage,
  liveStage,
}: {
  everFunded: boolean | undefined;
  stage: "empty" | "funded" | "owns" | undefined;
  liveStage: "empty" | "funded" | "owns" | undefined;
}): BuyStepState {
  const unfunded = everFunded !== true || stage === "empty" || liveStage === "empty";
  return { unfunded, loading: !unfunded && liveStage === undefined, earnsXp: !unfunded && liveStage === "funded" };
}

/**
 * Nudge lines the path already says while it is on screen. Only the news
 * about something held (Jev's line) stays: it is about the person's own
 * stock, not a second thing to do.
 */
export const NUDGES_SAID_BY_PATH: readonly NudgeKind[] = ["addFunds", "firstBuy", "parkCash", "invite"];
