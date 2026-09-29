import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { accountHubPlan, sellSources, walletActMessage, walletActOutcome } from "./account-wallets";
import { depositGate, withdrawGate } from "./pour-amount";
import { COPY } from "./copy";

const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";
const C = "0x00000000000000000000000000000000000000cc";

describe("accountHubPlan", () => {
  it("one wallet: an email session reads as before, before and after the list answers", () => {
    const before = accountHubPlan({ sessionSpoke: A, pending: null, linked: undefined, linkedLoading: true, emailSession: true });
    const after = accountHubPlan({ sessionSpoke: A, pending: null, linked: [{ address: A, family: "evm", isHome: true }], linkedLoading: false });
    for (const plan of [before, after]) {
      expect(plan).toEqual({ home: A, wallets: [{ spoke: A, isHome: true }], signer: A, signerLinked: true, homeKnown: true });
    }
  });

  it("a wallet session waits for the list, loading or failed, and a wallet with no session buys as before, so no buy is addressed to a hub wallet that may not be home", () => {
    for (const linkedLoading of [true, false]) {
      const plan = accountHubPlan({ sessionSpoke: B, pending: null, linked: undefined, linkedLoading });
      expect(plan).toMatchObject({ homeKnown: false, wallets: [] });
    }
    // No wallet session at all (the sign-in signature declined): the
    // connected address's own hub wallet, exactly as on master.
    for (const linkedLoading of [true, false]) {
      expect(accountHubPlan({ sessionSpoke: B, pending: null, linked: undefined, linkedLoading, walletSessionHeld: false })).toEqual({
        home: B,
        wallets: [{ spoke: B, isHome: true }],
        signer: B,
        signerLinked: true,
        homeKnown: true,
      });
    }
    // The list failed but the profile named the home: buys land there, as on master.
    expect(
      accountHubPlan({ sessionSpoke: B, pending: null, linked: undefined, linkedLoading: false, profileHome: A }),
    ).toMatchObject({ home: A, wallets: [{ spoke: A, isHome: true }], homeKnown: true });
    // Still loading: wait, even with the profile's answer.
    expect(
      accountHubPlan({ sessionSpoke: B, pending: null, linked: undefined, linkedLoading: true, profileHome: A }),
    ).toMatchObject({ homeKnown: false });
    // A single wallet account: its own address, whichever answers first.
    expect(
      accountHubPlan({ sessionSpoke: A, pending: null, linked: undefined, linkedLoading: false, profileHome: A }),
    ).toEqual({ home: A, wallets: [{ spoke: A, isHome: true }], signer: A, signerLinked: true, homeKnown: true });
    // Once it answers, the home is the account's, not the session's.
    const known = accountHubPlan({
      sessionSpoke: B,
      pending: null,
      linked: [
        { address: A, family: "evm", isHome: true },
        { address: B, family: "evm", isHome: false },
      ],
      linkedLoading: false,
    });
    expect(known).toMatchObject({ home: A, homeKnown: true });
  });

  it("two linked wallets: buys land at the home, the totals read both, the signer may be either", () => {
    const linked = [
      { address: B, family: "evm", isHome: false },
      { address: A, family: "evm", isHome: true },
    ];
    expect(accountHubPlan({ sessionSpoke: B, pending: null, linked, linkedLoading: false })).toEqual({
      home: A,
      wallets: [
        { spoke: A, isHome: true },
        { spoke: B, isHome: false },
      ],
      signer: B,
      signerLinked: true,
      homeKnown: true,
    });
  });

  it("a waiting extension address is never the account, and its orders wait until it is added", () => {
    const waiting = accountHubPlan({ sessionSpoke: C, pending: C, linked: undefined, linkedLoading: true });
    expect(waiting).toMatchObject({ home: undefined, wallets: [], signerLinked: false });
    const listed = accountHubPlan({ sessionSpoke: C, pending: C, linked: [{ address: A, family: "evm", isHome: true }], linkedLoading: false });
    expect(listed).toMatchObject({ home: A, wallets: [{ spoke: A, isHome: true }], signer: C, signerLinked: false });
  });

  it("the dev override derives that address alone", () => {
    expect(accountHubPlan({ override: B, sessionSpoke: A, pending: null, linked: undefined, linkedLoading: false })).toMatchObject({
      home: B,
      wallets: [{ spoke: B, isHome: true }],
    });
  });
});

describe("sellSources", () => {
  const wallets = [
    { spoke: A, hubWallet: "0xhubA", isHome: true },
    { spoke: B, hubWallet: "0xhubB", isHome: false },
  ];
  const balances: Record<string, bigint> = { "0xhubA": 5n, "0xhubB": 3n };

  it("lists every hub wallet that holds the listing, and which one this session can sign for", () => {
    expect(sellSources(wallets, (hub) => balances[hub] ?? 0n, "0xHUBB")).toEqual([
      { spoke: A, hubWallet: "0xhubA", isHome: true, balance: 5n, canSign: false },
      { spoke: B, hubWallet: "0xhubB", isHome: false, balance: 3n, canSign: true },
    ]);
  });

  it("leaves out empty and underived hub wallets", () => {
    const sources = sellSources([...wallets, { spoke: C, hubWallet: undefined, isHome: false }], (hub) => (hub === "0xhubA" ? 0n : 3n), "0xhubA");
    expect(sources.map((source) => source.spoke)).toEqual([B]);
  });
});

describe("the gates", () => {
  const readyBuy = {
    hasToken: true,
    address: C,
    buildAmount: 10n,
    balance: 20n,
    belowMinimum: false,
    isWrongChain: false,
    noRoute: false,
    quoted: 9n,
    minOut: 8n,
    hasWalletProvider: true,
    account: "ready" as const,
  };
  it("a buy paid from a wallet not on the account asks to add it first", () => {
    expect(depositGate({ ...readyBuy, payerLinked: false })).toEqual({ kind: "walletNotLinked" });
    expect(depositGate(readyBuy)).toEqual({ kind: "ready" });
  });

  const readySell = {
    address: A,
    hasDestination: true,
    recipient: A,
    usingCustomRecipient: false,
    buildAmount: 1n,
    availableShares: 2n,
    belowMinimum: false,
    isWrongChain: false,
    noRoute: false,
    belowDust: false,
    quoted: 1n,
    minOut: 1n,
    hasWalletProvider: true,
  };
  it("a sell from a hub wallet another address owns says so, and one address sells as before", () => {
    expect(withdrawGate({ ...readySell, canSignSource: false })).toEqual({ kind: "signWithOther" });
    expect(withdrawGate({ ...readySell, signerLinked: false })).toEqual({ kind: "walletNotLinked" });
    expect(withdrawGate(readySell)).toEqual({ kind: "ready" });
  });
});

describe("the Wallets list", async () => {
  const { WalletsList } = await import("@/components/account-wallets-list");
  const render = (props: Partial<Parameters<typeof WalletsList>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(WalletsList, {
        wallets: [
          { address: A, isHome: true, holds: true },
          { address: B, isHome: false, holds: true },
        ],
        signedInWith: A,
        unlinked: null,
        homeCanSign: true,
        allowHomeSwitch: true,
        emailSession: false,
        busy: false,
        ...props,
      }),
    );

  it("shows each address short, which is home, and offers home and remove on the others only", () => {
    const html = render();
    expect(html).toContain("0x0000…00aa");
    expect(html).toContain("0x0000…00bb");
    expect(html.match(new RegExp(COPY.walletsHomeTag, "g"))?.length).toBe(1);
    expect(html.match(new RegExp(COPY.walletsMakeHome, "g"))?.length).toBe(1);
    expect(html.match(new RegExp(`>${COPY.walletsRemove}<`, "g"))?.length).toBe(1);
    expect(html).not.toContain(COPY.walletNotLinkedPrompt.replace("'", "&#x27;"));
  });

  it("the quiet prompt appears only for a connected wallet not on the account", () => {
    expect(render({ unlinked: C })).toContain(COPY.walletNotLinkedPrompt.replace("'", "&#x27;"));
  });

  it("removing a wallet that still holds listings warns first", () => {
    const html = render({ initialConfirm: { kind: "remove", address: B } });
    expect(html).toContain(COPY.walletsRemoveHolds);
    expect(html).toContain(COPY.walletsRemoveConfirm("0x0000…00bb"));
  });

  it("switching home without the home wallet at hand says which to switch to", () => {
    const html = render({ homeCanSign: false, initialConfirm: { kind: "home", address: B } });
    expect(html).toContain(COPY.walletsNeedHomeSigner("0x0000…00aa"));
  });

  it("an email session is not offered Make home", () => {
    expect(render({ allowHomeSwitch: false, emailSession: true })).not.toContain(COPY.walletsMakeHome);
  });
});

describe("the shared browser line and the holdings block", async () => {
  const { SignedInAsLine, WalletsList } = await import("@/components/account-wallets-list");

  it("says who is signed in and who is connected, and offers signing in with the connected wallet first", () => {
    const html = renderToStaticMarkup(createElement(SignedInAsLine, { signedIn: A, connected: B, busy: false, onSignIn: () => {}, onAdd: () => {} }));
    expect(html).toContain(COPY.signedInAsWallet("0x0000…00aa"));
    expect(html).toContain(COPY.connectedWallet("0x0000…00bb"));
    expect(html.indexOf(COPY.signInWithWallet("0x0000…00bb"))).toBeLessThan(html.indexOf(COPY.addToThisAccount));
  });

  it("a wallet still holding stocks cannot be removed: the confirm is off and says why", () => {
    const html = renderToStaticMarkup(
      createElement(WalletsList, {
        wallets: [
          { address: A, isHome: true, holds: false },
          { address: B, isHome: false, holds: true },
        ],
        signedInWith: A,
        unlinked: null,
        homeCanSign: true,
        allowHomeSwitch: true,
        emailSession: false,
        busy: false,
        initialConfirm: { kind: "remove", address: B },
      }),
    );
    expect(html).toContain(COPY.walletsRemoveHolds);
    expect(html).toMatch(new RegExp(`<button[^>]*disabled[^>]*>${COPY.walletsSignToConfirm}`));
  });
});

describe("a wallet act's answer", () => {
  it("surfaces the server's 403 as sign in again, with its own line, and 429 as slow down", () => {
    expect(walletActOutcome(200, { wallets: [] })).toEqual({ ok: true });
    expect(walletActOutcome(403, null)).toEqual({ ok: false, reason: "reauth" });
    expect(walletActOutcome(429, null)).toEqual({ ok: false, reason: "slow" });
    expect(walletActOutcome(401, null)).toEqual({ ok: false, reason: "failed" });
    expect(walletActOutcome(0, null)).toEqual({ ok: false, reason: "failed" });
    expect(walletActMessage("reauth", COPY)).toBe(COPY.walletsSignInAgain);
    expect(walletActMessage("slow", COPY)).toBe(COPY.walletsSlowDown);
    expect(walletActMessage("declined", COPY)).toBe(COPY.walletsDeclined);
    expect(walletActMessage("failed", COPY)).toBe(COPY.walletsFailed);
  });
});
