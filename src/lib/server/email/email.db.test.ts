import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { linkWallet } from "@/lib/server/account-wallets";
import { listLimitOrders } from "@/lib/server/limit-orders";
import { TOKEN_LISTINGS } from "@/lib/listings";
import type { IntentResponse } from "@sodax/sdk";
import { deliver, retryPendingSends, setBackoff, setEmailTransport, type NoticeInput } from "./send";
import type { EmailTransport, OutgoingEmail } from "./resend";
import { claimSend, readPrefs, setPref, suppress } from "./store";
import { issueUnsubscribeToken } from "./token";
import * as unsubscribeRoute from "@/app/api/email/unsubscribe/route";
import * as webhookRoute from "@/app/api/email/webhook/route";

/**
 * The send decision against the real schema: one send per (type, ref),
 * the person's switches, suppression, the address read at send time, the
 * friend request's one a day, a failed send retried, and the two public
 * routes (one click unsubscribe, the signed webhook).
 */

let sql: SqlClient;
let close: () => Promise<void>;
let sent: OutgoingEmail[];
let answer: Awaited<ReturnType<EmailTransport>>;

const EMAIL = "sailor@example.com";

beforeAll(async () => {
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
  vi.stubEnv("EMAIL_TOKEN_SECRET", "email-db-test-secret");
});

afterAll(async () => {
  setEmailTransport(null);
  setSqlClient(null);
  vi.unstubAllEnvs();
  await close();
});

beforeEach(async () => {
  sent = [];
  answer = { ok: true, id: "re_test" };
  setEmailTransport(async (email) => {
    sent.push(email);
    return answer;
  });
  for (const table of ["limit_orders", "email_sends", "email_prefs", "email_suppressions", "account_audit", "user_identities", "users"]) {
    await sql.query(`delete from ${table}`);
  }
});

afterEach(() => setEmailTransport(null));

async function account(email: string | null = EMAIL, wallet = `0x${"a".repeat(40)}`): Promise<string> {
  const rows = (await sql.query(`insert into users (privy_did, wallet_address, email) values ($1, $2, $3) returning id`, [
    `did:privy:${Math.random().toString(36).slice(2)}`,
    wallet,
    email,
  ])) as { id: string }[];
  const id = rows[0].id;
  if (email) {
    await sql.query(
      `insert into user_identities (user_id, kind, value, is_primary, verified_at, proof) values ($1, 'email', $2, true, now(), 'privy_email')`,
      [id, email],
    );
  }
  return id;
}

const filled = (userId: string, ref = "order-1"): NoticeInput => ({
  userId,
  ref,
  notice: { type: "order_filled", side: "buy", name: "NVIDIA", price: "$198.20", received: "0.5 NVIDIA" },
});

describe("deliver", () => {
  it("sends once per (type, ref), however often the event repeats", async () => {
    const userId = await account();
    expect(await deliver(filled(userId))).toBe("sent");
    expect(await deliver(filled(userId))).toBe("duplicate");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(EMAIL);
    expect(sent[0].idempotencyKey).toBe("berth-order_filled-order-1");
    const rows = (await sql.query(`select status, provider_id from email_sends`)) as { status: string; provider_id: string }[];
    expect(rows).toEqual([{ status: "sent", provider_id: "re_test" }]);
  });

  it("the send log holds no address and no body", async () => {
    const userId = await account();
    await deliver(filled(userId));
    const row = JSON.stringify(await sql.query(`select * from email_sends`));
    expect(row).not.toContain(EMAIL);
    expect(row).not.toContain("NVIDIA");
  });

  it("follows the person's switch for orders and friends, never for security", async () => {
    const userId = await account();
    expect(await readPrefs(userId)).toEqual({ orders: true, friends: true, weekly: false });
    await setPref(userId, "orders", false);
    expect(await deliver(filled(userId))).toBe("pref_off");
    expect(
      await deliver({ userId, ref: "w1", notice: { type: "wallet_added", family: "evm", address: `0x${"b".repeat(40)}` } }),
    ).toBe("sent");
    expect(sent.map((email) => email.headers["X-Berth-Type"])).toEqual(["wallet_added"]);
    await setPref(userId, "orders", true);
    expect(await deliver(filled(userId))).toBe("sent");
  });

  it("puts one click unsubscribe headers on every kind but security", async () => {
    const userId = await account();
    await deliver(filled(userId));
    await deliver({ userId, ref: "m1", notice: { type: "accounts_merged" } });
    const [order, security] = sent;
    expect(order.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/www\.berthmarkets\.com\/api\/email\/unsubscribe\?t=[^>]+>$/);
    expect(order.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(order.headers["List-Unsubscribe"]).not.toContain(userId);
    expect(security.headers["List-Unsubscribe"]).toBeUndefined();
    expect(order.from).toBe("Berth <hello@mail.berthmarkets.com>");
    expect(order.replyTo).toBe("support@berthmarkets.com");
  });

  it("sends nothing to an account without a verified primary email", async () => {
    const userId = await account(null);
    // The legacy column alone is not enough.
    await sql.query(`update users set email = 'legacy@example.com' where id = $1`, [userId]);
    expect(await deliver(filled(userId))).toBe("no_address");
    expect(sent).toHaveLength(0);
  });

  it("sends nothing, security included, to a suppressed address", async () => {
    const userId = await account();
    await suppress("  Sailor@Example.com ", "bounce", "re_x");
    expect(await deliver(filled(userId))).toBe("suppressed");
    expect(await deliver({ userId, ref: "m2", notice: { type: "accounts_merged" } })).toBe("suppressed");
    expect(sent).toHaveLength(0);
  });

  it("sends at most one friend request email a day, held by the database even when requests race", async () => {
    const userId = await account();
    const request = (ref: string): NoticeInput => ({ userId, ref, notice: { type: "friend_request", username: "harbourmaster" } });
    const outcomes = await Promise.all([deliver(request("fr-1")), deliver(request("fr-2")), deliver(request("fr-3"))]);
    expect(outcomes.filter((outcome) => outcome === "sent")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "daily_cap")).toHaveLength(2);
    expect(await deliver(request("fr-1"))).toBe("duplicate");
    // Yesterday's slot does not hold today's.
    await sql.query(`update email_sends set day_key = '2000-01-01'`);
    expect(await deliver(request("fr-4"))).toBe("sent");
    expect(sent).toHaveLength(2);
  });

  it("past the day's cap only security notices go out", async () => {
    vi.stubEnv("EMAIL_DAILY_CAP", "2");
    const userId = await account();
    expect(await deliver(filled(userId, "o1"))).toBe("sent");
    expect(await deliver(filled(userId, "o2"))).toBe("sent");
    expect(await deliver(filled(userId, "o3"))).toBe("daily_volume");
    expect(await deliver({ userId, ref: "m-cap", notice: { type: "accounts_merged" } })).toBe("sent");
    vi.stubEnv("EMAIL_DAILY_CAP", "");
    expect(await deliver(filled(userId, "o3"))).toBe("sent");
  });

  it("waits out a rate limit, then defers a security notice for the next pass instead of failing it", async () => {
    setBackoff([0, 0]);
    const userId = await account();
    let calls = 0;
    setEmailTransport(async (email) => {
      calls += 1;
      if (calls <= 3) return { ok: false, error: "http_429:rate_limit_exceeded" };
      sent.push(email);
      return { ok: true, id: "re_late" };
    });
    expect(await deliver({ userId, ref: "m-429", notice: { type: "accounts_merged" } })).toBe("deferred");
    expect(calls).toBe(3);
    const waiting = (await sql.query(`select status, notice is not null as kept from email_sends`)) as { status: string; kept: boolean }[];
    expect(waiting).toEqual([{ status: "pending", kept: true }]);
    // Not yet stale: the pass leaves it.
    expect(await retryPendingSends()).toEqual({ retried: 0, sent: 0, gaveUp: 0 });
    await sql.query(`update email_sends set created_at = now() - interval '11 minutes'`);
    expect(await retryPendingSends()).toEqual({ retried: 1, sent: 1, gaveUp: 0 });
    expect(sent).toHaveLength(1);
    const done = (await sql.query(`select status, provider_id, notice from email_sends`)) as unknown[];
    expect(done).toEqual([{ status: "sent", provider_id: "re_late", notice: null }]);
    setBackoff(null);
  });

  it("a rate limited order notice fails rather than waiting", async () => {
    setBackoff([0]);
    const userId = await account();
    answer = { ok: false, error: "http_429" };
    expect(await deliver(filled(userId))).toBe("failed");
    setBackoff(null);
  });

  it("the pass sends a claim that died midway, checks the switches again, and gives up after the last attempt", async () => {
    const userId = await account();
    const stale = async (type: string, ref: string, notice: unknown, attempts = 1) =>
      sql.query(
        `insert into email_sends (user_id, type, ref, notice, attempts, created_at) values ($1, $2, $3, $4::jsonb, $5, now() - interval '20 minutes')`,
        [userId, type, ref, JSON.stringify(notice), attempts],
      );
    await stale("wallet_removed", "w-dead", { type: "wallet_removed", family: "evm", address: `0x${"e".repeat(40)}` });
    await stale("order_expired", "o-dead", { type: "order_expired", side: "buy", name: "NVIDIA" });
    await stale("order_expired", "o-old", { type: "order_expired", side: "sell", name: "NVIDIA" }, 5);
    await setPref(userId, "orders", false);
    expect(await retryPendingSends()).toEqual({ retried: 2, sent: 1, gaveUp: 1 });
    expect(sent.map((email) => email.subject)).toEqual(["A wallet was removed from your Berth account"]);
    const rows = (await sql.query(`select ref, status, error, notice from email_sends order by ref`)) as unknown[];
    expect(rows).toEqual([
      { ref: "o-dead", status: "failed", error: "pref_off", notice: null },
      { ref: "o-old", status: "failed", error: "gave_up", notice: null },
      { ref: "w-dead", status: "sent", error: null, notice: null },
    ]);
  });

  it("records a failure without throwing, and a retry of the event tries again", async () => {
    const userId = await account();
    answer = { ok: false, error: "http_500" };
    expect(await deliver(filled(userId))).toBe("failed");
    const failed = (await sql.query(`select status, error from email_sends`)) as { status: string; error: string }[];
    expect(failed).toEqual([{ status: "failed", error: "http_500" }]);
    answer = { ok: true, id: "re_2" };
    expect(await deliver(filled(userId))).toBe("sent");
    expect(await claimSend(userId, "order_filled", "order-1")).toBe("duplicate");
  });

  it("the kill switch stops even a test transport, read at the moment of sending", async () => {
    const userId = await account();
    vi.stubEnv("EMAIL_SENDING", "off");
    expect(await deliver(filled(userId))).toBe("off");
    expect(await retryPendingSends()).toEqual({ retried: 0, sent: 0, gaveUp: 0 });
    vi.stubEnv("EMAIL_SENDING", "");
    expect(sent).toHaveLength(0);
  });

  it("does nothing with sending off and no transport", async () => {
    setEmailTransport(null);
    vi.stubEnv("RESEND_API_KEY", "");
    const userId = await account();
    expect(await deliver(filled(userId))).toBe("off");
    vi.stubEnv("RESEND_API_KEY", "re_key");
    vi.stubEnv("EMAIL_SENDING", "off");
    expect(await deliver(filled(userId))).toBe("off");
    vi.unstubAllEnvs();
    vi.stubEnv("EMAIL_TOKEN_SECRET", "email-db-test-secret");
  });
});

describe("triggers", () => {
  it("a wallet linked to an account sends one security notice after the write", async () => {
    const userId = await account(EMAIL, `0x${"c".repeat(40)}`);
    await sql.query(
      `insert into user_identities (user_id, kind, value, family, is_home, verified_at, proof) values ($1, 'wallet', $2, 'evm', true, now(), 'siwe')`,
      [userId, `eip155:0x${"c".repeat(40)}`],
    );
    expect(await linkWallet(userId, `0x${"d".repeat(40)}`)).toBe("linked");
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].subject).toBe("A wallet was added to your Berth account");
    expect(sent[0].text).toContain("0xdddd…dddd");
    expect(sent[0].text).not.toContain("d".repeat(40));
    // Linking it again changes nothing and sends nothing.
    expect(await linkWallet(userId, `0x${"d".repeat(40)}`)).toBe("already");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sent).toHaveLength(1);
  });
});

describe("limit order trigger", () => {
  it("a fill found by the sync sends one order notice, in names and the price the person set", async () => {
    const userId = await account();
    const nvda = TOKEN_LISTINGS.find((listing) => listing.symbol === "NVDA")!.address.toLowerCase();
    await sql.query(
      `insert into limit_orders (user_id, intent_tx, direction, listing_symbol, listing_address, pay_symbol,
         input_raw, input_decimals, min_output_raw, output_decimals, limit_price)
       values ($1, '0xfillme', 'buy', 'NVDA', $2, 'USDC', 49800000, 6, 249000000000000000, 18, 198.2)`,
      [userId, nvda],
    );
    const filled = {
      intentHash: "0xh",
      txHash: "0xt",
      open: false,
      intent: { inputToken: "0xusdc", outputToken: nvda, inputAmount: "49800000", minOutputAmount: "249000000000000000", deadline: "0" },
      events: [
        { eventType: "intent-filled", txHash: "0xfill", blockNumber: 2, intentState: { exists: true, remainingInput: "0", receivedOutput: "250000000000000000" } },
      ],
    } as unknown as IntentResponse;
    await listLimitOrders(userId, { fetchRecord: async () => filled, onFilled: async () => true });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].subject).toBe("Your NVIDIA buy order filled");
    expect(sent[0].text).toContain("Your price: $198.20");
    expect(sent[0].text).toContain("Received: 0.25 NVIDIA");
    expect(sent[0].text).not.toContain("NVDA");
    // The next look finds it closed: nothing more is sent.
    await listLimitOrders(userId, { fetchRecord: async () => filled, onFilled: async () => true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sent).toHaveLength(1);
  });
});

describe("unsubscribe route", () => {
  it("one click POST switches that kind off and answers an empty 200", async () => {
    const userId = await account();
    const token = await issueUnsubscribeToken({ userId, kind: "orders" });
    const response = await unsubscribeRoute.POST(
      new NextRequest(`http://localhost/api/email/unsubscribe?t=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect((await readPrefs(userId)).orders).toBe(false);
    expect((await readPrefs(userId)).friends).toBe(true);
  });

  it("GET changes nothing and shows the page; the page's form turns it back on", async () => {
    const userId = await account();
    await setPref(userId, "friends", false);
    const token = await issueUnsubscribeToken({ userId, kind: "friends" });
    const url = `http://localhost/api/email/unsubscribe?t=${encodeURIComponent(token)}`;
    const get = await unsubscribeRoute.GET(new NextRequest(url));
    expect(get.status).toBe(303);
    expect(get.headers.get("location")).toContain("/email/u?t=");
    expect((await readPrefs(userId)).friends).toBe(false);
    const on = await unsubscribeRoute.POST(
      new NextRequest(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "action=on" }),
    );
    expect(on.status).toBe(303);
    expect(on.headers.get("location")).toContain("s=on");
    expect((await readPrefs(userId)).friends).toBe(true);
  });

  it("refuses a forged token without touching anything", async () => {
    const userId = await account();
    const response = await unsubscribeRoute.POST(
      new NextRequest(`http://localhost/api/email/unsubscribe?t=forged.token.x.y.z`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }),
    );
    expect(response.status).toBe(400);
    expect((await readPrefs(userId)).orders).toBe(true);
  });
});

describe("webhook route", () => {
  const key = Buffer.from("berth-webhook-db-test-key-bytes!");
  const body = JSON.stringify({ type: "email.complained", data: { email_id: "re_9", to: [EMAIL] } });
  const request = (signatureKey = key) => {
    const id = "msg_db";
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = `v1,${createHmac("sha256", signatureKey).update(`${id}.${ts}.${body}`).digest("base64")}`;
    return new NextRequest("http://localhost/api/email/webhook", {
      method: "POST",
      headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": signature },
      body,
    });
  };

  it("does not exist without RESEND_WEBHOOK_SECRET", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    expect((await webhookRoute.POST(request())).status).toBe(404);
  });

  it("refuses a bad signature, and a signed complaint stops every send to that address", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", `whsec_${key.toString("base64")}`);
    const userId = await account();
    expect((await webhookRoute.POST(request(Buffer.from("wrong")))).status).toBe(401);
    expect(await deliver({ userId, ref: "m3", notice: { type: "accounts_merged" } })).toBe("sent");
    const ok = await webhookRoute.POST(request());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ result: "suppressed" });
    expect(await deliver({ userId, ref: "m4", notice: { type: "accounts_merged" } })).toBe("suppressed");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
  });
});
