import { describe, expect, it } from "vitest";
import { COPY } from "@/lib/copy";
import { STOCK_LISTINGS } from "@/lib/listings";
import {
  AUTOPOST_EVERY_MS,
  AUTOPOST_SLACK_MS,
  autopostDue,
  autopostEnabled,
  calendarDrafts,
  campaignDraft,
  choosePost,
  composePost,
  MAX_POST_LENGTH,
  milestoneDrafts,
  newsDrafts,
  postLength,
  postProblems,
  quotableHeadline,
  withCampaignCta,
  type Draft,
  type LiveCampaign,
  type NewsStory,
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

function story(id: number, over: Partial<NewsStory> & { title?: string; publisher?: string; symbol?: string; ageH?: number; verdict?: "material" | "fact" | "analysis"; about?: number } = {}): NewsStory {
  return {
    id,
    hidden: over.hidden ?? false,
    sources: over.sources ?? [
      {
        source: "marketaux",
        publisher: over.publisher ?? "Reuters",
        title: over.title ?? "NVIDIA opens a new research centre in Taipei",
        url: `https://www.reuters.com/a/${id}`,
        publishedAt: MON - (over.ageH ?? 5) * HOUR,
      },
    ],
    verdicts: over.verdicts ?? [{ symbol: over.symbol ?? "NVDA", verdict: over.verdict ?? "material", about: over.about ?? 0.95, kept: true }],
  };
}

describe("a headline to quote", () => {
  it("is quoted verbatim, the publisher's own suffix taken off", () => {
    expect(quotableHeadline("NVIDIA opens a new research centre in Taipei - Reuters", "NVDA", "Reuters")).toBe(
      "NVIDIA opens a new research centre in Taipei",
    );
  });

  it.each([
    ["a price move", "NVIDIA shares surge after record quarter"],
    ["a percentage", "NVIDIA lifts its dividend by 50%"],
    ["a dollar figure", "NVIDIA wins a $2 billion contract with the Army"],
    ["a ticker", "NVDA opens a new research centre in Taipei"],
    ["an exchange prefix", "NVIDIA Corp (NASDAQ: NVDA) opens a research centre"],
    ["a dash as punctuation", "NVIDIA opens a centre in Taipei - and hires 500"],
    ["an em dash", "NVIDIA opens a centre in Taipei—and hires 500"],
    ["a rating", "Analysts upgrade NVIDIA ahead of its developer conference"],
    ["a prediction", "Where will NVIDIA be in five years? A forecast"],
    ["advice", "Is NVIDIA a buy right now after its developer conference?"],
    ["an emoji", "NVIDIA opens a new research centre in Taipei \u{1F680}"],
    ["inner quotes", 'NVIDIA chief calls Taipei centre "a new home"'],
    ["a handle", "NVIDIA opens a new research centre with @foxconn"],
    ["too short", "NVIDIA news"],
    ["another class's ticker", "Alphabet's GOOG launches a satellite prototype on a SpaceX mission"],
    ["another listing's ticker", "NVIDIA and TSLA sign a chip supply agreement for robots"],
    ["a bare web address", "Amazon.com announces a new warehouse in Ohio for next year"],
    ["a relayed prediction", "Elon Musk says Tesla will be worth more than Apple and Microsoft combined"],
    ["talk of the stock", "Tesla's delivery beat offers something the stock has been missing"],
  ])("refuses %s", (_why, title) => {
    expect(quotableHeadline(title, "NVDA", "Reuters")).toBeNull();
  });
});

it("quotes a company that goes by its letters", () => {
  expect(quotableHeadline("AMD unveils its next data centre chip in San Francisco", "AMD", "Reuters")).toBe(
    "AMD unveils its next data centre chip in San Francisco",
  );
});

describe("news drafts", () => {
  it("quotes a Marketaux headline about a listed company and links to it on Berth", () => {
    const [draft] = newsDrafts({ stories: [story(1)], now: MON, marketauxVisible: true });
    expect(draft).toMatchObject({ source: "news", key: "news:1", symbol: "NVDA", url: "https://www.berthmarkets.com" });
    expect(composePost(draft)).toBe(
      "NVIDIA in the news. Reuters reports: “NVIDIA opens a new research centre in Taipei” See it on Berth. https://www.berthmarkets.com",
    );
  });

  it("is nothing when the public may not see Marketaux", () => {
    expect(newsDrafts({ stories: [story(1)], now: MON, marketauxVisible: false })).toEqual([]);
  });

  it("reads only Marketaux, only the window, only kept readings that report something about a company", () => {
    const nasdaqOnly = story(2, {
      sources: [{ source: "nasdaq", publisher: "Nasdaq", title: "NVIDIA opens a new research centre in Taipei", url: "u", publishedAt: MON - HOUR }],
    });
    const old = story(3, { ageH: 80 });
    const analysis = story(4, { verdict: "analysis" });
    const vague = story(5, { about: 0.5 });
    const fund = story(6, { symbol: "SPY", title: "S&P 500 ETF sees record inflows this week" });
    const hidden = story(7, { hidden: true });
    const notKept = story(8, { verdicts: [{ symbol: "NVDA", verdict: "material", about: 1, kept: false }] });
    expect(newsDrafts({ stories: [nasdaqOnly, old, analysis, vague, fund, hidden, notKept], now: MON, marketauxVisible: true })).toEqual([]);
  });

  it("never quotes a publisher known only by its web address, which X would turn into a second link", () => {
    const stories = [story(1, { publisher: "foxbusiness.com" }), story(2, { publisher: "Reuters", about: 0.85, title: "Tesla names a new chief financial officer today", symbol: "TSLA" })];
    expect(newsDrafts({ stories, now: MON, marketauxVisible: true }).map((d) => d.key)).toEqual(["news:2"]);
  });

  it("ranks material over fact, then how surely it is about the company, then the newest; a company posted this week goes last", () => {
    const stories = [
      story(1, { verdict: "fact", title: "Apple opens a new store in Mumbai this weekend", symbol: "AAPL", publisher: "Bloomberg" }),
      story(2, { verdict: "material", about: 0.85, title: "Tesla names a new chief financial officer today", symbol: "TSLA" }),
      story(3, { verdict: "material", about: 0.99 }),
    ];
    expect(newsDrafts({ stories, now: MON, marketauxVisible: true }).map((d) => d.key)).toEqual(["news:3", "news:2", "news:1"]);
    expect(newsDrafts({ stories, now: MON, marketauxVisible: true, recentSymbols: new Set(["NVDA"]) }).map((d) => d.key)).toEqual([
      "news:2",
      "news:1",
      "news:3",
    ]);
  });
});

describe("milestones", () => {
  it("posts only the published top row, as the board says it", () => {
    const drafts = milestoneDrafts({
      mostHeld: { rows: [{ symbol: "NVDA", oneIn: 4 }], week: "2026-10-19" },
      mostBought: { rows: [{ symbol: "TSLA", people: 15, plus: true }], days: 7, week: "2026-10-12" },
    });
    expect(drafts.map((draft) => [draft.key, draft.body])).toEqual([
      ["most_held:2026-10-19", "Most held on Berth, the week of 19 October: NVIDIA, held by 1 in 4 people who own a stock or fund on Berth."],
      ["most_bought:2026-10-12", "Most bought on Berth, the week of 12 October: Tesla, bought by 15+ people."],
    ]);
  });

  it("is nothing before a week is published or when the board shows nothing", () => {
    expect(milestoneDrafts({ mostHeld: null, mostBought: null })).toEqual([]);
    expect(milestoneDrafts({ mostHeld: { rows: [], week: "2026-10-19" }, mostBought: { rows: [], days: 7, week: "2026-10-12" } })).toEqual([]);
  });
});

const CAMPAIGN: LiveCampaign = { code: "friends-oct", amountUsd: 5, stayDays: 7, perInviter: 3, placesLeft: 18, endsAt: new Date("2026-11-01T04:00:00Z") };

describe("the campaign", () => {
  it("says the inviter is paid for a friend who stays, never anything about buying", () => {
    const text = composePost(campaignDraft(CAMPAIGN, MON));
    expect(text).toBe(
      "Invite a friend who is new to Berth. If they set up their account and still use Berth 7 days later, $5 in USDC is added to your account, for up to 3 friends, while places last. 18 places left, until 31 October. How it works: https://www.berthmarkets.com/c/friends-oct",
    );
    expect(text).not.toMatch(/\b(buy|bought|hold|trade)\b/i);
    expect(postProblems(text)).toEqual([]);
  });

  it("leaves out places and the end when they are not known", () => {
    const text = campaignDraft({ ...CAMPAIGN, placesLeft: null, endsAt: null }, MON).body;
    expect(text).toBe("Invite a friend who is new to Berth. If they set up their account and still use Berth 7 days later, $5 in USDC is added to your account, for up to 3 friends, while places last.");
    expect(campaignDraft({ ...CAMPAIGN, perInviter: 1, placesLeft: null, endsAt: null }, MON).body).toContain("for up to 1 friend, while");
    expect(campaignDraft({ ...CAMPAIGN, placesLeft: 1, endsAt: null }, MON).body).toMatch(/ 1 place left\.$/);
  });
});

const NEWS = newsDrafts({ stories: [story(1)], now: MON, marketauxVisible: true });
const HOLIDAY = calendarDrafts(Date.parse("2026-11-23T22:00:00Z"));
const MILESTONE = milestoneDrafts({ mostHeld: { rows: [{ symbol: "NVDA", oneIn: 4 }], week: "2026-10-19" } });

it("never links a headline, a calendar day or a milestone to a listing, which opens the buy drawer", () => {
  for (const draft of [...NEWS, ...HOLIDAY, ...MILESTONE]) {
    expect(draft.url).toBe("https://www.berthmarkets.com");
    expect(draft.cta).toBe("See it on Berth.");
  }
  const promoted = withCampaignCta(NEWS[0], CAMPAIGN);
  expect(promoted.url).not.toContain("?open=");
});

describe("choosing the day's post", () => {
  const base = { campaign: null, calendar: [] as Draft[], news: [] as Draft[], milestones: [] as Draft[], used: new Set<string>(), lastSource: null, now: MON };

  it("prefers the calendar, then news, then a milestone", () => {
    expect(choosePost({ ...base, calendar: HOLIDAY, news: NEWS, milestones: MILESTONE })?.draft.source).toBe("calendar");
    expect(choosePost({ ...base, news: NEWS, milestones: MILESTONE })?.draft.source).toBe("news");
    expect(choosePost({ ...base, milestones: MILESTONE })?.draft.source).toBe("milestone");
    expect(choosePost(base)).toBeNull();
  });

  it("never posts the same story, holiday or week twice", () => {
    const used = new Set(["calendar:2026-11-26", "calendar:2026-11-27", "news:1"]);
    expect(choosePost({ ...base, calendar: HOLIDAY, news: NEWS, milestones: MILESTONE, used })?.draft.key).toBe("most_held:2026-10-19");
  });

  it("lets a live campaign take the slot, but never two in a row", () => {
    const first = choosePost({ ...base, campaign: CAMPAIGN, news: NEWS });
    expect(first?.draft.source).toBe("campaign");
    expect(first?.campaignCode).toBe("friends-oct");
    const second = choosePost({ ...base, campaign: CAMPAIGN, news: NEWS, lastSource: "campaign" });
    expect(second?.draft.source).toBe("news");
    expect(choosePost({ ...base, campaign: CAMPAIGN, lastSource: "campaign" })).toBeNull();
  });

  it("gives a news or calendar post the campaign as its call to action when it fits, and never a milestone", () => {
    const news = choosePost({ ...base, campaign: CAMPAIGN, news: NEWS, lastSource: "campaign" })!;
    expect(news.campaignCode).toBe("friends-oct");
    expect(news.text).toBe(
      "NVIDIA in the news. Reuters reports: “NVIDIA opens a new research centre in Taipei” Invite a friend: $5 in USDC for you if they set up and still use Berth 7 days later, up to 3 friends, while places last. https://www.berthmarkets.com/c/friends-oct",
    );
    const milestone = choosePost({ ...base, campaign: CAMPAIGN, milestones: MILESTONE, lastSource: "campaign" })!;
    expect(milestone.campaignCode).toBeNull();
    expect(milestone.text).toContain("See it on Berth.");
  });

  it("falls back to its own call to action when the campaign's would not fit", () => {
    const long = { ...NEWS[0], body: `NVIDIA in the news. Reuters reports: “${"x".repeat(150)}”` };
    const chosen = choosePost({ ...base, campaign: CAMPAIGN, news: [long], lastSource: "campaign" })!;
    expect(chosen.campaignCode).toBeNull();
    expect(chosen.text).toContain("See it on Berth.");
  });

  it("skips a draft that breaks a rule rather than post it", () => {
    const tooLong = { ...NEWS[0], key: "news:9", body: "y".repeat(300) };
    expect(choosePost({ ...base, news: [tooLong, ...NEWS] })?.draft.key).toBe("news:1");
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
    const longestName = [...STOCK_LISTINGS].sort((a, b) => b.name.length - a.name.length)[0];
    const longestHoliday = "Martin Luther King Jr. Day";
    const longestDay = "Wednesday 30 September";
    const t = COPY.xAutopost;
    const posts = [
      composePost({ body: t.holiday(longestDay, longestHoliday, longestDay), cta: t.seeIt, url: "https://www.berthmarkets.com" }),
      composePost({ body: t.halfDay(longestDay), cta: t.seeIt, url: "https://www.berthmarkets.com" }),
      composePost({ body: t.mostHeld("30 September", longestName.name, 20), cta: t.seeIt, url: "https://www.berthmarkets.com" }),
      composePost({ body: t.mostBought("30 September", longestName.name, 1000, true), cta: t.seeIt, url: "https://www.berthmarkets.com" }),
      composePost(campaignDraft({ code: "a".repeat(32), amountUsd: 12.5, stayDays: 90, perInviter: 100, placesLeft: 1000, endsAt: new Date("2026-09-30T12:00:00Z") }, MON)),
      composePost(withCampaignCta(HOLIDAY[0], { ...CAMPAIGN, amountUsd: 12.5, stayDays: 90 })),
    ];
    for (const post of posts) {
      expect(postProblems(post), post).toEqual([]);
      expect(postLength(post)).toBeLessThanOrEqual(MAX_POST_LENGTH);
    }
  });

  it("leaves a news post room for a headline of at least 140 characters with the longest name", () => {
    const longestName = [...STOCK_LISTINGS].sort((a, b) => b.name.length - a.name.length)[0].name;
    const t = COPY.xAutopost;
    const post = composePost({ body: t.news(longestName, "The Wall Street Journal", "h".repeat(140)), cta: t.seeIt, url: "https://www.berthmarkets.com" });
    expect(postLength(post)).toBeLessThanOrEqual(MAX_POST_LENGTH);
  });

  it("never says buy, sell, advice or a prediction in its own words", () => {
    const t = COPY.xAutopost;
    const own = [t.holiday("d", "n", "r"), t.halfDay("d"), t.news("N", "P", ""), t.mostHeld("w", "N", 2), t.mostBought("w", "N", 3, false), t.seeIt, t.campaignCta("$5", 7, 3), t.campaignLink, t.campaign("$5", 7, 3, 3, "1 May")];
    for (const line of own) {
      expect(line).not.toMatch(/\b(buy|sell|invest|advice|will rise|target|guarantee)\b/i);
      expect(line).not.toMatch(/\s-\s|[–—]/);
    }
  });
});
