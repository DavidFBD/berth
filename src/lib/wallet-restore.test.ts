import { describe, expect, it } from "vitest";
import {
  isEvmAddress,
  reconnectCandidates,
  rememberedFor,
  restorableAnchor,
  restorePhase,
  sessionHasId,
} from "@/lib/wallet-restore";

const ADDR = "0x1111111111111111111111111111111111111111";

describe("restorePhase", () => {
  it("is live whenever the extension is connected", () => {
    expect(restorePhase({ anchor: null, liveEvm: ADDR, hydrated: true, settled: false })).toBe("live");
    expect(restorePhase({ anchor: ADDR, liveEvm: ADDR, hydrated: false, settled: false })).toBe("live");
  });

  it("is none without a fresh EVM session: the welcome page, as before", () => {
    expect(restorePhase({ anchor: null, liveEvm: undefined, hydrated: true, settled: true })).toBe("none");
    expect(restorePhase({ anchor: undefined, liveEvm: undefined, hydrated: false, settled: false })).toBe("none");
    // A Solana address never owns an account, so it never restores one.
    expect(
      restorePhase({ anchor: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", liveEvm: undefined, hydrated: true, settled: true }),
    ).toBe("none");
  });

  it("restores (the splash, never the welcome page) while the wallet may still come back", () => {
    expect(restorePhase({ anchor: ADDR, liveEvm: undefined, hydrated: false, settled: false })).toBe("restoring");
    expect(restorePhase({ anchor: ADDR, liveEvm: undefined, hydrated: true, settled: false })).toBe("restoring");
    expect(restorePhase({ anchor: ADDR, liveEvm: undefined, hydrated: false, settled: true })).toBe("restoring");
  });

  it("waits on the splash until the email session is known, so a wallet never flashes in for an email account", () => {
    expect(restorePhase({ anchor: ADDR, liveEvm: undefined, hydrated: true, settled: true, identityReady: false })).toBe("restoring");
    expect(restorePhase({ anchor: ADDR, liveEvm: undefined, hydrated: true, settled: true, identityReady: true })).toBe("session");
    expect(restorePhase({ anchor: null, liveEvm: undefined, hydrated: true, settled: true, identityReady: false })).toBe("none");
  });

  it("settles on the session alone when the wallet stays away", () => {
    expect(restorePhase({ anchor: ADDR, liveEvm: undefined, hydrated: true, settled: true })).toBe("session");
  });
});

describe("reconnectCandidates", () => {
  const hana = { id: "xyz.hana", name: "Hana" };
  const metamask = { id: "io.metamask", name: "MetaMask" };
  const rabby = { id: "io.rabby", name: "Rabby" };
  const coinbase = { id: "com.coinbase.wallet", name: "Coinbase Wallet" };
  const walletConnect = { id: "walletConnect", name: "WalletConnect" };
  const injected = { id: "injected", name: "Injected" };
  const none = new Set<string>();

  it("tries the remembered wallet alone, once it has announced", () => {
    expect(reconnectCandidates([metamask, hana, walletConnect], "xyz.hana", none)).toEqual([hana]);
  });

  it("waits for a remembered extension that has not announced yet, rather than connect another", () => {
    expect(reconnectCandidates([metamask, rabby], "xyz.hana", none)).toEqual([]);
    // It arrives late (Hana announcing after the SDK's own reconnect): tried then.
    expect(reconnectCandidates([metamask, rabby, hana], "xyz.hana", none)).toEqual([hana]);
  });

  it("does not try anything else after the remembered wallet said no (locked)", () => {
    expect(reconnectCandidates([metamask, hana], "xyz.hana", new Set(["xyz.hana"]))).toEqual([]);
  });

  it("tries a remembered WalletConnect session, whose check never opens a QR code", () => {
    expect(reconnectCandidates([metamask, walletConnect], "walletConnect", none)).toEqual([walletConnect]);
  });

  it("without a record tries every EIP-6963 extension, never generic or relay connectors", () => {
    expect(reconnectCandidates([injected, walletConnect, metamask, rabby, coinbase, hana], null, none)).toEqual([
      metamask,
      rabby,
      coinbase,
      hana,
    ]);
    expect(reconnectCandidates([{ id: "io.privy.wallet", name: "Privy" }], null, none)).toEqual([]);
  });

  it("tries each late announcement once", () => {
    const tried = new Set(["io.metamask"]);
    expect(reconnectCandidates([metamask, hana], null, tried)).toEqual([hana]);
  });
});

describe("rememberedFor", () => {
  const record = { address: ADDR, id: "xyz.hana", name: "Hana" };
  it("names the wallet only for the account it signed in", () => {
    expect(rememberedFor(record, ADDR.toUpperCase().replace("0X", "0x"))).toEqual({ id: "xyz.hana", name: "Hana" });
    expect(rememberedFor(record, "0x2222222222222222222222222222222222222222")).toBeNull();
    expect(rememberedFor(null, ADDR)).toBeNull();
    expect(rememberedFor(record, null)).toBeNull();
  });
});

describe("isEvmAddress", () => {
  it("accepts only an EVM address", () => {
    expect(isEvmAddress(ADDR)).toBe(true);
    expect(isEvmAddress("0x123")).toBe(false);
    expect(isEvmAddress(null)).toBe(false);
  });
});

/** A JWT-shaped token with this payload (the signature is never read client side). */
function token(payload: Record<string, unknown>): string {
  const b64 = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}

describe("sessionHasId", () => {
  it("sees a session id, and nothing in a session from before ids", () => {
    expect(sessionHasId(token({ purpose: "wallet-session", sub: ADDR, jti: "8d3c-uuid" }))).toBe(true);
    expect(sessionHasId(token({ purpose: "wallet-session", sub: ADDR }))).toBe(false);
    expect(sessionHasId(token({ jti: "" }))).toBe(false);
    expect(sessionHasId("not-a-jwt")).toBe(false);
    expect(sessionHasId("a.@@@.c")).toBe(false);
    expect(sessionHasId(null)).toBe(false);
  });
});

describe("restorableAnchor", () => {
  const withId = { address: ADDR, token: token({ sub: ADDR, jti: "id-1" }) };
  const record = { address: ADDR, id: "xyz.hana", name: "Hana" };

  it("restores a session this code saw signed in: an id and the wallet recorded", () => {
    expect(restorableAnchor({ anchor: withId, record, emailSession: false })).toBe(ADDR);
  });

  it("never restores a session pocketed before the restore existed (it may belong to someone who signed out)", () => {
    // No record: master never wrote one, and never forgot sessions on unplug.
    expect(restorableAnchor({ anchor: withId, record: null, emailSession: false })).toBeNull();
    // No session id: it cannot be ended on the server, so it never opens the account on load.
    expect(
      restorableAnchor({ anchor: { address: ADDR, token: token({ sub: ADDR }) }, record, emailSession: false }),
    ).toBeNull();
  });

  it("never restores with a record of another account's wallet", () => {
    const other = { ...record, address: "0x2222222222222222222222222222222222222222" };
    expect(restorableAnchor({ anchor: withId, record: other, emailSession: false })).toBeNull();
  });

  it("is off in an email session, which is its own account", () => {
    expect(restorableAnchor({ anchor: withId, record, emailSession: true })).toBeNull();
  });

  it("restores nothing without a fresh session, or for a non-EVM address", () => {
    expect(restorableAnchor({ anchor: null, record, emailSession: false })).toBeNull();
    expect(
      restorableAnchor({
        anchor: { address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", token: withId.token },
        record: { ...record, address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" },
        emailSession: false,
      }),
    ).toBeNull();
  });
});
