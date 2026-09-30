import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NotHereCard, NotHereDrawerBody } from "./not-here";
import { COPY } from "@/lib/copy";

/**
 * The landing's words, as markup: a visitor with no account is told that
 * nothing about them was stored; a signed in account, whose data is kept
 * as always, never is.
 */

const US = { available: false, reason: "united-states" } as const;

describe("the landing's cards", () => {
  it("tells a visitor with no account that nothing was stored", () => {
    const html = renderToStaticMarkup(createElement(NotHereCard, { availability: US }));
    expect(html).toContain(COPY.unavailable.nothingKept);
    expect(html).not.toContain(COPY.unavailable.accountKept);
  });

  it("says nothing of storage on the consent screen, which cannot know who is reading", () => {
    const html = renderToStaticMarkup(createElement(NotHereCard, { availability: US, anonymous: false }));
    expect(html).not.toContain(COPY.unavailable.nothingKept);
  });

  it("offers an existing account every way in it is given, wallets included, under the sign in line", () => {
    const wayIn = createElement("div", null, createElement("button", null, "Sign in with email"), createElement("button", null, "Connect a wallet"));
    const html = renderToStaticMarkup(createElement(NotHereCard, { availability: US, signIn: wayIn }));
    expect(html).toContain(COPY.unavailable.haveAccount);
    expect(html).toContain("Connect a wallet");
    expect(html).toContain('id="not-here-sign-in"');
    // Without one, no sign in is offered at all.
    expect(renderToStaticMarkup(createElement(NotHereCard, { availability: US }))).not.toContain(COPY.unavailable.haveAccount);
  });

  it("never tells a signed in account that nothing about it was stored", () => {
    const html = renderToStaticMarkup(createElement(NotHereDrawerBody, { availability: US }));
    expect(html).not.toContain(COPY.unavailable.nothingKept);
    expect(html).toContain(COPY.unavailable.accountKept);
    expect(html).toContain("tokens issued for people outside the United States");
  });
});
