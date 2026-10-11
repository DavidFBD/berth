import { COPY } from "@/lib/copy";
import type { WalletFamily } from "@/lib/identity/caip";
import type { EmailKind } from "@/lib/email-kinds";
import { shortenAddress } from "@/lib/format";
import { DRAWER_LINK_PARAM, DRAWER_LINK_VIEW } from "@/lib/drawer-return";

/**
 * What each notice says, as data: the layout (template.tsx) renders it as
 * HTML and as plain text. Pure, so the words and what they may contain are
 * testable without a mail provider. A notice never carries the recipient's
 * email address, a full wallet address, or an account id.
 */

export type Notice =
  | { type: "wallet_added"; family: WalletFamily; address: string }
  | { type: "wallet_removed"; family: WalletFamily; address: string }
  | { type: "accounts_merged" }
  | { type: "assistant_connected"; app: string; scopes: readonly string[] }
  | {
      type: "order_filled";
      side: "buy" | "sell";
      /** The listing's plain name, never the ticker. */
      name: string;
      /** The limit price, formatted: "$198.20". */
      price: string;
      /** What arrived, formatted with its unit, when known: "0.5046 NVIDIA", "99.40 USDC". */
      received: string | null;
    }
  | { type: "order_expired"; side: "buy" | "sell"; name: string }
  | { type: "friend_request"; username: string }
  /** To every staff admin: a campaign's payout source was added or removed (lib/server/campaigns). */
  | { type: "payout_source_changed"; change: "added" | "removed"; campaign: string; address: string; reason: string }
  /** A campaign claim was paid, by hand (lib/server/campaigns). Amount formatted: "$5". */
  | { type: "campaign_paid"; amount: string; chain: string }
  | {
      /** To staff admins only (lib/server/staff/budgets). Names a service and a sum, never a person. */
      type: "budget_low";
      service: "openai" | "jev" | "x" | "resend";
      /** Formatted: "$1.20", "300 emails". */
      remaining: string;
      /** Whole days at the last week's pace, or null when nothing is being used. */
      daysLeft: number | null;
      /** Whether the remaining figure is Berth's own estimate. */
      estimate: boolean;
    }
  | {
      /** To the other staff admins (lib/server/staff/reveal-limit): one staff member's reveals in the last hour. */
      type: "staff_reveals";
      count: number;
      /** The staff account id's first eight characters, never a name or an address. */
      staff: string;
    }
  | {
      /**
       * To staff admins only (lib/server/quote-canary): the quote canary
       * failed twice in a row in US market hours. Pairs and the solver's
       * own words, never a person.
       */
      type: "quotes_down";
      /** Only stock routes refused with -4 while the crypto control quoted. */
      solverSide: boolean;
      failed: number;
      total: number;
      /** One failing pair and the solver's answer, cut short: "USDC on Base to NVDA: -4 No path was found". */
      example: string;
    }
  | {
      /**
       * To staff admins only (lib/server/feedback): someone sent a message
       * from the feedback sheet. Its first words, never who sent it.
       */
      type: "feedback_new";
      excerpt: string;
      /** Opened after an order that failed or whose outcome was unclear. */
      fromOrder: boolean;
    }
  | {
      /**
       * To the person who wrote, once, when staff mark their message fixed
       * and they said yes to a reply (lib/server/feedback markFeedback).
       */
      type: "feedback_fixed";
      excerpt: string;
    }
  | WeeklyNotice;

/**
 * The weekly summary (lib/server/weekly), every value already formatted.
 * A part is null (or the list empty) when the app has nothing it trusts
 * to say there; that section is then left out of the email.
 */
export type WeeklyNotice = {
  type: "weekly";
  /** The week's Monday: "22 September". */
  weekOf: string;
  /** The last close the week has: "Friday 26 September"; null when no day of it is stored. */
  closeDay: string | null;
  account: {
    /** "$1,234.56" */
    worth: string;
    /** "+1.24%", or null when the change cannot be told (money moved without an order, a week not yet filled). */
    change: string | null;
    /** The benchmark's name and its change over the same days, or null when the app would not show one. */
    benchmark: { name: string; change: string } | null;
  } | null;
  /** Largest first; the listing's plain name, never the ticker. `move` is the price's change over the week. */
  holdings: { name: string; worth: string; move: string | null }[];
  /**
   * What the list leaves out (past the largest, or not a listing Berth
   * names), as a count and a worth, so the rows add up to the account's
   * worth. Absent or null when nothing is left out (older stored notices
   * have no such field).
   */
  holdingsRest?: { count: number; worth: string } | null;
  /**
   * What filled this week (the app's order log: buys and sells, a filled
   * limit order among them), how many of those were limit orders (a part
   * of buys + sells, never more), and limit orders that expired unfilled.
   */
  orders: { buys: number; sells: number; limitsFilled: number; limitsExpired: number } | null;
  friends: { added: number; salutes: number } | null;
};

export type NoticeType = Notice["type"];

export const NOTICE_KIND: Readonly<Record<NoticeType, EmailKind>> = {
  wallet_added: "security",
  wallet_removed: "security",
  accounts_merged: "security",
  assistant_connected: "security",
  order_filled: "orders",
  order_expired: "orders",
  friend_request: "friends",
  // A reward paid to the account: about the person's own money, sent whatever the switches say
  // (no unsubscribe), so a person who turned order emails off still hears they were paid.
  campaign_paid: "account",
  // Who may send campaign money is a security matter for staff: no switch.
  payout_source_changed: "security",
  weekly: "weekly",
  budget_low: "security",
  staff_reveals: "security",
  quotes_down: "security",
  // Staff only; under the day's volume guard like any account notice, and
  // capped per day in lib/server/feedback, so it never crowds out security.
  feedback_new: "account",
  // The person asked for this reply in the sheet: sent whatever the switches say, once.
  feedback_fixed: "account",
};

export type EmailContent = {
  kind: EmailKind;
  subject: string;
  /** The inbox preview line. */
  preview: string;
  heading: string;
  paragraphs: string[];
  list?: string[];
  after?: string[];
  /** Label and value pairs, values in the mono face (prices, amounts). */
  facts?: { label: string; value: string }[];
  /** Titled groups of facts, after everything above (the weekly summary). */
  sections?: {
    heading: string;
    /** `aside` is a second, quieter value beside the first (a holding's move). */
    facts: { label: string; value: string; aside?: string }[];
    /** One small line under the group, saying what its numbers are. */
    note?: string;
  }[];
  button: { label: string; href: string };
  /** Why this email arrived. */
  why: string;
};

/** Anything a person or a client named (an app name, a username) is cut short and kept to one line. */
function plain(value: string, max = 60): string {
  const flat = value.replace(/[\r\n\t]+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function composeNotice(notice: Notice, baseUrl: string): EmailContent {
  const email = COPY.email;
  const kind = NOTICE_KIND[notice.type];
  const button = { label: email.openBerth, href: `${baseUrl}/` };
  const why = kind === "security" ? email.securityWhy : kind === "account" ? email.accountWhy : email.why[kind];
  switch (notice.type) {
    case "wallet_added":
    case "wallet_removed": {
      const words = notice.type === "wallet_added" ? email.walletAdded : email.walletRemoved;
      const body = words.body(email.family[notice.family], shortenAddress(notice.address));
      return { kind, subject: words.subject, preview: body, heading: words.heading, paragraphs: [body], button, why };
    }
    case "accounts_merged":
      return {
        kind,
        subject: email.accountsMerged.subject,
        preview: email.accountsMerged.body,
        heading: email.accountsMerged.heading,
        paragraphs: [email.accountsMerged.body],
        button,
        why,
      };
    case "assistant_connected": {
      const app = plain(notice.app);
      const words = email.assistantConnected;
      const list = (["read", "draft"] as const)
        .filter((scope) => notice.scopes.includes(`berth.${scope}`))
        .map((scope) => words.scopes[scope]);
      return {
        kind,
        subject: words.subject(app),
        preview: words.body(app).replace(/:$/, "."),
        heading: words.heading,
        paragraphs: [words.body(app)],
        list,
        after: [words.after],
        button,
        why,
      };
    }
    case "order_filled": {
      const words = email.orderFilled;
      const body = words.body(notice.name, notice.side, notice.price);
      const facts = [{ label: words.priceLabel, value: notice.price }];
      if (notice.received) facts.push({ label: words.receivedLabel, value: notice.received });
      return { kind, subject: words.subject(notice.name, notice.side), preview: body, heading: words.heading, paragraphs: [body], facts, button, why };
    }
    case "order_expired": {
      const words = email.orderExpired;
      const body = words.body(notice.name, notice.side);
      return { kind, subject: words.subject(notice.name, notice.side), preview: body, heading: words.heading, paragraphs: [body], button, why };
    }
    case "friend_request": {
      const words = email.friendRequest;
      const username = plain(notice.username, 32);
      const body = words.body(username);
      // Lands on the drawer's Friends screen, where the request waits (lib/drawer-return DRAWER_LINK_PARAM).
      return {
        kind,
        subject: words.subject(username),
        preview: body,
        heading: words.heading,
        paragraphs: [body],
        button: { ...button, href: `${baseUrl}/?${DRAWER_LINK_PARAM}=${DRAWER_LINK_VIEW}` },
        why,
      };
    }
    case "payout_source_changed": {
      const words = email.payoutSource;
      const body = words.body(notice.change, plain(notice.campaign), shortenAddress(notice.address));
      return {
        kind,
        subject: words.subject(notice.change, plain(notice.campaign)),
        preview: body,
        heading: words.heading(notice.change),
        paragraphs: [body],
        facts: [{ label: words.reasonLabel, value: plain(notice.reason, 200) }],
        button: { label: words.button, href: `${baseUrl}/staff/campaigns` },
        why,
      };
    }
    case "campaign_paid": {
      const words = email.campaignPaid;
      const body = words.body(notice.amount, notice.chain);
      return {
        kind,
        subject: words.subject(notice.amount),
        preview: body,
        heading: words.heading,
        paragraphs: [body, words.after],
        button,
        why,
      };
    }
    case "budget_low": {
      const words = email.budgetLow;
      const service = words.service[notice.service];
      const body = words.body(service, notice.remaining, notice.estimate);
      return {
        kind,
        subject: words.subject(service),
        preview: body,
        heading: words.heading,
        paragraphs: notice.daysLeft === null ? [body] : [body, words.runway(notice.daysLeft)],
        after: [words.after],
        button: { label: words.button, href: `${baseUrl}/staff/budgets` },
        why: words.why,
      };
    }
    case "quotes_down": {
      const words = email.quotesDown;
      const body = words.body(notice.failed, notice.total, notice.solverSide);
      return {
        kind,
        subject: words.subject(notice.solverSide),
        preview: body,
        heading: words.heading,
        paragraphs: [body],
        facts: [{ label: words.example, value: plain(notice.example, 140) }],
        after: [notice.solverSide ? words.afterSolver : words.afterOther, words.rate],
        button: { label: words.button, href: `${baseUrl}/staff/health` },
        why: words.why,
      };
    }
    case "staff_reveals": {
      const words = email.staffReveals;
      const body = words.body(plain(notice.staff, 8), notice.count);
      return {
        kind,
        subject: words.subject,
        preview: body,
        heading: words.heading,
        paragraphs: [body],
        after: [words.after],
        button: { label: words.button, href: `${baseUrl}/staff/audit` },
        why: email.budgetLow.why,
      };
    }
    case "feedback_new": {
      const words = email.feedbackNew;
      const body = words.body(notice.fromOrder);
      const said = words.said(plain(notice.excerpt, 300));
      return {
        kind,
        subject: words.subject(notice.fromOrder),
        preview: said,
        heading: words.heading,
        paragraphs: [body, said],
        after: [words.after, words.rate],
        button: { label: words.button, href: `${baseUrl}/staff/feedback` },
        why: words.why,
      };
    }
    case "feedback_fixed": {
      const words = email.feedbackFixed;
      const said = words.body(plain(notice.excerpt, 160));
      return {
        kind,
        subject: words.subject,
        preview: said,
        heading: words.heading,
        paragraphs: [said, words.fixed],
        button,
        why: words.why,
      };
    }
    case "weekly":
      return composeWeekly(notice, { kind, button, why });
  }
}

function composeWeekly(
  notice: WeeklyNotice,
  { kind, button, why }: Pick<EmailContent, "kind" | "button" | "why">,
): EmailContent {
  const words = COPY.email.weeklySummary;
  const sections: NonNullable<EmailContent["sections"]> = [];
  const paragraphs = [words.intro(notice.weekOf, notice.closeDay)];
  if (notice.account) {
    const facts = [{ label: words.account.worth, value: notice.account.worth }];
    if (notice.account.change) facts.push({ label: words.account.change, value: notice.account.change });
    if (notice.account.change && notice.account.benchmark) {
      facts.push({ label: words.account.benchmark(plain(notice.account.benchmark.name)), value: notice.account.benchmark.change });
    }
    sections.push({ heading: words.account.heading, facts });
  }
  const rest = notice.holdingsRest && notice.holdingsRest.count > 0 ? notice.holdingsRest : null;
  if (notice.holdings.length > 0 || rest) {
    const facts: { label: string; value: string; aside?: string }[] = notice.holdings.map((holding) =>
      holding.move ? { label: plain(holding.name), value: holding.worth, aside: holding.move } : { label: plain(holding.name), value: holding.worth },
    );
    if (rest) facts.push({ label: words.holdings.more(rest.count, notice.holdings.length > 0), value: rest.worth });
    sections.push({
      heading: words.holdings.heading,
      facts,
      ...(notice.holdings.some((holding) => holding.move) ? { note: words.holdings.note } : {}),
    });
  }
  if (notice.orders) {
    const facts: { label: string; value: string }[] = [];
    if (notice.orders.buys + notice.orders.sells > 0) {
      const limits = Math.min(notice.orders.limitsFilled, notice.orders.buys + notice.orders.sells);
      facts.push({ label: words.orders.filled, value: words.orders.filledValue(notice.orders.buys, notice.orders.sells, limits) });
    }
    if (notice.orders.limitsExpired > 0) {
      facts.push({ label: words.orders.limits, value: words.orders.limitsValue(notice.orders.limitsExpired) });
    }
    if (facts.length > 0) sections.push({ heading: words.orders.heading, facts });
  }
  if (notice.friends) {
    const facts: { label: string; value: string }[] = [];
    if (notice.friends.added > 0) facts.push({ label: words.friends.added, value: String(notice.friends.added) });
    if (notice.friends.salutes > 0) facts.push({ label: words.friends.salutes, value: String(notice.friends.salutes) });
    if (facts.length > 0) sections.push({ heading: words.friends.heading, facts });
  }
  return {
    kind,
    subject: words.subject(notice.weekOf),
    preview: notice.account && notice.closeDay ? words.previewWorth(notice.account.worth, notice.closeDay) : words.previewPlain,
    heading: words.heading,
    paragraphs,
    sections,
    after: notice.account?.change ? [words.account.changeNote, words.after] : [words.after],
    button,
    why,
  };
}

/** Whether a weekly summary has anything to say: an empty week sends nothing. */
export function weeklyHasContent(notice: WeeklyNotice): boolean {
  return (composeWeekly(notice, { kind: "weekly", button: { label: "", href: "" }, why: "" }).sections ?? []).length > 0;
}
