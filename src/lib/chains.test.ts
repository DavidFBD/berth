import { describe, expect, it } from "vitest";
import { ChainKeys, type XToken } from "@sodax/sdk";
import { DEPOSIT_SOURCE_CHAINS, getChainName, getDepositTokens, getNativeGasToken, toBalanceReadToken } from "./chains";
import { priceIdFor } from "./orders";

/**
 * One representative token per chain family the picker can show (see
 * DEPOSIT_SOURCE_CHAINS in ./chains). Addresses are shaped like real
 * registry entries for that family, not placeholders — several of them
 * (Sui, ICON) start with "0x" like an EVM address but are not one, which is
 * exactly the shape that crashed toBalanceReadToken before it routed by
 * chainKey instead of by string sniffing.
 */
function token(chainKey: XToken["chainKey"], address: string): XToken {
  return {
    symbol: "TOK",
    name: "Token",
    decimals: 6,
    address,
    chainKey,
    hubAsset: "0x0000000000000000000000000000000000000001",
    vault: "0x0000000000000000000000000000000000000002",
  };
}

describe("toBalanceReadToken", () => {
  it("re-checksums an EVM address with broken EIP-55 casing", () => {
    // Shaped like the real Polygon WBTC/LINK registry entries this guard
    // exists for: valid hex, but the mixed case fails isAddress's checksum.
    const t = token(
      ChainKeys.POLYGON_MAINNET,
      "0x1bFd67037B42cf73acf2047067Bd4f2C47d9BfD3",
    );
    const result = toBalanceReadToken(t);
    expect(result.address).toBe("0x1BFd67037b42Cf73ACF2047067bD4f2C47D9BfD3");
  });

  it("leaves an already-checksummed EVM address untouched", () => {
    const t = token(
      ChainKeys.ETHEREUM_MAINNET,
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    );
    expect(toBalanceReadToken(t)).toEqual(t);
  });

  it("passes a Sui coin type through unchanged (not an EVM address, despite the 0x prefix)", () => {
    const t = token(ChainKeys.SUI_MAINNET, "0x2::sui::SUI");
    expect(toBalanceReadToken(t)).toEqual(t);
  });

  it("passes a Sui package coin type through unchanged", () => {
    const t = token(
      ChainKeys.SUI_MAINNET,
      "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e::usdc::USDC",
    );
    expect(toBalanceReadToken(t)).toEqual(t);
  });

  it("passes a Solana base58 mint through unchanged", () => {
    const t = token(
      ChainKeys.SOLANA_MAINNET,
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    );
    expect(toBalanceReadToken(t)).toEqual(t);
  });

  it("passes a Stellar asset identifier through unchanged", () => {
    const t = token(
      ChainKeys.STELLAR_MAINNET,
      "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    );
    expect(toBalanceReadToken(t)).toEqual(t);
  });

  it("passes a NEAR account id through unchanged", () => {
    const t = token(ChainKeys.NEAR_MAINNET, "usdc.near");
    expect(toBalanceReadToken(t)).toEqual(t);
  });

  it("passes an Injective denom through unchanged", () => {
    const t = token(
      ChainKeys.INJECTIVE_MAINNET,
      "peggy0xdAC17F958D2ee523a2206206994597C13D831ec7",
    );
    expect(toBalanceReadToken(t)).toEqual(t);
  });

  it("passes an ICON contract address through unchanged (0x-prefixed but 21 bytes, not 20)", () => {
    const t = token(
      ChainKeys.ICON_MAINNET,
      "cx1a29259a59f463a67bb2ef84398b30ca56b5830a",
    );
    expect(toBalanceReadToken(t)).toEqual(t);
  });

  it("passes a Stacks principal::contract::asset triple through unchanged", () => {
    const t = token(
      ChainKeys.STACKS_MAINNET,
      "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-wstx::wstx",
    );
    expect(toBalanceReadToken(t)).toEqual(t);
  });

  it("passes a Bitcoin native sentinel through unchanged", () => {
    const t = token(ChainKeys.BITCOIN_MAINNET, "BTC");
    expect(toBalanceReadToken(t)).toEqual(t);
  });
});

describe("getChainName", () => {
  it("says HyperEVM, the name people know, not the SDK's Hyper", () => {
    expect(getChainName(ChainKeys.HYPEREVM_MAINNET)).toBe("HyperEVM");
    expect(getChainName(ChainKeys.BASE_MAINNET)).toBe("Base");
  });
});

describe("DEPOSIT_SOURCE_CHAINS", () => {
  // Robinhood Chain (4663, @sodax/sdk 2.2.0-rc.8) is a delivery destination
  // only. It must never appear as a place a deposit can originate, by
  // omission from this explicit list, not by filtering elsewhere.
  it("never offers Robinhood Chain as a pay-from chain", () => {
    expect(DEPOSIT_SOURCE_CHAINS).not.toContain(ChainKeys.ROBINHOOD_MAINNET);
  });
});

describe("getNativeGasToken", () => {
  it("names no separate gas token on Bitcoin, whose fee comes out of the BTC sent", () => {
    expect(getNativeGasToken(ChainKeys.BITCOIN_MAINNET)).toBeUndefined();
  });

  it("still names the native coin on an EVM chain and on Solana", () => {
    expect(getNativeGasToken(ChainKeys.BASE_MAINNET)?.symbol).toBe("ETH");
    expect(getNativeGasToken(ChainKeys.SOLANA_MAINNET)?.symbol).toBe("SOL");
  });
});

describe("getDepositTokens on Sonic", () => {
  const sonic = getDepositTokens(ChainKeys.SONIC_MAINNET);
  const at = (address: string) => sonic.find((token) => token.address.toLowerCase() === address.toLowerCase());

  it("shows hub vault tokens under their soda names, never as the coin itself", () => {
    expect(at("0x7A1A5555842Ad2D0eD274d09b5c4406a95799D5d")).toMatchObject({ symbol: "sodaBTC", name: "Soda BTC" });
    expect(at("0xdEa692287E2cE8Cb08FA52917Be0F16b1DACDC87")).toMatchObject({ symbol: "sodaSOL", name: "Soda SOL" });
    expect(at("0xdc5B4b00F98347E95b9F94911213DAB4C687e1e3")).toMatchObject({ symbol: "sodaSUI", name: "Soda SUI" });
    for (const coin of ["BTC", "SOL", "BNB", "AVAX", "XLM", "INJ", "SUI", "POL", "HYPE", "NEAR", "KAIA", "STX", "HBAR"]) {
      expect(sonic.some((token) => token.symbol === coin), coin).toBe(false);
    }
  });

  it("keeps the SDK's address and decimals, so payloads are untouched", () => {
    expect(at("0x7A1A5555842Ad2D0eD274d09b5c4406a95799D5d")).toMatchObject({
      address: "0x7A1A5555842Ad2D0eD274d09b5c4406a95799D5d",
      decimals: 18,
    });
  });

  it("prices sodaBTC as bitcoin and leaves the other wrappers unpriced", () => {
    expect(priceIdFor(at("0x7A1A5555842Ad2D0eD274d09b5c4406a95799D5d")?.symbol)).toBe("bitcoin");
    expect(priceIdFor(at("0xdEa692287E2cE8Cb08FA52917Be0F16b1DACDC87")?.symbol)).toBeUndefined();
  });

  it("leaves other chains' coins under their own names", () => {
    expect(getDepositTokens(ChainKeys.SOLANA_MAINNET).some((token) => token.symbol === "SOL")).toBe(true);
  });
});
