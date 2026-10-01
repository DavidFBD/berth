import { getSql } from "@/lib/server/db";
import { monthlyBudgetMicros } from "@/lib/server/chat/limits";
import { dailyPostCap } from "@/lib/x-schedule";
import { deliver } from "@/lib/server/email/send";
import { staffAdminIds } from "@/lib/server/staff-gate";
import { alertRef, anyLow, meterStatus, type MeterInput, type MeterStatus } from "@/lib/staff/budget-math";

/**
 * What Berth's paid services have cost and what is left (the staff Budgets
 * page, and the morning run's alert). Each figure comes from the cheapest
 * true source Berth has, and says which:
 *
 * - The Assistant (OpenAI, GPT-6 Luna): chat_usage, cost per message at
 *   the documented token prices (lib/server/chat/prices), against the house
 *   budget CHAT_MONTHLY_BUDGET_USD; and, if staff entered one, the prepaid
 *   credit. OpenAI's own bill is shown beside it when OPENAI_ADMIN_KEY is
 *   set (the organization costs API, an admin key, read only).
 * - Jev (TypeSafe): service_spend, metered per call by its size, since
 *   TypeSafe has no usage or balance endpoint. Prepaid credit as entered.
 * - X: x_read_budget, posts read per UTC day at $0.005 a post (measured
 *   2026-09-30), against X_DAILY_POST_CAP; prepaid credit as entered; X's
 *   own count from GET /2/usage/tweets when X_BEARER_TOKEN is set.
 * - Resend: email_sends sent, against the plan's quota (RESEND_DAILY_QUOTA,
 *   RESEND_MONTHLY_QUOTA, free plan 100 and 3,000 by default).
 * - Neon and Vercel: not tracked. Both usage APIs are for paid plans only.
 */

export const SERVICES = ["openai", "jev", "x", "resend", "neon", "vercel"] as const;
export type ServiceId = (typeof SERVICES)[number];
export const TRACKED_SERVICES = ["openai", "jev", "x", "resend"] as const satisfies readonly ServiceId[];
export type TrackedService = (typeof TRACKED_SERVICES)[number];

export function isTrackedService(value: unknown): value is TrackedService {
  return typeof value === "string" && (TRACKED_SERVICES as readonly string[]).includes(value);
}

/** X's price per post read, per UTC day (reports/x-cost-fix.md). */
export const X_USD_PER_POST = 0.005;

export type MeterRow = MeterStatus & { id: "budget" | "credit" | "cap" | "quota" | "day" };

export type BudgetSettings = { balanceUsd: number | null; balanceAt: string | null; threshold: number | null; updatedAt: string | null };

export type ServiceBudget = {
  id: ServiceId;
  tracked: boolean;
  meters: MeterRow[];
  low: boolean;
  settings: BudgetSettings;
};

const EMPTY_SETTINGS: BudgetSettings = { balanceUsd: null, balanceAt: null, threshold: null, updatedAt: null };

function envNumber(raw: string | undefined, fallback: number): number {
  const value = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** A threshold from the environment (BUDGET_THRESHOLD_JEV and so on), in the service's own unit. */
export function envThreshold(service: TrackedService, env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env[`BUDGET_THRESHOLD_${service.toUpperCase()}`];
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

async function readSettings(): Promise<Map<string, BudgetSettings>> {
  const rows = (await getSql().query(`select service, balance_usd, balance_at, threshold, updated_at from staff_budgets`)) as {
    service: string;
    balance_usd: string | number | null;
    balance_at: string | null;
    threshold: string | number | null;
    updated_at: string | null;
  }[];
  return new Map(
    rows.map((row) => [
      row.service,
      {
        balanceUsd: row.balance_usd === null ? null : Number(row.balance_usd),
        balanceAt: row.balance_at ? new Date(row.balance_at).toISOString() : null,
        threshold: row.threshold === null ? null : Number(row.threshold),
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      },
    ]),
  );
}

type Usage = { today: number; month: number; last7: number; since: number };

/**
 * One statement for every meter's sums. Days are UTC; "since" is from the
 * moment the balance was read for chat_usage, and from that UTC day for the
 * day rows (a day's spend before the reading counts, which errs low on
 * what is left, never high).
 */
async function readUsage(since: Record<"openai" | "jev" | "x", string | null>, now: Date): Promise<Record<TrackedService, Usage>> {
  const rows = (await getSql().query(
    `with t as (select ($1::timestamptz at time zone 'UTC')::date as today)
     select
       (select coalesce(sum(cost_micros), 0)::float8 from chat_usage, t where created_at >= t.today::timestamp at time zone 'UTC') as ai_today,
       (select coalesce(sum(cost_micros), 0)::float8 from chat_usage, t where created_at >= date_trunc('month', t.today)::timestamp at time zone 'UTC') as ai_month,
       (select coalesce(sum(cost_micros), 0)::float8 from chat_usage, t where created_at >= (t.today - 6)::timestamp at time zone 'UTC') as ai_last7,
       (select coalesce(sum(cost_micros), 0)::float8 from chat_usage where $2::timestamptz is not null and created_at >= $2::timestamptz) as ai_since,
       (select coalesce(sum(cost_micros), 0)::float8 from service_spend, t where service = 'jev' and day = t.today) as jev_today,
       (select coalesce(sum(cost_micros), 0)::float8 from service_spend, t where service = 'jev' and day >= date_trunc('month', t.today)::date) as jev_month,
       (select coalesce(sum(cost_micros), 0)::float8 from service_spend, t where service = 'jev' and day >= t.today - 6) as jev_last7,
       (select coalesce(sum(cost_micros), 0)::float8 from service_spend where service = 'jev' and $3::timestamptz is not null and day >= ($3::timestamptz at time zone 'UTC')::date) as jev_since,
       (select coalesce(sum(used), 0)::int from x_read_budget, t where day = to_char(t.today, 'YYYY-MM-DD')) as x_today,
       (select coalesce(sum(used), 0)::int from x_read_budget, t where day >= to_char(date_trunc('month', t.today), 'YYYY-MM-DD')) as x_month,
       (select coalesce(sum(used), 0)::int from x_read_budget, t where day >= to_char(t.today - 6, 'YYYY-MM-DD')) as x_last7,
       (select coalesce(sum(used), 0)::int from x_read_budget where $4::timestamptz is not null and day >= to_char(($4::timestamptz at time zone 'UTC')::date, 'YYYY-MM-DD')) as x_since,
       (select count(*)::int from email_sends, t where status = 'sent' and created_at >= t.today::timestamp at time zone 'UTC') as mail_today,
       (select count(*)::int from email_sends, t where status = 'sent' and created_at >= date_trunc('month', t.today)::timestamp at time zone 'UTC') as mail_month,
       (select count(*)::int from email_sends, t where status = 'sent' and created_at >= (t.today - 6)::timestamp at time zone 'UTC') as mail_last7`,
    [now.toISOString(), since.openai, since.jev, since.x],
  )) as Record<string, number>[];
  const row = rows[0] ?? {};
  const usd = (micros: unknown) => Number(micros ?? 0) / 1_000_000;
  const posts = (value: unknown) => Number(value ?? 0);
  return {
    openai: { today: usd(row.ai_today), month: usd(row.ai_month), last7: usd(row.ai_last7), since: usd(row.ai_since) },
    jev: { today: usd(row.jev_today), month: usd(row.jev_month), last7: usd(row.jev_last7), since: usd(row.jev_since) },
    x: { today: posts(row.x_today), month: posts(row.x_month), last7: posts(row.x_last7), since: posts(row.x_since) },
    resend: { today: Number(row.mail_today ?? 0), month: Number(row.mail_month ?? 0), last7: Number(row.mail_last7 ?? 0), since: 0 },
  };
}

/** The budgets as they stand at `now`. */
export async function readBudgets(now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<ServiceBudget[]> {
  const settings = await readSettings();
  const of = (id: ServiceId) => settings.get(id) ?? EMPTY_SETTINGS;
  const usage = await readUsage({ openai: of("openai").balanceAt, jev: of("jev").balanceAt, x: of("x").balanceAt }, now);
  const threshold = (id: TrackedService) => of(id).threshold ?? envThreshold(id, env);
  const meter = (id: MeterRow["id"], input: MeterInput): MeterRow => ({ id, ...meterStatus(input, now) });
  const credit = (id: "openai" | "jev" | "x", use: Usage, toUsd = (value: number) => value): MeterRow | null => {
    const set = of(id);
    if (set.balanceUsd === null) return null;
    return meter("credit", {
      kind: "prepaid",
      unit: "usd",
      today: toUsd(use.today),
      month: toUsd(use.month),
      last7: toUsd(use.last7),
      balance: set.balanceUsd,
      sinceBalance: toUsd(use.since),
      threshold: threshold(id),
    });
  };
  const xUsd = (posts: number) => posts * X_USD_PER_POST;

  const openai: MeterRow[] = [
    meter("budget", {
      kind: "monthly",
      unit: "usd",
      ...pick(usage.openai),
      limit: monthlyBudgetMicros(env.CHAT_MONTHLY_BUDGET_USD) / 1_000_000,
      threshold: threshold("openai"),
    }),
  ];
  const openaiCredit = credit("openai", usage.openai);
  if (openaiCredit) openai.push(openaiCredit);

  const jevCredit = credit("jev", usage.jev);
  const jev: MeterRow[] = jevCredit
    ? [jevCredit]
    : [meter("credit", { kind: "prepaid", unit: "usd", ...pick(usage.jev), balance: null, threshold: threshold("jev") })];

  const xCredit = credit("x", usage.x, xUsd);
  const x: MeterRow[] = [
    xCredit ?? meter("credit", { kind: "prepaid", unit: "usd", today: xUsd(usage.x.today), month: xUsd(usage.x.month), last7: xUsd(usage.x.last7), balance: null, threshold: threshold("x") }),
    meter("cap", { kind: "daily", unit: "posts", ...pick(usage.x), limit: dailyPostCap(env.X_DAILY_POST_CAP) }),
  ];

  const resend: MeterRow[] = [
    meter("quota", { kind: "monthly", unit: "emails", ...pick(usage.resend), limit: envNumber(env.RESEND_MONTHLY_QUOTA, 3000), threshold: threshold("resend") }),
    meter("day", { kind: "daily", unit: "emails", ...pick(usage.resend), limit: envNumber(env.RESEND_DAILY_QUOTA, 100) }),
  ];

  const tracked = (id: TrackedService, meters: MeterRow[]): ServiceBudget => ({ id, tracked: true, meters, low: anyLow(meters), settings: of(id) });
  return [
    tracked("openai", openai),
    tracked("jev", jev),
    tracked("x", x),
    tracked("resend", resend),
    { id: "neon", tracked: false, meters: [], low: false, settings: EMPTY_SETTINGS },
    { id: "vercel", tracked: false, meters: [], low: false, settings: EMPTY_SETTINGS },
  ];
}

function pick(use: Usage): Pick<MeterInput, "today" | "month" | "last7"> {
  return { today: use.today, month: use.month, last7: use.last7 };
}

export type ProviderChecks = {
  /** OpenAI's own bill this month in USD, from the organization costs API; null when not configured or not read. */
  openaiMonthUsd: number | null;
  openaiConfigured: boolean;
  /** X's own count of posts this billing cycle, and its cap. */
  xUsage: { used: number; cap: number | null; resetDay: number | null } | null;
  xConfigured: boolean;
};

const PROVIDER_TIMEOUT_MS = 5_000;

/** The providers' own figures, read only, cached five minutes. Never throws; a key never leaves the request. */
export async function readProviderChecks(now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<ProviderChecks> {
  const adminKey = env.OPENAI_ADMIN_KEY?.trim();
  const bearer = env.X_BEARER_TOKEN?.trim();
  const [openaiMonthUsd, xUsage] = await Promise.all([
    adminKey ? openaiMonthCost(adminKey, now) : Promise.resolve(null),
    bearer ? xUsageNow(bearer) : Promise.resolve(null),
  ]);
  return { openaiMonthUsd, openaiConfigured: Boolean(adminKey), xUsage, xConfigured: Boolean(bearer) };
}

async function openaiMonthCost(key: string, now: Date): Promise<number | null> {
  try {
    const start = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
    const response = await fetch(`https://api.openai.com/v1/organization/costs?start_time=${start}&bucket_width=1d&limit=31`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      next: { revalidate: 300 },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: { results?: { amount?: { value?: unknown } }[] }[] };
    let total = 0;
    for (const bucket of body.data ?? []) for (const result of bucket.results ?? []) total += Number(result.amount?.value ?? 0) || 0;
    return total;
  } catch {
    return null;
  }
}

async function xUsageNow(bearer: string): Promise<ProviderChecks["xUsage"]> {
  try {
    const response = await fetch("https://api.x.com/2/usage/tweets", {
      headers: { authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      next: { revalidate: 300 },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: { project_usage?: unknown; project_cap?: unknown; cap_reset_day?: unknown } };
    const data = body.data ?? {};
    const used = Number(data.project_usage);
    if (!Number.isFinite(used)) return null;
    const cap = Number(data.project_cap);
    const reset = Number(data.cap_reset_day);
    return { used, cap: Number.isFinite(cap) ? cap : null, resetDay: Number.isFinite(reset) ? reset : null };
  } catch {
    return null;
  }
}

export type BudgetAlertSummary = { low: number; sent: number; already: number; failed: number };

/** "$1.20", "300 emails": what is left, as the alert email says it. */
export function remainingLine(meter: MeterStatus): string {
  const value = meter.remaining ?? 0;
  if (meter.unit === "usd") return `$${Math.max(0, value).toFixed(2)}`;
  return `${Math.max(0, Math.floor(value)).toLocaleString("en-US")} ${meter.unit}`;
}

/**
 * The morning run's budget stage: for every service that is low, one email
 * to each staff admin, at most once per service per admin per UTC day
 * (email_sends' unique (type, ref), ref from alertRef). A security type
 * notice, so no daily cap stops it; it still respects suppression and the
 * kill switch.
 */
export async function runBudgetAlerts({
  now = new Date(),
  send = deliver,
  admins = staffAdminIds(),
}: { now?: Date; send?: typeof deliver; admins?: readonly string[] } = {}): Promise<BudgetAlertSummary> {
  const budgets = await readBudgets(now);
  const summary: BudgetAlertSummary = { low: 0, sent: 0, already: 0, failed: 0 };
  for (const service of budgets) {
    if (!service.low) continue;
    summary.low += 1;
    const meter = service.meters.find((row) => row.low)!;
    for (const admin of admins) {
      const outcome = await send({
        userId: admin,
        ref: alertRef(service.id, admin, now),
        notice: {
          type: "budget_low",
          service: service.id as TrackedService,
          remaining: remainingLine(meter),
          daysLeft: meter.daysLeft === null ? null : Math.max(0, Math.floor(meter.daysLeft)),
          estimate: meter.estimate,
        },
      }).catch(() => "failed" as const);
      if (outcome === "sent") summary.sent += 1;
      else if (outcome === "duplicate") summary.already += 1;
      else summary.failed += 1;
    }
  }
  return summary;
}
