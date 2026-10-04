import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_EVENTS,
  EVENT_PROPS,
  MASK_TEXT_SELECTOR,
  BLOCK_SELECTOR,
  amountBucket,
  analyticsConfigured,
  chainFamily,
  campaignRef,
  environmentFor,
  euApiHost,
  cleanProps,
  failureReason,
  maskAttribute,
  REPLAY_ATTRIBUTE_ALLOWLIST,
  maskText,
  MASKED_REGION_SELECTOR,
  UNMASK_SELECTOR,
  posthogConfig,
  recordingAllowedOn,
  promptAllowedOn,
  safeValue,
  scrubEvent,
  scrubPath,
  scrubReferrer,
  scrubSnapshotItem,
  scrubVercelEvent,
  scrubUrl,
  setAnalyticsSink,
  startAnonymous,
  track,
  trackOnce,
  trackingAllowedOn,
} from "./analytics";
import { CONSENT_STORAGE_KEY } from "./analytics-consent";
import { COPY } from "./copy";

describe("the event catalogue", () => {
  it("names events in snake case, each with its own short list of keys", () => {
    expect(ANALYTICS_EVENTS.length).toBeGreaterThan(20);
    for (const name of ANALYTICS_EVENTS) {
      expect(name).toMatch(/^[a-z]+(_[a-z]+)+$/);
      for (const key of EVENT_PROPS[name]) expect(key).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });

  it("has no property key shaped like personal data", () => {
    const pii = /amount(?!_bucket)|balance|address|email|user|handle|hash|headline|title|wallet|usd|price|value|tx|intent|token|name|phone|^ip$|code|text|url|id$/;
    for (const name of ANALYTICS_EVENTS) {
      for (const key of EVENT_PROPS[name]) expect(key, `${name}.${key}`).not.toMatch(pii);
    }
  });

  it("covers the funnels it promises", () => {
    for (const name of [
      "path_step_shown", "path_step_completed", "path_step_skipped", "path_finished", "home_stage_shown",
      "buy_drawer_opened", "buy_pay_token_chosen", "buy_amount_entered", "buy_quote_shown", "buy_sign_requested", "buy_signed", "buy_filled", "buy_failed",
      "sell_drawer_opened", "sell_amount_entered", "sell_quote_shown", "sell_sign_requested", "sell_signed", "sell_filled", "sell_failed",
      "limit_started", "limit_saved", "account_screen_opened",
      "news_story_opened", "news_refresh_tapped", "campaign_landed", "campaign_step", "first_look_shown",
      "invite_link_shared", "invite_link_copied", "ai_connect_started", "ai_connect_finished", "most_bought_viewed", "most_held_viewed",
    ]) {
      expect(ANALYTICS_EVENTS).toContain(name);
    }
  });
});

describe("property values", () => {
  it("lets through short codes, small counts and booleans", () => {
    for (const value of ["avatar", "evm", "NVDA", "BRK.B", "50_100", "fill_failed", true, false, 0, 3, 24]) expect(safeValue(value)).toBe(true);
  });

  it("refuses anything shaped like money, an address, an email, a hash or a sentence", () => {
    for (const value of [
      12.5, 1500, -1, 101, Number.NaN,
      "0x1234abcd5678ef90",
      "0xAbC123",
      "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV",
      "david@sodax.com",
      "Apple beats earnings estimates",
      "a".repeat(33),
      "$50",
      "",
      null,
      undefined,
      { nested: "x" },
      ["evm"],
    ]) {
      expect(safeValue(value), String(value)).toBe(false);
    }
  });

  it("keeps only the event's own keys, and drops unknown events", () => {
    expect(cleanProps("buy_failed", { listing: "NVDA", chain_family: "evm", order_type: "market", reason: "cancelled", amount: 50, address: "0xabc" })).toEqual({
      listing: "NVDA",
      chain_family: "evm",
      order_type: "market",
      reason: "cancelled",
    });
    expect(cleanProps("buy_amount_entered", { amount_bucket: "50_100", usd: 73.12 })).toEqual({ amount_bucket: "50_100" });
    expect(cleanProps("not_an_event", { step: "x" })).toBeNull();
    expect(cleanProps("news_story_opened", { listing: "AAPL", source_kind: "article", title: "Apple beats estimates" })).toEqual({ listing: "AAPL", source_kind: "article" });
  });
});

describe("amount buckets", () => {
  it("are broad ranges, never the number", () => {
    expect(amountBucket(undefined)).toBeNull();
    expect(amountBucket(0)).toBeNull();
    expect(amountBucket(-5)).toBeNull();
    expect(amountBucket(Number.NaN)).toBeNull();
    expect(amountBucket(Number.POSITIVE_INFINITY)).toBeNull();
    expect(amountBucket(3)).toBe("under_10");
    expect(amountBucket(10)).toBe("10_50");
    expect(amountBucket(49.99)).toBe("10_50");
    expect(amountBucket(73.12)).toBe("50_100");
    expect(amountBucket(100)).toBe("100_250");
    expect(amountBucket(499)).toBe("250_500");
    expect(amountBucket(999)).toBe("500_1k");
    expect(amountBucket(4_999)).toBe("1k_5k");
    expect(amountBucket(1_000_000)).toBe("5k_plus");
  });

  it("are all safe values", () => {
    for (const usd of [1, 20, 70, 200, 400, 700, 2_000, 9_000]) expect(safeValue(amountBucket(usd))).toBe(true);
  });
});

describe("codes", () => {
  it("say why an order stopped without the message", () => {
    expect(failureReason({ cancelled: true, errorCode: "X" })).toBe("cancelled");
    expect(failureReason({ errorCode: "RELAY_TIMEOUT" })).toBe("relay_timeout");
    expect(failureReason({ errorCode: "user rejected the request from 0xabc" })).toBe("other");
    expect(failureReason({})).toBe("other");
  });

  it("send a campaign as a reference, never its code", () => {
    const ref = campaignRef("SPRING-2026");
    expect(ref).toMatch(/^c_[0-9a-f]{8}$/);
    expect(ref).not.toContain("spring");
    expect(campaignRef(" spring-2026 ")).toBe(ref);
    expect(campaignRef("autumn")).not.toBe(ref);
    expect(safeValue(ref)).toBe(true);
  });

  it("name a chain family only", () => {
    expect(chainFamily("EVM")).toBe("evm");
    expect(chainFamily("BITCOIN")).toBe("bitcoin");
    expect(chainFamily(undefined)).toBe("other");
    expect(chainFamily("0xabc")).toBe("other");
  });
});

describe("URLs", () => {
  it("lose personal path segments", () => {
    expect(scrubPath("/u/david")).toBe("/u/:handle");
    expect(scrubPath("/f/abcDEF123")).toBe("/f/:token");
    expect(scrubPath("/r/HARBOUR7")).toBe("/r/:code");
    expect(scrubPath("/c/spring")).toBe("/c/:code");
    expect(scrubPath("/email/unsubscribe/secret-token")).toBe("/email/:rest");
    expect(scrubPath("/staff/users/42")).toBe("/staff");
    expect(scrubPath("/dev/x/0x1234567890abcdef")).toBe("/dev/x/:id");
    expect(scrubPath("/")).toBe("/");
    expect(scrubPath("/privacy")).toBe("/privacy");
  });

  it("lose their query, bar utm codes, and their hash", () => {
    expect(scrubUrl("https://www.berthmarkets.com/?ref=HARBOUR7&email=a@b.com&utm_source=x&utm_campaign=spring#top")).toBe(
      "https://www.berthmarkets.com/?utm_source=x&utm_campaign=spring",
    );
    expect(scrubUrl("https://www.berthmarkets.com/u/david?x=1")).toBe("https://www.berthmarkets.com/u/:handle");
    expect(scrubUrl("https://www.berthmarkets.com/?buy=NVDA&usd=500")).toBe("https://www.berthmarkets.com/");
    expect(scrubUrl("https://www.berthmarkets.com/?utm_source=a%40b.com")).toBe("https://www.berthmarkets.com/");
  });

  it("keep only a referrer's origin", () => {
    expect(scrubReferrer("https://mail.google.com/mail/u/0/#inbox/abc")).toBe("https://mail.google.com");
    expect(scrubReferrer("$direct")).toBe("$direct");
    expect(scrubReferrer("not a url")).toBe("");
  });
});

describe("the environment tag", () => {
  it("is development on a local host, even in a production build", () => {
    expect(environmentFor({ hostname: "localhost", nodeEnv: "production", vercelEnv: undefined })).toBe("development");
    expect(environmentFor({ hostname: "www.berthmarkets.com", nodeEnv: "development", vercelEnv: "production" })).toBe("development");
    expect(environmentFor({ hostname: "www.berthmarkets.com", nodeEnv: "production", vercelEnv: "production" })).toBe("production");
    expect(environmentFor({ hostname: "x.vercel.app", nodeEnv: "production", vercelEnv: "preview" })).toBe("preview");
  });
});

/** A stand-in element: `closest` answers by which selectors it sits inside. */
function inside(...regions: ("unmask" | "masked")[]) {
  return {
    closest: (selector: string) =>
      (selector === UNMASK_SELECTOR && regions.includes("unmask")) || (selector === MASKED_REGION_SELECTOR && regions.includes("masked")) ? {} : null,
  };
}

describe("replay text fails closed", () => {
  it("masks every text node by default, whatever it says", () => {
    expect(MASK_TEXT_SELECTOR).toBe("*");
    for (const text of ["$25.00 is ready to spend. Choose one to start.", "Help improve Berth", "harbourfox", "Signed in as gosia@example.com"]) {
      expect(maskText(text, inside())).not.toMatch(/[^\s*]/);
      expect(maskText(text, null)).not.toMatch(/[^\s*]/);
    }
  });

  it("shows only static words inside an unmask region, never a number, a sign, an email or an address", () => {
    expect(maskText("Friends", inside("unmask"))).toBe("Friends");
    expect(maskText("Your money", inside("unmask"))).toBe("Your money");
    for (const text of ["3 friends", "$25.00", "€ balance", "gosia@example.com", "0x1234567890abcdef", "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV"]) {
      expect(maskText(text, inside("unmask"))).not.toMatch(/[^\s*]/);
    }
    expect(maskText("Friends", inside("unmask", "masked"))).toBe("*******");
  });

  it("is what the PostHog configuration uses", () => {
    const config = posthogConfig({ host: undefined, granted: true, pathname: "/" });
    expect(config.session_recording.maskTextFn("$25.00 is ready", inside() as unknown as HTMLElement)).not.toMatch(/[^\s*]/);
    expect(config.session_recording.maskTextFn("Friends", inside("unmask") as unknown as HTMLElement)).toBe("Friends");
    expect(config.session_recording.maskAttributeFn("aria-label", "Open friends", inside() as unknown as Element)).toMatch(/^\*+$/);
    expect(config.session_recording.maskAttributeFn("aria-label", "Open friends", inside("unmask") as unknown as Element)).toBe("Open friends");
  });
});

describe("replay attributes", () => {
  it("hide names, emails, addresses and money in word attributes", () => {
    expect(maskAttribute("aria-label", "Account total, signed in as david@sodax.com", false)).toMatch(/^\*+$/);
    expect(maskAttribute("title", "0x1234567890abcdef", false)).toMatch(/^\*+$/);
    expect(maskAttribute("aria-label", "$1,234.56", false)).toMatch(/^\*+$/);
    expect(maskAttribute("alt", "harbourfox", true)).toMatch(/^\*+$/);
    expect(maskAttribute("aria-label", "Open the news", false)).toBe("Open the news");
    expect(maskAttribute("class", "money text-sm", true)).toBe("money text-sm");
  });

  it("inside a masked region keep only the pinned layout allowlist", () => {
    // A privacy decision: adding an attribute here means it will be recorded as is.
    expect([...REPLAY_ATTRIBUTE_ALLOWLIST]).toEqual(["class", "style", "width", "height", "role", "tabindex", "aria-hidden", "viewbox", "xmlns", "type"]);
    for (const name of [...REPLAY_ATTRIBUTE_ALLOWLIST, "data-ph-mask", "data-ph-block", "rr_width"]) {
      expect(maskAttribute(name, "kept", true), name).toBe("kept");
    }
  });

  it("inside a masked region mask every other attribute, including ones added later", () => {
    for (const name of ["id", "data-handle", "data-story", "data-value", "aria-valuetext", "aria-valuenow", "aria-label", "title", "alt", "href", "src", "srcset", "content", "d", "value", "name", "for", "data-testid"]) {
      expect(maskAttribute(name, "harbourfox $1,234", true), name).toMatch(/^\*+$/);
    }
  });

  it("scrub links", () => {
    expect(maskAttribute("href", "/u/david?from=drawer", false)).toBe("/u/:handle");
    expect(maskAttribute("href", "https://www.berthmarkets.com/r/HARBOUR7", false)).toBe("https://www.berthmarkets.com/r/:code");
    expect(maskAttribute("href", "/privacy#analytics", false)).toBe("/privacy");
  });
});

describe("where nothing is sent or recorded", () => {
  it("sends nothing from staff pages", () => {
    expect(trackingAllowedOn("/staff")).toBe(false);
    expect(trackingAllowedOn("/staff/users")).toBe(false);
    expect(trackingAllowedOn("/")).toBe(true);
    expect(trackingAllowedOn("/staffing")).toBe(true);
  });

  it("records no profile, invite, email link or consent screen", () => {
    for (const path of ["/u/david", "/f/x", "/r/x", "/c/x", "/email/x", "/oauth/authorize", "/friends", "/staff"]) expect(recordingAllowedOn(path)).toBe(false);
    for (const path of ["/", "/privacy", "/assistants"]) expect(recordingAllowedOn(path)).toBe(true);
  });

  it("asks nowhere it would cover the policy itself", () => {
    expect(promptAllowedOn("/")).toBe(true);
    expect(promptAllowedOn("/privacy")).toBe(false);
    expect(promptAllowedOn("/staff")).toBe(false);
  });
});

describe("the last scrub before sending", () => {
  const env = { environment: "development", pathname: "/" };

  it("drops events not in the catalogue, PostHog's own included", () => {
    for (const event of ["$autocapture", "$rageclick", "$exception", "$opt_in", "$web_vitals", "$feature_flag_called", "made_up"]) {
      expect(scrubEvent({ event, properties: {} }, env)).toBeNull();
    }
  });

  it("drops everything on a staff page", () => {
    expect(scrubEvent({ event: "$pageview", properties: {} }, { ...env, pathname: "/staff/users" })).toBeNull();
  });

  it("allowlists our properties and scrubs PostHog's URLs, title and user agent", () => {
    const out = scrubEvent(
      {
        event: "buy_failed",
        properties: {
          listing: "NVDA",
          chain_family: "evm",
          order_type: "market",
          reason: "cancelled",
          amount: "73.12",
          email: "a@b.com",
          title: "@david on Berth",
          distinct_id: "abc",
          $current_url: "https://www.berthmarkets.com/u/david?ref=X",
          $pathname: "/u/david",
          $referrer: "https://t.co/abc?x=1",
          $raw_user_agent: "Mozilla/5.0",
          $browser: "Safari",
        },
        $set_once: { $initial_current_url: "https://www.berthmarkets.com/r/HARBOUR7", $initial_referrer: "https://x.com/david/status/1" },
      },
      env,
    )!;
    expect(out.properties).toMatchObject({
      listing: "NVDA",
      reason: "cancelled",
      distinct_id: "abc",
      $current_url: "https://www.berthmarkets.com/u/:handle",
      $pathname: "/u/:handle",
      $referrer: "https://t.co",
      $browser: "Safari",
      $environment: "development",
      $geoip_disable: true,
      $ip: null,
    });
    for (const key of ["amount", "email", "title", "$raw_user_agent"]) expect(out.properties).not.toHaveProperty(key);
    expect(out.$set_once).toEqual({ $initial_current_url: "https://www.berthmarkets.com/r/:code", $initial_referrer: "https://x.com" });
  });

  it("scrubs a page view's own extras", () => {
    const out = scrubEvent({ event: "$pageview", properties: { title: "Berth", $current_url: "https://www.berthmarkets.com/?ref=X", stray: "x" } }, env)!;
    expect(out.properties).toEqual({ $current_url: "https://www.berthmarkets.com/", $environment: "development", $geoip_disable: true, $ip: null });
  });

  it("scrubs page addresses inside a replay, and sends none from where recording is not allowed", () => {
    const out = scrubEvent(
      {
        event: "$snapshot",
        properties: {
          $snapshot_data: [
            { type: 4, data: { href: "https://www.berthmarkets.com/u/david?x=1" } },
            { type: 5, data: { tag: "$url_changed", payload: { href: "https://www.berthmarkets.com/r/CODE" } } },
            { type: 3, data: { source: 2 } },
          ],
        },
      },
      env,
    )!;
    const data = out.properties.$snapshot_data as { data: { href?: string; payload?: { href: string } } }[];
    expect(data[0].data.href).toBe("https://www.berthmarkets.com/u/:handle");
    expect(data[1].data.payload?.href).toBe("https://www.berthmarkets.com/r/:code");
    expect(scrubEvent({ event: "$snapshot", properties: { $snapshot_data: [] } }, { ...env, pathname: "/u/david" })).toBeNull();
  });

  it("passes a compressed full snapshot through untouched, never spread into an object", () => {
    const compressed = "\u001f\u008b\u0008\u0000abc";
    const item = { type: 2, cv: "2024-10", data: compressed, timestamp: 1 } as unknown as Parameters<typeof scrubSnapshotItem>[0];
    expect(scrubSnapshotItem(item)).toBe(item);
    const out = scrubEvent({ event: "$snapshot", properties: { $snapshot_data: [item, { type: 4, data: { href: "https://www.berthmarkets.com/u/x" } }] } }, env)!;
    const data = out.properties.$snapshot_data as { data: unknown }[];
    expect(data[0].data).toBe(compressed);
    expect(JSON.stringify(data[0]).length).toBeLessThan(80);
    expect((data[1].data as { href: string }).href).toBe("https://www.berthmarkets.com/u/:handle");
  });
});

describe("Vercel Web Analytics", () => {
  it("sends nothing without consent or from staff, and a scrubbed address with it", () => {
    const event = { type: "pageview" as const, url: "https://www.berthmarkets.com/u/david?ref=X#y" };
    expect(scrubVercelEvent(event, { consented: false, pathname: "/" })).toBeNull();
    expect(scrubVercelEvent(event, { consented: true, pathname: "/staff/users" })).toBeNull();
    expect(scrubVercelEvent({ type: "pageview", url: "https://www.berthmarkets.com/staff/users/123" }, { consented: true, pathname: "/" })).toBeNull();
    expect(scrubVercelEvent(event, { consented: true, pathname: "/u/david" })).toEqual({ type: "pageview", url: "https://www.berthmarkets.com/u/:handle" });
  });

  it("is no longer mounted unconditionally in the root layout", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8")).not.toMatch(/@vercel\/analytics/);
  });
});

describe("the PostHog configuration", () => {
  it("is cookieless with replay off until consent", () => {
    const config = posthogConfig({ host: "https://eu.i.posthog.com", granted: false, pathname: "/" });
    expect(config.persistence).toBe("memory");
    expect(config.disable_session_recording).toBe(true);
    expect(config.capture_pageleave).toBe(false);
  });

  it("is explicit events only, on the EU host, with masked replay after consent", () => {
    const config = posthogConfig({ host: "https://eu.i.posthog.com", granted: true, pathname: "/" });
    expect(config).toMatchObject({
      api_host: "https://eu.i.posthog.com",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: true,
      rageclick: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_exceptions: false,
      capture_performance: false,
      persistence: "localStorage+cookie",
      disable_session_recording: false,
      enable_recording_console_log: false,
      respect_dnt: true,
      person_profiles: "identified_only",
      advanced_disable_feature_flags: true,
      disable_external_dependency_loading: true,
    });
    expect(config.session_recording).toMatchObject({ maskAllInputs: true, recordHeaders: false, recordBody: false });
    expect(config.session_recording.maskTextSelector).toBe(MASK_TEXT_SELECTOR);
    expect(config.session_recording.blockSelector).toBe(BLOCK_SELECTOR);
    expect(config.session_recording.maskCapturedNetworkRequestFn()).toBeNull();
    expect(config.session_recording.maskAttributeFn("aria-label", "signed in as a@b.com", inside("unmask") as unknown as Element)).toMatch(/^\*+$/);
    expect(MASKED_REGION_SELECTOR).toContain("[data-ph-mask]");
    expect(MASKED_REGION_SELECTOR).toContain(".money");
    expect(MASKED_REGION_SELECTOR).toContain(".font-mono");
  });

  it("never records on a page where recording is not allowed, and falls back to the EU host", () => {
    const config = posthogConfig({ host: "http://evil.example", granted: true, pathname: "/u/david" });
    expect(config.disable_session_recording).toBe(true);
    expect(config.api_host).toBe("https://eu.i.posthog.com");
  });

  it("only ever talks to PostHog's EU cloud, and refuses any other host", () => {
    expect(euApiHost(undefined)).toBe("https://eu.i.posthog.com");
    expect(euApiHost("")).toBe("https://eu.i.posthog.com");
    expect(euApiHost("https://eu.i.posthog.com/")).toBe("https://eu.i.posthog.com");
    for (const host of ["https://us.i.posthog.com", "https://app.posthog.com", "http://eu.i.posthog.com", "https://eu.i.posthog.com.evil.example", "https://proxy.example"]) {
      expect(euApiHost(host), host).toBeNull();
      expect(analyticsConfigured({ key: "phc_test", host })).toBe(false);
    }
  });

  it("does nothing without a key", () => {
    expect(analyticsConfigured({ key: undefined, host: "https://eu.i.posthog.com" })).toBe(false);
    expect(analyticsConfigured({ key: "  ", host: undefined })).toBe(false);
    expect(analyticsConfigured({ key: "phc_test", host: undefined })).toBe(true);
  });
});

describe("a fresh load starts anonymous", () => {
  /** A stand-in for PostHog's persisted identity and what it stamps on events. */
  function leftOver(identified: boolean) {
    let state = { distinctId: identified ? "hash-of-person-a" : "anon-1", userState: identified ? "identified" : "anonymous" };
    const sent: { event: string; distinct_id: string }[] = [];
    return {
      sent,
      get_property: (key: string) => (key === "$user_state" ? state.userState : undefined),
      reset: () => {
        state = { distinctId: "anon-fresh", userState: "anonymous" };
      },
      capture: (event: string) => sent.push({ event, distinct_id: state.distinctId }),
    };
  }

  it("never sends the first page view or replay snapshot of a signed out load under a previous identity", () => {
    const posthog = leftOver(true);
    startAnonymous(posthog);
    posthog.capture("$pageview");
    posthog.capture("$snapshot");
    expect(posthog.sent.map((e) => e.distinct_id)).toEqual(["anon-fresh", "anon-fresh"]);
  });

  it("leaves an anonymous browser as it is", () => {
    const posthog = leftOver(false);
    startAnonymous(posthog);
    posthog.capture("$pageview");
    expect(posthog.sent[0].distinct_id).toBe("anon-1");
  });

  it("starts with replay off, to be started once the identity is settled", () => {
    expect(posthogConfig({ host: undefined, granted: true, pathname: "/", deferRecording: true }).disable_session_recording).toBe(true);
  });
});

describe("track", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
      navigator: {},
    });
  });
  afterEach(() => {
    setAnalyticsSink(null);
    vi.unstubAllGlobals();
  });

  it("sends nothing without consent, even with a sink attached", () => {
    const capture = vi.fn();
    setAnalyticsSink({ capture });
    track("buy_drawer_opened", { listing: "NVDA", listing_kind: "stock" });
    store.set(CONSENT_STORAGE_KEY, "denied");
    track("buy_drawer_opened", { listing: "NVDA", listing_kind: "stock" });
    expect(capture).not.toHaveBeenCalled();
  });

  it("sends nothing under Do Not Track or Global Privacy Control, even after an earlier yes", () => {
    const capture = vi.fn();
    store.set(CONSENT_STORAGE_KEY, "granted");
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => store.get(key) ?? null }, navigator: { globalPrivacyControl: true } });
    setAnalyticsSink({ capture });
    track("news_refresh_tapped", {});
    expect(capture).not.toHaveBeenCalled();
  });

  it("with consent sends clean properties, holds early events until PostHog loads, and sends a once event once", () => {
    store.set(CONSENT_STORAGE_KEY, "granted");
    const capture = vi.fn();
    track("campaign_landed", { campaign: "spring" });
    expect(capture).not.toHaveBeenCalled();
    setAnalyticsSink({ capture });
    expect(capture).toHaveBeenCalledWith("campaign_landed", { campaign: "spring" }, undefined);
    track("buy_amount_entered", { amount_bucket: "50_100", usd: 73 } as never);
    expect(capture).toHaveBeenLastCalledWith("buy_amount_entered", { amount_bucket: "50_100" }, undefined);
    trackOnce("stage", "home_stage_shown", { stage: "owns" });
    trackOnce("stage", "home_stage_shown", { stage: "owns" });
    expect(capture.mock.calls.filter(([name]) => name === "home_stage_shown")).toHaveLength(1);
  });
});

describe("the words", () => {
  it("ask calmly, with no dashes as punctuation", () => {
    const words = COPY.analytics;
    for (const text of Object.values(words)) expect(text).not.toMatch(/ [-–—] |—|–/);
    expect(words.title).toBe("Help improve Berth");
    expect(words.allow).toBe("Allow");
    expect(words.decline).toBe("No thanks");
  });

  it("are in the privacy policy: PostHog, Frankfurt, consent, how to withdraw, and the processors list", () => {
    const policy = COPY.privacyPolicy;
    const section = policy.sections.find((s) => s.id === "analytics");
    expect(section).toBeDefined();
    const text = section!.body.join("\n");
    for (const part of ["PostHog", "Frankfurt", "IP address is discarded", "consent", "Settings, Help improve Berth", "signed in or not", "30 days", "Do Not Track", "Vercel"]) expect(text).toContain(part);
    const collect = policy.sections.find((s) => s.id === "what-we-collect")!;
    expect(collect.list?.find((line) => line.startsWith("Usage statistics"))).toMatch(/only if you allow it/);
    expect(collect.after?.join(" ")).not.toMatch(/usage statistics rest on our legitimate interest/);
    expect(text).not.toMatch(/ [-–—] |—|–/);
    const sharing = policy.sections.find((s) => s.id === "sharing")!;
    expect(sharing.list?.some((line) => line.startsWith("PostHog,"))).toBe(true);
  });
});
