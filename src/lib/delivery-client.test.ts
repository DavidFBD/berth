import { describe, expect, it, vi } from "vitest";
import { getAddress, type Address } from "viem";
import { hubDelivery, type Delivery } from "./delivery";
import { askDelivery, buyDestination, onTheSwitch, readDeliveryAnswer, robinhoodParams } from "./delivery-client";

const WALLET = getAddress("0xbe59d5bf40ac4a349bd748e0d7c19ef27ad3ca23");
const OTHER = getAddress("0x1111111111111111111111111111111111111111");
const RH_TOKEN = "0x2D5D2250EE426cA318efBd03ddf926B23c96f74B" as Address;
const ROBINHOOD: Delivery = { chainKey: "robinhood", address: WALLET, reason: "switched_on" };
const auth = async () => ({ authorization: "Bearer t" });

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("readDeliveryAnswer", () => {
  it("is Robinhood Chain only for a 200 naming it with a valid address", () => {
    expect(readDeliveryAnswer(200, ROBINHOOD)).toEqual(ROBINHOOD);
    expect(readDeliveryAnswer(200, { chainKey: "robinhood", address: "0xnope", reason: "switched_on" })).toEqual(hubDelivery("read_failed"));
    expect(readDeliveryAnswer(200, { chainKey: "robinhood" })).toEqual(hubDelivery("read_failed"));
  });

  it("is the hub for any other status, whatever the body says", () => {
    for (const status of [201, 401, 403, 404, 429, 500, 503]) {
      expect(readDeliveryAnswer(status, ROBINHOOD)).toEqual(hubDelivery("read_failed"));
    }
  });

  it("keeps the route's hub reason, and reads an unknown one as a failure", () => {
    expect(readDeliveryAnswer(200, { chainKey: "sonic", address: null, reason: "not_listed" })).toEqual(hubDelivery("not_listed"));
    expect(readDeliveryAnswer(200, { chainKey: "sonic", address: null, reason: "restricted_country" })).toEqual(hubDelivery("restricted_country"));
    expect(readDeliveryAnswer(200, { chainKey: "sonic", address: null, reason: "made_up" })).toEqual(hubDelivery("read_failed"));
    expect(readDeliveryAnswer(200, null)).toEqual(hubDelivery("read_failed"));
  });
});

describe("askDelivery", () => {
  it("posts to the route with the session's headers and reads the answer", async () => {
    const fetcher = respond(200, ROBINHOOD);
    expect(await askDelivery({ headers: auth, fetcher })).toEqual({ delivery: ROBINHOOD, answered: true });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/delivery");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer t");
  });

  it("is the hub, unanswered, on a non-200, a thrown request, no session or a timeout", async () => {
    const hub = { delivery: hubDelivery("read_failed"), answered: false };
    expect(await askDelivery({ headers: auth, fetcher: respond(500, ROBINHOOD) })).toEqual(hub);
    expect(await askDelivery({ headers: auth, fetcher: respond(401, ROBINHOOD) })).toEqual(hub);
    expect(
      await askDelivery({
        headers: auth,
        fetcher: vi.fn(async () => {
          throw new TypeError("network");
        }),
      }),
    ).toEqual(hub);
    expect(await askDelivery({ headers: async () => null, fetcher: respond(200, ROBINHOOD) })).toEqual(hub);
    const never = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    );
    expect(await askDelivery({ headers: auth, fetcher: never as unknown as typeof fetch, timeoutMs: 10 })).toEqual(hub);
    expect(await askDelivery({ headers: auth, fetcher: vi.fn(async () => new Response("not json", { status: 200 })) })).toEqual(hub);
  });

  it("says whether the account is on the switch only from a real answer", async () => {
    expect(onTheSwitch(await askDelivery({ headers: auth, fetcher: respond(200, ROBINHOOD) }))).toBe(true);
    // Switched, but this buy goes to the hub (abroad, a wallet read failed on the server): what is there is still shown.
    expect(onTheSwitch(await askDelivery({ headers: auth, fetcher: respond(200, hubDelivery("restricted_country")) }))).toBe(true);
    expect(onTheSwitch(await askDelivery({ headers: auth, fetcher: respond(200, hubDelivery("read_failed")) }))).toBe(true);
    expect(onTheSwitch(await askDelivery({ headers: auth, fetcher: respond(200, hubDelivery("not_listed")) }))).toBe(false);
    expect(onTheSwitch(await askDelivery({ headers: auth, fetcher: respond(500, {}) }))).toBe(false);
  });
});

describe("buyDestination", () => {
  it("is the hub whenever the drawer quoted the hub, whatever the fresh answer", () => {
    expect(buyDestination({ quoted: hubDelivery("not_listed"), fresh: hubDelivery("not_listed"), rhAddress: RH_TOKEN })).toEqual({ kind: "hub" });
    expect(buyDestination({ quoted: hubDelivery("read_failed"), fresh: ROBINHOOD, rhAddress: RH_TOKEN })).toEqual({ kind: "hub" });
  });

  it("is the hub for a listing with no token on Robinhood Chain", () => {
    expect(buyDestination({ quoted: ROBINHOOD, fresh: ROBINHOOD, rhAddress: undefined })).toEqual({ kind: "hub" });
  });

  it("is Robinhood Chain when both answers say it, to the same address", () => {
    expect(buyDestination({ quoted: ROBINHOOD, fresh: ROBINHOOD, rhAddress: RH_TOKEN })).toEqual({
      kind: "robinhood",
      address: WALLET,
      rhAddress: RH_TOKEN,
    });
  });

  it("stops when the drawer showed Robinhood Chain and the fresh answer differs (a failure included)", () => {
    expect(buyDestination({ quoted: ROBINHOOD, fresh: hubDelivery("read_failed"), rhAddress: RH_TOKEN })).toEqual({ kind: "changed" });
    expect(
      buyDestination({ quoted: ROBINHOOD, fresh: { ...ROBINHOOD, address: OTHER }, rhAddress: RH_TOKEN }),
    ).toEqual({ kind: "changed" });
  });
});

describe("robinhoodParams", () => {
  it("replaces exactly the destination chain, the output token and the recipient", () => {
    const params = {
      inputToken: "0xin",
      outputToken: "0xsonicListing",
      inputAmount: 5n,
      minOutputAmount: 4n,
      deadline: 9n,
      allowPartialFill: false,
      srcChainKey: "base",
      dstChainKey: "sonic",
      srcAddress: "0xpayer",
      dstAddress: "0xhubWallet",
      solver: "0x0",
      data: "0x",
    } as const;
    const out = robinhoodParams(params as never, { address: WALLET, rhAddress: RH_TOKEN }) as unknown as Record<string, unknown>;
    expect(out).toEqual({ ...params, dstChainKey: "robinhood", outputToken: RH_TOKEN, dstAddress: WALLET });
    // Exactly the address the route answered, not a re-encoding of it.
    expect(out.dstAddress).toBe(WALLET);
  });
});
