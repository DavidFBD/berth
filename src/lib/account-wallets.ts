import type { Copy } from "@/lib/copy";

/**
 * The client's rule for an account with more than one EVM address
 * (docs/plans/account-linking.md, phase 2): which address is home, whose
 * hub wallets the totals add up, and whether the address signing in this
 * session belongs to the account. Pure, so the rule is testable without a
 * wallet; hooks/use-hub-account derives the hub wallets from it.
 */

export type LinkedWalletView = { address: string; family: string; isHome: boolean };

export type AccountHubPlan = {
  /**
   * Where buys land: the wallet this session signs with when it is linked
   * to the account (its own hub wallet, which this session can also sell
   * from), else the account's home, else the session's own address.
   */
  home: string | undefined;
  /** Every EVM address whose hub wallet counts, home first, lowercase. */
  wallets: { spoke: string; isHome: boolean }[];
  /** The address that signs on the home chain in this session, lowercase. */
  signer: string | undefined;
  signerLinked: boolean;
  /**
   * False while a wallet session waits for the server's list (loading or
   * failed): the home is not known yet, so no buy may be addressed. The
   * session's address may not be the home at all.
   */
  homeKnown: boolean;
};

export function accountHubPlan({
  override,
  sessionSpoke,
  pending,
  linked,
  linkedLoading,
  emailSession = false,
  walletSessionHeld = true,
  profileHome,
}: {
  /** The dev page's "derive any address": that address alone. */
  override?: string;
  /** The home chain rule's address for this session (lib/account homeSpokeAddress). */
  sessionSpoke: string | undefined;
  /** An extension address waiting to be added (hooks/use-profile usePendingWallet). */
  pending: string | null;
  /** The server's list, when it has answered. */
  linked: readonly LinkedWalletView[] | undefined;
  linkedLoading: boolean;
  /**
   * An email session's home is its embedded wallet (the drawer never offers
   * another), so it may stand in before the list answers. A wallet
   * session's may be another linked address, so it waits.
   */
  emailSession?: boolean;
  /**
   * Whether this browser holds a wallet session for the connected address.
   * Without one (the sign-in signature declined, or not asked yet) no list
   * can answer, and the connected address's own hub wallet is the account,
   * exactly as before phase 2.
   */
  walletSessionHeld?: boolean;
  /**
   * The home the profile response named (Profile.homeAddress), for when the
   * list request failed: the account's one address, so a single wallet
   * account with a session always buys, home first as on master.
   */
  profileHome?: string | null;
}): AccountHubPlan {
  if (override) {
    const spoke = override.toLowerCase();
    return { home: override, wallets: [{ spoke, isHome: true }], signer: spoke, signerLinked: true, homeKnown: true };
  }
  const signer = sessionSpoke?.toLowerCase();
  const evm = (linked ?? []).filter((wallet) => wallet.family === "evm").map((wallet) => ({
    spoke: wallet.address.toLowerCase(),
    isHome: wallet.isHome,
  }));
  const linkedHome = evm.find((wallet) => wallet.isHome)?.spoke;

  if (!linkedHome) {
    // A waiting address is never the account.
    if (pending) return { home: undefined, wallets: [], signer, signerLinked: false, homeKnown: false };
    // An email session, or a wallet with no session here: its own address
    // is the account, exactly as before phase 2. A wallet session: wait for
    // the list, so a buy never
    // lands in a hub wallet that is not the home (the drawer reads
    // "deriving" meanwhile, and stays so if the list fails).
    if (!emailSession && walletSessionHeld) {
      // The list failed but the profile named the home: buys land there.
      // Totals read it alone until the list answers (a second wallet's
      // holdings are then missing, never misplaced).
      if (!linkedLoading && profileHome) {
        const home = profileHome.toLowerCase();
        return {
          home,
          wallets: [{ spoke: home, isHome: true }],
          signer,
          // Unknown without the list; the server's pour check decides.
          signerLinked: true,
          homeKnown: true,
        };
      }
      return { home: sessionSpoke, wallets: [], signer, signerLinked: true, homeKnown: false };
    }
    return {
      home: sessionSpoke,
      wallets: signer ? [{ spoke: signer, isHome: true }] : [],
      signer,
      signerLinked: true,
      homeKnown: true,
    };
  }

  const wallets = [...evm].sort((a, b) => Number(b.isHome) - Number(a.isHome));
  const signerListed = !!signer && wallets.some((wallet) => wallet.spoke === signer);
  const signerLinked = !signer || signerListed || (!pending && linkedLoading);
  // A buy lands where this session can sell it: in the signer's own hub
  // wallet when the signer is on the account (a wallet signed in with its
  // own key, or an email session's embedded wallet). The home is where it
  // lands otherwise. After a merge this keeps a wallet's buys its own,
  // rather than in an email account's wallet it cannot sign for.
  return { home: signerListed ? signer : linkedHome, wallets, signer, signerLinked, homeKnown: true };
}

/**
 * Where a sell can come from: the hub wallets that hold the listing, and
 * which one this session can sign for. A hub wallet is spent only by a
 * signature from the address it is derived from.
 */
export function sellSources(
  wallets: readonly { spoke: string; hubWallet: string | undefined; isHome: boolean }[],
  balanceAt: (hubWallet: string) => bigint,
  signerHubWallet: string | undefined,
): { spoke: string; hubWallet: string; isHome: boolean; balance: bigint; canSign: boolean }[] {
  return wallets.flatMap((wallet) => {
    if (!wallet.hubWallet) return [];
    const balance = balanceAt(wallet.hubWallet);
    if (balance <= 0n) return [];
    return [{
      spoke: wallet.spoke,
      hubWallet: wallet.hubWallet,
      isHome: wallet.isHome,
      balance,
      canSign: !!signerHubWallet && wallet.hubWallet.toLowerCase() === signerHubWallet.toLowerCase(),
    }];
  });
}

/**
 * What a wallet act's answer means for the person: a body is the answer;
 * 403 is the server asking an email account for a fresh code ("sign in
 * again"), 429 the rate limit, anything else a plain failure.
 */
export function walletActOutcome(
  status: number,
  data: unknown,
): { ok: true } | { ok: false; reason: "reauth" | "slow" | "failed" } {
  if (status >= 200 && status < 300 && data) return { ok: true };
  if (status === 403) return { ok: false, reason: "reauth" };
  if (status === 429) return { ok: false, reason: "slow" };
  return { ok: false, reason: "failed" };
}

/** The line a failed wallet act shows. */
export function walletActMessage(reason: string, copy: Copy): string {
  if (reason === "declined") return copy.walletsDeclined;
  if (reason === "slow") return copy.walletsSlowDown;
  if (reason === "reauth") return copy.walletsSignInAgain;
  return copy.walletsFailed;
}

