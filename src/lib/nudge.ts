/**
 * The one line under the account total that says what might be worth doing
 * next, and the rules for which lines may be said at all.
 *
 * Pure, and shared by both sides of the wire. The client reports a handful of
 * yes/no facts about the account; the server decides which lines are
 * eligible here, in code, and only then lets Jev pick among them
 * (lib/server/nudge). That order is the whole safety argument: Jev never sees
 * a line it could pick wrongly for this account, it only chooses which true
 * thing is most useful to say. The words themselves live in copy.ts, and Jev
 * cannot write any.
 *
 * Deliberately not money advice. No line says buy or sell a name, and the
 * news line says only that there is news about something the person already
 * holds, and where to read it.
 */

export const NUDGE_KINDS = [
  "addFunds",
  "firstBuy",
  "heldNews",
  "parkCash",
  "invite",
] as const;
export type NudgeKind = (typeof NUDGE_KINDS)[number];

/** What the client tells the server. Bounded on purpose: see `parseFacts`. */
export type NudgeFacts = {
  /** Symbols of every listing held, cash included. */
  held: string[];
  /** Spendable dollars above dust are sitting in the account. */
  funds: boolean;
  /** The account's rank has unlocked its invite link. */
  canInvite: boolean;
  /**
   * The account is an external wallet rather than an email account. "Add
   * funds by card, bank or crypto" is the email account's top-up drawer and
   * is not true of a wallet, which is funded from outside Berth.
   */
  wallet: boolean;
  /** Lines this person dismissed recently, so the next true one is said instead. */
  skip: NudgeKind[];
};

export type Nudge =
  | { kind: "heldNews"; symbol: string; name: string; postUrl: string }
  | { kind: Exclude<NudgeKind, "heldNews"> };

export type NudgeResponse = { nudge: Nudge | null };

export const CASH_SYMBOL = "SGOV";

/**
 * Which lines are true of this account, in the order they are said when Jev
 * does not answer. News about something held comes first because it is the
 * only one that changes day to day; the rest are standing facts the person
 * already knows by the second visit, which is also why they can be dismissed.
 */
export function eligibleKinds(facts: NudgeFacts, hasHeldNews: boolean): NudgeKind[] {
  const stocks = facts.held.filter((symbol) => symbol !== CASH_SYMBOL);
  const kinds: NudgeKind[] = [];
  const say = (kind: NudgeKind) => {
    if (!facts.skip.includes(kind)) kinds.push(kind);
  };
  if (hasHeldNews) say("heldNews");
  if (!facts.funds && facts.held.length === 0 && !facts.wallet) say("addFunds");
  if (facts.funds && stocks.length === 0) say("firstBuy");
  if (facts.funds && stocks.length > 0 && !facts.held.includes(CASH_SYMBOL)) {
    say("parkCash");
  }
  if (facts.canInvite) say("invite");
  return kinds;
}

/**
 * The query string, read strictly. Every fact is a known symbol or a flag,
 * so the number of distinct questions anyone can make the server ask Jev is
 * finite and small, and each is cached: the endpoint cannot be used to spend
 * the credit by varying the input.
 */
export function parseFacts(
  params: URLSearchParams,
  knownSymbols: ReadonlySet<string>,
): NudgeFacts {
  const held = (params.get("held") ?? "")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => knownSymbols.has(symbol));
  const skip = (params.get("skip") ?? "")
    .split(",")
    .filter((kind): kind is NudgeKind => (NUDGE_KINDS as readonly string[]).includes(kind));
  return {
    held: [...new Set(held)].sort(),
    funds: params.get("funds") === "1",
    canInvite: params.get("invite") === "1",
    wallet: params.get("wallet") === "1",
    skip: [...new Set(skip)].sort(),
  };
}

export function factsQuery(facts: NudgeFacts): string {
  const params = new URLSearchParams();
  if (facts.held.length > 0) params.set("held", [...facts.held].sort().join(","));
  if (facts.funds) params.set("funds", "1");
  if (facts.canInvite) params.set("invite", "1");
  if (facts.wallet) params.set("wallet", "1");
  if (facts.skip.length > 0) params.set("skip", [...facts.skip].sort().join(","));
  return params.toString();
}

/**
 * How long a dismissed line stays away. A standing fact for a week, since it
 * will still be true and saying it daily is nagging; news for a day, since
 * tomorrow's is different news.
 */
export function dismissFor(kind: NudgeKind): number {
  const day = 24 * 60 * 60 * 1000;
  return kind === "heldNews" ? day : 7 * day;
}

/** Kinds still inside their dismissal window, from a map of kind to when. */
export function activeSkips(
  dismissed: Partial<Record<string, number>>,
  now: number,
): NudgeKind[] {
  return NUDGE_KINDS.filter((kind) => {
    const at = dismissed[kind];
    return typeof at === "number" && now - at < dismissFor(kind);
  });
}
