import { describe, expect, it } from "vitest";
import { filingsFrom } from "@/lib/server/news-sources/edgar";
import { marketauxItems } from "@/lib/server/news-sources/marketaux";

describe("EDGAR filings", () => {
  const json = {
    filings: {
      recent: {
        accessionNumber: ["0001193125-26-409863", "0001193125-26-409866", "0001193125-26-399364", "0000000000-26-000001", "0000000000-26-000002"],
        filingDate: ["2026-10-01", "2026-10-01", "2026-09-23", "2026-09-30", "2026-08-01"],
        form: ["8-K", "DEFA14A", "4", "10-Q", "8-K"],
        primaryDocument: ["mstr-20260930.htm", "x.htm", "xslF345X06/ownership.xml", "q.htm", "old.htm"],
        items: ["7.01,8.01", "", "", "", ""],
      },
    },
  };

  it("keeps the shown forms with a link to the document, stores insider forms unshown, and skips the rest and the old", () => {
    const events = filingsFrom("MSTR", 1050446, json, "2026-09-18");
    expect(events.map((event) => [event.detail.form, event.shown])).toEqual([
      ["8-K", true],
      ["4", false],
      ["10-Q", true],
    ]);
    expect(events[0]).toMatchObject({
      symbol: "MSTR",
      kind: "filing",
      day: "2026-10-01",
      source: "edgar",
      sourceRef: "0001193125-26-409863",
      detail: { url: "https://www.sec.gov/Archives/edgar/data/1050446/000119312526409863/mstr-20260930.htm", items: "7.01,8.01" },
    });
    // A document in a subfolder links to the filing's folder instead.
    expect(events[1].detail.url).toBe("https://www.sec.gov/Archives/edgar/data/1050446/000119312526399364/");
  });

  it("survives an empty or odd answer", () => {
    expect(filingsFrom("MSTR", 1, {}, "2026-01-01")).toEqual([]);
  });
});

describe("Marketaux articles", () => {
  it("keeps the title, link, publisher and time, tags only our listings it matched well, and nothing else", () => {
    const items = marketauxItems(
      {
        data: [
          {
            uuid: "u1",
            title: " Tesla's Registrations Surge in Europe (TSLA) ",
            url: "https://www.gurufocus.com/news/1/tesla",
            source: "gurufocus.com",
            published_at: "2026-10-01T21:30:33.000000Z",
            language: "en",
            entities: [
              { symbol: "TSLA", match_score: 20.1 },
              { symbol: "NVDA", match_score: 3 },
              { symbol: "RIVN", match_score: 30 },
            ],
            description: "publisher words",
            snippet: "more publisher words",
            image_url: "https://img",
          } as never,
          { uuid: "u2", title: "Nothing of ours", url: "https://a.example/2", published_at: "2026-10-01T00:00:00Z", entities: [{ symbol: "RIVN", match_score: 40 }] },
          { uuid: "u3", title: "No date", url: "https://a.example/3", entities: [{ symbol: "TSLA", match_score: 40 }] },
        ],
      },
      ["TSLA", "NVDA"],
    );
    expect(items).toEqual([
      {
        source: "marketaux",
        sourceId: "u1",
        title: "Tesla's Registrations Surge in Europe (TSLA)",
        url: "https://www.gurufocus.com/news/1/tesla",
        publisher: "GuruFocus",
        publishedAt: Date.parse("2026-10-01T21:30:33Z"),
        symbols: ["TSLA"],
        taggedBy: "feed",
      },
    ]);
    expect(JSON.stringify(items)).not.toMatch(/sentiment|publisher words|img/);
  });
});
