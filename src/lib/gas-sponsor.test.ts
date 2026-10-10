import { afterEach, describe, expect, it, vi } from "vitest";
import { InsufficientFundsForPaidSend } from "./gas-need";
import { insufficientGasError } from "./error-copy";
import { ChainKeys } from "@sodax/sdk";
import { createWalletClient, custom, keccak256, toHex } from "viem";
import { base } from "viem/chains";
import {
  gasSponsored,
  isSponsoredChain,
  joinNames,
  markSponsorRefused,
  parseSponsorChains,
  PRIVY_SPONSORABLE_CHAIN_IDS,
  sponsorChainsFromEnv,
  resetSponsorRefusals,
  classifySponsorError,
  isSponsoredOutcomeUnknown,
  ENTRY_POINTS,
  OUTCOME_HOLD_MS,
  RATE_LIMIT_RETRY_MS,
  SponsoredCallFailed,
  sponsoredCallSucceeded,
  USER_OPERATION_EVENT,
  outcomeHoldUntil,
  resetOutcomeHold,
  SponsoredOutcomeUnknown,
  LATE_HOLD_CAP_MS,
  holdAfterUnknownOutcome,
  lateSponsoredSends,
  SPONSORED_SEND_DEADLINE_MS,
  subscribeSponsoredStall,
  sponsorFallbackAllowed,
  sponsorRefusals,
  sponsoredSendsOut,
  sponsoredChainNames,
  sponsoredSendOptions,
  toSponsoredTransaction,
  withGasSponsor,
} from "./gas-sponsor";
import { DEPOSIT_SOURCE_CHAINS, getChainName } from "./chains";
import { COPY } from "./copy";
import { friendlyError } from "./error-copy";

const LIST = parseSponsorChains("8453, 42161,10 137,56");
const HASH = `0x${"ab".repeat(32)}`;

afterEach(() => {
  resetSponsorRefusals();
  resetOutcomeHold();
});

describe("parseSponsorChains", () => {
  it("is off when empty or unset", () => {
    expect(parseSponsorChains(undefined).size).toBe(0);
    expect(parseSponsorChains("").size).toBe(0);
    expect(parseSponsorChains("  , ").size).toBe(0);
  });
  it("reads ids separated by commas or spaces and drops anything else", () => {
    expect([...parseSponsorChains("8453,base, 42161 -1 0x2105 0")]).toEqual([8453, 42161]);
  });
});

describe("sponsorChainsFromEnv", () => {
  it("keeps only chains Privy sponsors for Berth, and warns about each one dropped", () => {
    const warn = vi.fn();
    expect([...sponsorChainsFromEnv("8453,146,42161,43114,999,10,137,56,1,4663", warn)]).toEqual([
      8453, 42161, 10, 137, 56, 4663,
    ]);
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn.mock.calls.map(([message]) => message).join(" ")).toMatch(/146.*43114.*999.*\b1,/);
  });
  it("gives nothing for chains Privy cannot sponsor, nor for Ethereum, whose blocks outlast Privy's 20 second wait", () => {
    expect(sponsorChainsFromEnv("146,43114,999").size).toBe(0);
    expect(sponsorChainsFromEnv("1").size).toBe(0);
    expect(sponsorChainsFromEnv("").size).toBe(0);
  });
  it("is exactly the agreed set", () => {
    expect([...PRIVY_SPONSORABLE_CHAIN_IDS].sort((a, b) => a - b)).toEqual([10, 56, 137, 4663, 8453, 42161]);
  });
});

describe("isSponsoredChain and gasSponsored", () => {
  it("is never on by default", () => {
    expect(isSponsoredChain(ChainKeys.BASE_MAINNET)).toBe(false);
    expect(gasSponsored(ChainKeys.BASE_MAINNET, true)).toBe(false);
  });
  it("covers listed EVM chains only", () => {
    expect(isSponsoredChain(ChainKeys.BASE_MAINNET, LIST)).toBe(true);
    expect(isSponsoredChain(ChainKeys.BSC_MAINNET, LIST)).toBe(true);
    expect(isSponsoredChain(ChainKeys.SONIC_MAINNET, LIST)).toBe(false);
    expect(isSponsoredChain(ChainKeys.SOLANA_MAINNET, parseSponsorChains("1"))).toBe(false);
    expect(isSponsoredChain(null, LIST)).toBe(false);
  });
  it("is for the embedded wallet only, never an external one", () => {
    expect(gasSponsored(ChainKeys.BASE_MAINNET, true, LIST, new Set())).toBe(true);
    expect(gasSponsored(ChainKeys.BASE_MAINNET, false, LIST, new Set())).toBe(false);
  });
  it("drops a chain Privy refused this session, and only that chain", () => {
    markSponsorRefused(8453);
    expect(sponsorRefusals().has(8453)).toBe(true);
    expect(gasSponsored(ChainKeys.BASE_MAINNET, true, LIST)).toBe(false);
    expect(gasSponsored(ChainKeys.ARBITRUM_MAINNET, true, LIST)).toBe(true);
  });
});

describe("chain names", () => {
  it("names the sponsored pay-from chains in list order, joined plainly", () => {
    const names = sponsoredChainNames(DEPOSIT_SOURCE_CHAINS, getChainName, LIST);
    expect(names).toEqual(["Base", "Arbitrum", "Optimism", "Polygon", "BNB Chain"]);
    expect(COPY.gasCoveredChains(joinNames(names, COPY.listAnd))).toBe(
      "Buying from Base, Arbitrum, Optimism, Polygon and BNB Chain has no network fee to pay.",
    );
  });
  it("joins one and two names without a comma", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Base"])).toBe("Base");
    expect(joinNames(["Base", "Arbitrum"])).toBe("Base and Arbitrum");
  });
  it("is empty when sponsorship is off", () => {
    expect(sponsoredChainNames(DEPOSIT_SOURCE_CHAINS, getChainName, new Set())).toEqual([]);
  });
  it("never calls the trade free and uses no dashes", () => {
    const lines = [
      COPY.noNetworkFeeOn("Base"),
      COPY.noNetworkFeeNote,
      COPY.gasCoveredChains("Base"),
      COPY.errOutcomeUnknown,
      COPY.limitSummaryFeeNoGas("0.2 USDC", "Base"),
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/free|first|\bgas\b/i);
      expect(line).not.toMatch(/[–—]| - /);
    }
  });
});

describe("toSponsoredTransaction", () => {
  it("keeps the call and drops gas, fees and empty fields", () => {
    expect(
      toSponsoredTransaction(
        { from: "0xa", to: "0xb", data: "0x1234", value: "0x0", gas: "0x5208" } as never,
        8453,
      ),
    ).toEqual({ from: "0xa", to: "0xb", data: "0x1234", chainId: 8453 });
    expect(toSponsoredTransaction({ to: "0xb", input: "0xff", value: "0x10" }, 10)).toEqual({
      to: "0xb",
      data: "0xff",
      value: "0x10",
      chainId: 10,
    });
  });
});

describe("classifySponsorError", () => {
  const api = (status: number, error = "x", code?: string) =>
    Object.assign(new Error(error), { name: "PrivyApiError", error, status, ...(code ? { code } : {}) });

  it("refuses, so falls back, only on client error statuses from Privy's API", () => {
    for (const status of [400, 402, 403, 422]) {
      expect(classifySponsorError(api(status, "Insufficient credits"))).toBe("refused");
    }
    for (const status of [402, 403]) expect(sponsorFallbackAllowed(api(status))).toBe(true);
    expect(classifySponsorError(api(429, "Too many requests"))).toBe("rate-limited");
  });

  it("tells a simulation revert from a sponsorship refusal on a 400 or 422", () => {
    for (const status of [400, 422]) {
      // Simulation reverts: an ordinary failed order, no paid send.
      expect(classifySponsorError(api(status, "Transaction simulation failed: execution reverted"))).toBe("failed");
      expect(classifySponsorError(api(status, "x", "transaction_execution_failure"))).toBe("failed");
      expect(classifySponsorError(api(status, "Too little received", "invalid_data"))).toBe("failed");
      expect(classifySponsorError(api(status, "Sponsored transaction reverted in simulation"))).toBe("failed");
      // Unsure: still an ordinary failure, sponsorship stays on.
      expect(classifySponsorError(api(status))).toBe("failed");
      expect(classifySponsorError(api(status, "Invalid request", "invalid_request"))).toBe("failed");
      expect(sponsorFallbackAllowed(api(status, "execution reverted"))).toBe(false);
      // Genuine refusals: by code or by words about sponsorship.
      expect(classifySponsorError(api(status, "x", "feature_not_enabled"))).toBe("refused");
      expect(classifySponsorError(api(status, "x", "not_supported"))).toBe("refused");
      expect(classifySponsorError(api(status, "x", "transaction_limit_reached"))).toBe("refused");
      expect(classifySponsorError(api(status, "Gas sponsorship is not enabled for this chain"))).toBe("refused");
      expect(classifySponsorError(api(status, "Paymaster deposit too low"))).toBe("refused");
    }
    // Words on a wrapped cause count too.
    expect(classifySponsorError(new Error("Transaction failed", { cause: api(400, "execution reverted: STF") }))).toBe("failed");
  });

  it("holds a 400 or 422 at or after broadcast as unknown, never failed or refused, whatever else it says", () => {
    for (const status of [400, 422]) {
      expect(classifySponsorError(api(status, "x", "transaction_broadcast_failure"))).toBe("unknown");
      expect(classifySponsorError(api(status, "Failed to broadcast transaction"))).toBe("unknown");
      expect(classifySponsorError(api(status, "eth_sendUserOperation timed out"))).toBe("unknown");
      expect(classifySponsorError(api(status, "Request timeout from bundler"))).toBe("unknown");
      expect(classifySponsorError(api(status, "nonce too low"))).toBe("unknown");
      expect(classifySponsorError(api(status, "already known"))).toBe("unknown");
      expect(classifySponsorError(api(status, "replacement transaction underpriced"))).toBe("unknown");
      // Broadcast outranks revert words and sponsorship words alike.
      expect(classifySponsorError(api(status, "execution reverted", "transaction_broadcast_failure"))).toBe("unknown");
      expect(classifySponsorError(api(status, "Sponsored transaction broadcast failed"))).toBe("unknown");
      expect(sponsorFallbackAllowed(api(status, "x", "transaction_broadcast_failure"))).toBe(false);
    }
    expect(classifySponsorError(new Error("Transaction failed", { cause: api(400, "x", "transaction_broadcast_failure") }))).toBe("unknown");
  });

  it("treats every server or timeout status as unknown, whatever the message says", () => {
    for (const status of [408, 409, 500, 502, 503, 504]) {
      expect(classifySponsorError(api(status, "Chain not configured for sponsorship"))).toBe("unknown");
      expect(sponsorFallbackAllowed(api(status))).toBe(false);
    }
    expect(classifySponsorError({ status: 500 })).toBe("unknown");
    expect(classifySponsorError({ status: 502, message: "Bad Gateway" })).toBe("unknown");
    expect(classifySponsorError(new Error("<html>cloudflare</html>", { cause: { status: 502 } }))).toBe("unknown");
  });

  it("reads status before the message", () => {
    expect(classifySponsorError(api(500, "Sponsoring is only supported for wallets on the TEE stack"))).toBe("unknown");
    expect(classifySponsorError(api(400, "Invalid request"))).toBe("failed");
    // A 400 that timed out may have reached the bundler: held, never failed.
    expect(classifySponsorError(api(400, "Request timed out"))).toBe("unknown");
    expect(classifySponsorError(api(403, "execution reverted"))).toBe("refused");
  });

  it("falls back on react-auth's own pre-send throws", () => {
    expect(classifySponsorError(Object.assign(new Error("Sponsoring is only supported for wallets on the TEE stack"), { type: "client_error" }))).toBe("refused");
    expect(classifySponsorError(new Error("Cannot sponsor a sign transaction request"))).toBe("refused");
    expect(classifySponsorError(Object.assign(new Error("Chain ID 146 is not supported. It must be added"), { privyErrorCode: "unsupported_chain_id" }))).toBe("refused");
  });

  it("never falls back on anything that may have reached the bundler", () => {
    // Privy answered 2xx with no hash: react-auth throws this.
    expect(classifySponsorError(new Error("Unable to sign transaction"))).toBe("unknown");
    expect(classifySponsorError(new Error("something"))).toBe("unknown");
    expect(classifySponsorError(new Error("Transaction failed"))).toBe("unknown");
    expect(classifySponsorError(new Error("execution reverted"))).toBe("unknown");
    expect(classifySponsorError(new Error("paymaster deposit too low"))).toBe("unknown");
    expect(classifySponsorError(Object.assign(new Error("Request timed out"), { privyErrorCode: "client_request_timeout" }))).toBe("unknown");
    expect(classifySponsorError(Object.assign(new Error("fetch failed"), { type: "api_error", status: null }))).toBe("unknown");
    expect(classifySponsorError(new DOMException("signal timed out", "TimeoutError"))).toBe("unknown");
    expect(classifySponsorError(undefined)).toBe("unknown");
    expect(classifySponsorError("Insufficient credits")).toBe("unknown");
  });

  it("knows a cancel", () => {
    expect(classifySponsorError({ code: 4001, message: "nope" })).toBe("cancelled");
    expect(classifySponsorError(new Error("x", { cause: { code: 4001 } }))).toBe("cancelled");
    expect(classifySponsorError(new Error("User rejected the request."))).toBe("cancelled");
  });

  it("counts closing the MFA prompt as a cancel, even beside a refusal status", () => {
    expect(classifySponsorError({ code: "mfa_canceled", error: "MFA canceled" })).toBe("cancelled");
    expect(classifySponsorError({ code: "mfa_canceled", status: 400 })).toBe("cancelled");
    expect(sponsorFallbackAllowed({ code: "mfa_canceled" })).toBe(false);
  });
});

describe("sponsoredSendOptions", () => {
  it("sends headless, so Privy's modal Retry can never send a second time", () => {
    expect(sponsoredSendOptions("0xa")).toEqual({ sponsor: true, address: "0xa", uiOptions: { showWalletUIs: false } });
  });
});

describe("withGasSponsor", () => {
  const sendArgs = { method: "eth_sendTransaction", params: [{ from: "0xa", to: "0xb", data: "0x12" }] };

  function setup(sendSponsored: () => Promise<{ hash: string }>, active = true) {
    const inner = { request: vi.fn(async () => "0xordinary") };
    const onFallback = vi.fn();
    const sponsored = vi.fn(sendSponsored);
    const provider = withGasSponsor(inner, { chainId: 8453, address: "0xa", active: () => active, sendSponsored: sponsored, onFallback });
    return { inner, onFallback, sponsored, provider };
  }

  it("sends through Privy's sponsored path and returns its hash", async () => {
    const { inner, sponsored, provider } = setup(async () => ({ hash: HASH }));
    await expect(provider.request(sendArgs)).resolves.toBe(HASH);
    expect(sponsored).toHaveBeenCalledWith({ from: "0xa", to: "0xb", data: "0x12", chainId: 8453 });
    expect(inner.request).not.toHaveBeenCalled();
  });

  it("passes every other method straight through", async () => {
    const { inner, sponsored, provider } = setup(async () => ({ hash: HASH }));
    await provider.request({ method: "eth_chainId" });
    expect(inner.request).toHaveBeenCalledWith({ method: "eth_chainId" });
    expect(sponsored).not.toHaveBeenCalled();
  });

  it("falls back to the ordinary send when Privy refuses, and says so", async () => {
    const { inner, onFallback, provider } = setup(async () => {
      throw Object.assign(new Error("Insufficient balance for gas sponsorship"), { name: "PrivyApiError", status: 402 });
    });
    await expect(provider.request(sendArgs)).resolves.toBe("0xordinary");
    expect(onFallback).toHaveBeenCalledOnce();
    expect(onFallback.mock.calls[0][1]).toBe("refused");
    expect(inner.request).toHaveBeenCalledWith(sendArgs);
  });

  it("checks the wallet's gas before the paid fallback, and sends nothing when it cannot pay", async () => {
    const inner = { request: vi.fn(async () => "0xordinary") };
    const refused = async () => {
      throw Object.assign(new Error("Insufficient balance for gas sponsorship"), { name: "PrivyApiError", status: 402 });
    };
    const beforePaidSend = vi.fn(async () => {
      throw new InsufficientFundsForPaidSend(100n, 400n);
    });
    const provider = withGasSponsor(inner, { chainId: 8453, address: "0xa", active: () => true, sendSponsored: refused, beforePaidSend });
    const error = await provider.request(sendArgs).catch((caught: unknown) => caught);
    expect(beforePaidSend).toHaveBeenCalledWith(sendArgs.params[0]);
    expect(inner.request).not.toHaveBeenCalled();
    // Reads like the node's own refusal, so the person is told how much to add.
    expect(insufficientGasError(error)).toEqual({ shortfall: 300n });
  });

  it("sends the paid fallback when the gas check passes", async () => {
    const inner = { request: vi.fn(async () => "0xordinary") };
    const refused = async () => {
      throw Object.assign(new Error("Insufficient balance for gas sponsorship"), { name: "PrivyApiError", status: 402 });
    };
    const beforePaidSend = vi.fn(async () => {});
    const provider = withGasSponsor(inner, { chainId: 8453, address: "0xa", active: () => true, sendSponsored: refused, beforePaidSend });
    await expect(provider.request(sendArgs)).resolves.toBe("0xordinary");
    expect(beforePaidSend).toHaveBeenCalledOnce();
  });

  it("asks once more after one 429, and sponsors if Privy then agrees", async () => {
    const tooMany = Object.assign(new Error("Too many requests"), { name: "PrivyApiError", status: 429 });
    const sponsored = vi.fn().mockRejectedValueOnce(tooMany).mockResolvedValueOnce({ hash: HASH });
    const sleep = vi.fn(async () => {});
    const inner = { request: vi.fn() };
    const onFallback = vi.fn();
    const provider = withGasSponsor(inner, { chainId: 8453, address: "0xa", active: () => true, sendSponsored: sponsored, onFallback, sleep });
    await expect(provider.request(sendArgs)).resolves.toBe(HASH);
    expect(sleep).toHaveBeenCalledWith(RATE_LIMIT_RETRY_MS);
    expect(sponsored).toHaveBeenCalledTimes(2);
    expect(inner.request).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("after two 429s pays this once, as rate limited, not refused", async () => {
    const tooMany = Object.assign(new Error("Too many requests"), { status: 429 });
    const inner = { request: vi.fn(async () => "0xordinary") };
    const onFallback = vi.fn();
    const provider = withGasSponsor(inner, {
      chainId: 8453,
      address: "0xa",
      active: () => true,
      sendSponsored: async () => {
        throw tooMany;
      },
      onFallback,
      sleep: async () => {},
    });
    await expect(provider.request(sendArgs)).resolves.toBe("0xordinary");
    expect(onFallback).toHaveBeenCalledWith(tooMany, "rate-limited");
  });

  it("never retries a 429 into an unknown outcome as a paid send", async () => {
    const sponsored = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("slow down"), { status: 429 }))
      .mockRejectedValueOnce(Object.assign(new Error("Bad Gateway"), { status: 502 }));
    const inner = { request: vi.fn() };
    const provider = withGasSponsor(inner, { chainId: 8453, address: "0xa", active: () => true, sendSponsored: sponsored, sleep: async () => {} });
    const failure = await provider.request(sendArgs).catch((caught: unknown) => caught);
    expect(isSponsoredOutcomeUnknown(failure)).toBe(true);
    expect(inner.request).not.toHaveBeenCalled();
  });

  it("retries only a 429: a refusal or unknown outcome is asked once", async () => {
    for (const first of [{ status: 400 }, { status: 502 }, new Error("Unable to sign transaction")]) {
      const sponsored = vi.fn().mockRejectedValueOnce(first).mockResolvedValueOnce({ hash: HASH });
      const sleep = vi.fn(async () => {});
      const inner = { request: vi.fn(async () => "0xordinary") };
      const provider = withGasSponsor(inner, { chainId: 8453, address: "0xa", active: () => true, sendSponsored: sponsored, sleep });
      await provider.request(sendArgs).catch(() => undefined);
      expect(sponsored).toHaveBeenCalledOnce();
      expect(sleep).not.toHaveBeenCalled();
    }
  });

  it("after a 429, a refusal falls back as refused and a cancel is never resent", async () => {
    const tooMany = { status: 429 };
    const refused = { status: 403 };
    const inner = { request: vi.fn(async () => "0xordinary") };
    const onFallback = vi.fn();
    const provider = withGasSponsor(inner, {
      chainId: 8453,
      address: "0xa",
      active: () => true,
      sendSponsored: vi.fn().mockRejectedValueOnce(tooMany).mockRejectedValueOnce(refused),
      onFallback,
      sleep: async () => {},
    });
    await expect(provider.request(sendArgs)).resolves.toBe("0xordinary");
    expect(onFallback).toHaveBeenCalledWith(refused, "refused");

    const mfa = { code: "mfa_canceled" };
    const inner2 = { request: vi.fn() };
    const provider2 = withGasSponsor(inner2, {
      chainId: 8453,
      address: "0xa",
      active: () => true,
      sendSponsored: vi.fn().mockRejectedValueOnce(tooMany).mockRejectedValueOnce(mfa),
      sleep: async () => {},
    });
    await expect(provider2.request(sendArgs)).rejects.toBe(mfa);
    expect(inner2.request).not.toHaveBeenCalled();
  });

  it("treats a simulation revert as an ordinary failed order: no paid send, no hold, the chain stays sponsored", async () => {
    const revert = Object.assign(new Error("Transaction simulation failed: execution reverted"), { name: "PrivyApiError", status: 400 });
    const { inner, onFallback, sponsored, provider } = setup(async () => {
      throw revert;
    });
    await expect(provider.request(sendArgs)).rejects.toBe(revert);
    expect(sponsored).toHaveBeenCalledTimes(1);
    expect(inner.request).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
    expect(outcomeHoldUntil()).toBe(0);
  });

  it("does not fall back or drop the chain when the MFA prompt is closed", async () => {
    const mfa = { code: "mfa_canceled", error: "MFA canceled" };
    const { inner, onFallback, provider } = setup(async () => {
      throw mfa;
    });
    await expect(provider.request(sendArgs)).rejects.toBe(mfa);
    expect(inner.request).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("closes viem's wallet_sendTransaction retry while sponsorship is on, and opens it when off", async () => {
    const on = setup(async () => ({ hash: HASH }));
    await expect(on.provider.request({ method: "wallet_sendTransaction", params: [{}] })).rejects.toMatchObject({ code: -32601 });
    expect(on.inner.request).not.toHaveBeenCalled();
    const off = setup(async () => ({ hash: HASH }), false);
    await off.provider.request({ method: "wallet_sendTransaction", params: [{}] });
    expect(off.inner.request).toHaveBeenCalledOnce();
  });

  it("after two 429s, a paid send short of gas still says how much to add, through viem", async () => {
    const address = "0x000000000000000000000000000000000000000a";
    const inner = {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_sendTransaction") {
          throw Object.assign(new Error("insufficient funds for gas * price + value: have 1000 want 200000000001000"), { code: -32000 });
        }
        throw new Error(`unexpected ${method}`);
      }),
    };
    const busy = Object.assign(new Error("Too many requests"), { name: "PrivyApiError", status: 429 });
    const provider = withGasSponsor(inner, {
      chainId: 8453,
      address,
      active: () => true,
      sendSponsored: async () => {
        throw busy;
      },
      sleep: async () => {},
    });
    const wallet = createWalletClient({ account: address, chain: base, transport: custom(provider) });
    const error = await wallet
      .sendTransaction({ to: "0x000000000000000000000000000000000000000b", value: 1n, gas: 21_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n })
      .catch((caught: unknown) => caught);
    // viem asked wallet_sendTransaction once, was told the method is not there, and kept the original error.
    expect(inner.request.mock.calls.filter(([args]) => args.method === "eth_sendTransaction")).toHaveLength(1);
    const words = friendlyError(error, COPY.errOrderFailed, { symbol: "ETH", decimals: 18, network: "Base" });
    expect(words).toMatch(/^Not enough to cover the network fee\. Add about 0\.000\d+ ETH on Base/);
    expect(words).not.toBe(COPY.errOrderFailed);
  });

  it("does not ask Privy once sponsorship is off for the chain", async () => {
    const { inner, sponsored, provider } = setup(async () => ({ hash: HASH }), false);
    await expect(provider.request(sendArgs)).resolves.toBe("0xordinary");
    expect(sponsored).not.toHaveBeenCalled();
    expect(inner.request).toHaveBeenCalledOnce();
  });

  it("rethrows a cancel as it is, and sends nothing", async () => {
    const cancel = { code: 4001, message: "User rejected" };
    const { inner, onFallback, provider } = setup(async () => {
      throw cancel;
    });
    await expect(provider.request(sendArgs)).rejects.toBe(cancel);
    expect(inner.request).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("never resends after an unknown outcome, and says the outcome is unknown", async () => {
    const unknowns = [
      new Error("Unable to sign transaction"),
      Object.assign(new Error("Internal server error"), { name: "PrivyApiError", status: 500 }),
      Object.assign(new Error("Bad Gateway"), { status: 502 }),
      new Error("Request timed out"),
      new Error("something"),
    ];
    for (const error of unknowns) {
      const { inner, onFallback, provider } = setup(async () => {
        throw error;
      });
      const failure = await provider.request(sendArgs).catch((caught: unknown) => caught);
      expect(isSponsoredOutcomeUnknown(failure)).toBe(true);
      expect((failure as Error).cause).toBe(error);
      expect(inner.request).not.toHaveBeenCalled();
      expect(onFallback).not.toHaveBeenCalled();
    }
  });

  it("stops rather than resend when Privy accepts without a hash", async () => {
    const { inner, provider } = setup(async () => ({ hash: "" }));
    const failure = await provider.request(sendArgs).catch((caught: unknown) => caught);
    expect(isSponsoredOutcomeUnknown(failure)).toBe(true);
    expect(inner.request).not.toHaveBeenCalled();
  });
});

describe("an unknown outcome", () => {
  it("has its own calm words, however deeply it is wrapped, and they never say try again now", () => {
    const wrapped = new Error("UnknownRpcError", {
      cause: new Error("INTENT_CREATION_FAILED", { cause: new SponsoredOutcomeUnknown(new Error("Unable to sign transaction")) }),
    });
    expect(friendlyError(wrapped, COPY.errOrderFailed)).toBe(COPY.errOutcomeUnknown);
    expect(COPY.errOutcomeUnknown).toBe("This order may still go through. Check What you own in a minute before trying again.");
    expect(COPY.errOutcomeUnknown).not.toMatch(/[\u2013\u2014]| - /);
  });

  it("holds the order buttons for a minute, and a refusal or success does not", async () => {
    const inner = { request: vi.fn(async () => "0xordinary") };
    const args = { method: "eth_sendTransaction", params: [{ to: "0xb" }] };
    const make = (send: () => Promise<{ hash: string }>) =>
      withGasSponsor(inner, { chainId: 8453, address: "0xa", active: () => true, sendSponsored: send });

    await make(async () => ({ hash: HASH })).request(args);
    await make(async () => {
      throw Object.assign(new Error("no credits"), { status: 402 });
    }).request(args);
    expect(outcomeHoldUntil()).toBe(0);

    const before = Date.now();
    await make(async () => {
      throw new Error("Unable to sign transaction");
    })
      .request(args)
      .catch(() => null);
    expect(outcomeHoldUntil()).toBeGreaterThanOrEqual(before + OUTCOME_HOLD_MS);
  });
});

describe("a sponsored send past its deadline", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetOutcomeHold();
  });
  const args = { method: "eth_sendTransaction", params: [{ from: "0xa", to: "0xb", data: "0x12" }] };

  function setup(pending: () => Promise<{ hash: string }>, sendDeadlineMs?: number) {
    const inner = { request: vi.fn(async () => "0xordinary") };
    const onFallback = vi.fn();
    const sponsored = vi.fn(pending);
    const provider = withGasSponsor(inner, {
      chainId: 8453,
      address: "0xa",
      active: () => true,
      sendSponsored: sponsored,
      onFallback,
      sendDeadlineMs,
    });
    return { inner, onFallback, sponsored, provider };
  }

  function deferred() {
    let resolve!: (value: { hash: string }) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<{ hash: string }>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("waits about ninety seconds by default, and caps a kept hold at ten minutes", () => {
    expect(SPONSORED_SEND_DEADLINE_MS).toBe(90_000);
    expect(LATE_HOLD_CAP_MS).toBe(600_000);
  });

  it("at the deadline: tells the order screen, holds, and keeps waiting for Privy", async () => {
    vi.useFakeTimers();
    const privy = deferred();
    const stalled = vi.fn();
    const off = subscribeSponsoredStall(stalled);
    const { inner, onFallback, sponsored, provider } = setup(() => privy.promise);
    let settled = false;
    void provider.request(args).finally(() => (settled = true)).catch(() => {});
    await vi.advanceTimersByTimeAsync(SPONSORED_SEND_DEADLINE_MS - 1);
    expect(stalled).not.toHaveBeenCalled();
    // Held all the while the send is out, not only from the deadline.
    expect(outcomeHoldUntil()).toBeGreaterThan(Date.now());
    await vi.advanceTimersByTimeAsync(1);
    expect(stalled).toHaveBeenCalledOnce();
    expect(outcomeHoldUntil()).toBeGreaterThan(Date.now());
    expect(lateSponsoredSends()).toBe(1);
    expect(settled).toBe(false);
    expect(sponsored).toHaveBeenCalledOnce();
    expect(inner.request).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
    off();
  });

  it("keeps the hold past a minute while Privy is silent, then a late hash goes on as a sent order", async () => {
    vi.useFakeTimers();
    const privy = deferred();
    const { inner, sponsored, provider } = setup(() => privy.promise);
    const answer = provider.request(args);
    await vi.advanceTimersByTimeAsync(SPONSORED_SEND_DEADLINE_MS);
    // Three minutes on, far past OUTCOME_HOLD_MS, still held.
    await vi.advanceTimersByTimeAsync(3 * OUTCOME_HOLD_MS);
    expect(outcomeHoldUntil()).toBeGreaterThan(Date.now());
    privy.resolve({ hash: HASH });
    await expect(answer).resolves.toBe(HASH);
    expect(lateSponsoredSends()).toBe(0);
    // A fresh minute from the late answer, then nothing renews it.
    expect(outcomeHoldUntil()).toBe(Date.now() + OUTCOME_HOLD_MS);
    await vi.advanceTimersByTimeAsync(2 * OUTCOME_HOLD_MS);
    expect(outcomeHoldUntil()).toBeLessThan(Date.now());
    expect(sponsored).toHaveBeenCalledOnce();
    expect(inner.request).not.toHaveBeenCalled();
  });

  it("a late refusal lifts the hold, and is never sent again, sponsored or paid", async () => {
    vi.useFakeTimers();
    const privy = deferred();
    const { inner, onFallback, sponsored, provider } = setup(() => privy.promise);
    const answer = provider.request(args).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(SPONSORED_SEND_DEADLINE_MS + 30_000);
    expect(outcomeHoldUntil()).toBeGreaterThan(Date.now());
    // Even a refusal Privy words as "no credits", which before the deadline would fall back to a paid send.
    privy.reject(Object.assign(new Error("Insufficient balance for gas sponsorship"), { status: 402 }));
    const error = await answer;
    expect(isSponsoredOutcomeUnknown(error)).toBe(true);
    expect(outcomeHoldUntil()).toBe(0);
    expect(sponsored).toHaveBeenCalledOnce();
    expect(inner.request).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("a late refusal keeps an ordinary hold another unknown outcome set meanwhile", async () => {
    vi.useFakeTimers();
    const privy = deferred();
    const { provider } = setup(() => privy.promise);
    const answer = provider.request(args).catch(() => null);
    await vi.advanceTimersByTimeAsync(SPONSORED_SEND_DEADLINE_MS);
    // Another send's outcome turns unknown meanwhile: its minute stands.
    holdAfterUnknownOutcome();
    const theirs = outcomeHoldUntil();
    await vi.advanceTimersByTimeAsync(10_000);
    privy.reject(Object.assign(new Error("Forbidden"), { status: 403 }));
    await answer;
    expect(outcomeHoldUntil()).toBe(theirs);
  });

  it("a late answer that may still land (a timeout, a 5xx) holds a fresh minute, never frees the buttons", async () => {
    vi.useFakeTimers();
    const privy = deferred();
    const { inner, onFallback, sponsored, provider } = setup(() => privy.promise);
    const answer = provider.request(args).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(SPONSORED_SEND_DEADLINE_MS + 30_000);
    privy.reject(Object.assign(new Error("Request timed out"), { status: 504 }));
    const error = await answer;
    expect(isSponsoredOutcomeUnknown(error)).toBe(true);
    expect(outcomeHoldUntil()).toBe(Date.now() + OUTCOME_HOLD_MS);
    expect(sponsored).toHaveBeenCalledOnce();
    expect(inner.request).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("stops renewing at the cap even if Privy never answers", async () => {
    vi.useFakeTimers();
    const { provider } = setup(() => new Promise(() => {}));
    void provider.request(args).catch(() => {});
    await vi.advanceTimersByTimeAsync(SPONSORED_SEND_DEADLINE_MS + LATE_HOLD_CAP_MS + 2 * OUTCOME_HOLD_MS);
    expect(outcomeHoldUntil()).toBeLessThan(Date.now());
  });

  it("bounds the retry after a 429 the same way, and never falls back", async () => {
    vi.useFakeTimers();
    const tooMany = Object.assign(new Error("Too many requests"), { name: "PrivyApiError", status: 429 });
    const privy = deferred();
    const sponsored = vi.fn().mockRejectedValueOnce(tooMany).mockReturnValueOnce(privy.promise);
    const inner = { request: vi.fn(async () => "0xordinary") };
    const onFallback = vi.fn();
    const stalled = vi.fn();
    const off = subscribeSponsoredStall(stalled);
    const provider = withGasSponsor(inner, {
      chainId: 8453,
      address: "0xa",
      active: () => true,
      sendSponsored: sponsored,
      onFallback,
      sleep: async () => {},
      sendDeadlineMs: 5,
    });
    const answer = provider.request(args).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5);
    expect(stalled).toHaveBeenCalledOnce();
    privy.reject(new Error("gone"));
    expect(isSponsoredOutcomeUnknown(await answer)).toBe(true);
    expect(sponsored).toHaveBeenCalledTimes(2);
    expect(inner.request).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
    off();
  });

  it("does not touch a send that answers in time", async () => {
    const stalled = vi.fn();
    const off = subscribeSponsoredStall(stalled);
    const { provider } = setup(async () => ({ hash: HASH }), 50);
    await expect(provider.request(args)).resolves.toBe(HASH);
    expect(stalled).not.toHaveBeenCalled();
    expect(outcomeHoldUntil()).toBe(0);
    off();
  });
});

describe("the hold after an unknown outcome, across a refresh and other tabs", () => {
  function fakeStorage(blocked = false) {
    const items = new Map<string, string>();
    const guard = () => {
      if (blocked) throw new DOMException("blocked", "SecurityError");
    };
    return {
      getItem: (key: string) => (guard(), items.get(key) ?? null),
      setItem: (key: string, value: string) => (guard(), void items.set(key, value)),
      removeItem: (key: string) => (guard(), void items.delete(key)),
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("survives a reload within the minute and lapses after it", async () => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
    const first = await import("./gas-sponsor");
    const now = Date.now();
    first.holdAfterUnknownOutcome(now);

    vi.resetModules();
    const reloaded = await import("./gas-sponsor");
    expect(reloaded.outcomeHoldUntil()).toBe(now + OUTCOME_HOLD_MS);

    reloaded.resetOutcomeHold();
    first.holdAfterUnknownOutcome(now - OUTCOME_HOLD_MS - 1);
    vi.resetModules();
    expect((await import("./gas-sponsor")).outcomeHoldUntil()).toBe(0);
  });

  it("reaches a tab that was already open, and never shortens a hold of its own", async () => {
    const storage = fakeStorage();
    const handlers: ((event: { key: string | null }) => void)[] = [];
    vi.stubGlobal("window", {
      localStorage: storage,
      addEventListener: (type: string, handler: (event: { key: string | null }) => void) => {
        if (type === "storage") handlers.push(handler);
      },
      removeEventListener: () => {},
    });
    const other = await import("./gas-sponsor");
    const heard = vi.fn();
    other.subscribeOutcomeHold(heard);
    expect(other.outcomeHoldUntil()).toBe(0);

    // The first tab holds; the browser tells this one through a storage event.
    const now = Date.now();
    storage.setItem("berth.gasSponsorOutcomeHold", String(now + OUTCOME_HOLD_MS));
    for (const handler of handlers) handler({ key: "berth.gasSponsorOutcomeHold" });
    expect(other.outcomeHoldUntil()).toBe(now + OUTCOME_HOLD_MS);
    expect(heard).toHaveBeenCalledTimes(1);

    // An unrelated key, or an earlier end, changes nothing.
    for (const handler of handlers) handler({ key: "something.else" });
    storage.setItem("berth.gasSponsorOutcomeHold", String(now + 1_000));
    for (const handler of handlers) handler({ key: "berth.gasSponsorOutcomeHold" });
    expect(other.outcomeHoldUntil()).toBe(now + OUTCOME_HOLD_MS);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  /** A sponsored send in `mod` that the person cancels: a definite answer before broadcast. */
  async function cancelledSend(mod: typeof import("./gas-sponsor")) {
    const provider = mod.withGasSponsor(
      { request: async () => "0xpaid" },
      { chainId: 8453, address: "0xa", active: () => true, sendSponsored: async () => Promise.reject({ code: 4001 }) },
    );
    await provider.request({ method: "eth_sendTransaction", params: [{ to: "0xb" }] }).catch(() => null);
  }

  it("a reloaded tab keeps an unknown outcome's hold through a send of its own that ends definitely", async () => {
    const storage = fakeStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const first = await import("./gas-sponsor");
    const now = Date.now();
    first.holdAfterUnknownOutcome(now);

    // The page reloads; a sponsored limit cancel from it is then refused.
    vi.resetModules();
    const reloaded = await import("./gas-sponsor");
    await cancelledSend(reloaded);
    expect(reloaded.outcomeHoldUntil()).toBe(now + OUTCOME_HOLD_MS);
    expect(storage.getItem("berth.gasSponsorOutcomeHold")).toBe(String(now + OUTCOME_HOLD_MS));
    reloaded.resetOutcomeHold();
    first.resetOutcomeHold();
  });

  it("a second tab keeps a hold it heard of through a send of its own that ends definitely", async () => {
    const storage = fakeStorage();
    const handlers: ((event: { key: string | null }) => void)[] = [];
    vi.stubGlobal("window", {
      localStorage: storage,
      addEventListener: (type: string, handler: (event: { key: string | null }) => void) => {
        if (type === "storage") handlers.push(handler);
      },
      removeEventListener: () => {},
    });
    const other = await import("./gas-sponsor");
    const off = other.subscribeOutcomeHold(() => {});
    // The first tab's send ends unknown; the browser tells this one.
    const now = Date.now();
    storage.setItem("berth.gasSponsorOutcomeHold", String(now + OUTCOME_HOLD_MS));
    for (const handler of handlers) handler({ key: "berth.gasSponsorOutcomeHold" });
    await cancelledSend(other);
    expect(other.outcomeHoldUntil()).toBe(now + OUTCOME_HOLD_MS);
    expect(storage.getItem("berth.gasSponsorOutcomeHold")).toBe(String(now + OUTCOME_HOLD_MS));
    off();
    other.resetOutcomeHold();
  });

  it("still holds this page when storage is blocked", async () => {
    vi.stubGlobal("window", { localStorage: fakeStorage(true) });
    const mod = await import("./gas-sponsor");
    expect(mod.outcomeHoldUntil()).toBe(0);
    const now = Date.now();
    mod.holdAfterUnknownOutcome(now);
    expect(mod.outcomeHoldUntil()).toBe(now + OUTCOME_HOLD_MS);
    mod.resetOutcomeHold();
    expect(mod.outcomeHoldUntil()).toBe(0);
  });
});

describe("the call inside a sponsored transaction", () => {
  const SENDER = "0x1111111111111111111111111111111111111111";
  const OTHER = "0x2222222222222222222222222222222222222222";
  const V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  const word = (value: bigint | number) => BigInt(value).toString(16).padStart(64, "0");
  const pad = (address: string) => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
  const userOp = (sender: string, success: boolean, address = V07) => ({
    address,
    topics: [USER_OPERATION_EVENT, `0x${"ab".repeat(32)}`, pad(sender), pad(OTHER)],
    data: `0x${word(7)}${word(success ? 1 : 0)}${word(1000)}${word(50000)}`,
  });

  it("knows the EntryPoint's event", () => {
    expect(USER_OPERATION_EVENT).toBe(
      keccak256(toHex("UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)")),
    );
    expect(ENTRY_POINTS.has(V07.toLowerCase())).toBe(true);
  });

  it("reads our user operation's own success flag", () => {
    expect(sponsoredCallSucceeded({ status: "success", logs: [userOp(SENDER, true)] }, SENDER)).toBe(true);
    expect(sponsoredCallSucceeded({ status: "success", logs: [userOp(SENDER, false)] }, SENDER)).toBe(false);
  });

  it("ignores other senders in the same bundle, and look-alike events from other contracts", () => {
    const logs = [userOp(OTHER, false), userOp(SENDER, true), userOp(SENDER, false, OTHER)];
    expect(sponsoredCallSucceeded({ status: "success", logs }, SENDER)).toBe(true);
  });

  it("says nothing without a user operation of ours, and fails a reverted outer transaction", () => {
    expect(sponsoredCallSucceeded({ status: "success", logs: [] }, SENDER)).toBeUndefined();
    expect(sponsoredCallSucceeded({ status: "reverted", logs: [userOp(SENDER, true)] }, SENDER)).toBe(false);
  });

  it("turns a failed inner call into a failed order, never a resend or an unknown outcome", async () => {
    const inner = { request: vi.fn(async () => "0xordinary") };
    const onFallback = vi.fn();
    const provider = withGasSponsor(inner, {
      chainId: 8453,
      address: SENDER,
      active: () => true,
      sendSponsored: async () => ({ hash: HASH }),
      readReceipt: async () => ({ status: "success", logs: [userOp(SENDER, false)] }),
      onFallback,
    });
    const failure = await provider
      .request({ method: "eth_sendTransaction", params: [{ to: "0xb" }] })
      .catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(SponsoredCallFailed);
    expect(isSponsoredOutcomeUnknown(failure)).toBe(false);
    expect(friendlyError(failure, COPY.errOrderFailed)).toBe(COPY.errOrderFailed);
    expect(inner.request).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
    expect(outcomeHoldUntil()).toBe(0);
  });

  it("trusts the hash when the receipt succeeds or cannot be read", async () => {
    for (const readReceipt of [
      async () => ({ status: "success", logs: [userOp(SENDER, true)] }),
      async () => undefined,
      async () => {
        throw new Error("rpc down");
      },
    ]) {
      const provider = withGasSponsor(
        { request: vi.fn() },
        { chainId: 8453, address: SENDER, active: () => true, sendSponsored: async () => ({ hash: HASH }), readReceipt },
      );
      await expect(provider.request({ method: "eth_sendTransaction", params: [{ to: "0xb" }] })).resolves.toBe(HASH);
    }
  });
});

describe("Robinhood Chain (4663)", () => {
  it("is sponsorable once listed, for an email session only, and drops out once Privy refuses it", () => {
    const RH = ChainKeys.ROBINHOOD_MAINNET;
    const warn = vi.fn();
    const ids = sponsorChainsFromEnv("8453,4663", warn);
    expect(PRIVY_SPONSORABLE_CHAIN_IDS.has(4663)).toBe(true);
    expect([...ids]).toEqual([8453, 4663]);
    expect(warn).not.toHaveBeenCalled();
    expect(isSponsoredChain(RH, ids)).toBe(true);
    expect(gasSponsored(RH, true, ids, new Set())).toBe(true);
    // An external wallet signs and pays for itself.
    expect(gasSponsored(RH, false, ids, new Set())).toBe(false);
    // Not listed in the env: not sponsored.
    expect(isSponsoredChain(RH, sponsorChainsFromEnv("8453"))).toBe(false);
    // A refusal (credits out, the dashboard not ticking it) falls back to the ordinary, paid send.
    expect(gasSponsored(RH, true, ids, new Set([4663]))).toBe(false);
  });
});

describe("the hold while a sponsored send is out", () => {
  const args = { method: "eth_sendTransaction", params: [{ from: "0xa", to: "0xb", data: "0x12" }] };

  function deferred() {
    let resolve!: (value: { hash: string }) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<{ hash: string }>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  function setup(pending: () => Promise<{ hash: string }>, extra: Partial<Parameters<typeof withGasSponsor>[1]> = {}) {
    const inner = { request: vi.fn(async () => "0xpaid") };
    const sponsored = vi.fn(pending);
    const provider = withGasSponsor(inner, { chainId: 8453, address: "0xa", active: () => true, sendSponsored: sponsored, ...extra });
    return { inner, sponsored, provider };
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("holds the moment Privy is asked, before it answers", async () => {
    const privy = deferred();
    const { provider } = setup(() => privy.promise);
    const answer = provider.request(args);
    await Promise.resolve();
    expect(outcomeHoldUntil()).toBeGreaterThan(Date.now());
    expect(sponsoredSendsOut()).toBe(1);
    privy.resolve({ hash: HASH });
    await expect(answer).resolves.toBe(HASH);
    // A hash: the order is out and followed from here; the hold lifts.
    expect(outcomeHoldUntil()).toBe(0);
    expect(sponsoredSendsOut()).toBe(0);
  });

  it("renews the hold while Privy is slow, short of the deadline", async () => {
    vi.useFakeTimers();
    const privy = deferred();
    const { provider } = setup(() => privy.promise);
    const answer = provider.request(args);
    // Past a whole minute, still before the ninety second deadline.
    await vi.advanceTimersByTimeAsync(OUTCOME_HOLD_MS + 20_000);
    expect(outcomeHoldUntil()).toBeGreaterThan(Date.now());
    privy.resolve({ hash: HASH });
    await answer;
    expect(outcomeHoldUntil()).toBe(0);
  });

  it("is in storage from the start, so a reload mid-POST comes back held", async () => {
    const items = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
        removeItem: (key: string) => void items.delete(key),
      },
    });
    vi.resetModules();
    const mod = await import("./gas-sponsor");
    const provider = withGasSponsorFrom(mod, () => new Promise(() => {}));
    void provider.request(args).catch(() => {});
    await Promise.resolve();
    // The page goes away here; a fresh one reads the hold back.
    vi.resetModules();
    const reloaded = await import("./gas-sponsor");
    expect(reloaded.outcomeHoldUntil()).toBeGreaterThan(Date.now());
    expect(reloaded.outcomeHoldUntil()).toBeLessThanOrEqual(Date.now() + OUTCOME_HOLD_MS);
    mod.resetOutcomeHold();
    vi.resetModules();
  });

  function withGasSponsorFrom(mod: typeof import("./gas-sponsor"), pending: () => Promise<{ hash: string }>) {
    return mod.withGasSponsor({ request: async () => "0xpaid" }, { chainId: 8453, address: "0xa", active: () => true, sendSponsored: pending });
  }

  it("lifts on a definite answer before broadcast: a refusal, a revert, a cancel", async () => {
    const answers = [
      Object.assign(new Error("Transaction simulation failed: execution reverted"), { status: 400 }),
      { code: 4001, message: "User rejected" },
    ];
    for (const error of answers) {
      const { provider } = setup(async () => Promise.reject(error));
      await provider.request(args).catch(() => null);
      expect(outcomeHoldUntil()).toBe(0);
    }
    // A refusal lifts the hold before the paid send and its gas check.
    let heldAtPaidSend = -1;
    const { provider, inner } = setup(async () => Promise.reject(Object.assign(new Error("no credits"), { status: 402 })), {
      beforePaidSend: async () => {
        heldAtPaidSend = outcomeHoldUntil();
      },
    });
    await expect(provider.request(args)).resolves.toBe("0xpaid");
    expect(heldAtPaidSend).toBe(0);
    expect(inner.request).toHaveBeenCalledOnce();
  });

  it("keeps the unknown outcome's minute as before", async () => {
    const { provider } = setup(async () => Promise.reject(Object.assign(new Error("Bad Gateway"), { status: 502 })));
    const before = Date.now();
    await provider.request(args).catch(() => null);
    expect(outcomeHoldUntil()).toBeGreaterThanOrEqual(before + OUTCOME_HOLD_MS);
  });

  it("stays held while another send is still out, and keeps an earlier unknown minute", async () => {
    const slow = deferred();
    const first = setup(() => slow.promise);
    const firstAnswer = first.provider.request(args);
    const second = setup(async () => Promise.reject({ code: 4001 }));
    await second.provider.request(args).catch(() => null);
    // The first send is still out: the second's cancel lifts nothing.
    expect(outcomeHoldUntil()).toBeGreaterThan(Date.now());
    holdAfterUnknownOutcome();
    const minute = outcomeHoldUntil();
    slow.resolve({ hash: HASH });
    await firstAnswer;
    expect(outcomeHoldUntil()).toBe(minute);
  });
});

describe("a lapsed Privy session", () => {
  const api = (status: number, error = "x", code?: string) =>
    Object.assign(new Error(error), { name: "PrivyApiError", error, status, ...(code ? { code } : {}) });
  const args = { method: "eth_sendTransaction", params: [{ from: "0xa", to: "0xb", data: "0x12" }] };

  it("is its own kind: never a refusal, never a fallback", () => {
    for (const error of [
      api(401, "Unauthorized"),
      api(404, "Not found"),
      { code: "must_be_authenticated" },
      { code: "embedded_wallet_request_expired", error: "Wallet request expired before it could be sent. Please try again." },
      new Error("Must have valid access token and Privy wallet to send transaction"),
      new Error("User must be authenticated before signing with a Privy wallet"),
      new Error("Wallet request expired before it could be sent. Please try again."),
    ]) {
      expect(classifySponsorError(error)).toBe("auth");
      expect(sponsorFallbackAllowed(error)).toBe(false);
    }
    // Refusals stay refusals.
    expect(classifySponsorError(api(402))).toBe("refused");
    expect(classifySponsorError(api(403))).toBe("refused");
    expect(classifySponsorError({ code: "embedded_wallet_not_found" })).toBe("refused");
  });

  function setup(answers: unknown[], refreshAuth?: () => Promise<boolean>) {
    const inner = { request: vi.fn(async () => "0xpaid") };
    const onFallback = vi.fn();
    const beforePaidSend = vi.fn(async () => {});
    const sponsored = vi.fn(async () => {
      const next = answers.shift();
      if (next instanceof Error || (typeof next === "object" && next !== null && !("hash" in next))) throw next;
      return next as { hash: string };
    });
    const provider = withGasSponsor(inner, {
      chainId: 8453,
      address: "0xa",
      active: () => true,
      sendSponsored: sponsored,
      onFallback,
      beforePaidSend,
      refreshAuth,
      sleep: async () => {},
    });
    return { inner, onFallback, beforePaidSend, sponsored, provider };
  }

  it("refreshes the token and asks Privy once more, sponsored", async () => {
    const refresh = vi.fn(async () => true);
    const { inner, onFallback, sponsored, provider } = setup([api(401, "Unauthorized"), { hash: HASH }], refresh);
    await expect(provider.request(args)).resolves.toBe(HASH);
    expect(refresh).toHaveBeenCalledOnce();
    expect(sponsored).toHaveBeenCalledTimes(2);
    expect(onFallback).not.toHaveBeenCalled();
    expect(inner.request).not.toHaveBeenCalled();
    expect(sponsorRefusals().size).toBe(0);
  });

  it("fails the order with its own error when the second ask lapses too, never paying", async () => {
    const refresh = vi.fn(async () => true);
    const second = api(401, "Still unauthorized");
    const { inner, onFallback, beforePaidSend, sponsored, provider } = setup([{ code: "embedded_wallet_request_expired" }, second], refresh);
    await expect(provider.request(args)).rejects.toBe(second);
    expect(refresh).toHaveBeenCalledOnce();
    expect(sponsored).toHaveBeenCalledTimes(2);
    expect(onFallback).not.toHaveBeenCalled();
    expect(beforePaidSend).not.toHaveBeenCalled();
    expect(inner.request).not.toHaveBeenCalled();
    expect(outcomeHoldUntil()).toBe(0);
  });

  it("fails the order at once when no fresh token comes, or the refresh throws, or there is none", async () => {
    for (const refresh of [async () => false, async () => Promise.reject(new Error("offline")), undefined]) {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const lapsed = api(401, "Unauthorized");
      const { inner, onFallback, sponsored, provider } = setup([lapsed, { hash: HASH }], refresh);
      await expect(provider.request(args)).rejects.toBe(lapsed);
      expect(sponsored).toHaveBeenCalledOnce();
      expect(onFallback).not.toHaveBeenCalled();
      expect(inner.request).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
  });

  it("a refusal after the fresh token is a real refusal, and falls back", async () => {
    const { inner, onFallback, provider } = setup([api(401), api(402, "Insufficient credits")], async () => true);
    await expect(provider.request(args)).resolves.toBe("0xpaid");
    expect(onFallback).toHaveBeenCalledWith(expect.anything(), "refused");
    expect(inner.request).toHaveBeenCalledOnce();
  });

  it("an unknown outcome on the second ask is held, never resent", async () => {
    const { inner, onFallback, sponsored, provider } = setup([api(401), api(502, "Bad Gateway")], async () => true);
    const error = await provider.request(args).catch((e: unknown) => e);
    expect(isSponsoredOutcomeUnknown(error)).toBe(true);
    expect(sponsored).toHaveBeenCalledTimes(2);
    expect(outcomeHoldUntil()).toBeGreaterThan(Date.now());
    expect(onFallback).not.toHaveBeenCalled();
    expect(inner.request).not.toHaveBeenCalled();
  });
});
