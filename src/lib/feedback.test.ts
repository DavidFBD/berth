import { describe, expect, it } from "vitest";
import { cleanBody, cleanPath, cleanUserAgent, cleanViewport, excerpt, qualifiesForXp, readFeedbackOrder, sanitizeContext, FEEDBACK_MAX_CHARS } from "./feedback";

describe("sanitizeContext", () => {
  it("keeps only the path, the viewport and the user agent, whatever else is sent", () => {
    expect(
      sanitizeContext({
        path: "/?account=rewards",
        viewport: "1280x800",
        userAgent: "Mozilla/5.0 Safari",
        amount: "$500",
        balance: 12,
        wallet: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
        email: "sailor@example.com",
        name: "Sailor",
        order: { id: "x" },
      }),
    ).toEqual({ path: "/", viewport: "1280x800", userAgent: "Mozilla/5.0 Safari" });
  });

  it("answers an empty context for anything that is not an object", () => {
    for (const raw of [null, undefined, "path", 3, ["/"]]) expect(sanitizeContext(raw)).toEqual({ path: null, viewport: null, userAgent: null });
  });
});

describe("cleanPath", () => {
  it("strips query strings and fragments, from a path or a full URL", () => {
    expect(cleanPath("/staff/users?q=sailor@example.com")).toBe("/staff/users");
    expect(cleanPath("/#fine-print")).toBe("/");
    expect(cleanPath("https://www.berthmarkets.com/privacy?utm_source=x#top")).toBe("/privacy");
  });

  it("replaces a username, an invite or campaign code, an address, an email and a long token", () => {
    expect(cleanPath("/u/harbourmaster")).toBe("/u/:username");
    expect(cleanPath("/r/AB12CD")).toBe("/r/:code");
    expect(cleanPath("/c/autumn")).toBe("/c/:code");
    expect(cleanPath("/f/k3y")).toBe("/f/:code");
    expect(cleanPath("/x/0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe("/x/:id");
    expect(cleanPath("/x/sailor%40example.com")).toBe("/x/:id");
    expect(cleanPath("/x/7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV")).toBe("/x/:id");
    expect(cleanPath("/x/bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toBe("/x/:id");
    expect(cleanPath("/x/31612345678")).toBe("/x/:id");
  });

  it("keeps an ordinary screen as it is", () => {
    expect(cleanPath("/dev/board")).toBe("/dev/board");
    expect(cleanPath("/friends")).toBe("/friends");
  });

  it("refuses what is not a path and caps a long one", () => {
    expect(cleanPath("javascript:alert(1)")).toBeNull();
    expect(cleanPath("relative/path")).toBeNull();
    expect(cleanPath(42)).toBeNull();
    expect(cleanPath(`/${"a/".repeat(200)}`)!.length).toBeLessThanOrEqual(160);
  });
});

describe("cleanViewport and cleanUserAgent", () => {
  it("keeps a viewport only in its plain shape", () => {
    expect(cleanViewport("390x844")).toBe("390x844");
    expect(cleanViewport("390 x 844")).toBeNull();
    expect(cleanViewport("390x844; drop table")).toBeNull();
  });

  it("cuts a user agent short and takes out anything shaped like an email", () => {
    expect(cleanUserAgent("Mozilla/5.0 me@example.com Safari")).toBe("Mozilla/5.0 Safari");
    expect(cleanUserAgent("x".repeat(500))!.length).toBe(300);
    expect(cleanUserAgent("\u0000\u0001")).toBeNull();
  });
});

describe("readFeedbackOrder", () => {
  it("keeps a known kind and a hub hash, nothing else", () => {
    const hash = `0x${"AB".repeat(32)}`;
    expect(readFeedbackOrder({ kind: "fill_failed", ref: hash, amount: "5" })).toEqual({ kind: "fill_failed", ref: hash.toLowerCase() });
    expect(readFeedbackOrder({ kind: "unsettled", ref: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" })).toEqual({ kind: "unsettled", ref: null });
    expect(readFeedbackOrder({ kind: "exploded" })).toBeNull();
    expect(readFeedbackOrder("fill_failed")).toBeNull();
  });
});

describe("the message", () => {
  it("is trimmed, never empty, and at most the cap", () => {
    expect(cleanBody("  hello \r\n there  ")).toEqual({ ok: true, body: "hello \n there" });
    expect(cleanBody("   ")).toEqual({ ok: false, error: "empty" });
    expect(cleanBody(null)).toEqual({ ok: false, error: "empty" });
    expect(cleanBody("x".repeat(FEEDBACK_MAX_CHARS + 1))).toEqual({ ok: false, error: "too_long" });
  });

  it("earns the XP from twenty characters, trimmed", () => {
    expect(qualifiesForXp(`   ${"x".repeat(19)}   `)).toBe(false);
    expect(qualifiesForXp("x".repeat(20))).toBe(true);
  });

  it("is quoted back by its first words, cut at a word", () => {
    expect(excerpt("Short one.")).toBe("Short one.");
    const long = "The sell drawer kept the old amount after I switched stocks, so I had to clear it by hand every single time I tried.";
    const cut = excerpt(long, 60);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(61);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
  });
});
