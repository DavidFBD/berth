import { describe, expect, it } from "vitest";
import {
  attemptOf,
  passed,
  runSmoke,
  smokeJobs,
  smokeTable,
  smokeVerdict,
  usdToUnits,
  type SmokeAttempt,
  type SmokeJob,
} from "./quote-smoke";
import { TOKEN_LISTINGS } from "./listings";

// Every pay token exists, priced at $1, with 6 decimals: enough to build every job.
const tokenOn = (chainKey: string, symbol: string) => ({ address: `0x${symbol}${chainKey}`, decimals: 6, hubAsset: `hub-${symbol}-${chainKey}` });
const prices = new Proxy(new Map<string, number>(), { get: (target, key) => (key === "get" ? () => 1 : Reflect.get(target, key)) });

const noPath: SmokeAttempt = { status: "no_path", code: -4 };
const ok: SmokeAttempt = { status: "ok" };

describe("smokeJobs", () => {
  it("quick: 16 pairs at $5 plus the crypto control, USDC on Base to every stock first", () => {
    const jobs = smokeJobs({ full: false, tokenOn, prices });
    expect(jobs).toHaveLength(17);
    expect(jobs.filter((j) => j.dir === "buy")).toHaveLength(12);
    expect(jobs.filter((j) => j.dir === "sell")).toHaveLength(4);
    expect(jobs.filter((j) => j.dir === "control")).toHaveLength(1);
    expect(jobs.slice(0, 4).map((j) => `${j.src}>${j.dst}`)).toEqual([
      "USDC@0x2105.base>NVDA", "USDC@0x2105.base>SPY", "USDC@0x2105.base>AAPL", "USDC@0x2105.base>TSLA",
    ]);
    expect(jobs.every((j) => j.usd === 5 && j.payload)).toBe(true);
    expect(jobs.find((j) => j.dir === "control")!.stock).toBe(false);
  });

  it("full: 15 sources x 4 stocks x 3 sizes, every listing sold at 3 sizes, plus the control", () => {
    const jobs = smokeJobs({ full: true, tokenOn, prices });
    expect(jobs.filter((j) => j.dir === "buy")).toHaveLength(180);
    expect(jobs.filter((j) => j.dir === "sell")).toHaveLength(TOKEN_LISTINGS.length * 3);
  });

  it("names a missing token instead of throwing", () => {
    const jobs = smokeJobs({ full: false, tokenOn: (c, s) => (s === "SOL" ? undefined : tokenOn(c, s)), prices });
    expect(jobs.filter((j) => j.missing === "token not in the SDK")).toHaveLength(2);
  });

  it("prices a dollar amount into token units", () => {
    expect(usdToUnits(5, 1, 6)).toBe(5_000_000n);
    expect(usdToUnits(5, 200, 18)).toBe(25_000_000_000_000_000n);
  });
});

describe("attemptOf", () => {
  it.each([
    [{ ok: true } as const, "ok"],
    [{ ok: false, error: { detail: { code: -4, message: "No path was found" } } } as const, "no_path"],
    [{ ok: false, error: { detail: { code: -23, message: "Input amount too low" } } } as const, "too_low"],
    [{ ok: false, error: { detail: { code: -999, message: "SODAX API unreachable" } } } as const, "error"],
    [{ ok: false, error: { detail: "Unauthorized" } } as const, "error"],
    [{ ok: false, error: { detail: { code: -5, message: "No private liquidity" } } } as const, "refused"],
  ])("%j is %s", (result, status) => {
    expect(attemptOf(result).status).toBe(status);
  });

  it("too low passes only under Berth's own floor", () => {
    expect(passed({ status: "too_low" }, 1)).toBe(true);
    expect(passed({ status: "too_low" }, 5)).toBe(false);
  });
});

function jobsOf(n: number, extra: Partial<SmokeJob> = {}): SmokeJob[] {
  return Array.from({ length: n }, (_, i) => ({ dir: "buy" as const, src: `S${i}`, dst: "NVDA", usd: 5, stock: true, payload: {} as SmokeJob["payload"], ...extra }));
}

describe("runSmoke and smokeVerdict", () => {
  const control: SmokeJob = { dir: "control", src: "USDC@base", dst: "USDC@arb", usd: 5, stock: false, payload: {} as SmokeJob["payload"] };

  it("passes when everything quotes, without waiting", async () => {
    let slept = 0;
    const rows = await runSmoke({ jobs: [...jobsOf(3), control], ask: async () => ok, sleep: async (ms) => (slept += ms) });
    expect(slept).toBe(0);
    expect(smokeVerdict(rows).verdict).toBe("pass");
  });

  it("asks a failing pair once more after 20 s; a pass then is flapping, not a failure", async () => {
    const seen = new Map<string, number>();
    let slept = 0;
    const rows = await runSmoke({
      jobs: [...jobsOf(2), control],
      ask: async (job) => {
        const n = (seen.get(job.src) ?? 0) + 1;
        seen.set(job.src, n);
        return job.src === "S0" && n === 1 ? noPath : ok;
      },
      sleep: async (ms) => (slept += ms),
    });
    expect(slept).toBe(20_000);
    const verdict = smokeVerdict(rows);
    expect(verdict.verdict).toBe("pass");
    expect(verdict.flapping.map((r) => r.src)).toEqual(["S0"]);
    expect(verdict.summary).toMatch(/1 flapping/);
    expect(seen.get("S1")).toBe(1);
  });

  it("stocks refused with -4 twice while the control quotes is the solver's side", async () => {
    const rows = await runSmoke({ jobs: [...jobsOf(4), control], ask: async (job) => (job.dir === "control" ? ok : noPath), sleep: async () => {} });
    const verdict = smokeVerdict(rows);
    expect(verdict.verdict).toBe("solver_down");
    expect(verdict.summary).toMatch(/SOLVER SIDE/);
  });

  it("the control failing too is a failure, not an excuse", async () => {
    const rows = await runSmoke({ jobs: [...jobsOf(2), control], ask: async () => noPath, sleep: async () => {} });
    expect(smokeVerdict(rows).verdict).toBe("fail");
  });

  it("anything but -4 on a stock is a failure that may be Berth's", async () => {
    const rows = await runSmoke({
      jobs: [...jobsOf(2), control],
      ask: async (job) => (job.src === "S1" ? { status: "error", code: -999 } : ok),
      sleep: async () => {},
    });
    const verdict = smokeVerdict(rows);
    expect(verdict.verdict).toBe("fail");
    expect(verdict.summary).toMatch(/may be Berth's/);
  });

  it("a crypto pair refused with -4 is not excused as the stock outage", async () => {
    const rows = await runSmoke({
      jobs: [...jobsOf(1, { stock: false, dst: "USDC@arb" }), control],
      ask: async (job) => (job.dir === "control" ? ok : noPath),
      sleep: async () => {},
    });
    expect(smokeVerdict(rows).verdict).toBe("fail");
  });

  it("prints a table with the first answer, the retry and the result", async () => {
    const rows = await runSmoke({ jobs: [...jobsOf(1), control], ask: async (job) => (job.dir === "control" ? ok : noPath), sleep: async () => {} });
    const table = smokeTable(rows, { all: true });
    expect(table.split("\n")[0]).toMatch(/^dir\s+from\s+to\s+usd\s+first\s+retry\s+result$/);
    expect(table).toMatch(/no_path -4\s+no_path -4\s+FAIL/);
    expect(smokeTable(rows, { all: false }).split("\n")).toHaveLength(3);
  });
});

describe("pacing and timers (guards review minors 12, 13)", () => {
  it("paced keeps at most `size` in flight, with gaps between", async () => {
    const { paced } = await import("./quote-smoke");
    let inFlight = 0;
    let most = 0;
    const gaps: number[] = [];
    const out = await paced(
      Array.from({ length: 10 }, (_, i) => i),
      4,
      async (i) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return i * 2;
      },
      250,
      async (ms) => {
        gaps.push(ms);
      },
    );
    expect(most).toBe(4);
    expect(out).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
    expect(gaps.every((ms) => ms === 250)).toBe(true);
  });

  it("quoteOnce clears its deadline whether the quote answers or not", async () => {
    const { quoteOnce } = await import("./quote-smoke");
    const vi = (await import("vitest")).vi;
    vi.useFakeTimers();
    try {
      const sodax = { swaps: { getQuote: async () => ({ ok: true, value: { quoted_amount: 1n } }) } } as never;
      const answered = await quoteOnce(sodax, { dir: "buy", src: "a", dst: "b", usd: 5, stock: true, payload: {} as SmokeJob["payload"] }, 10_000);
      expect(answered.status).toBe("ok");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
