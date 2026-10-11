import { describe, expect, it } from "vitest";
import {
  basescanAddress,
  berthAddressKind,
  formatUsdcRaw,
  FUNDING_NETWORK,
  FUNDING_TOKEN,
  fundingCover,
  fundingLineState,
  INTENTS_CONTRACT_ADDRESS,
  judgePayoutAddress,
} from "./campaign-funding";
import { INTENTS_CONTRACT } from "@/lib/server/pour-ownership";
import { PARTNER_FEE } from "@/lib/sodax-config";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { USDC_BASE } from "@/lib/server/campaigns/usdc";

// EIP-55's own test vectors.
const CHECKSUMMED = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const OTHER = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";

describe("judgePayoutAddress", () => {
  it("takes a checksummed address as it is", () => {
    expect(judgePayoutAddress(CHECKSUMMED)).toEqual({ kind: "ok", address: CHECKSUMMED, berth: null });
  });

  it("checksums an all lowercase or all uppercase address for display", () => {
    expect(judgePayoutAddress(CHECKSUMMED.toLowerCase())).toEqual({ kind: "ok", address: CHECKSUMMED, berth: null });
    expect(judgePayoutAddress(`0x${OTHER.slice(2).toUpperCase()}`)).toEqual({ kind: "ok", address: OTHER, berth: null });
    expect(judgePayoutAddress(`  ${OTHER}\n`)).toMatchObject({ kind: "ok", address: OTHER });
  });

  it("refuses mixed case that does not match its checksum", () => {
    const typo = CHECKSUMMED.replace("aAeb", "aaEb");
    expect(judgePayoutAddress(typo)).toEqual({ kind: "bad_checksum" });
  });

  it("refuses what is not an address", () => {
    expect(judgePayoutAddress("")).toEqual({ kind: "empty" });
    expect(judgePayoutAddress("   ")).toEqual({ kind: "empty" });
    expect(judgePayoutAddress(CHECKSUMMED.slice(0, 41))).toEqual({ kind: "invalid" });
    expect(judgePayoutAddress(`${CHECKSUMMED}0`)).toEqual({ kind: "invalid" });
    expect(judgePayoutAddress(CHECKSUMMED.slice(2))).toEqual({ kind: "invalid" });
    expect(judgePayoutAddress("0xZZZZ6053F3E94C9b9A09f33669435E7Ef1BeAed")).toEqual({ kind: "invalid" });
    expect(judgePayoutAddress("alice.eth")).toEqual({ kind: "invalid" });
  });

  it("refuses the zero address", () => {
    expect(judgePayoutAddress(`0x${"0".repeat(40)}`)).toEqual({ kind: "zero" });
  });

  it("warns on Berth's own addresses, valid but not a campaign wallet", () => {
    expect(judgePayoutAddress(USDC_BASE)).toMatchObject({ kind: "ok", berth: "usdc_contract" });
    expect(judgePayoutAddress(PARTNER_FEE.address)).toMatchObject({ kind: "ok", berth: "fee_wallet" });
    expect(judgePayoutAddress(PARTNER_FEE.address.toLowerCase())).toMatchObject({ kind: "ok", berth: "fee_wallet" });
    expect(judgePayoutAddress(INTENTS_CONTRACT)).toMatchObject({ kind: "ok", berth: "intents_contract" });
    expect(judgePayoutAddress(TOKEN_LISTINGS[0].address)).toMatchObject({ kind: "ok", berth: "listing_token" });
    expect(berthAddressKind(CHECKSUMMED)).toBeNull();
  });

  it("keeps its copy of the Intents contract equal to the server's", () => {
    expect(INTENTS_CONTRACT_ADDRESS).toBe(INTENTS_CONTRACT.toLowerCase());
  });
});

describe("the funding facts", () => {
  it("name Base and Circle's USDC on Base, linked to Basescan", () => {
    expect(FUNDING_NETWORK).toBe("Base");
    expect(FUNDING_TOKEN.address).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(basescanAddress(CHECKSUMMED)).toBe(`https://basescan.org/address/${CHECKSUMMED}`);
  });
});

describe("formatUsdcRaw", () => {
  it("shows dollars and cents, rounded down", () => {
    expect(formatUsdcRaw(0n)).toBe("$0.00");
    expect(formatUsdcRaw(1n)).toBe("$0.00");
    expect(formatUsdcRaw(9_999n)).toBe("$0.00");
    expect(formatUsdcRaw(10_000n)).toBe("$0.01");
    expect(formatUsdcRaw(12_345_678n)).toBe("$12.34");
    expect(formatUsdcRaw(100_000_000n)).toBe("$100.00");
    expect(formatUsdcRaw(1_234_567_000_000n)).toBe("$1,234,567.00");
  });
});

describe("fundingCover", () => {
  it("counts whole rewards the balance pays for", () => {
    expect(fundingCover({ balanceRaw: 100_000_000n, amountUsd: 5, budgetUsd: 100 })).toEqual({
      rewards: 20,
      neededUsd: 100,
      neededRewards: 20,
      shortRaw: 0n,
    });
    expect(fundingCover({ balanceRaw: 42_500_000n, amountUsd: 5, budgetUsd: 100 }).rewards).toBe(8);
    expect(fundingCover({ balanceRaw: 4_999_999n, amountUsd: 5, budgetUsd: 100 }).rewards).toBe(0);
    expect(fundingCover({ balanceRaw: 5_000_000n, amountUsd: 5, budgetUsd: 100 }).rewards).toBe(1);
  });

  it("says how far the balance falls short of the budget", () => {
    expect(fundingCover({ balanceRaw: 42_500_000n, amountUsd: 5, budgetUsd: 100 }).shortRaw).toBe(57_500_000n);
    expect(fundingCover({ balanceRaw: 0n, amountUsd: 5, budgetUsd: 100 }).shortRaw).toBe(100_000_000n);
    expect(fundingCover({ balanceRaw: 150_000_000n, amountUsd: 5, budgetUsd: 100 }).shortRaw).toBe(0n);
  });

  it("takes what is already paid off the budget, not the balance", () => {
    const cover = fundingCover({ balanceRaw: 90_000_000n, amountUsd: 5, budgetUsd: 100, paidUsd: 10 });
    expect(cover).toEqual({ rewards: 18, neededUsd: 90, neededRewards: 18, shortRaw: 0n });
    expect(fundingCover({ balanceRaw: 0n, amountUsd: 5, budgetUsd: 100, paidUsd: 100 })).toMatchObject({ neededUsd: 0, neededRewards: 0, shortRaw: 0n });
    expect(fundingCover({ balanceRaw: 0n, amountUsd: 5, budgetUsd: 100, paidUsd: 120 })).toMatchObject({ neededUsd: 0, shortRaw: 0n });
  });

  it("works in cents, never in floats", () => {
    const cover = fundingCover({ balanceRaw: 100_000_000n, amountUsd: 0.1, budgetUsd: 0.3 });
    expect(cover.rewards).toBe(1000);
    expect(cover.neededRewards).toBe(3);
    expect(cover.neededUsd).toBe(0.3);
    expect(fundingCover({ balanceRaw: 100_000_000n, amountUsd: 7.5, budgetUsd: 100 })).toMatchObject({ rewards: 13, neededRewards: 13 });
  });

  it("is calm about a half typed form", () => {
    expect(fundingCover({ balanceRaw: 100_000_000n, amountUsd: 0, budgetUsd: 0 })).toEqual({ rewards: 0, neededUsd: 0, neededRewards: 0, shortRaw: 0n });
    expect(fundingCover({ balanceRaw: -1n, amountUsd: 5, budgetUsd: 5 })).toMatchObject({ rewards: 0, shortRaw: 5_000_000n });
  });
});

describe("fundingLineState", () => {
  const ok = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
  const base = { retired: false, read: false, fetching: false };
  it("says there is no wallet, for a live and a retired campaign alike", () => {
    expect(fundingLineState({ ...base, address: null })).toBe("none");
    expect(fundingLineState({ ...base, address: null, retired: true })).toBe("none_retired");
  });
  it("says a Berth address is one, and a stored value that is no wallet is none, instead of could not be read", () => {
    expect(fundingLineState({ ...base, address: USDC_BASE })).toBe("berth");
    expect(fundingLineState({ ...base, address: "not a wallet" })).toBe("not_a_wallet");
  });
  it("reads, is reading, or could not read a real wallet", () => {
    expect(fundingLineState({ ...base, address: ok, read: true })).toBe("read");
    expect(fundingLineState({ ...base, address: ok, fetching: true })).toBe("reading");
    expect(fundingLineState({ ...base, address: ok })).toBe("unreadable");
  });
});
