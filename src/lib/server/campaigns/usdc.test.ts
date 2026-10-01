import { describe, expect, it } from "vitest";
import { fetchUsdcTransfers, paysEnough, payoutSenders, readUsdcTransfers, TRANSFER_TOPIC, USDC_BASE, usdcRaw, type Receipt } from "./usdc";

/** The mark paid check, against receipts shaped as Base's RPC returns them (no network). */

const TO = "0x00000000000000000000000000000000000000aa";
const TO2 = "0x00000000000000000000000000000000000000ab";
const HOUSE = "0x00000000000000000000000000000000000000cc";
const STRANGER = "0x00000000000000000000000000000000000005ee";
const SENDERS = new Set([HOUSE]);
const pad = (address: string) => `0x${address.slice(2).padStart(64, "0")}`;
const amount = (raw: bigint) => `0x${raw.toString(16).padStart(64, "0")}`;

function transfer(to: string, raw: bigint, { token = USDC_BASE, from = HOUSE } = {}) {
  return { address: token, topics: [TRANSFER_TOPIC, pad(from), pad(to)], data: amount(raw) };
}
const receipt = (logs: NonNullable<Receipt>["logs"], status = "0x1"): Receipt => ({ status, blockNumber: "0x10", logs });

function read(r: Receipt) {
  const out = readUsdcTransfers(r, SENDERS);
  if (out.outcome !== "read") throw new Error(out.outcome);
  return out;
}

describe("usdcRaw", () => {
  it("counts in six decimals, cents exact", () => {
    expect(usdcRaw(5)).toBe(5_000_000n);
    expect(usdcRaw(5.5)).toBe(5_500_000n);
    expect(usdcRaw(0.1 + 0.2)).toBe(300_000n);
  });
});

describe("payoutSenders", () => {
  it("reads the house's payout wallets, and nothing else", () => {
    expect([...payoutSenders({ STAFF_PAYOUT_ADDRESSES: ` ${HOUSE.toUpperCase().replace("0X", "0x")} , nope` })]).toEqual([HOUSE]);
    expect(payoutSenders({}).size).toBe(0);
  });
});

describe("readUsdcTransfers and paysEnough", () => {
  it("pays an address the amount from a house wallet", () => {
    const transfers = read(receipt([transfer(TO, 5_000_000n)]));
    expect(paysEnough(transfers, TO.toUpperCase().replace("0X", "0x"), 5_000_000n)).toBe(true);
    expect(paysEnough(transfers, TO, 10_000_000n)).toBe(false);
  });

  it("never counts USDC from anyone else, or another token", () => {
    const transfers = read(receipt([transfer(TO, 5_000_000n, { from: STRANGER }), transfer(TO, 5_000_000n, { token: `0x${"c".repeat(40)}` })]));
    expect(paysEnough(transfers, TO, 5_000_000n)).toBe(false);
    expect(transfers.others).toEqual([{ from: STRANGER, to: TO, raw: "5000000" }]);
  });

  it("reads a batch: each recipient its own sum", () => {
    const transfers = read(receipt([transfer(TO, 5_000_000n), transfer(TO2, 5_000_000n), transfer(TO, 5_000_000n)]));
    expect(transfers.byRecipient).toEqual({ [TO]: "10000000", [TO2]: "5000000" });
    expect(paysEnough(transfers, TO, 10_000_000n)).toBe(true);
    expect(paysEnough(transfers, TO2, 10_000_000n)).toBe(false);
  });

  it("says a reverted transaction failed and an absent one was not found", () => {
    expect(readUsdcTransfers(receipt([transfer(TO, 5_000_000n)], "0x0"), SENDERS)).toEqual({ outcome: "tx_failed" });
    expect(readUsdcTransfers(null, SENDERS)).toEqual({ outcome: "not_found" });
  });

  it("skips malformed logs instead of trusting them", () => {
    const logs = [
      { address: USDC_BASE, topics: [TRANSFER_TOPIC, pad(HOUSE), "0xnothex"], data: amount(5_000_000n) },
      { address: USDC_BASE, topics: [TRANSFER_TOPIC, pad(HOUSE), pad(TO)], data: "0xzz" },
    ];
    expect(read(receipt(logs)).byRecipient).toEqual({});
  });
});

describe("fetchUsdcTransfers", () => {
  it("answers unreachable when the RPC does not answer", async () => {
    const out = await fetchUsdcTransfers("0xabc", SENDERS, async () => {
      throw new Error("rpc http 503");
    });
    expect(out).toEqual({ outcome: "unreachable", error: "rpc http 503" });
  });
});
