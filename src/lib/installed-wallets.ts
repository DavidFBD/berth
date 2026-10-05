/**
 * Which wallets a browser actually has, from the SDK's connector lists.
 *
 * The welcome screen offers a wallet only when it is installed: a phone
 * without one sees email alone, a Phantom or MetaMask in-app browser sees
 * its own wallet as a one-tap option. The rules that turn the per-family
 * connector lists into that offer live here, pure, so they can be tested
 * without a browser.
 */

/** The slice of the SDK's `IXConnector` these rules read. */
export type ConnectorLike = {
  id: string;
  name: string;
  icon?: string;
  isInstalled: boolean;
  xChainType: string;
};

/** One wallet as offered: a name, its icon, and one connector per family. */
export type InstalledWallet<C extends ConnectorLike = ConnectorLike> = {
  name: string;
  icon?: string;
  /** Detected connectors for this wallet, in FAMILY_PRIORITY order. */
  connectors: C[];
  /** The connector tapped first: the wallet's highest-priority family. */
  primary: C;
};

/**
 * Which family to connect first when one wallet serves several. EVM first
 * because the home chain is Base and most funding starts there; then the
 * families the plan names as funding doors.
 */
export const FAMILY_PRIORITY: readonly string[] = [
  "EVM",
  "SOLANA",
  "BITCOIN",
  "STELLAR",
  "SUI",
  "NEAR",
  "INJECTIVE",
  "STACKS",
  "ICON",
];

/**
 * Families whose connectors actually probe the browser before answering
 * `isInstalled`: Bitcoin wallets check their injected providers, Solana and
 * Sui come from the wallet standard registry, Stacks and ICON look for their
 * window objects. Everything else (Stellar, NEAR, Injective) carries web or
 * redirect wallets that report installed on every device, which is exactly
 * the false offer this rule exists to avoid; those stay reachable in the
 * full wallet drawer once signed in.
 */
export const DETECTABLE_FAMILIES: ReadonlySet<string> = new Set([
  "EVM",
  "SOLANA",
  "SUI",
  "BITCOIN",
  "STACKS",
  "ICON",
]);

/**
 * Connectors that are not a wallet on this device: WalletConnect is a QR
 * relay to a wallet elsewhere and always reports installed; the Privy bridge
 * is the email account itself surfacing as a wallet-standard wallet; on EVM
 * only providers announced through EIP-6963 count, and those carry a
 * reverse-DNS id (`io.metamask`, `app.phantom`), while wagmi's own SDK and
 * generic connectors (`metaMaskSDK`, `coinbaseWalletSDK`, `injected`) can
 * deep-link or fall back without any extension present.
 */
export function isDetectableWallet(connector: ConnectorLike): boolean {
  const id = connector.id.toLowerCase();
  if (id === "walletconnect" || id.includes("privy")) return false;
  if (!DETECTABLE_FAMILIES.has(connector.xChainType)) return false;
  if (connector.xChainType === "EVM" && !id.includes(".")) return false;
  return connector.isInstalled;
}

function familyRank(chainType: string): number {
  const index = FAMILY_PRIORITY.indexOf(chainType);
  return index === -1 ? FAMILY_PRIORITY.length : index;
}

/**
 * Flatten the per-family connector map into one row per installed wallet,
 * grouped by name (Phantom on Solana and Phantom on EVM are one wallet to
 * the person holding the phone), families ordered by priority, wallets
 * ordered by their best family and then by name.
 */
export function pickInstalledWallets<C extends ConnectorLike>(
  byChain: Partial<Record<string, readonly C[]>>,
): InstalledWallet<C>[] {
  const groups = new Map<string, C[]>();
  for (const connectors of Object.values(byChain)) {
    for (const connector of connectors ?? []) {
      if (!isDetectableWallet(connector)) continue;
      const key = connector.name.trim().toLowerCase();
      const group = groups.get(key);
      if (group) {
        if (!group.some((c) => c.xChainType === connector.xChainType)) {
          group.push(connector);
        }
      } else {
        groups.set(key, [connector]);
      }
    }
  }

  const wallets: InstalledWallet<C>[] = [];
  for (const connectors of groups.values()) {
    connectors.sort(
      (a, b) => familyRank(a.xChainType) - familyRank(b.xChainType),
    );
    const primary = connectors[0];
    wallets.push({
      name: primary.name,
      icon: connectors.find((c) => c.icon)?.icon,
      connectors,
      primary,
    });
  }
  wallets.sort(
    (a, b) =>
      familyRank(a.primary.xChainType) - familyRank(b.primary.xChainType) ||
      a.name.localeCompare(b.name),
  );
  return wallets;
}

/** Above this many wallets the way in folds the rest behind "More wallets". */
export const WALLETS_SHOWN_IN_FULL = 2;

/** The wallets offered as their own pill, and the ones folded behind "More wallets". */
export type WalletOffer<W> = { shown: W[]; hidden: W[] };

/**
 * Split the detected wallets for the way in, so ten extensions never crowd
 * the welcome page. Two or fewer are all shown, as before. More than two
 * show one: the wallet last used on this device when it is still here
 * (matched by name, as `pickInstalledWallets` groups them), otherwise the
 * first in the usual order. The rest keep their order behind the fold.
 */
export function splitWalletOffer<W extends { name: string }>(
  wallets: readonly W[],
  rememberedName: string | null,
): WalletOffer<W> {
  if (wallets.length <= WALLETS_SHOWN_IN_FULL) return { shown: [...wallets], hidden: [] };
  const key = rememberedName?.trim().toLowerCase();
  const found = key ? wallets.findIndex((w) => w.name.trim().toLowerCase() === key) : -1;
  const lead = found === -1 ? 0 : found;
  return {
    shown: [wallets[lead]],
    hidden: wallets.filter((_, i) => i !== lead),
  };
}

const LAST_WALLET_KEY = "berth.last-wallet.v1";

/**
 * The name of the wallet last picked on the way in on this device. Kept
 * apart from the restore record (hooks/use-wallet-session), which is
 * forgotten on sign out; this is only a name, so it can outlive one.
 */
export function lastWalletName(): string | null {
  try {
    const raw = localStorage.getItem(LAST_WALLET_KEY);
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

export function rememberLastWallet(name: string): void {
  try {
    localStorage.setItem(LAST_WALLET_KEY, name);
  } catch {
    // Private windows and blocked storage: the first wallet leads instead.
  }
}
