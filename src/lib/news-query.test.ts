import { describe, expect, it } from "vitest";
import { normaliseQuery } from "@/lib/news-query";

const q = (search: string) => normaliseQuery(new URLSearchParams(search));

describe("/api/news query", () => {
  it("answers only the column's own queries, each at one address", () => {
    expect(q("")).toEqual({ symbol: undefined, mode: undefined, canonical: "" });
    expect(q("symbol=NVDA")).toEqual({ symbol: "NVDA", mode: undefined, canonical: "?symbol=NVDA" });
    expect(q("fresh=1")?.mode).toBe("fresh");
    expect(q("symbol=NVDA&poll=1")?.mode).toBe("poll");
  });

  it("refuses anything else, so a random parameter cannot skip the shared cache", () => {
    for (const search of ["x=1", "symbol=nvda", "symbol=ZZZZ", "fresh=2", "fresh=1&poll=1", "symbol=NVDA&symbol=AAPL", "symbol=NVDA&utm_source=a"]) {
      expect(q(search)).toBeNull();
    }
  });
});
