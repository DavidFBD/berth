import { describe, expect, it } from "vitest";
import { COPY } from "@/lib/copy";
import { TOKEN_LISTINGS } from "@/lib/listings";
import {
  AUTOPOST_EVERY_MS,
  AUTOPOST_SLACK_MS,
  autopostDue,
  autopostEnabled,
  calendarDrafts,
  campaignDraft,
  choosePost,
  composePost,
  hasCallToAction,
  MAX_POST_LENGTH,
  namedListing,
  postLength,
  postProblems,
  postRefusals,
  quotesHeadline,
  withCampaignCta,
  type Draft,
  type LiveCampaign,
} from "@/lib/x-autopost";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Monday 5 October 2026, 22:00 UTC: an evening run.
const MON = Date.parse("2026-10-05T22:00:00Z");

describe("the kill switch", () => {
  it("is off unless X_AUTOPOST_ENABLED is exactly 1, and only in production", () => {
    expect(autopostEnabled({})).toBe(false);
    expect(autopostEnabled({ VERCEL_ENV: "production" })).toBe(false);
    expect(autopostEnabled({ VERCEL_ENV: "production", X_AUTOPOST_ENABLED: "true" })).toBe(false);
    expect(autopostEnabled({ VERCEL_ENV: "preview", X_AUTOPOST_ENABLED: "1" })).toBe(false);
    expect(autopostEnabled({ X_AUTOPOST_ENABLED: "1" })).toBe(false);
    expect(autopostEnabled({ VERCEL_ENV: "production", X_AUTOPOST_ENABLED: "1" })).toBe(true);
  });
});

describe("the schedule", () => {
  it("posts when nothing has been posted", () => {
    expect(autopostDue(undefined, MON)).toBe(true);
  });

  it("posts three days later, allowing two hours early so a late cron never drifts a day", () => {
    expect(autopostDue(MON, MON + AUTOPOST_EVERY_MS)).toBe(true);
    expect(autopostDue(MON + 50 * 60_000, MON + 3 * DAY)).toBe(true);
    expect(autopostDue(MON, MON + 3 * DAY - AUTOPOST_SLACK_MS)).toBe(true);
    expect(autopostDue(MON, MON + 3 * DAY - AUTOPOST_SLACK_MS - 1)).toBe(false);
    expect(autopostDue(MON, MON + 2 * DAY)).toBe(false);
    expect(autopostDue(MON, MON + 1 * DAY)).toBe(false);
  });
});

describe("the calendar", () => {
  it("says Thanksgiving in the week before it, with the day trading resumes, then the half day", () => {
    const drafts = calendarDrafts(Date.parse("2026-11-23T22:00:00Z"));
    expect(drafts.map((draft) => draft.key)).toEqual(["calendar:2026-11-26", "calendar:2026-11-27"]);
    expect(drafts[0].body).toBe(
      "US stock markets are closed on Thursday 26 November for Thanksgiving. Trading resumes on Friday 27 November.",
    );
    expect(drafts[1].body).toBe("US stock markets close early on Friday 27 November, at 1pm New York time.");
  });

  it("names the next session across a weekend", () => {
    // Good Friday 2027 is 26 March; the market reopens Monday 29 March.
    const [draft] = calendarDrafts(Date.parse("2027-03-22T22:00:00Z"));
    expect(draft.body).toContain("Good Friday");
    expect(draft.body).toContain("resumes on Monday 29 March");
  });

  it("says nothing on a week without a closure", () => {
    expect(calendarDrafts(MON)).toEqual([]);
  });

  it("never says a day already passed or today", () => {
    expect(calendarDrafts(Date.parse("2026-11-26T22:00:00Z")).map((draft) => draft.key)).toEqual(["calendar:2026-11-27"]);
  });
});

const CAMPAIGN: LiveCampaign = { code: "welcome-oct", amountUsd: 5, stayDays: 7, placesLeft: 18, endsAt: new Date("2026-11-01T04:00:00Z") };

describe("the campaign", () => {
  it("says a new account opened through the link is paid once it stays, never anything about buying or an inviter", () => {
    const text = composePost(campaignDraft(CAMPAIGN, MON));
    expect(text).toBe(
      "New to Berth? Open an account through this link, set it up and still use Berth 7 days later, and $5 in USDC on Base is added to your account, while places last. 18 places left, until 31 October. How it works: https://www.berthmarkets.com/c/welcome-oct",
    );
    expect(text).not.toMatch(/invite/i);
    expect(text).not.toMatch(/\b(buy|bought|hold|trade)\b/i);
    expect(postProblems(text)).toEqual([]);
    expect(postRefusals(text)).toEqual([]);
  });

  it("leaves out places and the end when they are not known", () => {
    const text = campaignDraft({ ...CAMPAIGN, placesLeft: null, endsAt: null }, MON).body;
    expect(text).toBe("New to Berth? Open an account through this link, set it up and still use Berth 7 days later, and $5 in USDC on Base is added to your account, while places last.");
    expect(campaignDraft({ ...CAMPAIGN, placesLeft: 1, endsAt: null }, MON).body).toMatch(/ 1 place left\.$/);
  });
});

const HOLIDAY = calendarDrafts(Date.parse("2026-11-23T22:00:00Z"));

it("never links a calendar day to a listing, which opens the buy drawer", () => {
  for (const draft of HOLIDAY) {
    expect(draft.url).toBe("https://www.berthmarkets.com");
    expect(draft.cta).toBe("See it on Berth.");
  }
  const promoted = withCampaignCta(HOLIDAY[0], CAMPAIGN);
  expect(promoted.url).not.toContain("?open=");
});

describe("choosing the day's post", () => {
  const base = { campaign: null, calendar: [] as Draft[], used: new Set<string>(), lastSource: null, now: MON };

  it("posts the calendar, and nothing on a day without one", () => {
    expect(choosePost({ ...base, calendar: HOLIDAY })?.draft.source).toBe("calendar");
    expect(choosePost(base)).toBeNull();
  });

  it("never posts the same holiday twice", () => {
    expect(choosePost({ ...base, calendar: HOLIDAY, used: new Set(["calendar:2026-11-26"]) })?.draft.key).toBe("calendar:2026-11-27");
    expect(choosePost({ ...base, calendar: HOLIDAY, used: new Set(["calendar:2026-11-26", "calendar:2026-11-27"]) })).toBeNull();
  });

  it("lets a live campaign take the slot, but never two in a row", () => {
    const first = choosePost({ ...base, campaign: CAMPAIGN, calendar: HOLIDAY });
    expect(first?.draft.source).toBe("campaign");
    expect(first?.campaignCode).toBe("welcome-oct");
    const second = choosePost({ ...base, campaign: CAMPAIGN, calendar: HOLIDAY, lastSource: "campaign" });
    expect(second?.draft.source).toBe("calendar");
    expect(choosePost({ ...base, campaign: CAMPAIGN, lastSource: "campaign" })).toBeNull();
  });

  it("gives a calendar post the campaign as its call to action when it fits", () => {
    const chosen = choosePost({ ...base, campaign: CAMPAIGN, calendar: HOLIDAY, lastSource: "campaign" })!;
    expect(chosen.campaignCode).toBe("welcome-oct");
    expect(chosen.text).toBe(
      "US stock markets are closed on Thursday 26 November for Thanksgiving. Trading resumes on Friday 27 November. New here? Join through this link, set up and still use Berth 7 days later, and $5 in USDC on Base is yours, while places last. https://www.berthmarkets.com/c/welcome-oct",
    );
  });

  it("falls back to its own call to action when the campaign's would not fit", () => {
    const long = { ...HOLIDAY[0], body: "x".repeat(150) };
    const chosen = choosePost({ ...base, campaign: CAMPAIGN, calendar: [long], lastSource: "campaign" })!;
    expect(chosen.campaignCode).toBeNull();
    expect(chosen.text).toContain("See it on Berth.");
  });

  it("skips a draft that breaks a rule rather than post it", () => {
    const tooLong = { ...HOLIDAY[0], key: "calendar:x", body: "y".repeat(300) };
    expect(choosePost({ ...base, calendar: [tooLong, ...HOLIDAY] })?.draft.key).toBe("calendar:2026-11-26");
  });
});

describe("the guard", () => {
  const LINK = "https://www.berthmarkets.com";

  it("finds a listing by its ticker, its name, its short name or its issuer, in any case but a ticker's", () => {
    expect(namedListing("NVIDIA opened a lab")).toBe("NVIDIA");
    expect(namedListing("nvidia opened a lab")).toBe("nvidia");
    expect(namedListing("Watch $NVDA today")).toBe("NVDA");
    expect(namedListing("AAPL and friends")).toBe("AAPL");
    expect(namedListing("Micron Technology reports")).toMatch(/micron/i);
    expect(namedListing("The S&P 500 ETF")).toBe("S&P 500 ETF");
    expect(namedListing("US stock markets are closed on Thursday 26 November for Thanksgiving.")).toBeNull();
    expect(namedListing("a story at https://example.com/NVDA")).toBeNull();
    for (const listing of TOKEN_LISTINGS) {
      expect(namedListing(`A post about ${listing.name} today.`), listing.symbol).not.toBeNull();
      expect(namedListing(`A post about ${listing.symbol} today.`), listing.symbol).not.toBeNull();
    }
  });

  it("knows a call to action, Berth's own and the usual ones", () => {
    for (const line of ["See it on Berth.", "How it works:", "Join through this link", "Sign up now", "Learn more", "Tap to open", "Trade it on Berth"]) {
      expect(hasCallToAction(line), line).toBe(true);
    }
    expect(hasCallToAction("NVIDIA was in the news today.")).toBe(false);
    expect(hasCallToAction("US stock markets close early on Friday 27 November, at 1pm New York time.")).toBe(false);
  });

  it("refuses a listing beside a link or a call to action, however it is written", () => {
    expect(postRefusals(`NVIDIA in the news. See it on Berth. ${LINK}`)).toEqual(["names NVIDIA beside a link or call to action"]);
    expect(postRefusals(`Apple opens a store. ${LINK}`)).toEqual(["names Apple beside a link or call to action"]);
    expect(postRefusals("Tesla was in the news today. See it on Berth.")).toEqual(["names Tesla beside a link or call to action"]);
    expect(postRefusals("Read about TSLA at berthmarkets.com")).toEqual(["names TSLA beside a link or call to action"]);
    expect(postRefusals("Most held on Berth this week: SpaceX. Join through this link")).toHaveLength(1);
  });

  it("lets a listing alone or a link alone through", () => {
    expect(postRefusals("NVIDIA was in the news today.")).toEqual([]);
    expect(postRefusals(`US stock markets close early on Friday 27 November, at 1pm New York time. See it on Berth. ${LINK}`)).toEqual([]);
  });

  it("refuses the 6 October post as it went out", () => {
    const sent =
      "Meta Platforms in the news. GuruFocus reports: “Meta Platforms Expands AI Infrastructure With New Data Center Deal” See it on Berth. https://www.berthmarkets.com";
    const refusals = postRefusals(sent, ["Meta Platforms Expands AI Infrastructure With New Data Center Deal"]);
    expect(refusals).toContain("names Meta Platforms beside a link or call to action");
    expect(refusals).toContain("quotes something");
    expect(refusals).toContain("repeats a headline");
  });

  it("refuses a headline repeated word for word, whole or seven words in a row, whatever the case or punctuation", () => {
    const headline = "NVIDIA opens a new research centre in Taipei - Reuters";
    expect(quotesHeadline("NVIDIA opens a new research centre in Taipei - Reuters", [headline])).toBe(true);
    expect(quotesHeadline("nvidia OPENS a new, research centre in taipei!", [headline])).toBe(true);
    expect(quotesHeadline("Today: opens a new research centre in Taipei.", [headline])).toBe(true);
    expect(quotesHeadline("NVIDIA opens a centre", [headline])).toBe(false);
    expect(quotesHeadline("Fed holds rates", ["Fed holds rates"])).toBe(false);
    expect(quotesHeadline("Markets shut for the day", ["Markets shut for the day"])).toBe(true);
    expect(postRefusals("Fed holds rates steady as markets wait for jobs data", ["Fed holds rates steady as markets wait for jobs data"])).toEqual([
      "repeats a headline",
    ]);
  });

  it("passes every template Berth drafts today", () => {
    const posts = [
      ...calendarDrafts(Date.parse("2026-11-23T22:00:00Z")),
      ...calendarDrafts(Date.parse("2026-12-21T22:00:00Z")),
      ...calendarDrafts(Date.parse("2026-06-29T22:00:00Z")),
    ].flatMap((draft) => [composePost(draft), composePost(withCampaignCta(draft, CAMPAIGN))]);
    posts.push(composePost(campaignDraft(CAMPAIGN, MON)));
    expect(posts.length).toBeGreaterThan(4);
    for (const post of posts) expect(postRefusals(post), post).toEqual([]);
  });
});

describe("length and the copy rules", () => {
  it("counts a link as 23, whatever its length", () => {
    expect(postLength("a https://www.berthmarkets.com/?open=NVDA")).toBe(2 + 23);
    expect(postLength("“x”")).toBe(3);
    expect(postLength("\u{1F680}")).toBe(2);
    expect(postLength("a Amazon.com b")).toBe(4 + 23);
    expect(postLength("Mr. Smith, Jr. Day")).toBe(18);
  });

  it("finds each broken rule", () => {
    expect(postProblems(`${"a".repeat(260)} https://x.co`)).toContain("too long");
    expect(postProblems("Calm - water https://x.co")).toContain("dash");
    expect(postProblems("Calm — water https://x.co")).toContain("dash");
    expect(postProblems("Calm \u{1F680} https://x.co")).toContain("emoji");
    expect(postProblems("See $NVDA https://x.co")).toContain("cashtag");
    expect(postProblems("Buy NVIDIA on Berth https://x.co")).toContain("buy");
    expect(postProblems("No link")).toContain("one link");
    expect(postProblems("From foxbusiness.com https://x.co")).toContain("one link");
    expect(postProblems("A well-made thing https://x.co")).toEqual([]);
  });

  it("keeps every template within the rules at its longest", () => {
    const longestHoliday = "Martin Luther King Jr. Day";
    const longestDay = "Wednesday 30 September";
    const t = COPY.xAutopost;
    const posts = [
      composePost({ body: t.holiday(longestDay, longestHoliday, longestDay), cta: t.seeIt, url: "https://www.berthmarkets.com" }),
      composePost({ body: t.halfDay(longestDay), cta: t.seeIt, url: "https://www.berthmarkets.com" }),
      composePost(campaignDraft({ code: "a".repeat(32), amountUsd: 12.5, stayDays: 90, placesLeft: 1000, endsAt: new Date("2026-09-30T12:00:00Z") }, MON)),
      composePost(withCampaignCta(HOLIDAY[0], { ...CAMPAIGN, amountUsd: 12.5, stayDays: 90 })),
    ];
    for (const post of posts) {
      expect(postProblems(post), post).toEqual([]);
      expect(postRefusals(post), post).toEqual([]);
      expect(postLength(post)).toBeLessThanOrEqual(MAX_POST_LENGTH);
    }
  });

  it("never says buy, sell, advice or a prediction in its own words, and never names a listing", () => {
    const t = COPY.xAutopost;
    const own = [t.holiday("d", "n", "r"), t.halfDay("d"), t.seeIt, t.campaignCta("$5", 7), t.campaignLink, t.campaign("$5", 7, 3, "1 May")];
    for (const line of own) {
      expect(line).not.toMatch(/\b(buy|sell|invest|advice|will rise|target|guarantee)\b/i);
      expect(line).not.toMatch(/\s-\s|[–—]/);
      expect(namedListing(line), line).toBeNull();
    }
  });
});
