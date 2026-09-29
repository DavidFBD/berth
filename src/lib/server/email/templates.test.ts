import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeNotice, NOTICE_KIND } from "./compose";
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
      for (const line of [content.subject, content.heading, ...content.paragraphs, ...(content.list ?? []), ...(content.after ?? []), content.why]) {
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
});
