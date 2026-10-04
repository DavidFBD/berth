/**
 * Product analytics, privacy first (PostHog, EU host). This module is the
 * whole rulebook and has no PostHog import, so every rule is a unit test:
 *
 * - The event catalogue: the only events Berth sends, each with the only
 *   property keys it may carry. Anything else is dropped, here and again in
 *   `scrubEvent`, which runs on every event PostHog is about to send.
 * - Values are short codes (a step, a chain family, a listing symbol, a
 *   bucket), small whole numbers or booleans. Never an amount, a balance,
 *   an address, an email, a username, an intent hash or a headline: a value
 *   shaped like one is refused even under an allowed key.
 * - Amounts only as a bucket (`amountBucket`).
 * - URLs lose their query (bar utm_*), their hash and any personal path
 *   segment (a username, an invite code, a friend link's token).
 *
 * Nothing is sent before consent (lib/analytics-consent): PostHog is not
 * even loaded until then (components/analytics/analytics-root), and `track`
 * is a no op while no sink is attached.
 */

import type { PathStep } from "@/lib/first-path";
import type { HomeStage } from "@/lib/home-stage";
import { readConsent } from "@/lib/analytics-consent";

/** The chain families a pay or receive token can come from (lib/chains getChainType, lower cased). */
export type ChainFamily = string;

export type AmountBucket =
  | "under_10"
  | "10_50"
  | "50_100"
  | "100_250"
  | "250_500"
  | "500_1k"
  | "1k_5k"
  | "5k_plus";

export type OrderType = "market" | "limit";
type OrderProps = { listing: string; chain_family: ChainFamily; order_type: OrderType };

/** Every event Berth may send, and what each carries. */
export type AnalyticsEvents = {
  path_step_shown: { step: PathStep; index: number; total: number };
  path_step_completed: { step: PathStep };
  path_step_skipped: { step: PathStep };
  path_finished: { skipped: number };
  home_stage_shown: { stage: HomeStage };

  buy_drawer_opened: { listing: string; listing_kind: string };
  buy_pay_token_chosen: { chain_family: ChainFamily };
  buy_amount_entered: { amount_bucket: AmountBucket };
  buy_quote_shown: { amount_bucket: AmountBucket };
  buy_sign_requested: OrderProps;
  buy_signed: OrderProps;
  buy_filled: OrderProps;
  buy_failed: OrderProps & { reason: string };

  sell_drawer_opened: { listing: string; listing_kind: string };
  sell_receive_token_chosen: { chain_family: ChainFamily };
  sell_amount_entered: { amount_bucket: AmountBucket };
  sell_quote_shown: { amount_bucket: AmountBucket };
  sell_sign_requested: OrderProps;
  sell_signed: OrderProps;
  sell_filled: OrderProps;
  sell_failed: OrderProps & { reason: string };

  limit_started: { side: "buy" | "sell" };
  limit_saved: { side: "buy" | "sell" };

  account_screen_opened: { screen: string };
  news_story_opened: { listing: string; source_kind: string };
  news_refresh_tapped: Record<string, never>;
  campaign_landed: { campaign: string };
  campaign_step: { step: string };
  first_look_shown: { listing: string; in_news: boolean; moved: boolean };
  invite_link_shared: { surface: string };
  invite_link_copied: { surface: string };
  ai_connect_started: { assistant: string };
  ai_connect_finished: { assistant: string; decision: "approve" | "decline" };
  most_bought_viewed: { rows: number };
};

export type AnalyticsEvent = keyof AnalyticsEvents;

const ORDER_KEYS = ["listing", "chain_family", "order_type"] as const;

/** The allowlist at run time: each event's only property keys. */
export const EVENT_PROPS = {
  path_step_shown: ["step", "index", "total"],
  path_step_completed: ["step"],
  path_step_skipped: ["step"],
  path_finished: ["skipped"],
  home_stage_shown: ["stage"],

  buy_drawer_opened: ["listing", "listing_kind"],
  buy_pay_token_chosen: ["chain_family"],
  buy_amount_entered: ["amount_bucket"],
  buy_quote_shown: ["amount_bucket"],
  buy_sign_requested: ORDER_KEYS,
  buy_signed: ORDER_KEYS,
  buy_filled: ORDER_KEYS,
  buy_failed: [...ORDER_KEYS, "reason"],

  sell_drawer_opened: ["listing", "listing_kind"],
  sell_receive_token_chosen: ["chain_family"],
  sell_amount_entered: ["amount_bucket"],
  sell_quote_shown: ["amount_bucket"],
  sell_sign_requested: ORDER_KEYS,
  sell_signed: ORDER_KEYS,
  sell_filled: ORDER_KEYS,
  sell_failed: [...ORDER_KEYS, "reason"],

  limit_started: ["side"],
  limit_saved: ["side"],

  account_screen_opened: ["screen"],
  news_story_opened: ["listing", "source_kind"],
  news_refresh_tapped: [],
  campaign_landed: ["campaign"],
  campaign_step: ["step"],
  first_look_shown: ["listing", "in_news", "moved"],
  invite_link_shared: ["surface"],
  invite_link_copied: ["surface"],
  ai_connect_started: ["assistant"],
  ai_connect_finished: ["assistant", "decision"],
  most_bought_viewed: ["rows"],
} as const satisfies { [K in AnalyticsEvent]: readonly (keyof AnalyticsEvents[K])[] };

export const ANALYTICS_EVENTS = Object.keys(EVENT_PROPS) as AnalyticsEvent[];

export function isAnalyticsEvent(name: string): name is AnalyticsEvent {
  return Object.prototype.hasOwnProperty.call(EVENT_PROPS, name);
}

/** PostHog's own events that may go out, after scrubbing. Everything else it might send is dropped. */
const SYSTEM_EVENTS = new Set(["$pageview", "$pageleave", "$identify", "$snapshot"]);

type Value = string | number | boolean;

/** A short code: letters, digits and _ . : - only. No spaces, no @, nothing long. */
const CODE = /^[a-z0-9][a-z0-9_.:-]{0,31}$/i;
const HEX_ADDRESS = /0x[0-9a-f]{6,}/i;
const BASE58_RUN = /[1-9A-HJ-NP-Za-km-z]{24,}/;

/** Whether one value may be sent. Numbers are small counts or positions, never money. */
export function safeValue(value: unknown): value is Value {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 && value <= 100;
  if (typeof value !== "string") return false;
  return CODE.test(value) && !HEX_ADDRESS.test(value) && !BASE58_RUN.test(value);
}

/** Only the event's own keys, each with a safe value; null for an event not in the catalogue. */
export function cleanProps(name: string, props: Record<string, unknown> | undefined): Record<string, Value> | null {
  if (!isAnalyticsEvent(name)) return null;
  const allowed: readonly string[] = EVENT_PROPS[name];
  const out: Record<string, Value> = {};
  for (const key of allowed) {
    const value = props?.[key];
    if (safeValue(value)) out[key] = value;
  }
  return out;
}

/** An amount in dollars as a broad range, never the number. Null for nothing or nonsense. */
export function amountBucket(usd: number | undefined | null): AmountBucket | null {
  if (usd === undefined || usd === null || !Number.isFinite(usd) || usd <= 0) return null;
  if (usd < 10) return "under_10";
  if (usd < 50) return "10_50";
  if (usd < 100) return "50_100";
  if (usd < 250) return "100_250";
  if (usd < 500) return "250_500";
  if (usd < 1_000) return "500_1k";
  if (usd < 5_000) return "1k_5k";
  return "5k_plus";
}

/**
 * Why an order stopped, as a code: "cancelled", the SDK's own error code
 * (upper snake case, lowered) or "other". Never the message itself.
 */
export function failureReason({ cancelled, errorCode }: { cancelled?: boolean; errorCode?: string }): string {
  if (cancelled) return "cancelled";
  if (errorCode && /^[A-Z][A-Z0-9_]{2,31}$/.test(errorCode)) return errorCode.toLowerCase();
  return "other";
}

/**
 * A campaign as a short reference, never its code: FNV-1a of the lower
 * cased code, "c_" and eight hex digits. Staff can match a known code to
 * its reference (campaignRef in a console); the code itself is not sent.
 */
export function campaignRef(code: string): string {
  let hash = 0x811c9dc5;
  for (const char of code.trim().toLowerCase()) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `c_${hash.toString(16).padStart(8, "0")}`;
}

/** "EVM", "SOLANA", "BITCOIN" as a lower case family. */
export function chainFamily(chainType: string | undefined): ChainFamily {
  const family = (chainType ?? "").toLowerCase();
  return /^[a-z]{2,16}$/.test(family) ? family : "other";
}

/* ── where nothing is recorded ─────────────────────────────────────────── */

/** Pages that send no event at all: the staff area shows people's data. */
export function trackingAllowedOn(pathname: string): boolean {
  return !/^\/staff(\/|$)/.test(pathname);
}

/**
 * Pages never recorded in a replay: staff, someone's profile, an invite or
 * friend link, an email link, and the AI consent screen.
 */
export function recordingAllowedOn(pathname: string): boolean {
  return trackingAllowedOn(pathname) && !/^\/(u|f|r|c|email|oauth|friends)(\/|$)/.test(pathname);
}

/** Pages where the consent card is not shown: the legal pages themselves, staff, and the AI consent screen. */
export function promptAllowedOn(pathname: string): boolean {
  return trackingAllowedOn(pathname) && !/^\/(privacy|terms|oauth|email)(\/|$)/.test(pathname);
}

/* ── URLs ──────────────────────────────────────────────────────────────── */

const PERSONAL_SEGMENTS: Record<string, string> = {
  u: ":handle",
  f: ":token",
  r: ":code",
  c: ":code",
  email: ":rest",
};

const UTM = /^utm_(source|medium|campaign|content|term)$/;

/** A path with every personal segment replaced. */
export function scrubPath(pathname: string): string {
  const parts = pathname.split("/");
  const first = parts[1];
  if (first && first in PERSONAL_SEGMENTS && parts.length > 2) return `/${first}/${PERSONAL_SEGMENTS[first]}`;
  if (first === "staff") return "/staff";
  return (
    parts
      .map((part) => (part.length > 24 || HEX_ADDRESS.test(part) || BASE58_RUN.test(part) || part.includes("@") ? ":id" : part))
      .join("/") || "/"
  );
}

/** A URL without its query (bar utm_* codes), its hash, or any personal path segment. */
export function scrubUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw.startsWith("/") ? scrubPath(raw.split(/[?#]/)[0]) : "";
  }
  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (UTM.test(key) && CODE.test(value)) kept.set(key, value);
  }
  const query = kept.toString();
  return `${url.origin}${scrubPath(url.pathname)}${query ? `?${query}` : ""}`;
}

/** A referrer as its origin only; PostHog's "$direct" stays. */
export function scrubReferrer(raw: string): string {
  if (raw === "$direct") return raw;
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

const URL_KEY = /(url|href)$/i;
const PATH_KEY = /pathname$/i;
const REFERRER_KEY = /referrer$/i;

function scrubUrlProps(props: Record<string, unknown> | undefined): void {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (typeof value !== "string") continue;
    if (REFERRER_KEY.test(key)) props[key] = scrubReferrer(value);
    else if (URL_KEY.test(key)) props[key] = scrubUrl(value);
    else if (PATH_KEY.test(key)) props[key] = scrubPath(value);
  }
}

/** PostHog's own properties that may stay: device class and session bookkeeping, nothing that names anyone. */
const KEPT_NON_DOLLAR = new Set(["distinct_id", "token"]);
/** PostHog's own properties never sent: the raw user agent and the page title (a profile's title names its owner). */
const DROPPED = new Set(["$raw_user_agent", "title", "$el_text", "$elements", "$elements_chain"]);

/** The shape of what PostHog hands `before_send`, the parts this touches. */
export type OutgoingEvent = {
  event: string;
  properties: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
};

type SnapshotItem = { type?: number; data?: { href?: unknown; tag?: unknown; payload?: { href?: unknown } } };

/**
 * The last word on every event before it leaves the browser: unknown events
 * dropped, our properties allowlisted, PostHog's URL properties scrubbed, the
 * environment stamped, and a replay's page addresses scrubbed too. Null drops it.
 */
export function scrubEvent<T extends OutgoingEvent>(data: T, { environment, pathname }: { environment: string; pathname: string }): T | null {
  if (!trackingAllowedOn(pathname)) return null;
  const custom = isAnalyticsEvent(data.event);
  if (!custom && !SYSTEM_EVENTS.has(data.event)) return null;
  if (data.event === "$snapshot" && !recordingAllowedOn(pathname)) return null;

  const properties: Record<string, unknown> = { ...data.properties };
  for (const key of Object.keys(properties)) {
    if (DROPPED.has(key)) delete properties[key];
  }
  if (custom) {
    const clean = cleanProps(data.event, properties) ?? {};
    for (const key of Object.keys(properties)) {
      if (!key.startsWith("$") && !KEPT_NON_DOLLAR.has(key)) delete properties[key];
    }
    Object.assign(properties, clean);
  } else {
    for (const key of Object.keys(properties)) {
      if (!key.startsWith("$") && !KEPT_NON_DOLLAR.has(key)) delete properties[key];
    }
  }
  scrubUrlProps(properties);
  if (data.event === "$snapshot" && Array.isArray(properties.$snapshot_data)) {
    properties.$snapshot_data = (properties.$snapshot_data as SnapshotItem[]).map(scrubSnapshotItem);
  }
  properties.$environment = environment;
  properties.$geoip_disable = true;
  properties.$ip = null;

  const out: T = { ...data, properties };
  if (data.$set) {
    out.$set = { ...data.$set };
    scrubUrlProps(out.$set);
  }
  if (data.$set_once) {
    out.$set_once = { ...data.$set_once };
    for (const key of Object.keys(out.$set_once)) if (DROPPED.has(key)) delete out.$set_once[key];
    scrubUrlProps(out.$set_once);
  }
  return out;
}

/**
 * One replay event with its page address scrubbed. posthog-js compresses a
 * full snapshot's data into a latin1 string (`cv: "2024-10"`); anything
 * that is not a plain object is passed through untouched, never spread.
 */
export function scrubSnapshotItem(item: SnapshotItem): SnapshotItem {
  if (!item || typeof item !== "object" || !item.data || typeof item.data !== "object" || Array.isArray(item.data)) return item;
  const data = { ...item.data };
  if (typeof data.href === "string") data.href = scrubUrl(data.href);
  if (data.payload && typeof data.payload === "object" && typeof data.payload.href === "string") {
    data.payload = { ...data.payload, href: scrubUrl(data.payload.href) };
  }
  return { ...item, data };
}

/**
 * Vercel Web Analytics' last word on a page view: nothing without consent
 * or from a staff page, and the address scrubbed as PostHog's is.
 */
export function scrubVercelEvent<E extends { url: string }>(event: E, { consented, pathname }: { consented: boolean; pathname: string }): E | null {
  if (!consented || !trackingAllowedOn(pathname)) return null;
  // The event's own address decides too, not only the page it was sent from.
  let eventPath: string;
  try {
    eventPath = new URL(event.url, "https://www.berthmarkets.com").pathname;
  } catch {
    return null;
  }
  if (!trackingAllowedOn(eventPath)) return null;
  return { ...event, url: scrubUrl(event.url) };
}

/* ── replay masking ────────────────────────────────────────────────────── */

/**
 * Replay text fails closed: every text node is masked (the selector matches
 * everything), and `maskText` decides what may show. Only static copy
 * inside a `data-ph-unmask` region (a label or heading from lib/copy) is
 * kept, and never if it holds a digit, a currency sign, an @ or anything
 * address shaped, or sits in a masked region. Inputs are masked by
 * maskAllInputs as well.
 */
export const MASK_TEXT_SELECTOR = "*";
/** Regions that stay masked even inside an unmasked one: money, accounts, people, fields. */
export const MASKED_REGION_SELECTOR =
  "[data-ph-mask], .money, [data-money], .font-money, .font-mono, input, textarea, [contenteditable]";
/** Static UI chrome that may show in a replay, words only. */
export const UNMASK_SELECTOR = "[data-ph-unmask]";
/** Regions never recorded at all, drawn as an empty box: key export, QR codes, lists of people. */
export const BLOCK_SELECTOR = "[data-ph-block]";

/** Attributes that carry words a person reads (and so may carry a name or an email). */
const WORD_ATTRIBUTES = new Set(["aria-label", "aria-description", "title", "alt", "placeholder", "value", "data-value"]);
const LINK_ATTRIBUTES = new Set(["href", "src", "action", "formaction"]);
const SENSITIVE = /@|0x[0-9a-f]{6,}|[1-9A-HJ-NP-Za-km-z]{24,}|\d[\d,.]*\d|[$€£¥]/i;

type Closest = { closest?: (selector: string) => unknown } | null | undefined;

/** Whether an element is static chrome that may show: inside an unmask region and not inside a masked one. */
export function unmaskedChrome(element: Closest): boolean {
  return Boolean(element?.closest?.(UNMASK_SELECTOR)) && !element?.closest?.(MASKED_REGION_SELECTOR);
}

/** Every text node of a replay passes here (maskTextFn): asterisks unless it is safe chrome. */
export function maskText(text: string, element: Closest): string {
  const keep = unmaskedChrome(element) && !/\d/.test(text) && !SENSITIVE.test(text);
  return keep ? text : text.replace(/\S/g, "*");
}

/**
 * The only attributes a replay keeps inside a masked region (which is
 * everywhere but a `data-ph-unmask` label): layout and structure, never
 * words, links, ids or data. Anything else, including attributes added
 * later (a `data-handle`, an `aria-valuetext` with an amount), becomes
 * asterisks. Adding to this list is a privacy decision: the test pins it.
 */
export const REPLAY_ATTRIBUTE_ALLOWLIST: readonly string[] = [
  "class",
  "style",
  "width",
  "height",
  "role",
  "tabindex",
  "aria-hidden",
  "viewbox",
  "xmlns",
  "type",
];

function layoutAttribute(key: string): boolean {
  return REPLAY_ATTRIBUTE_ALLOWLIST.includes(key) || key.startsWith("data-ph-") || key.startsWith("rr_");
}

/**
 * Replay attributes: text masking does not reach attributes. Inside a
 * masked region every attribute but the layout allowlist becomes
 * asterisks. In the one unmasked kind of region (static labels), word
 * attributes shaped like an email, an address or a number are masked and
 * links lose personal path segments and their query.
 */
export function maskAttribute(name: string, value: string, insideMasked: boolean): string {
  const key = name.toLowerCase();
  if (insideMasked) return layoutAttribute(key) ? value : "*".repeat(Math.min(value.length, 12));
  if (LINK_ATTRIBUTES.has(key)) {
    if (value.startsWith("data:")) return value;
    if (value.startsWith("/")) return scrubPath(value.split(/[?#]/)[0]);
    return /^https?:/i.test(value) ? scrubUrl(value) : value;
  }
  if (WORD_ATTRIBUTES.has(key) && SENSITIVE.test(value)) return "*".repeat(Math.min(value.length, 12));
  return value;
}

/**
 * The $environment every event carries: "development" on a local host
 * (a local production build included) or outside a production build,
 * otherwise Vercel's environment (production, preview).
 */
export function environmentFor({ hostname, nodeEnv, vercelEnv }: { hostname: string; nodeEnv: string | undefined; vercelEnv: string | undefined }): string {
  if (nodeEnv !== "production" || /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$|\.test$/.test(hostname)) return "development";
  return vercelEnv && /^[a-z]{2,16}$/.test(vercelEnv) ? vercelEnv : "production";
}

/* ── configuration ─────────────────────────────────────────────────────── */

export type AnalyticsEnv = {
  key: string | undefined;
  host: string | undefined;
};

export const DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";

/**
 * PostHog's EU cloud only (Frankfurt, as the policy says): unset means the
 * EU host; anything else that is not an EU PostHog host is refused (null),
 * and analytics then stays off.
 */
export function euApiHost(host: string | undefined): string | null {
  const value = host?.trim();
  if (!value) return DEFAULT_POSTHOG_HOST;
  return /^https:\/\/(eu\.i\.posthog\.com|[a-z0-9-]+\.eu\.posthog\.com)\/?$/.test(value) ? value.replace(/\/$/, "") : null;
}

/** Configured at all: without a key, or with a host outside PostHog's EU cloud, nothing is ever loaded. */
export function analyticsConfigured(env: AnalyticsEnv): boolean {
  return typeof env.key === "string" && env.key.trim().length > 0 && euApiHost(env.host) !== null;
}

/**
 * The PostHog configuration for one consent state. Only "granted" is ever
 * initialised (components/analytics/analytics-root); the other branch keeps
 * the cookieless, recording off defaults in case it ever were.
 */
export function posthogConfig<B = never>({
  host,
  granted,
  pathname,
  beforeSend,
  deferRecording = false,
}: {
  host: string | undefined;
  granted: boolean;
  pathname: string;
  /** Start with replay off; the caller starts it once the identity is settled. */
  deferRecording?: boolean;
  /** PostHog's before_send, typed by the caller against posthog-js (lib/analytics has no PostHog import). */
  beforeSend?: B;
}) {
  return {
    api_host: euApiHost(host) ?? DEFAULT_POSTHOG_HOST,
    ui_host: "https://eu.posthog.com",
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: granted,
    rageclick: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_exceptions: false,
    capture_performance: false,
    disable_surveys: true,
    disable_web_experiments: true,
    disable_product_tours: true,
    disable_conversations: true,
    advanced_disable_feature_flags: true,
    disable_external_dependency_loading: true,
    persistence: granted ? ("localStorage+cookie" as const) : ("memory" as const),
    cross_subdomain_cookie: false,
    secure_cookie: true,
    disable_session_recording: !granted || deferRecording || !recordingAllowedOn(pathname),
    enable_recording_console_log: false,
    respect_dnt: true,
    person_profiles: "identified_only" as const,
    internal_or_test_user_hostname: null,
    mask_personal_data_properties: true,
    custom_personal_data_properties: ["ref", "code", "token", "request", "email", "address"],
    mask_all_text: true,
    mask_all_element_attributes: true,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: MASK_TEXT_SELECTOR,
      blockSelector: BLOCK_SELECTOR,
      recordHeaders: false,
      recordBody: false,
      captureCanvas: { recordCanvas: false },
      collectFonts: false,
      maskCapturedNetworkRequestFn: () => null,
      maskTextFn: (text: string, element?: HTMLElement) => maskText(text, element),
      maskAttributeFn: (attribute: string, value: string, element?: Element) =>
        maskAttribute(attribute, value, !unmaskedChrome(element)),
    },
    ...(beforeSend ? { before_send: beforeSend } : {}),
  };
}

/** The two calls `startAnonymous` needs, so it can be tested without PostHog. */
export type IdentityHolder = { get_property: (key: string) => unknown; reset: (resetDeviceId?: boolean) => void };

/**
 * A fresh load forgets any name kept from before: a browser left
 * identified (a sign out the page never saw, a lapsed session, another
 * person) must not send this visit's first page view or replay under it.
 */
export function startAnonymous(posthog: IdentityHolder): void {
  if (posthog.get_property("$user_state") === "identified") posthog.reset();
}

/* ── the sink ──────────────────────────────────────────────────────────── */

export type AnalyticsSink = {
  capture: (name: string, props: Record<string, Value>, options?: { beacon?: boolean }) => void;
};

let sink: AnalyticsSink | null = null;
const sentOnce = new Set<string>();
/**
 * Events from the first moments of a page whose browser already said yes,
 * before PostHog has finished loading (a campaign landing redirects at
 * once). Held in memory, a few at most, and only with consent: without it
 * nothing is kept, so nothing from before a yes is ever sent after it.
 */
const early: { name: string; props: Record<string, Value>; options?: { beacon?: boolean } }[] = [];
const EARLY_MAX = 20;

function consented(): boolean {
  try {
    return readConsent() === "granted";
  } catch {
    return false;
  }
}

/** Attached by the analytics root once consent is given and PostHog is loaded; null detaches. */
export function setAnalyticsSink(next: AnalyticsSink | null): void {
  sink = next;
  if (!next) {
    sentOnce.clear();
    early.length = 0;
    return;
  }
  for (const event of early.splice(0)) send(event.name, event.props, event.options);
}

function send(name: string, props: Record<string, Value>, options?: { beacon?: boolean }): void {
  try {
    sink?.capture(name, props, options);
  } catch {
    // Analytics never breaks the app.
  }
}

/** Only consent, as this browser holds it right now, lets an event through; a sink alone is not enough. */
function listening(): boolean {
  return consented();
}

/** Send one catalogued event. A no op without consent. */
export function track<K extends AnalyticsEvent>(name: K, props: AnalyticsEvents[K], options?: { beacon?: boolean }): void {
  if (!listening()) return;
  const clean = cleanProps(name, props as Record<string, unknown>);
  if (!clean) return;
  if (sink) send(name, clean, options);
  else if (early.length < EARLY_MAX) early.push({ name, props: clean, options });
}

/** Send an event at most once per page session for `key` (a stage seen, a story card shown). */
export function trackOnce<K extends AnalyticsEvent>(key: string, name: K, props: AnalyticsEvents[K]): void {
  if (!listening() || sentOnce.has(key)) return;
  sentOnce.add(key);
  track(name, props);
}
