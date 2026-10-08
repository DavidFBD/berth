import { afterEach, describe, expect, it, vi } from "vitest";
import { ChainKeys } from "@sodax/sdk";
import { InsufficientFundsForPaidSend } from "./gas-need";
import { outcomeHoldUntil, resetOutcomeHold, resetSponsorRefusals, withGasSponsor } from "./gas-sponsor";
import { privySponsorOptions } from "./privy-sponsor-wiring";

const HASH = `0x${"cd".repeat(32)}`;
const ADDRESS = "0x00000000000000000000000000000000000000aa";
const send = (tx: Record<string, string>) => ({ method: "eth_sendTransaction", params: [{ from: ADDRESS, to: "0xb", data: "0x12", ...tx }] });

afterEach(() => {
  resetSponsorRefusals();
  resetOutcomeHold();
  vi.restoreAllMocks();
});

function wire(overrides: {
  sendSponsored?: () => Promise<{ hash: string }>;
  balance?: () => Promise<bigint>;
  feePerGas?: () => Promise<bigint>;
  token?: () => Promise<string | null>;
  receipt?: () => Promise<{ status: string; logs: [] }>;
} = {}) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const inner = { request: vi.fn(async () => "0xpaid") };
  const privySend = vi.fn(overrides.sendSponsored ?? (async () => ({ hash: HASH })));
  const getBalance = vi.fn(overrides.balance ?? (async () => 10n ** 18n));
  const readFeePerGas = vi.fn(overrides.feePerGas ?? (async () => 1_000_000_000n));
  const getAccessToken = vi.fn(overrides.token ?? (async () => "fresh-token"));
  const markRefused = vi.fn();
  const options = privySponsorOptions({
    chainId: 8453,
    chainKey: ChainKeys.BASE_MAINNET,
    address: ADDRESS,
    client: {
      getBalance,
      waitForTransactionReceipt: vi.fn(overrides.receipt ?? (async () => ({ status: "success", logs: [] as [] }))),
    },
    readFeePerGas,
    send: privySend,
    getAccessToken,
    markRefused,
    active: () => true,
  });
  const provider = withGasSponsor(inner, { ...options, sleep: async () => {} });
  return { inner, privySend, getBalance, readFeePerGas, getAccessToken, markRefused, options, provider };
}

const status = (code: number, message = "x") => Object.assign(new Error(message), { name: "PrivyApiError", status: code });

describe("the Privy wallet's sponsor wiring", () => {
  it("sends headless with sponsor on, from the embedded wallet", async () => {
    const { privySend, provider, inner } = wire();
    await expect(provider.request(send({}))).resolves.toBe(HASH);
    expect(privySend).toHaveBeenCalledOnce();
    expect((privySend.mock.calls[0] as unknown[])[1]).toEqual({ sponsor: true, address: ADDRESS, uiOptions: { showWalletUIs: false } });
    expect(inner.request).not.toHaveBeenCalled();
  });

  it("trusts the hash when the receipt cannot be read", async () => {
    const { provider } = wire({ receipt: async () => Promise.reject(new Error("rpc down")) });
    await expect(provider.request(send({}))).resolves.toBe(HASH);
  });

  describe("onFallback", () => {
    it("drops the chain for the session on a refusal, then pays", async () => {
      const { provider, markRefused, inner } = wire({ sendSponsored: async () => Promise.reject(status(402, "no credits")) });
      await expect(provider.request(send({}))).resolves.toBe("0xpaid");
      expect(markRefused).toHaveBeenCalledWith(8453);
      expect(inner.request).toHaveBeenCalledOnce();
    });

    it("keeps the chain sponsored after two 429s in a row, and pays this once", async () => {
      const { provider, markRefused, inner, privySend } = wire({ sendSponsored: async () => Promise.reject(status(429)) });
      await expect(provider.request(send({}))).resolves.toBe("0xpaid");
      expect(privySend).toHaveBeenCalledTimes(2);
      expect(markRefused).not.toHaveBeenCalled();
      expect(inner.request).toHaveBeenCalledOnce();
    });

    it("is never told of a lapsed session: refresh, ask again, sponsored", async () => {
      const privy = vi.fn<() => Promise<{ hash: string }>>().mockRejectedValueOnce(status(401, "Unauthorized")).mockResolvedValueOnce({ hash: HASH });
      const { provider, markRefused, inner, getAccessToken } = wire({ sendSponsored: privy });
      await expect(provider.request(send({}))).resolves.toBe(HASH);
      expect(getAccessToken).toHaveBeenCalledOnce();
      expect(privy).toHaveBeenCalledTimes(2);
      expect(markRefused).not.toHaveBeenCalled();
      expect(inner.request).not.toHaveBeenCalled();
    });

    it("fails the order when no fresh token comes, without marking or paying", async () => {
      const { provider, markRefused, inner, privySend, getBalance } = wire({
        sendSponsored: async () => Promise.reject(status(401, "Unauthorized")),
        token: async () => null,
      });
      await expect(provider.request(send({}))).rejects.toThrow("Unauthorized");
      expect(privySend).toHaveBeenCalledOnce();
      expect(markRefused).not.toHaveBeenCalled();
      expect(getBalance).not.toHaveBeenCalled();
      expect(inner.request).not.toHaveBeenCalled();
      expect(outcomeHoldUntil()).toBe(0);
    });
  });

  describe("beforePaidSend", () => {
    const refused = { sendSponsored: async () => Promise.reject(status(403, "Forbidden")) };

    it("stops a paid send the wallet cannot pay for, with the insufficient-funds line", async () => {
      const { provider, inner } = wire({ ...refused, balance: async () => 0n });
      const error = await provider.request(send({ gas: "0x5208" })).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InsufficientFundsForPaidSend);
      expect(String((error as Error).message)).toMatch(/^insufficient funds for gas \* price \+ value: have 0 want \d+/);
      expect(inner.request).not.toHaveBeenCalled();
    });

    it("reads the chain's fee only when the transaction carries none", async () => {
      const carried = wire(refused);
      await carried.provider.request(send({ gas: "0x5208", maxFeePerGas: "0x3b9aca00" }));
      expect(carried.readFeePerGas).not.toHaveBeenCalled();
      expect(carried.getBalance).toHaveBeenCalledWith({ address: ADDRESS });

      const bare = wire(refused);
      await bare.provider.request(send({ gas: "0x5208" }));
      expect(bare.readFeePerGas).toHaveBeenCalledWith(ChainKeys.BASE_MAINNET);
      expect(bare.inner.request).toHaveBeenCalledOnce();
    });

    it("lets the node decide when the balance cannot be read", async () => {
      const { provider, inner } = wire({ ...refused, balance: async () => Promise.reject(new Error("rpc down")) });
      await expect(provider.request(send({ gas: "0x5208" }))).resolves.toBe("0xpaid");
      expect(inner.request).toHaveBeenCalledOnce();
    });

    it("counts the value sent beside the fee", async () => {
      const { provider, inner } = wire({ ...refused, balance: async () => 10n ** 15n });
      // 0.01 ETH of value against 0.001 ETH held.
      await expect(provider.request(send({ gas: "0x5208", value: "0x2386f26fc10000" }))).rejects.toBeInstanceOf(InsufficientFundsForPaidSend);
      expect(inner.request).not.toHaveBeenCalled();
    });
  });
});
