import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AddWalletList } from "@/components/account-wallets-list";
import { COPY } from "@/lib/copy";
import { addWalletRows, bitcoinSignatureBase64, solanaSignatureBytes, type ConnectedNetwork } from "@/lib/add-wallet-list";

const HOME = "0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be";
const SOL = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const SOL_OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const BTC = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";

const hana: ConnectedNetwork[] = [
  { network: "SOLANA", name: "Solana", address: SOL, extension: "Hana" },
  { network: "EVM", name: "EVM", address: "0x3F5CE5FBFE3E9AF3971DD833D26BA9B5C936F0BE", extension: "Hana" },
  { network: "BITCOIN", name: "Bitcoin", address: BTC, extension: "Hana" },
  { network: "SUI", name: "Sui", address: undefined },
  { network: "STELLAR", name: "Stellar", address: undefined },
  { network: "ICON", name: "ICON", address: undefined },
];

describe("addWalletRows", () => {
  it("lists what one multichain extension has open, network by network, EVM first", () => {
    const { rows, comingSoon } = addWalletRows({ networks: hana, linked: [{ address: HOME, family: "evm" }], outcomes: new Map() });
    expect(rows.map((row) => [row.network, row.state])).toEqual([
      ["EVM", "added"],
      ["SOLANA", "add"],
      ["BITCOIN", "add"],
    ]);
    expect(rows[1]).toMatchObject({ address: SOL, extension: "Hana" });
    expect(comingSoon).toEqual(["Sui", "Stellar", "ICON"]);
  });

  it("a linked Solana address reads Added only when it matches exactly: base58 is case-sensitive", () => {
    const linked = [
      { address: HOME, family: "evm" },
      { address: SOL, family: "solana" },
    ];
    expect(addWalletRows({ networks: hana, linked, outcomes: new Map() }).rows[1].state).toBe("added");
    const miscased = [{ address: SOL.toLowerCase(), family: "solana" }];
    expect(addWalletRows({ networks: hana, linked: miscased, outcomes: new Map() }).rows[1].state).toBe("add");
    // An EVM address compares without case.
    expect(addWalletRows({ networks: hana, linked: [{ address: HOME.toUpperCase().replace("0X", "0x"), family: "evm" }], outcomes: new Map() }).rows[0].state).toBe("added");
  });

  it("says another account holds it only after its signature answered so, and never for another address", () => {
    const outcomes = new Map<string, "other_account" | "cooling">([[SOL, "other_account"]]);
    expect(addWalletRows({ networks: hana, linked: [], outcomes }).rows[1].state).toBe("other_account");
    const moved = hana.map((entry) => (entry.network === "SOLANA" ? { ...entry, address: SOL_OTHER } : entry));
    expect(addWalletRows({ networks: moved, linked: [], outcomes }).rows[1].state).toBe("add");
    expect(addWalletRows({ networks: hana, linked: [], outcomes: new Map([[SOL, "cooling"]]) }).rows[1].state).toBe("cooling");
  });

  it("offers Connect for a supported network with nothing connected", () => {
    const evmOnly = hana.map((entry) => (entry.network === "EVM" ? entry : { ...entry, address: undefined }));
    const { rows, comingSoon } = addWalletRows({ networks: evmOnly, linked: [{ address: HOME, family: "evm" }], outcomes: new Map() });
    expect(rows.map((row) => [row.network, row.state])).toEqual([
      ["EVM", "added"],
      ["SOLANA", "connect"],
      ["BITCOIN", "connect"],
    ]);
    expect(comingSoon).toEqual(["Sui", "Stellar", "ICON"]);
  });

  it("a linked Bitcoin address reads Added in any case the wallet reports it: bech32 has one spelling", () => {
    const linked = [{ address: BTC, family: "bitcoin" }];
    expect(addWalletRows({ networks: hana, linked, outcomes: new Map() }).rows[2].state).toBe("added");
    const upper = hana.map((entry) => (entry.network === "BITCOIN" ? { ...entry, address: BTC.toUpperCase() } : entry));
    expect(addWalletRows({ networks: upper, linked, outcomes: new Map() }).rows[2].state).toBe("added");
    // Linked in another family is not linked here.
    expect(addWalletRows({ networks: hana, linked: [{ address: BTC, family: "solana" }], outcomes: new Map() }).rows[2].state).toBe("add");
    expect(addWalletRows({ networks: hana, linked: [], outcomes: new Map([[BTC, "other_account"]]) }).rows[2].state).toBe("other_account");
  });
});

describe("bitcoinSignatureBase64", () => {
  it("passes the wallets' base64 through, turns bytes and BIP-137 hex into base64, refuses the rest", () => {
    const bip137 = new Uint8Array(65).map((_, i) => (i === 0 ? 31 : i));
    const b64 = Buffer.from(bip137).toString("base64");
    expect(bitcoinSignatureBase64(b64)).toBe(b64);
    expect(bitcoinSignatureBase64(bip137)).toBe(b64);
    expect(bitcoinSignatureBase64(Buffer.from(bip137).toString("hex"))).toBe(b64);
    expect(bitcoinSignatureBase64("not base64!")).toBeNull();
    expect(bitcoinSignatureBase64("abc")).toBeNull();
    expect(bitcoinSignatureBase64(undefined)).toBeNull();
    expect(bitcoinSignatureBase64(new Uint8Array(0))).toBeNull();
  });
});

describe("solanaSignatureBytes", () => {
  it("reads the SDK's base64 answer and raw bytes, 64 bytes only", () => {
    const bytes = new Uint8Array(64).map((_, i) => i);
    expect(Array.from(solanaSignatureBytes(Buffer.from(bytes).toString("base64"))!)).toEqual(Array.from(bytes));
    expect(solanaSignatureBytes(bytes)).toBe(bytes);
    expect(solanaSignatureBytes(Buffer.from(bytes.slice(0, 32)).toString("base64"))).toBeNull();
    expect(solanaSignatureBytes("0x1234")).toBeNull();
    expect(solanaSignatureBytes(undefined)).toBeNull();
  });
});

describe("AddWalletList", () => {
  const render = (props: Parameters<typeof AddWalletList>[0]) => renderToStaticMarkup(createElement(AddWalletList, props));

  it("draws every state in plain words, with no switch instruction outside EVM", () => {
    const { rows } = addWalletRows({
      networks: [
        ...hana,
        { network: "INJECTIVE", name: "Injective", address: "inj1abc" },
      ],
      linked: [{ address: HOME, family: "evm" }],
      outcomes: new Map(),
    });
    const withOther = [...rows, { ...rows[1], address: SOL_OTHER, state: "other_account" as const }];
    const html = render({ rows: withOther, comingSoon: ["Sui"], busyAddress: null, onAdd: () => {}, onConnect: () => {} });
    expect(html).toContain(COPY.walletsAdded);
    expect(html).toContain(`>${COPY.walletsAddOne}<`);
    expect(html).toContain(COPY.walletsBelongsElsewhere);
    expect(html).toContain(COPY.walletsComingSoon);
    expect(html).toContain(COPY.walletsComingSoonList("Sui"));
    expect(html).toContain("Hana");
    // The one switch hint belongs to the EVM row alone.
    expect(html.split(COPY.walletsAddHint)).toHaveLength(2);
    expect(html).not.toContain("Switch to the other wallet");
  });

  it("offers Connect Solana when nothing is connected there", () => {
    const html = render({
      rows: [{ network: "SOLANA", name: "Solana", address: null, extension: null, state: "connect" }],
      comingSoon: [],
      busyAddress: null,
      onConnect: () => {},
    });
    expect(html).toContain(COPY.walletsConnectNetwork("Solana"));
    expect(html).not.toContain(COPY.walletsAddHint);
  });

  it("the copy has no dash as punctuation", () => {
    for (const text of [
      COPY.walletsAddListSub,
      COPY.walletsAddHint,
      COPY.walletsBelongsElsewhere,
      COPY.walletsSolanaNote,
      COPY.walletsBitcoinNote,
      COPY.walletsComingSoonList("Bitcoin, Sui"),
    ]) {
      expect(text).not.toMatch(/ [-–—] |—|–/);
    }
  });
});
