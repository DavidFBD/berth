import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifySponsorError, isSponsoredOutcomeUnknown, withGasSponsor } from "./gas-sponsor";

/**
 * Privy's client wraps fetch in fetch-retry (3 retries on 408, 409, 425 and
 * 5xx, and on network errors), and the sponsored send is a POST to the
 * wallet rpc route with no idempotency key: a 502 after Privy had already
 * submitted the user operation would be replayed and could buy twice.
 * patches/@privy-io__js-sdk-core@0.68.4.patch sends a sponsored rpc POST
 * (react-auth puts "sponsor":true in its body; one whose body cannot be
 * read counts as sponsored) with the plain fetch, once. Every other
 * request, unsponsored rpc POSTs included, keeps Privy's retry. These tests load the INSTALLED js-sdk-core, the copy
 * react-auth itself resolves, so a Privy upgrade that drops the patch turns
 * the suite red before it can ship.
 */
const requireFromReactAuth = createRequire(createRequire(import.meta.url).resolve("@privy-io/react-auth"));
const sdkRoot = join(dirname(requireFromReactAuth.resolve("@privy-io/js-sdk-core")), "..", "..");
const ESM = join(sdkRoot, "dist/esm/client/PrivyInternal.mjs");
const CJS = join(sdkRoot, "dist/cjs/client/PrivyInternal.js");

type Internal = {
  _fetch: (request: Request, init?: RequestInit) => Promise<Response>;
  fetch: (route: { path: string; method: string }, options: Record<string, unknown>) => Promise<unknown>;
};

async function makeInternal(fetchImpl: (request: Request) => Promise<Response>): Promise<{ internal: Internal; calls: Request[] }> {
  const calls: Request[] = [];
  // PrivyInternal captures globalThis.fetch when it is constructed.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      calls.push(request);
      return fetchImpl(request);
    }),
  );
  const { PrivyInternal } = (await import(/* @vite-ignore */ pathToFileURL(ESM).href)) as {
    PrivyInternal: new (options: Record<string, unknown>) => Internal;
  };
  const internal = new PrivyInternal({
    appId: "app",
    baseUrl: "https://auth.privy.io",
    storage: { get: async () => null, put: async () => {}, del: async () => {} },
    crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000000" },
    logger: { error() {}, warn() {}, info() {}, debug() {}, log() {} },
  });
  return { internal, calls };
}

const RPC = "https://auth.privy.io/api/v1/wallets/wallet-1/rpc";
/** The marker scripts/check-privy-patch.mjs also looks for at build time. */
const PATCH_MARKER = "berth patch: a sponsored wallet rpc POST";
/** The body react-auth sends for a sponsored eth_sendTransaction (js-sdk-core wallet-api/rpc.mjs). */
const SPONSORED = JSON.stringify({ chain_type: "ethereum", method: "eth_sendTransaction", caip2: "eip155:8453", sponsor: true, params: { transaction: {} } });
const UNSPONSORED = JSON.stringify({ chain_type: "ethereum", method: "eth_signTransaction", caip2: "eip155:8453", params: { transaction: {} } });
const badGateway = () => new Response(JSON.stringify({ error: "Bad gateway" }), { status: 502 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Privy's wallet rpc POST (patched js-sdk-core)", () => {
  it("is the version the patch was written for, and both builds carry the patch", () => {
    const pkg = JSON.parse(readFileSync(join(sdkRoot, "package.json"), "utf8")) as { version: string };
    // A bump must re-make the patch (pnpm also refuses an unused patch).
    expect(pkg.version).toBe("0.68.4");
    for (const file of [ESM, CJS]) expect(readFileSync(file, "utf8")).toContain(PATCH_MARKER);
    // The build-time check looks for the same words.
    expect(readFileSync(join(process.cwd(), "scripts/check-privy-patch.mjs"), "utf8")).toContain(`"${PATCH_MARKER}"`);
  });

  it("sends a sponsored rpc POST exactly once on a 5xx", async () => {
    const { internal, calls } = await makeInternal(async () => badGateway());
    const response = await internal._fetch(new Request(RPC, { method: "POST", body: SPONSORED }));
    expect(response.status).toBe(502);
    expect(calls).toHaveLength(1);
  });

  it("sends an rpc POST whose body cannot be read as JSON once too", async () => {
    const { internal, calls } = await makeInternal(async () => badGateway());
    expect((await internal._fetch(new Request(RPC, { method: "POST", body: "not json" }))).status).toBe(502);
    expect(calls).toHaveLength(1);
  });

  it("sends it exactly once when the connection drops", async () => {
    const { internal, calls } = await makeInternal(async () => {
      throw new TypeError("Load failed");
    });
    await expect(internal._fetch(new Request(RPC, { method: "POST", body: SPONSORED }))).rejects.toThrow("Load failed");
    expect(calls).toHaveLength(1);
  });

  it("still retries everything else, as Privy intends", async () => {
    vi.useFakeTimers();
    const { internal, calls } = await makeInternal(async () => badGateway());
    const pending = internal._fetch(new Request("https://auth.privy.io/api/v1/apps/app", { method: "GET" }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).status).toBe(502);
    expect(calls).toHaveLength(4);
  });

  it("still retries an unsponsored rpc POST (a paid send's signature, a sign-in message)", async () => {
    vi.useFakeTimers();
    const { internal, calls } = await makeInternal(async () => badGateway());
    const pending = internal._fetch(new Request(RPC, { method: "POST", body: UNSPONSORED }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).status).toBe(502);
    expect(calls).toHaveLength(4);
    // "sponsor":false is unsponsored too.
    calls.length = 0;
    const off = internal._fetch(new Request(RPC, { method: "POST", body: JSON.stringify({ method: "eth_sendTransaction", sponsor: false }) }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await off).status).toBe(502);
    expect(calls).toHaveLength(4);
  });

  it("surfaces the 5xx to withGasSponsor as an unknown outcome: never resent, never paid again", async () => {
    const { internal, calls } = await makeInternal(async () => badGateway());
    let thrown: unknown;
    try {
      await internal.fetch(
        { path: "/api/v1/wallets/:wallet_id/rpc", method: "POST" },
        { params: { wallet_id: "wallet-1" }, body: { method: "eth_sendTransaction", sponsor: true }, onRequest: async () => ({}) },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ name: "PrivyApiError", status: 502 });
    expect(classifySponsorError(thrown)).toBe("unknown");

    const inner = { request: vi.fn(async () => "0xpaid") };
    const provider = withGasSponsor(inner, {
      chainId: 8453,
      address: "0xa",
      active: () => true,
      sendSponsored: async () => {
        throw thrown;
      },
    });
    const outcome = await provider.request({ method: "eth_sendTransaction", params: [{ to: "0xb" }] }).catch((error: unknown) => error);
    expect(isSponsoredOutcomeUnknown(outcome)).toBe(true);
    expect(inner.request).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it("treats an edge's HTML 5xx page and a dropped connection as unknown too", () => {
    expect(classifySponsorError(new SyntaxError("JSON Parse error: Unrecognized token '<'"))).toBe("unknown");
    expect(classifySponsorError(new TypeError("Load failed"))).toBe("unknown");
    expect(classifySponsorError(new TypeError("Failed to fetch"))).toBe("unknown");
  });
});
