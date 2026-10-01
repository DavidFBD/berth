import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeNotice, NOTICE_KIND, weeklyHasContent } from "./compose";
import { renderSample, SAMPLE_NOTICES } from "./send";

/**
 * Every notice rendered: the text part as a snapshot, the HTML checked for
 * what it must and must not hold. EMAIL_SHOTS_DIR=<dir> also writes each
 * rendered HTML file there, for screenshots.
 */

const RECIPIENT = "person@example.com";
const FULL_WALLETS = SAMPLE_NOTICES.flatMap(({ notice }) => ("address" in notice ? [notice.address] : []));
// Dashes as punctuation (a spaced hyphen, an en or em dash) and emoji never appear in a person's email.
const DASHES = /\s-\s|[–—]/;
const EMOJI = /\p{Extended_Pictographic}/u;

describe("notice templates", () => {
  for (const { name, notice } of SAMPLE_NOTICES) {
    it(`${name} renders HTML and text without personal data`, async () => {
      const { subject, html, text } = await renderSample(notice);
      const dir = process.env.EMAIL_SHOTS_DIR;
      if (dir) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${name}.html`), html);
        writeFileSync(join(dir, `${name}.txt`), `Subject: ${subject}\n\n${text}\n`);
      }
      expect(`Subject: ${subject}\n\n${text}`).toMatchSnapshot();

      for (const part of [subject, html, text]) {
        expect(part).not.toContain(RECIPIENT);
        for (const wallet of FULL_WALLETS) expect(part).not.toContain(wallet);
        expect(part).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      }
      const content = composeNotice(notice, "https://www.berthmarkets.com");
      for (const line of [content.subject, content.heading, ...content.paragraphs, ...(content.list ?? []), ...(content.after ?? []), content.why, ...(content.sections ?? []).flatMap((section) => [section.heading, ...section.facts.flatMap((fact) => [fact.label, fact.value, fact.aside ?? ""]), section.note ?? ""])]) {
        expect(line).not.toMatch(DASHES);
        expect(line).not.toMatch(EMOJI);
        expect(line).not.toContain("!");
      }
      // The one accent is the button; links go to Berth or the privacy contact only.
      expect(html.match(/#1F4ED8/g)?.length).toBe(1);
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
      for (const href of hrefs) expect(href).toMatch(/^(https:\/\/www\.berthmarkets\.com\/|mailto:support@berthmarkets\.com$)/);
      expect(html).toContain('lang="en"');

      if (NOTICE_KIND[notice.type] === "security") {
        expect(text).toContain("Not you? Write to us at support@berthmarkets.com.");
        expect(text).not.toContain("/api/email/unsubscribe");
      } else {
        expect(text).toContain("Turn these off: https://www.berthmarkets.com/api/email/unsubscribe?t=sample-token");
        expect(html).toContain("/api/email/unsubscribe?t=sample-token");
      }
    });
  }

  it("keeps a client's self given name to one short line", () => {
    const content = composeNotice(
      { type: "assistant_connected", app: `Evil\nApp ${"x".repeat(200)}`, scopes: ["berth.read"] },
      "https://www.berthmarkets.com",
    );
    expect(content.subject).not.toContain("\n");
    expect(content.subject.length).toBeLessThan(110);
    expect(content.list).toEqual(["See what you own and your orders."]);
  });

  it("leaves out a weekly section with nothing trusted to say", () => {
    const content = composeNotice(
      {
        type: "weekly",
        weekOf: "21 September",
        closeDay: null,
        account: null,
        holdings: [],
        orders: { buys: 0, sells: 0, limitsFilled: 0, limitsExpired: 1 },
        recurring: { placed: 0, skipped: 0, next: null },
        friends: { added: 0, salutes: 0 },
      },
      "https://www.berthmarkets.com",
    );
    expect(content.sections).toEqual([{ heading: "Orders", facts: [{ label: "Limit orders", value: "1 expired" }] }]);
    expect(content.paragraphs).toEqual(["Here is what happened in your account in the week of 21 September."]);
    expect(content.after).toEqual(["Values are at the market's close, in US dollars."]);
  });

  it("counts a filled limit order once, as a part of what filled", () => {
    const orders = (buys: number, sells: number, limitsFilled: number) =>
      composeNotice(
        {
          type: "weekly",
          weekOf: "21 September",
          closeDay: null,
          account: null,
          holdings: [],
          orders: { buys, sells, limitsFilled, limitsExpired: 0 },
          recurring: null,
          friends: null,
        },
        "https://www.berthmarkets.com",
      ).sections;
    expect(orders(2, 0, 1)).toEqual([{ heading: "Orders", facts: [{ label: "Filled", value: "2 buys, of which 1 was a limit order" }] }]);
    expect(orders(1, 0, 1)?.[0].facts).toEqual([{ label: "Filled", value: "1 buy, a limit order" }]);
    expect(orders(1, 1, 2)?.[0].facts).toEqual([{ label: "Filled", value: "1 buy, 1 sell, both limit orders" }]);
    expect(orders(3, 1, 2)?.[0].facts).toEqual([{ label: "Filled", value: "3 buys, 1 sell, of which 2 were limit orders" }]);
    // Never more limit orders than filled.
    expect(orders(1, 0, 5)?.[0].facts).toEqual([{ label: "Filled", value: "1 buy, a limit order" }]);
    expect(orders(2, 0, 0)?.[0].facts).toEqual([{ label: "Filled", value: "2 buys" }]);
  });

  it("tells the holdings the list leaves out, even when none is listed", () => {
    const hold = (holdings: { name: string; worth: string; move: string | null }[]) =>
      composeNotice(
        {
          type: "weekly",
          weekOf: "21 September",
          closeDay: "Friday 25 September",
          account: null,
          holdings,
          holdingsRest: { count: 2, worth: "$12.40" },
          orders: null,
          recurring: null,
          friends: null,
        },
        "https://www.berthmarkets.com",
      ).sections;
    expect(hold([{ name: "NVIDIA", worth: "$100.00", move: null }])?.[0].facts).toEqual([
      { label: "NVIDIA", value: "$100.00" },
      { label: "And 2 more", value: "$12.40" },
    ]);
    expect(hold([])).toEqual([{ heading: "What you hold", facts: [{ label: "2 holdings", value: "$12.40" }] }]);
  });

  it("shows the benchmark only beside a change it can be set against", () => {
    const content = composeNotice(
      {
        type: "weekly",
        weekOf: "21 September",
        closeDay: "Friday 25 September",
        account: { worth: "$100.00", change: null, benchmark: { name: "S&P 500 ETF", change: "+0.50%" } },
        holdings: [],
        orders: null,
        recurring: null,
        friends: null,
      },
      "https://www.berthmarkets.com",
    );
    expect(content.sections).toEqual([{ heading: "Your account", facts: [{ label: "Worth at the close", value: "$100.00" }] }]);
    expect(weeklyHasContent({ type: "weekly", weekOf: "x", closeDay: null, account: null, holdings: [], orders: null, recurring: null, friends: null })).toBe(false);
  });
});
