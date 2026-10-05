import { describe, expect, it } from "vitest";
import {
  isDetectableWallet,
  pickInstalledWallets,
  splitWalletOffer,
  type ConnectorLike,
} from "./installed-wallets";

const c = (
  id: string,
  name: string,
  xChainType: string,
  isInstalled = true,
  icon?: string,
): ConnectorLike => ({ id, name, xChainType, isInstalled, icon });

describe("isDetectableWallet", () => {
  it("counts an installed wallet and ignores one that is not", () => {
    expect(isDetectableWallet(c("io.metamask", "MetaMask", "EVM"))).toBe(true);
    expect(isDetectableWallet(c("io.rabby", "Rabby", "EVM", false))).toBe(false);
  });

  it("never counts WalletConnect or the Privy bridge as a wallet on this device", () => {
    expect(isDetectableWallet(c("walletConnect", "WalletConnect", "EVM"))).toBe(false);
    expect(isDetectableWallet(c("privy-solana", "Berth account", "SOLANA"))).toBe(false);
  });

  it("on EVM counts only EIP-6963 announced providers, never SDK or generic connectors", () => {
    expect(isDetectableWallet(c("io.metamask", "MetaMask", "EVM"))).toBe(true);
    expect(isDetectableWallet(c("app.phantom", "Phantom", "EVM"))).toBe(true);
    expect(isDetectableWallet(c("metaMaskSDK", "MetaMask", "EVM"))).toBe(false);
    expect(isDetectableWallet(c("coinbaseWalletSDK", "Coinbase Wallet", "EVM"))).toBe(false);
    expect(isDetectableWallet(c("injected", "Browser Wallet", "EVM"))).toBe(false);
  });

  it("ignores families whose wallets report installed on every device", () => {
    expect(isDetectableWallet(c("albedo", "Albedo", "STELLAR"))).toBe(false);
    expect(isDetectableWallet(c("xbull", "xBull", "STELLAR"))).toBe(false);
    expect(isDetectableWallet(c("meteor-wallet", "Meteor Wallet", "NEAR"))).toBe(false);
    expect(isDetectableWallet(c("ledger", "Ledger", "NEAR"))).toBe(false);
    expect(isDetectableWallet(c("keplr", "Keplr", "INJECTIVE"))).toBe(false);
  });

  it("trusts the families that probe the browser", () => {
    expect(isDetectableWallet(c("xverse", "Xverse", "BITCOIN"))).toBe(true);
    expect(isDetectableWallet(c("phantom", "Phantom", "SOLANA"))).toBe(true);
    expect(isDetectableWallet(c("sui-wallet", "Sui Wallet", "SUI"))).toBe(true);
    expect(isDetectableWallet(c("leather", "Leather", "STACKS"))).toBe(true);
    expect(isDetectableWallet(c("hana", "Hana Wallet", "ICON"))).toBe(true);
  });
});

describe("pickInstalledWallets", () => {
  it("answers nothing for a browser without wallets", () => {
    expect(
      pickInstalledWallets({
        EVM: [c("io.rabby", "Rabby", "EVM", false), c("walletConnect", "WalletConnect", "EVM")],
        SOLANA: [c("phantom", "Phantom", "SOLANA", false)],
      }),
    ).toEqual([]);
  });

  it("groups one wallet across families and connects EVM first", () => {
    const wallets = pickInstalledWallets({
      SOLANA: [c("phantom", "Phantom", "SOLANA", true, "data:phantom")],
      EVM: [c("app.phantom", "Phantom", "EVM")],
      BITCOIN: [c("phantom-btc", "Phantom", "BITCOIN")],
    });
    expect(wallets).toHaveLength(1);
    expect(wallets[0].name).toBe("Phantom");
    expect(wallets[0].icon).toBe("data:phantom");
    expect(wallets[0].connectors.map((x) => x.xChainType)).toEqual([
      "EVM",
      "SOLANA",
      "BITCOIN",
    ]);
    expect(wallets[0].primary.xChainType).toBe("EVM");
  });

  it("keeps one connector per family even when a wallet is listed twice", () => {
    const wallets = pickInstalledWallets({
      EVM: [c("io.metamask", "MetaMask", "EVM"), c("metaMaskSDK", "MetaMask", "EVM")],
    });
    expect(wallets).toHaveLength(1);
    expect(wallets[0].connectors).toHaveLength(1);
  });

  it("orders wallets by their best family, then by name", () => {
    const wallets = pickInstalledWallets({
      BITCOIN: [c("xverse", "Xverse", "BITCOIN")],
      SOLANA: [c("solflare", "Solflare", "SOLANA"), c("backpack", "Backpack", "SOLANA")],
      EVM: [c("io.metamask", "MetaMask", "EVM")],
    });
    expect(wallets.map((w) => w.name)).toEqual([
      "MetaMask",
      "Backpack",
      "Solflare",
      "Xverse",
    ]);
  });

  it("orders the probing families by priority and drops the rest", () => {
    const wallets = pickInstalledWallets({
      STACKS: [c("leather", "Leather", "STACKS")],
      STELLAR: [c("freighter", "Freighter", "STELLAR")],
      BITCOIN: [c("xverse", "Xverse", "BITCOIN")],
    });
    expect(wallets.map((w) => w.name)).toEqual(["Xverse", "Leather"]);
  });
});

describe("splitWalletOffer", () => {
  const names = ["MetaMask", "Phantom", "Rabby", "Backpack", "Coinbase Wallet", "OKX Wallet", "Solflare", "Trust Wallet", "Xverse", "Leather"];
  const wallets = (n: number) => names.slice(0, n).map((name) => ({ name }));

  it("shows nothing when nothing is detected", () => {
    expect(splitWalletOffer([], null)).toEqual({ shown: [], hidden: [] });
    expect(splitWalletOffer([], "Rabby")).toEqual({ shown: [], hidden: [] });
  });

  it("shows one or two wallets in full, as before, remembered or not", () => {
    expect(splitWalletOffer(wallets(1), null)).toEqual({ shown: wallets(1), hidden: [] });
    expect(splitWalletOffer(wallets(2), null)).toEqual({ shown: wallets(2), hidden: [] });
    expect(splitWalletOffer(wallets(2), "Phantom")).toEqual({ shown: wallets(2), hidden: [] });
  });

  it("with three, shows the first and folds two", () => {
    const { shown, hidden } = splitWalletOffer(wallets(3), null);
    expect(shown.map((w) => w.name)).toEqual(["MetaMask"]);
    expect(hidden.map((w) => w.name)).toEqual(["Phantom", "Rabby"]);
  });

  it("with three, leads with the remembered wallet and keeps the rest in order", () => {
    const { shown, hidden } = splitWalletOffer(wallets(3), "rabby");
    expect(shown.map((w) => w.name)).toEqual(["Rabby"]);
    expect(hidden.map((w) => w.name)).toEqual(["MetaMask", "Phantom"]);
  });

  it("with ten, shows one and folds nine", () => {
    const { shown, hidden } = splitWalletOffer(wallets(10), null);
    expect(shown.map((w) => w.name)).toEqual(["MetaMask"]);
    expect(hidden).toHaveLength(9);
    expect(hidden.map((w) => w.name)).toEqual(names.slice(1));
  });

  it("with ten, leads with the remembered wallet when it is still installed", () => {
    const { shown, hidden } = splitWalletOffer(wallets(10), "Coinbase Wallet");
    expect(shown.map((w) => w.name)).toEqual(["Coinbase Wallet"]);
    expect(hidden).toHaveLength(9);
    expect(hidden.map((w) => w.name)).not.toContain("Coinbase Wallet");
  });

  it("falls back to the first when the remembered wallet is gone", () => {
    const { shown, hidden } = splitWalletOffer(wallets(10), "Keplr");
    expect(shown.map((w) => w.name)).toEqual(["MetaMask"]);
    expect(hidden).toHaveLength(9);
  });
});
