import { describe, expect, it, vi } from "vitest";
import { getSodax } from "./pour-verify";
import {
  INTENTS_CONTRACT,
  NATIVE_TOKEN,
  sodaxOwnershipReads,
  UNKNOWN,
  type HubFunding,
  createdOnHub,
  deliveredToAccount,
  fundedBy,
  transfersOf,
  withTimeout,
  decodeSource,
  judgeOwnership,
  proveOwnership,
  type OwnedWallet,
  type OwnershipFacts,
  type OwnershipReads,
} from "./pour-ownership";

/**
 * Fixtures recorded 2026-10-01, read only: the intents from SODAX's public
 * orderbook (GET api.sodax.com/v1/be/solver/orderbook), people who are not
 * Berth accounts, and each creator checked against the hub wallet factory's
 * getDeployedAddress(srcChain, srcAddress) on Sonic (the router for a Sonic
 * source). The source fields are exactly as recorded; a buy's delivery is
 * set per test, as Berth delivers on Sonic.
 */
const SONIC = 146;
const F = {
  solana: {
    srcChain: 1,
    srcAddress: "0x1c7cdfc2e4e7745be1a2361d0513f60490fcd73c1a7df1993a896a1b37594ef3",
    creator: "0x04edfda1B34481303689ab190E3240e75751A6F2",
    address: "2vCraXuVuBnHY5F8tPYEKG6s6Qb9aUjk3cpt4VKWKvvW",
  },
  bitcoinTaproot: {
    srcChain: 627463,
    srcAddress: "0x626331706b6577346c79787677376478676d6b3973736373786167356a7974747678383664386667357838637266767732726576306136716366766d7332",
    creator: "0x6636B530D4Df4074Df0Fd2F025498FE41AC18727",
    address: "bc1pkew4lyxvw7dxgmk9sscsxag5jyttvx86d8fg5x8crfvw2rev0a6qcfvms2",
  },
  bitcoinSegwit: {
    srcChain: 627463,
    srcAddress: "0x62633171786a6a636a776d6a61706a32356e757066656c71306c39346e6c667470796d66776661633834",
    creator: "0x68F68Acc47a3BA0326597dE70e478c8f2C30257b",
    address: "bc1qxjjcjwmjapj25nupfelq0l94nlftpymfwfac84",
  },
  sui: {
    srcChain: 21,
    srcAddress: "0xa43deb7b6eb7ff83e9892b73a736e6b89636a67bfe4c710f3619a3909410dbc8",
    creator: "0xdf42504fAAc5D0af945C3869dD21740DDa68730C",
    address: "0xa43deb7b6eb7ff83e9892b73a736e6b89636a67bfe4c710f3619a3909410dbc8",
  },
  stellar: {
    srcChain: 27,
    srcAddress: "0x000000120000000000000000fef6f953ec3337495e54d4f2f885da8e9ff04fd38aa5e0ccd1e2406f5381619f",
    creator: "0x9A0d129ccCd1aaD1d4B59DE680D61DE4Da335c5a",
    address: "GD7PN6KT5QZTOSK6KTKPF6EF3KHJ74CP2OFKLYGM2HREA32TQFQZ7FDB",
  },
  arbitrum: {
    srcChain: 23,
    srcAddress: "0x0ab764ab3816cd036ea951be973098510d8105a6",
    creator: "0xA227B184a182BC87CC8DBa6be54C132361FdB568",
    address: "0x0ab764ab3816cd036ea951be973098510d8105a6",
    /** Its hub wallet on the home chain (Base), where Berth delivers a buy. */
    homeHub: "0x2ee3435f86b614062135fae9463c56fc29092004",
  },
  sonicRouter: {
    srcChain: SONIC,
    srcAddress: "0x749b50a054fe23b497f10850239e50335247f030",
    creator: "0x4cd03B3CfeDbb197799758f81765066210B91D4F",
    address: "0x749b50a054fe23b497f10850239e50335247f030",
  },
  /**
   * A solver tester's intent made directly on Sonic that names a Sui source
   * it never came from: the factory derives 0x1c1e…74b2 for that source,
   * not the creator. srcAddress alone proves nothing.
   */
  spoofed: {
    srcChain: 21,
    srcAddress: "0x076471bc92b938bcf6c903ca2a98de28c23cb9a98dbcfae1263e783bca76c70a",
    creator: "0xf48Cd107FaaA95DE81afC2436e0A044196E21825",
    derived: "0x1c1e883aedfe1d836171e5e4523538ec0c3d74b2",
  },
} as const;

const HOME = "0x1111111111111111111111111111111111111111";
const HOME_HUB = "0x2222222222222222222222222222222222222222";
const STRANGER = "0x3333333333333333333333333333333333333333";
const STRANGER_HUB = "0x4444444444444444444444444444444444444444";
/** A hub wallet nobody here holds: what a real read answers for an address that is not the account's. */
const NOBODY = "0x000000000000000000000000000000000000dead";

const USDC_HUB = "0x29219dd400f2bf60e5a23d13be72b486d4038894";
const AMOUNT = 1_000n;
const RELAYER = "0x695880381e2f947065fbbd65dce8bb309a4344c2";
/** What every intent here spends. */
const SPEND = { inputToken: USDC_HUB, inputAmount: AMOUNT };
/** A hub transaction in which each of `payers` moved the intent's input (plus the fee) into the Intents contract. */
const paidBy = (...payers: string[]): HubFunding => ({
  txFrom: RELAYER,
  transfers: payers.map((from) => ({ token: USDC_HUB, from: from.toLowerCase(), to: INTENTS_CONTRACT, value: AMOUNT + 4n })),
});
/** A Sonic transaction the EOA sent itself, paying the input into the Intents contract. */
const signedBy = (eoa: string): HubFunding => ({ ...paidBy(eoa), txFrom: eoa.toLowerCase() });
/** Every creator in these tests paid: for tests whose subject is not the funding. */
const PAID_BY_ALL = paidBy(...Object.values(F).map((fixture) => fixture.creator), HOME_HUB, STRANGER_HUB, F.arbitrum.homeHub);

type Source = { srcChain: number; srcAddress: string; creator: string };
const buyFrom = (source: Source, dstAddress: string = HOME_HUB, dstChain: number = SONIC) => ({
  ...SPEND,
  creator: source.creator,
  srcChain: BigInt(source.srcChain),
  srcAddress: source.srcAddress,
  dstChain: BigInt(dstChain),
  dstAddress,
});

const home: OwnedWallet = { family: "evm", address: HOME, linkedAt: null };
const homeHubs = [{ address: HOME_HUB, linkedAt: null }];

function facts(over: Partial<OwnershipFacts> & Pick<OwnershipFacts, "intent">): OwnershipFacts {
  return {
    direction: "buy",
    wallets: [home],
    sourceHub: over.intent.creator.toLowerCase(),
    homeHubs,
    funding: paidBy(over.intent.creator),
    inputIsHubAsset: true,
    ...over,
  } as OwnershipFacts;
}

describe("decodeSource: each family, spelled as user_identities stores it", () => {
  it("EVM: the 20 bytes, lowercase", () => {
    expect(decodeSource(F.arbitrum.srcChain, F.arbitrum.srcAddress.toUpperCase().replace("0X", "0x"))).toEqual({
      chainKey: "0xa4b1.arbitrum",
      family: "evm",
      address: F.arbitrum.address,
    });
    expect(decodeSource(SONIC, F.sonicRouter.srcAddress)).toMatchObject({ chainKey: "sonic", family: "evm", address: F.sonicRouter.address });
  });

  it("Solana: the 32 byte key as base58, case kept", () => {
    expect(decodeSource(F.solana.srcChain, F.solana.srcAddress)).toEqual({ chainKey: "solana", family: "solana", address: F.solana.address });
  });

  it("Bitcoin: the address string from UTF-8, bech32 lowercased", () => {
    expect(decodeSource(F.bitcoinTaproot.srcChain, F.bitcoinTaproot.srcAddress)).toEqual({
      chainKey: "bitcoin",
      family: "bitcoin",
      address: F.bitcoinTaproot.address,
    });
    expect(decodeSource(F.bitcoinSegwit.srcChain, F.bitcoinSegwit.srcAddress).address).toBe(F.bitcoinSegwit.address);
    // An upper case bech32 string (valid, BIP-173) is the same address.
    const upper = `0x${Buffer.from(F.bitcoinSegwit.address.toUpperCase(), "utf8").toString("hex")}`;
    expect(decodeSource(627463, upper).address).toBe(F.bitcoinSegwit.address);
  });

  it("Sui and Stellar decode, but no identity can be linked in them", () => {
    expect(decodeSource(F.sui.srcChain, F.sui.srcAddress)).toEqual({ chainKey: "sui", family: null, address: F.sui.address });
    expect(decodeSource(F.stellar.srcChain, F.stellar.srcAddress)).toEqual({ chainKey: "stellar", family: null, address: F.stellar.address });
  });

  it("an unknown chain or an address that is not its chain's shape is unreadable", () => {
    expect(decodeSource(987654321, F.arbitrum.srcAddress)).toEqual({ chainKey: null, family: null, address: null });
    expect(decodeSource(F.arbitrum.srcChain, F.solana.srcAddress).address).toBeNull();
    expect(decodeSource(F.bitcoinSegwit.srcChain, "0x6869").address).toBeNull();
  });
});

describe("judgeOwnership, per family", () => {
  it("EVM spoke: the payer's own address, delivered to the account", () => {
    const intent = buyFrom(F.arbitrum, F.arbitrum.homeHub);
    const wallets: OwnedWallet[] = [{ family: "evm", address: F.arbitrum.address, linkedAt: null }];
    expect(judgeOwnership(facts({ intent, wallets, homeHubs: [{ address: F.arbitrum.homeHub, linkedAt: null }] }))).toEqual({
      ok: true,
      payer: { family: "evm", address: F.arbitrum.address },
    });
    // Delivered to the payer's own hub wallet (a cup, or a buy without a delivery override): also its own.
    expect(judgeOwnership(facts({ intent: buyFrom(F.arbitrum, F.arbitrum.creator), wallets, homeHubs: [] })).ok).toBe(true);
  });

  it("Sonic: the router is the creator; a sell is made by the account's hub wallet itself", () => {
    const wallets: OwnedWallet[] = [{ family: "evm", address: F.sonicRouter.address, linkedAt: null }];
    // The EOA signed the Sonic transaction itself.
    const signed = signedBy(F.sonicRouter.address);
    expect(judgeOwnership(facts({ intent: buyFrom(F.sonicRouter, F.sonicRouter.creator), wallets, funding: signed })).ok).toBe(true);
    const sell = { ...SPEND, creator: HOME_HUB, srcChain: BigInt(SONIC), srcAddress: HOME_HUB, dstChain: 23n, dstAddress: "0x9999999999999999999999999999999999999999" };
    expect(createdOnHub(sell)).toBe(true);
    expect(judgeOwnership(facts({ direction: "sell", intent: sell, sourceHub: null }))).toEqual({ ok: true, payer: { family: "evm", address: HOME_HUB } });
    // Someone else's hub wallet selling is not this account's sell.
    expect(judgeOwnership(facts({ direction: "sell", intent: { ...sell, creator: STRANGER_HUB, srcAddress: STRANGER_HUB }, sourceHub: null }))).toEqual({
      ok: false,
      why: "payer not on account",
    });
  });

  it("Solana: a SIWS linked address, before the intent", () => {
    const wallets: OwnedWallet[] = [home, { family: "solana", address: F.solana.address, linkedAt: 1_000 }];
    expect(judgeOwnership(facts({ intent: buyFrom(F.solana), wallets, intentAt: 1_000 }))).toEqual({
      ok: true,
      payer: { family: "solana", address: F.solana.address },
    });
  });

  it("Bitcoin: the BIP-322 linked address, taproot and segwit", () => {
    for (const source of [F.bitcoinTaproot, F.bitcoinSegwit]) {
      const wallets: OwnedWallet[] = [home, { family: "bitcoin", address: source.address, linkedAt: 1_000 }];
      expect(judgeOwnership(facts({ intent: buyFrom(source), wallets, intentAt: 2_000 }))).toEqual({
        ok: true,
        payer: { family: "bitcoin", address: source.address },
      });
    }
  });

  it("Sui and Stellar: a genuine intent, but no identity can prove it, so it is nobody's here", () => {
    for (const source of [F.sui, F.stellar]) {
      expect(judgeOwnership(facts({ intent: buyFrom(source) }))).toEqual({ ok: false, why: "family not linkable" });
    }
  });

  it("a written srcAddress is not a proof: the creator must be the wallet it derives", () => {
    const intent = buyFrom(F.spoofed);
    expect(judgeOwnership(facts({ intent, sourceHub: F.spoofed.derived }))).toEqual({ ok: false, why: "creator not the source's" });
    // Even when the named address really is on the account.
    const solanaSpoof = { ...buyFrom(F.solana), creator: STRANGER_HUB };
    const wallets: OwnedWallet[] = [home, { family: "solana", address: F.solana.address, linkedAt: null }];
    expect(judgeOwnership(facts({ intent: solanaSpoof, wallets, sourceHub: F.solana.creator.toLowerCase() }))).toEqual({
      ok: false,
      why: "creator not the source's",
    });
    expect(judgeOwnership(facts({ intent: buyFrom(F.solana), wallets, sourceHub: null }))).toEqual({ ok: false, why: "creator not the source's" });
  });

  it("a stranger reporting someone else's intent: the payer is not on their account, in every family", () => {
    const strangers: OwnedWallet[] = [{ family: "evm", address: STRANGER, linkedAt: null }];
    const strangerHubs = [{ address: STRANGER_HUB, linkedAt: null }];
    for (const source of [F.solana, F.bitcoinTaproot, F.bitcoinSegwit, F.arbitrum, F.sonicRouter]) {
      const funding = source === F.sonicRouter ? signedBy(F.sonicRouter.address) : paidBy(source.creator);
      expect(judgeOwnership(facts({ intent: buyFrom(source), wallets: strangers, homeHubs: strangerHubs, funding }))).toEqual({
        ok: false,
        why: "payer not on account",
      });
    }
  });

  it("the account's own payer, delivered to someone else's account, is not the account's buy", () => {
    const wallets: OwnedWallet[] = [home, { family: "solana", address: F.solana.address, linkedAt: null }];
    expect(judgeOwnership(facts({ intent: buyFrom(F.solana, STRANGER_HUB), wallets }))).toEqual({ ok: false, why: "not delivered to account" });
    expect(judgeOwnership(facts({ intent: buyFrom(F.solana, HOME_HUB, 30), wallets }))).toEqual({ ok: false, why: "not delivered to account" });
  });

  it("a wallet linked after the intent does not prove it; the time must be known", () => {
    const wallets: OwnedWallet[] = [home, { family: "solana", address: F.solana.address, linkedAt: 5_000 }];
    expect(judgeOwnership(facts({ intent: buyFrom(F.solana), wallets, intentAt: 4_999 }))).toEqual({ ok: false, why: "payer linked later" });
    expect(judgeOwnership(facts({ intent: buyFrom(F.solana), wallets }))).toEqual({ ok: false, why: "payer linked later" });
    expect(judgeOwnership(facts({ intent: buyFrom(F.solana), wallets, intentAt: 5_000 })).ok).toBe(true);
    // Delivered to the hub wallet of an EVM address that joined later: the same rule.
    const lateHub = [{ address: HOME_HUB, linkedAt: 9_000 }];
    expect(judgeOwnership(facts({ intent: buyFrom(F.solana), wallets, homeHubs: lateHub, intentAt: 6_000 }))).toEqual({
      ok: false,
      why: "payer linked later",
    });
  });

  it("a sell's payout address is the person's choice and is not asked", () => {
    const wallets: OwnedWallet[] = [{ family: "evm", address: F.arbitrum.address, linkedAt: null }];
    const sell = buyFrom(F.arbitrum, "0x00eb833b2d1790f2fbc63961ceb637f6c704debfad", 1768124270);
    expect(judgeOwnership(facts({ direction: "sell", intent: sell, wallets })).ok).toBe(true);
  });
});

describe("deliveredToAccount", () => {
  it("on Sonic, to one of the account's home hub wallets, any casing", () => {
    expect(deliveredToAccount({ dstChain: 146n, dstAddress: HOME_HUB.toUpperCase().replace("0X", "0x") }, homeHubs)).toBe(true);
    expect(deliveredToAccount({ dstChain: 30, dstAddress: HOME_HUB }, homeHubs)).toBe(false);
    expect(deliveredToAccount({ dstChain: "146", dstAddress: STRANGER_HUB }, homeHubs)).toBe(false);
    expect(deliveredToAccount({ dstChain: 146, dstAddress: HOME_HUB }, [])).toBe(false);
  });
});

describe("proveOwnership: the reads it makes", () => {
  const reads = (over: Partial<OwnershipReads> = {}): OwnershipReads => ({
    funding: vi.fn(async () => PAID_BY_ALL),
    isHubAsset: () => true,
    sourceHub: vi.fn(async (chain: bigint, address: string) =>
      chain === 1n && address === F.solana.srcAddress ? F.solana.creator.toLowerCase() : chain === 21n ? F.spoofed.derived : NOBODY,
    ),
    homeHub: vi.fn(async (address: string) => (address === HOME ? HOME_HUB : address === STRANGER ? STRANGER_HUB : NOBODY)),
    intentAt: vi.fn(async () => 7_000),
    ...over,
  });

  it("a stranger's report fails, and nothing about it stands in the real owner's way", async () => {
    const intent = buyFrom(F.solana);
    const stranger = await proveOwnership({ direction: "buy", intent, wallets: [{ family: "evm", address: STRANGER, linkedAt: null }], reads: reads() });
    expect(stranger).toEqual({ ok: false, why: "payer not on account" });
    const owner = await proveOwnership({
      direction: "buy",
      intent,
      wallets: [home, { family: "solana", address: F.solana.address, linkedAt: 6_000 }],
      reads: reads(),
    });
    expect(owner).toEqual({ ok: true, payer: { family: "solana", address: F.solana.address } });
  });

  it("reads the intent's time only when a later wallet is what proves it", async () => {
    const intent = buyFrom(F.solana, F.solana.creator);
    const anyTime = reads();
    await proveOwnership({ direction: "buy", intent, wallets: [home, { family: "solana", address: F.solana.address, linkedAt: null }], reads: anyTime });
    expect(anyTime.intentAt).not.toHaveBeenCalled();
    // Delivered to its own creator: the home hubs are not read either.
    expect(anyTime.homeHub).not.toHaveBeenCalled();
    const later = reads({ intentAt: vi.fn(async () => 5_000) });
    expect(
      await proveOwnership({ direction: "buy", intent, wallets: [home, { family: "solana", address: F.solana.address, linkedAt: 6_000 }], reads: later }),
    ).toEqual({ ok: false, why: "payer linked later" });
    expect(later.intentAt).toHaveBeenCalledTimes(1);
  });

  it("an account with no wallets proves nothing and reads nothing", async () => {
    const used = reads();
    expect(await proveOwnership({ direction: "buy", intent: buyFrom(F.solana), wallets: [], reads: used })).toEqual({ ok: false, why: "payer not on account" });
    expect(used.sourceHub).not.toHaveBeenCalled();
  });

  it("a Sui or Stellar buy delivered to the account's own hub wallet: not proven, but delivered to the account", async () => {
    for (const source of [F.sui, F.stellar]) {
      const used = reads({ sourceHub: vi.fn(async () => source.creator.toLowerCase()) });
      expect(await proveOwnership({ direction: "buy", intent: buyFrom(source, HOME_HUB), wallets: [home], reads: used })).toEqual({
        ok: false,
        why: "family not linkable",
        deliveredToAccount: true,
      });
    }
  });

  it("delivered elsewhere, or reported by a stranger, or a sell: no delivery to the account", async () => {
    const used = reads({ sourceHub: vi.fn(async () => F.sui.creator.toLowerCase()) });
    // Delivered to someone else's hub wallet.
    expect(await proveOwnership({ direction: "buy", intent: buyFrom(F.sui, STRANGER_HUB), wallets: [home], reads: used })).toEqual({
      ok: false,
      why: "family not linkable",
    });
    // Delivered to the owner's hub, but the stranger's account holds a different one.
    const stranger: OwnedWallet[] = [{ family: "evm", address: STRANGER, linkedAt: null }];
    expect(await proveOwnership({ direction: "buy", intent: buyFrom(F.sui, HOME_HUB), wallets: stranger, reads: used })).toEqual({
      ok: false,
      why: "family not linkable",
    });
    // A sell pays out wherever the person chose: delivery says nothing about whose it was.
    const sell = buyFrom(F.sui, HOME_HUB);
    expect(await proveOwnership({ direction: "sell", intent: sell, wallets: [home], reads: used })).toEqual({ ok: false, why: "family not linkable" });
  });

  it("a genuine but unproven payer counts as delivered when the stock landed in the account (a gift, a wallet linked later); a spoofed source does not", async () => {
    const spoof = await proveOwnership({ direction: "buy", intent: buyFrom(F.spoofed, HOME_HUB), wallets: [home], reads: reads() });
    // A spoofed source is not genuine, so it is nobody's, delivered or not.
    expect(spoof).toEqual({ ok: false, why: "creator not the source's" });
    const gift = await proveOwnership({ direction: "buy", intent: buyFrom(F.solana, HOME_HUB), wallets: [home], reads: reads() });
    expect(gift).toEqual({ ok: false, why: "payer not on account", deliveredToAccount: true });
    const late = await proveOwnership({
      direction: "buy",
      intent: buyFrom(F.solana, HOME_HUB),
      wallets: [home, { family: "solana", address: F.solana.address, linkedAt: 9_000 }],
      reads: reads({ intentAt: vi.fn(async () => 5_000) }),
    });
    expect(late).toEqual({ ok: false, why: "payer linked later", deliveredToAccount: true });
  });

  it("reads the account's home hub wallets for the delivery check even when the buy names its creator", async () => {
    const used = reads({ sourceHub: vi.fn(async () => F.sui.creator.toLowerCase()) });
    expect(await proveOwnership({ direction: "buy", intent: buyFrom(F.sui, F.sui.creator), wallets: [home], reads: used })).toEqual({
      ok: false,
      why: "family not linkable",
    });
    expect(used.homeHub).toHaveBeenCalledWith(HOME);
  });

  it("a hub wallet sell derives the account's home hub wallets, never the source", async () => {
    const used = reads();
    const sell = { ...SPEND, creator: HOME_HUB, srcChain: BigInt(SONIC), srcAddress: HOME_HUB, dstChain: 23n, dstAddress: STRANGER };
    expect((await proveOwnership({ direction: "sell", intent: sell, wallets: [home], reads: used })).ok).toBe(true);
    expect(used.sourceHub).not.toHaveBeenCalled();
    expect(used.homeHub).toHaveBeenCalledWith(HOME);
  });
});

/**
 * Ported from the review's probe (reports/pour-ownership-review-probes/
 * probe.test.ts): a read that fails is unknown, never a refusal and never
 * "delivered but unproven". Base home buy: creator = factory(30, home EOA).
 */
describe("a read that fails", () => {
  const BASE = 30n;
  const homeBuy = { ...SPEND, creator: F.arbitrum.homeHub, srcChain: BASE, srcAddress: F.arbitrum.address, dstChain: 146n, dstAddress: F.arbitrum.homeHub };
  const homeWallets: OwnedWallet[] = [{ family: "evm", address: F.arbitrum.address, linkedAt: null }];
  const reads = (over: Partial<OwnershipReads>): OwnershipReads => ({
    funding: async () => PAID_BY_ALL,
    isHubAsset: () => true,
    sourceHub: async () => F.arbitrum.homeHub,
    homeHub: async () => F.arbitrum.homeHub,
    intentAt: async () => 10_000,
    ...over,
  });

  it("the factory read fails, the home hub is cached: unknown, not delivered-but-unproven", async () => {
    const verdict = await proveOwnership({ direction: "buy", intent: homeBuy, wallets: homeWallets, reads: reads({ sourceHub: async () => UNKNOWN }) });
    expect(verdict).toEqual({ ok: false, why: "reads failed", unknown: true });
  });

  it("both reads fail: unknown, not a refusal", async () => {
    const verdict = await proveOwnership({
      direction: "buy",
      intent: homeBuy,
      wallets: homeWallets,
      reads: reads({ sourceHub: async () => UNKNOWN, homeHub: async () => UNKNOWN }),
    });
    expect(verdict).toEqual({ ok: false, why: "reads failed", unknown: true });
  });

  it("a linked Solana payer whose intent time cannot be read: unknown, not delivered-but-unproven", async () => {
    const verdict = await proveOwnership({
      direction: "buy",
      intent: buyFrom(F.solana, HOME_HUB),
      wallets: [home, { family: "solana", address: F.solana.address, linkedAt: 1 }],
      reads: reads({ sourceHub: async () => F.solana.creator.toLowerCase(), homeHub: async () => HOME_HUB, intentAt: async () => UNKNOWN }),
    });
    expect(verdict).toEqual({ ok: false, why: "reads failed", unknown: true });
  });

  it("a hub wallet sell whose home hub read fails: unknown", async () => {
    const sell = { ...SPEND, creator: HOME_HUB, srcChain: 146n, srcAddress: HOME_HUB, dstChain: 23n, dstAddress: STRANGER };
    expect(await proveOwnership({ direction: "sell", intent: sell, wallets: [home], reads: reads({ homeHub: async () => UNKNOWN }) })).toEqual({
      ok: false,
      why: "reads failed",
      unknown: true,
    });
  });

  it("a delivery that only an unread hub could prove: unknown", async () => {
    const wallets: OwnedWallet[] = [home, { family: "evm", address: STRANGER, linkedAt: null }];
    const verdict = await proveOwnership({
      direction: "buy",
      intent: buyFrom(F.sui, STRANGER_HUB),
      wallets,
      reads: reads({ sourceHub: async () => F.sui.creator.toLowerCase(), homeHub: async (address) => (address === HOME ? HOME_HUB : UNKNOWN) }),
    });
    expect(verdict).toEqual({ ok: false, why: "reads failed", unknown: true });
  });

  it("a definite refusal needs no read that failed: a stranger is still refused while the chain is down", async () => {
    const verdict = await proveOwnership({
      direction: "buy",
      intent: buyFrom(F.solana, STRANGER_HUB),
      wallets: [home],
      reads: reads({ sourceHub: async () => F.solana.creator.toLowerCase(), homeHub: async () => HOME_HUB }),
    });
    expect(verdict).toEqual({ ok: false, why: "payer not on account" });
  });

  it("withTimeout: an error, a nullish answer and a slow read are all unknown", async () => {
    expect(await withTimeout(async () => "0xabc")).toBe("0xabc");
    expect(await withTimeout(async () => Promise.reject(new Error("rpc")))).toBe(UNKNOWN);
    expect(await withTimeout(async () => null)).toBe(UNKNOWN);
    expect(await withTimeout(() => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 200)), 10)).toBe(UNKNOWN);
  });
});

/**
 * M1 (the review's creator3/creator4 probes): the Intents contract pulls
 * the input from msg.sender and never checks the creator field, so anyone
 * can emit an intent naming a victim's hub wallet as its creator, paying
 * for it themselves. The proof believes the creator only when the hub
 * transaction shows the creator paying (or, signed on Sonic, the EOA
 * sending it). Receipts below recorded 2026-10-01 from SODAX's orderbook.
 */
describe("who funded the intent", () => {
  const solanaReceipt = {
    from: "0xa4026a97d3bf3caed9489cfac61ac8863d2ddb83",
    inputToken: "0x0c09e69a4528945de6d16c7E469deA6996Fdf636",
    inputAmount: 50_000_000n,
    logs: [
      {
        address: "0x0c09e69a4528945de6d16c7e469dea6996fdf636",
        topics: [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          "0x00000000000000000000000004edfda1b34481303689ab190e3240e75751a6f2",
        ],
        data: "0x0000000000000000000000000000000000000000000000000000000002faf080",
      },
      {
        address: "0x0c09e69a4528945de6d16c7e469dea6996fdf636",
        topics: [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          "0x00000000000000000000000004edfda1b34481303689ab190e3240e75751a6f2",
          "0x0000000000000000000000006382d6ccd780758c5e8a6123c33ee8f4472f96ef",
        ],
        data: "0x0000000000000000000000000000000000000000000000000000000002faf080",
      },
    ],
  };
  const realSolana = {
    ...buyFrom(F.solana, HOME_HUB),
    inputToken: solanaReceipt.inputToken,
    inputAmount: solanaReceipt.inputAmount,
  };
  const solanaWallets: OwnedWallet[] = [home, { family: "solana", address: F.solana.address, linkedAt: null }];
  const realFunding: HubFunding = { txFrom: solanaReceipt.from, transfers: transfersOf(solanaReceipt.logs) };

  it("reads a real receipt: the mint into the hub wallet, then the hub wallet paying the Intents contract", () => {
    expect(realFunding.transfers).toEqual([
      { token: solanaReceipt.inputToken.toLowerCase(), from: "0x0000000000000000000000000000000000000000", to: F.solana.creator.toLowerCase(), value: 50_000_000n },
      { token: solanaReceipt.inputToken.toLowerCase(), from: F.solana.creator.toLowerCase(), to: INTENTS_CONTRACT, value: 50_000_000n },
    ]);
    expect(fundedBy(realFunding, realSolana, F.solana.creator, INTENTS_CONTRACT)).toBe(true);
    expect(judgeOwnership(facts({ intent: realSolana, wallets: solanaWallets, funding: realFunding }))).toMatchObject({ ok: true });
  });

  it("the Intents contract the proof looks for is the configured one", () => {
    expect(INTENTS_CONTRACT).toBe(getSodax().config.solver.intentsContract.toLowerCase());
  });

  it("a forged spoke intent (creator and source the victim's, paid by the attacker): refused, and never counted as delivered", async () => {
    const ATTACKER = "0x5555555555555555555555555555555555555555";
    const forged = buyFrom(F.solana, HOME_HUB);
    expect(judgeOwnership(facts({ intent: forged, wallets: solanaWallets, funding: paidBy(ATTACKER) }))).toEqual({
      ok: false,
      why: "not funded by its creator",
    });
    const verdict = await proveOwnership({
      direction: "buy",
      intent: forged,
      wallets: solanaWallets,
      reads: { sourceHub: async () => F.solana.creator.toLowerCase(), homeHub: async () => HOME_HUB, intentAt: async () => 1, funding: async () => paidBy(ATTACKER), isHubAsset: () => true },
    });
    expect(verdict).toEqual({ ok: false, why: "not funded by its creator" });
  });

  it("a forged hub wallet sell (the victim's hub named as creator and source, the attacker's dust): refused", () => {
    const ATTACKER = "0x5555555555555555555555555555555555555555";
    const sell = { ...SPEND, creator: HOME_HUB, srcChain: BigInt(SONIC), srcAddress: HOME_HUB, dstChain: 23n, dstAddress: ATTACKER };
    expect(judgeOwnership(facts({ direction: "sell", intent: sell, sourceHub: null, funding: { txFrom: ATTACKER, transfers: paidBy(ATTACKER).transfers } }))).toEqual({
      ok: false,
      why: "not funded by its creator",
    });
    // The real one: the relayer delivers the account's own instruction, the hub wallet pays.
    expect(judgeOwnership(facts({ direction: "sell", intent: sell, sourceHub: null, funding: paidBy(HOME_HUB) })).ok).toBe(true);
  });

  it("a forged Sonic router intent (the victim's EOA as source, sent by someone else): refused", () => {
    const wallets: OwnedWallet[] = [{ family: "evm", address: F.sonicRouter.address, linkedAt: null }];
    const intent = buyFrom(F.sonicRouter, F.sonicRouter.creator);
    expect(judgeOwnership(facts({ intent, wallets, funding: { txFrom: "0x5555555555555555555555555555555555555555", transfers: [] } }))).toEqual({
      ok: false,
      why: "not funded by its creator",
    });
  });

  it("an EOA that made its own intent on Sonic, sending the transaction itself: its own", () => {
    const eoa = "0x749b50a054fe23b497f10850239e50335247f030";
    const intent = { ...SPEND, creator: eoa, srcChain: BigInt(SONIC), srcAddress: eoa, dstChain: BigInt(SONIC), dstAddress: eoa };
    const wallets: OwnedWallet[] = [{ family: "evm", address: eoa, linkedAt: null }];
    expect(judgeOwnership(facts({ intent, wallets, sourceHub: null, funding: signedBy(eoa) })).ok).toBe(true);
  });

  it("the transfer must be the intent's own: its token, into the Intents contract, at least its amount", () => {
    const creator = F.solana.creator;
    const base = { token: USDC_HUB, from: creator.toLowerCase(), to: INTENTS_CONTRACT, value: AMOUNT };
    const spend = { inputToken: USDC_HUB, inputAmount: AMOUNT };
    expect(fundedBy({ txFrom: RELAYER, transfers: [base] }, spend, creator, INTENTS_CONTRACT)).toBe(true);
    expect(fundedBy({ txFrom: RELAYER, transfers: [{ ...base, token: NOBODY }] }, spend, creator, INTENTS_CONTRACT)).toBe(false);
    expect(fundedBy({ txFrom: RELAYER, transfers: [{ ...base, to: NOBODY }] }, spend, creator, INTENTS_CONTRACT)).toBe(false);
    expect(fundedBy({ txFrom: RELAYER, transfers: [{ ...base, value: AMOUNT - 1n }] }, spend, creator, INTENTS_CONTRACT)).toBe(false);
  });

  it("a hub transaction that could not be read: unknown", async () => {
    const verdict = await proveOwnership({
      direction: "buy",
      intent: realSolana,
      wallets: solanaWallets,
      reads: { sourceHub: async () => F.solana.creator.toLowerCase(), homeHub: async () => HOME_HUB, intentAt: async () => 1, funding: async () => UNKNOWN, isHubAsset: () => true },
    });
    expect(verdict).toEqual({ ok: false, why: "reads failed", unknown: true });
  });
});

describe("delivery counts only for a hub wallet that was the account's when the intent was placed (m5)", () => {
  const LATE = "0x6666666666666666666666666666666666666666";
  const LATE_HUB = "0x7777777777777777777777777777777777777777";
  const reads = (at: number): OwnershipReads => ({
    funding: async () => PAID_BY_ALL,
    isHubAsset: () => true,
    sourceHub: async () => F.sui.creator.toLowerCase(),
    homeHub: async (address) => (address === LATE ? LATE_HUB : address === HOME ? HOME_HUB : NOBODY),
    intentAt: async () => at,
  });
  const wallets: OwnedWallet[] = [home, { family: "evm", address: LATE, linkedAt: 5_000, unlinkedAt: null }];

  it("a Sui buy into a hub wallet linked after it is not delivered to this account; one linked before is", async () => {
    expect(await proveOwnership({ direction: "buy", intent: buyFrom(F.sui, LATE_HUB), wallets, reads: reads(4_000) })).toEqual({
      ok: false,
      why: "family not linkable",
    });
    expect(await proveOwnership({ direction: "buy", intent: buyFrom(F.sui, LATE_HUB), wallets, reads: reads(6_000) })).toEqual({
      ok: false,
      why: "family not linkable",
      deliveredToAccount: true,
    });
  });

  it("nor one unlinked before it", async () => {
    const gone: OwnedWallet[] = [home, { family: "evm", address: LATE, linkedAt: 1_000, unlinkedAt: 3_000 }];
    expect(await proveOwnership({ direction: "buy", intent: buyFrom(F.sui, LATE_HUB), wallets: gone, reads: reads(4_000) })).toEqual({
      ok: false,
      why: "family not linkable",
    });
  });
});

describe("cups: a vault deposit delivered to its own proven creator (M3)", () => {
  it("a deposit from a linked Solana wallet into that wallet's own hub wallet is the account's, recorded and paid as before", async () => {
    const wallets: OwnedWallet[] = [home, { family: "solana", address: F.solana.address, linkedAt: null }];
    const used: OwnershipReads = {
      funding: async () => paidBy(F.solana.creator),
      isHubAsset: () => true,
      sourceHub: async () => F.solana.creator.toLowerCase(),
      homeHub: vi.fn(async () => HOME_HUB),
      intentAt: async () => 1,
    };
    const cup = buyFrom(F.solana, F.solana.creator);
    expect(await proveOwnership({ direction: "buy", intent: cup, wallets, reads: used })).toEqual({ ok: true, payer: { family: "solana", address: F.solana.address } });
    // Delivered to its creator: no home hub wallet needed to prove it.
    expect(used.homeHub).not.toHaveBeenCalled();
  });

  it("a cup paid from an unlinked or unlinkable source into its own hub wallet is not the account's: that hub wallet is not the account's either", async () => {
    const reads = (creator: string): OwnershipReads => ({
      funding: async () => paidBy(creator),
      isHubAsset: () => true,
      sourceHub: async () => creator.toLowerCase(),
      homeHub: async () => HOME_HUB,
      intentAt: async () => 1,
    });
    expect(await proveOwnership({ direction: "buy", intent: buyFrom(F.sui, F.sui.creator), wallets: [home], reads: reads(F.sui.creator) })).toEqual({
      ok: false,
      why: "family not linkable",
    });
    expect(await proveOwnership({ direction: "buy", intent: buyFrom(F.solana, F.solana.creator), wallets: [home], reads: reads(F.solana.creator) })).toEqual({
      ok: false,
      why: "payer not on account",
    });
  });

  it("a cup withdraw from a linked Solana wallet's own hub wallet (signed on Solana) is the account's sell", async () => {
    const wallets: OwnedWallet[] = [home, { family: "solana", address: F.solana.address, linkedAt: null }];
    const withdraw = { ...buyFrom(F.solana, "0x00eb833b2d1790f2fbc63961ceb637f6c704debfad", 1) };
    const used: OwnershipReads = {
      funding: async () => paidBy(F.solana.creator),
      isHubAsset: () => true,
      sourceHub: async () => F.solana.creator.toLowerCase(),
      homeHub: async () => HOME_HUB,
      intentAt: async () => 1,
    };
    expect((await proveOwnership({ direction: "sell", intent: withdraw, wallets, reads: used })).ok).toBe(true);
  });
});

/**
 * The delta verifier's probes (reports/pour-ownership-delta-probes/forge.mjs):
 * a token the attacker deploys can emit any Transfer, so only a real SODAX
 * hub asset's logs prove a payment (N1); and on Sonic the EOA must itself
 * have paid, not merely sent a transaction to some contract (n2).
 */
describe("the funding proof, hardened", () => {
  const ATTACKER_CONTRACT = "0x8888888888888888888888888888888888888888";
  const FAKE_TOKEN = "0x1234567890123456789012345678901234567890";
  // The forgery: a fake token whose transferFrom logs Transfer(victim hub -> Intents).
  const forgedFunding: HubFunding = {
    txFrom: "0x5555555555555555555555555555555555555555",
    transfers: [{ token: FAKE_TOKEN, from: HOME_HUB, to: INTENTS_CONTRACT, value: AMOUNT }],
  };

  it("a fake input token's Transfer proves nothing: spoke shaped and hub shaped forgeries are refused (N1)", () => {
    const spoke = { ...buyFrom({ srcChain: 30, srcAddress: HOME, creator: HOME_HUB }, HOME_HUB), inputToken: FAKE_TOKEN };
    expect(judgeOwnership(facts({ intent: spoke, funding: forgedFunding, inputIsHubAsset: false }))).toEqual({ ok: false, why: "not funded by its creator" });
    const hub = { ...spoke, srcChain: BigInt(SONIC), srcAddress: HOME_HUB };
    expect(judgeOwnership(facts({ intent: hub, sourceHub: null, funding: forgedFunding, inputIsHubAsset: false }))).toEqual({
      ok: false,
      why: "not funded by its creator",
    });
    // The same shapes with a real hub asset are what a genuine order looks like.
    expect(judgeOwnership(facts({ intent: { ...spoke, inputToken: USDC_HUB }, funding: paidBy(HOME_HUB) })).ok).toBe(true);
  });

  it("the SDK's own config decides what a hub asset is: USDC and a listing are, a deployed token and native S are not", () => {
    const reads = sodaxOwnershipReads(getSodax(), async () => UNKNOWN, async () => UNKNOWN);
    expect(reads.isHubAsset(USDC_HUB)).toBe(true);
    expect(reads.isHubAsset("0x2D5D2250EE426cA318efBd03ddf926B23c96f74B")).toBe(true); // NVDA
    expect(reads.isHubAsset(FAKE_TOKEN)).toBe(false);
    expect(reads.isHubAsset(NATIVE_TOKEN)).toBe(false);
  });

  it("proveOwnership asks the config about the intent's own input token", async () => {
    const isHubAsset = vi.fn((token: string) => token.toLowerCase() === USDC_HUB);
    const verdict = await proveOwnership({
      direction: "buy",
      intent: { ...buyFrom(F.solana, HOME_HUB), inputToken: FAKE_TOKEN },
      wallets: [home, { family: "solana", address: F.solana.address, linkedAt: null }],
      reads: {
        funding: async () => ({ txFrom: RELAYER, transfers: [{ token: FAKE_TOKEN, from: F.solana.creator.toLowerCase(), to: INTENTS_CONTRACT, value: AMOUNT }] }),
        isHubAsset,
        sourceHub: async () => F.solana.creator.toLowerCase(),
        homeHub: async () => HOME_HUB,
        intentAt: async () => 1,
      },
    });
    expect(verdict).toEqual({ ok: false, why: "not funded by its creator" });
    expect(isHubAsset).toHaveBeenCalledWith(FAKE_TOKEN);
  });

  it("a Sonic router intent made by a contract the victim called, paying itself, is refused (n2)", () => {
    const wallets: OwnedWallet[] = [{ family: "evm", address: F.sonicRouter.address, linkedAt: null }];
    const intent = buyFrom(F.sonicRouter, F.sonicRouter.creator);
    const viaContract: HubFunding = {
      txFrom: F.sonicRouter.address,
      txTo: ATTACKER_CONTRACT,
      transfers: [{ token: USDC_HUB, from: ATTACKER_CONTRACT, to: INTENTS_CONTRACT, value: AMOUNT }],
    };
    expect(judgeOwnership(facts({ intent, wallets, funding: viaContract }))).toEqual({ ok: false, why: "not funded by its creator" });
    // The EOA's own payment, in its own transaction: its own.
    expect(judgeOwnership(facts({ intent, wallets, funding: signedBy(F.sonicRouter.address) })).ok).toBe(true);
  });

  it("native S moves as value: proven only when the EOA called the Intents contract itself (n2)", () => {
    const wallets: OwnedWallet[] = [{ family: "evm", address: F.sonicRouter.address, linkedAt: null }];
    const intent = { ...buyFrom(F.sonicRouter, F.sonicRouter.creator), inputToken: NATIVE_TOKEN };
    const direct: HubFunding = { txFrom: F.sonicRouter.address, txTo: INTENTS_CONTRACT, transfers: [] };
    expect(judgeOwnership(facts({ intent, wallets, funding: direct, inputIsHubAsset: false })).ok).toBe(true);
    expect(judgeOwnership(facts({ intent, wallets, funding: { ...direct, txTo: ATTACKER_CONTRACT }, inputIsHubAsset: false }))).toEqual({
      ok: false,
      why: "not funded by its creator",
    });
  });
});

describe("the intent's time is read once (n5)", () => {
  it("a payer linked later, then a delivery into a hub wallet linked later: one block time read", async () => {
    const LATE = "0x6666666666666666666666666666666666666666";
    const LATE_HUB = "0x7777777777777777777777777777777777777777";
    const intentAt = vi.fn(async () => 6_000);
    const verdict = await proveOwnership({
      direction: "buy",
      intent: buyFrom(F.solana, LATE_HUB),
      wallets: [home, { family: "solana", address: F.solana.address, linkedAt: 9_000 }, { family: "evm", address: LATE, linkedAt: 5_000 }],
      reads: {
        funding: async () => PAID_BY_ALL,
        isHubAsset: () => true,
        sourceHub: async () => F.solana.creator.toLowerCase(),
        homeHub: async (address) => (address === LATE ? LATE_HUB : HOME_HUB),
        intentAt,
      },
    });
    expect(verdict).toEqual({ ok: false, why: "payer linked later", deliveredToAccount: true });
    expect(intentAt).toHaveBeenCalledTimes(1);
  });
});
