import { ChainKeys, type Sodax, type SpokeChainKey } from "@sodax/sdk";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { MIN_ORDER_USD, isTooSmallQuoteError } from "@/lib/order-minimum";

/**
 * The live quote smoke: the core money journey asked of the real solver,
 * quotes only (no wallet, no signing, no sends). One module for both callers,
 * so the ship gate and the canary ask exactly the same pairs:
 *
 * - `pnpm smoke:quotes` (scripts/smoke-quotes.mjs), through the production
 *   proxy by default, before every ship and after every SDK bump.
 * - `/api/cron/canary`, server side, every 30 minutes in US market hours.
 *
 * It calls `sodax.swaps.getQuote` exactly as the drawers do (hooks/
 * use-pour-quote): the pre-fee amount, the app's sodaxConfig with its
 * partner fee and Sonic overrides. Born as reports/quote-matrix.mjs in the
 * 2026-10-08 core health audit, which found the solver dropping every stock
 * route for minutes at a time while crypto pairs stayed fine. The crypto
 * control row tells those apart: stocks red with the control green is the
 * solver's side, the control red too is the solver or the proxy down, and
 * anything but -4 is worth reading as possibly Berth's.
 */

export type SmokeDir = "buy" | "sell" | "control";
export type SmokeStatus = "ok" | "too_low" | "no_path" | "refused" | "error" | "missing";

export type SmokeJob = {
  dir: SmokeDir;
  /** "USDC@0x2105.base" or a listing symbol. */
  src: string;
  dst: string;
  usd: number;
  /** Whether a stock is on either side: the routes the solver drops. */
  stock: boolean;
  payload?: {
    token_src: string;
    token_src_blockchain_id: SpokeChainKey;
    token_dst: string;
    token_dst_blockchain_id: SpokeChainKey;
    amount: bigint;
  };
  /** Why the job could not be built (a token the SDK no longer carries, no oracle price). */
  missing?: string;
};

export type SmokeAttempt = { status: SmokeStatus; code?: number; message?: string };

export type SmokeRow = Omit<SmokeJob, "payload"> & {
  first: SmokeAttempt;
  retry?: SmokeAttempt;
  /** Failed, then passed on the retry. Counted as a pass, reported apart. */
  flapping: boolean;
  final: SmokeAttempt;
};

type PaySource = readonly [SpokeChainKey, string];

/** The quick matrix: 12 buys and 4 sells at $5 (16 pairs), plus the crypto control. */
const QUICK_BUYS: readonly (readonly [PaySource, readonly string[]])[] = [
  // The main path: a card payment lands as USDC on Base (lib/funding-handoff), and it flapped worst.
  [[ChainKeys.BASE_MAINNET, "USDC"], ["NVDA", "SPY", "AAPL", "TSLA"]],
  [[ChainKeys.ARBITRUM_MAINNET, "ETH"], ["NVDA", "SPY", "AAPL", "TSLA"]],
  [[ChainKeys.SOLANA_MAINNET, "SOL"], ["NVDA", "SPY"]],
  [[ChainKeys.POLYGON_MAINNET, "USDC"], ["AAPL", "TSLA"]],
];
const QUICK_SELLS = ["NVDA", "SPY", "AAPL", "TSLA"];
const QUICK_USD = [5];

/** The full matrix of the audit: 15 pay sources × 4 stocks × 3 sizes, every listing sold at 3 sizes. */
const FULL_PAY: readonly PaySource[] = [
  [ChainKeys.BASE_MAINNET, "USDC"], [ChainKeys.BASE_MAINNET, "ETH"],
  [ChainKeys.ARBITRUM_MAINNET, "USDC"], [ChainKeys.ARBITRUM_MAINNET, "ETH"],
  [ChainKeys.OPTIMISM_MAINNET, "USDC"], [ChainKeys.OPTIMISM_MAINNET, "ETH"],
  [ChainKeys.POLYGON_MAINNET, "USDC"], [ChainKeys.POLYGON_MAINNET, "POL"],
  [ChainKeys.BSC_MAINNET, "USDC"], [ChainKeys.BSC_MAINNET, "ETHB"], [ChainKeys.BSC_MAINNET, "BNB"],
  [ChainKeys.SOLANA_MAINNET, "SOL"], [ChainKeys.SOLANA_MAINNET, "USDC"],
  [ChainKeys.SONIC_MAINNET, "SODA"], [ChainKeys.SONIC_MAINNET, "S"],
];
const FULL_STOCKS = ["NVDA", "SPY", "AAPL", "TSLA"];
const FULL_USD = [2, 5, 20];

/** Where sells land, and the control's two ends. */
const USDC_BASE: PaySource = [ChainKeys.BASE_MAINNET, "USDC"];
const USDC_ARB: PaySource = [ChainKeys.ARBITRUM_MAINNET, "USDC"];

/** Whole units of a token worth `usd` at `price`, in its own decimals. */
export function usdToUnits(usd: number, price: number, decimals: number): bigint {
  const n = usd / price;
  const [i, f = ""] = n.toFixed(Math.min(decimals, 12)).split(".");
  return BigInt(i + f.padEnd(decimals, "0").slice(0, decimals));
}

/** The hub oracle's USD prices by hub asset (lower cased), from api.sodax.com. */
export async function fetchHubPrices(fetcher: typeof fetch = fetch, timeoutMs = 15_000): Promise<Map<string, number>> {
  const response = await fetcher("https://api.sodax.com/v1/intent/oracle", { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`oracle answered ${response.status}`);
  const rows = (await response.json()) as { chainId: string; address: string; priceUsd: number }[];
  return new Map(rows.filter((e) => e.chainId === "146").map((e) => [e.address.toLowerCase(), Number(e.priceUsd)]));
}

type TokenLookup = (chainKey: SpokeChainKey, symbol: string) => { address: string; decimals: number; hubAsset: string } | undefined;

/** The jobs for one run: quick by default, the whole matrix with `full`. */
export function smokeJobs({ full, tokenOn, prices }: { full: boolean; tokenOn: TokenLookup; prices: Map<string, number> }): SmokeJob[] {
  const jobs: SmokeJob[] = [];
  const listing = (symbol: string) => TOKEN_LISTINGS.find((l) => l.symbol === symbol);
  const label = ([chainKey, symbol]: PaySource) => `${symbol}@${chainKey}`;

  const buys: [PaySource, readonly string[]][] = full
    ? FULL_PAY.map((pay) => [pay, FULL_STOCKS])
    : QUICK_BUYS.map(([pay, stocks]) => [pay, stocks]);
  const sizes = full ? FULL_USD : QUICK_USD;
  for (const [pay, stocks] of buys) {
    const token = tokenOn(pay[0], pay[1]);
    const price = token ? prices.get(token.hubAsset.toLowerCase()) : undefined;
    for (const symbol of stocks) {
      const dst = listing(symbol);
      for (const usd of sizes) {
        const base = { dir: "buy" as const, src: label(pay), dst: symbol, usd, stock: true };
        if (!token) jobs.push({ ...base, missing: "token not in the SDK" });
        else if (!price) jobs.push({ ...base, missing: "no oracle price" });
        else if (!dst) jobs.push({ ...base, missing: "listing not found" });
        else
          jobs.push({
            ...base,
            payload: {
              token_src: token.address,
              token_src_blockchain_id: pay[0],
              token_dst: dst.address,
              token_dst_blockchain_id: ChainKeys.SONIC_MAINNET,
              amount: usdToUnits(usd, price, token.decimals),
            },
          });
      }
    }
  }

  const usdcBase = tokenOn(USDC_BASE[0], USDC_BASE[1]);
  const sells = full ? TOKEN_LISTINGS.map((l) => l.symbol) : QUICK_SELLS;
  for (const symbol of sells) {
    const src = listing(symbol);
    const price = src ? prices.get(src.address.toLowerCase()) : undefined;
    for (const usd of sizes) {
      const base = { dir: "sell" as const, src: symbol, dst: label(USDC_BASE), usd, stock: src?.kind === "stock" };
      if (!src || !usdcBase) jobs.push({ ...base, missing: "token not found" });
      else if (!price) jobs.push({ ...base, missing: "no oracle price" });
      else
        jobs.push({
          ...base,
          payload: {
            token_src: src.address,
            token_src_blockchain_id: ChainKeys.SONIC_MAINNET,
            token_dst: usdcBase.address,
            token_dst_blockchain_id: USDC_BASE[0],
            amount: usdToUnits(usd, price, src.decimals),
          },
        });
    }
  }

  // The control: crypto to crypto, so an all red stock column reads as the solver's, not Berth's.
  const a = tokenOn(USDC_BASE[0], USDC_BASE[1]);
  const b = tokenOn(USDC_ARB[0], USDC_ARB[1]);
  const control = { dir: "control" as const, src: label(USDC_BASE), dst: label(USDC_ARB), usd: 5, stock: false };
  jobs.push(
    a && b
      ? {
          ...control,
          payload: {
            token_src: a.address,
            token_src_blockchain_id: USDC_BASE[0],
            token_dst: b.address,
            token_dst_blockchain_id: USDC_ARB[0],
            amount: usdToUnits(5, 1, a.decimals),
          },
        }
      : { ...control, missing: "USDC not in the SDK" },
  );
  return jobs;
}

/** What one quote answer means for the smoke. */
export function attemptOf(result: { ok: true } | { ok: false; error: unknown }): SmokeAttempt {
  if (result.ok) return { status: "ok" };
  const detail = (result.error as { detail?: { code?: unknown; message?: unknown } } | undefined)?.detail;
  const code = typeof detail?.code === "number" ? detail.code : undefined;
  const message = typeof detail?.message === "string" ? detail.message.slice(0, 160) : JSON.stringify(result.error ?? null).slice(0, 160);
  if (isTooSmallQuoteError(result.error)) return { status: "too_low", code, message };
  if (code === -4) return { status: "no_path", code, message };
  if (code === undefined || code === -999) return { status: "error", code, message };
  return { status: "refused", code, message };
}

/** A pass: a quote, or "too low" for a size under Berth's own floor (which the app never asks). */
export function passed(attempt: SmokeAttempt, usd: number): boolean {
  return attempt.status === "ok" || (attempt.status === "too_low" && usd < MIN_ORDER_USD);
}

const QUOTE_TIMEOUT_MS = 20_000;

/** One quote with a deadline (the SDK's own fetch has none), its timer always cleared. */
export async function quoteOnce(sodax: Sodax, job: SmokeJob, timeoutMs = QUOTE_TIMEOUT_MS): Promise<SmokeAttempt> {
  if (!job.payload) return { status: "missing", message: job.missing };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      sodax.swaps.getQuote({ ...job.payload, quote_type: "exact_input" }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer in ${timeoutMs / 1000} s`)), timeoutMs);
      }),
    ]);
    return attemptOf(result);
  } catch (error) {
    return { status: "error", message: String(error instanceof Error ? error.message : error).slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}

/** At most `size` at once, a new one starting as one ends, `gapMs` apart. */
export async function paced<T, R>(items: T[], size: number, work: (item: T) => Promise<R>, gapMs = 0, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
      if (gapMs > 0 && next < items.length) await sleep(gapMs);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(size, items.length)) }, lane));
  return out;
}

/** One job's row from its first answer. */
export function rowOf(job: SmokeJob, first: SmokeAttempt): SmokeRow {
  return {
    dir: job.dir,
    src: job.src,
    dst: job.dst,
    usd: job.usd,
    stock: job.stock,
    ...(job.missing && { missing: job.missing }),
    first,
    flapping: false,
    final: first,
  };
}

/**
 * Runs the jobs, then each failing one once more after `retryDelayMs`, so a
 * single blip does not fail a ship. A pair that fails then passes is
 * flapping: a pass, reported apart.
 */
export async function runSmoke({
  jobs,
  ask,
  retryDelayMs = 20_000,
  concurrency = 8,
  gapMs = 0,
  sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  onRetry,
}: {
  jobs: SmokeJob[];
  ask: (job: SmokeJob) => Promise<SmokeAttempt>;
  /** Negative: no retry (the canary judges flapping across runs instead). */
  retryDelayMs?: number;
  /** Quotes in flight at once. */
  concurrency?: number;
  /** A pause between quotes in each lane, to pace the full matrix through the proxy. */
  gapMs?: number;
  sleep?: (ms: number) => Promise<unknown>;
  onRetry?: (count: number) => void;
}): Promise<SmokeRow[]> {
  const firsts = await paced(jobs, concurrency, ask, gapMs, sleep);
  const rows: SmokeRow[] = jobs.map((job, i) => rowOf(job, firsts[i]));
  const failing = rows.map((row, i) => [row, i] as const).filter(([row]) => !passed(row.first, row.usd) && row.first.status !== "missing");
  if (failing.length === 0 || retryDelayMs < 0) return rows;
  onRetry?.(failing.length);
  await sleep(retryDelayMs);
  const retries = await paced(failing.map(([, i]) => jobs[i]), concurrency, ask, gapMs, sleep);
  failing.forEach(([row], k) => {
    row.retry = retries[k];
    row.final = retries[k];
    row.flapping = passed(retries[k], row.usd);
  });
  return rows;
}

export type SmokeVerdict = {
  /** pass; solver_down: only stock routes refused with -4 while the control quoted; fail: anything else. */
  verdict: "pass" | "solver_down" | "fail";
  failed: SmokeRow[];
  flapping: SmokeRow[];
  controlOk: boolean;
  summary: string;
};

export function smokeVerdict(rows: SmokeRow[]): SmokeVerdict {
  const failed = rows.filter((row) => !passed(row.final, row.usd));
  const flapping = rows.filter((row) => row.flapping);
  const control = rows.find((row) => row.dir === "control");
  const controlOk = !!control && passed(control.final, control.usd);
  const ok = rows.length - failed.length;
  let verdict: SmokeVerdict["verdict"] = "pass";
  let summary = `${ok} of ${rows.length} quoted`;
  if (failed.length > 0) {
    const solverSide = controlOk && failed.every((row) => row.stock && row.final.status === "no_path");
    verdict = solverSide ? "solver_down" : "fail";
    summary += solverSide
      ? `. SOLVER SIDE: ${failed.length} stock route${failed.length === 1 ? "" : "s"} refused with -4 "No path" while the crypto control quoted. Not a Berth regression; escalate to the SODAX solver team.`
      : controlOk
        ? `. FAILED: ${failed.length} pair${failed.length === 1 ? "" : "s"} failed in a way that is not the solver's known -4 on stocks. Read the rows; it may be Berth's.`
        : `. FAILED: the crypto control did not quote either, so the solver or the proxy is down (or the request is broken).`;
  }
  if (flapping.length > 0) summary += ` ${flapping.length} flapping (failed once, passed on retry).`;
  return { verdict, failed, flapping, controlOk, summary };
}

const short = (a: SmokeAttempt | undefined) =>
  !a ? "" : a.status === "ok" ? "ok" : `${a.status}${a.code !== undefined ? ` ${a.code}` : ""}`;

/** A plain text table: every row for the quick run, the failing and flapping ones for the full. */
export function smokeTable(rows: SmokeRow[], { all }: { all: boolean }): string {
  const shown = all ? rows : rows.filter((row) => row.flapping || !passed(row.final, row.usd));
  const head = ["dir", "from", "to", "usd", "first", "retry", "result"];
  const body = shown.map((row) => [
    row.dir,
    row.src,
    row.dst,
    `$${row.usd}`,
    short(row.first),
    short(row.retry),
    row.flapping ? "FLAPPING" : passed(row.final, row.usd) ? "ok" : "FAIL",
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  return [line(head), line(widths.map((w) => "-".repeat(w))), ...body.map(line)].join("\n");
}

/** The SDK's swap token lookup, as the smoke needs it. */
export function sdkTokenLookup(sodax: Sodax): TokenLookup {
  return (chainKey, symbol) => {
    const token = sodax.config.getSupportedSwapTokensByChainId(chainKey).find((t) => t.symbol === symbol);
    return token ? { address: token.address, decimals: token.decimals, hubAsset: String(token.hubAsset) } : undefined;
  };
}
