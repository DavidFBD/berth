import type { ProofFamily } from "@/lib/account-proof";
import { normalizeAddress } from "@/lib/identity/caip";

/**
 * "Add a wallet" in the account drawer: every address the connected
 * extensions have open right now, one row per network family, each with
 * what adding it means. A multichain extension (Hana, Phantom, OKX) holds
 * its Solana or Bitcoin address in the same extension as its EVM one, so
 * there is nothing to switch to: the row is already there to add. Pure, so
 * the rule is testable without a wallet; hooks/use-account-wallets feeds it
 * the SDK's connections and the account's list.
 */

/** The wallet SDK's chain types (wallet-sdk-react ChainType), as the drawer knows them. */
export type NetworkType = "EVM" | "SOLANA" | "BITCOIN" | "SUI" | "STELLAR" | "ICON" | "INJECTIVE" | "NEAR" | "STACKS";

/** The families an address can be proved in today. */
export const LINKABLE: Partial<Record<NetworkType, ProofFamily>> = { EVM: "evm", SOLANA: "solana", BITCOIN: "bitcoin" };

/** Display order: EVM first, then the networks people hold most. */
export const NETWORK_ORDER: readonly NetworkType[] = ["EVM", "SOLANA", "BITCOIN", "SUI", "STELLAR", "ICON", "INJECTIVE", "NEAR", "STACKS"];

export type AddRowState =
  /** On this account. */
  | "added"
  /** Connected, not on the account: one press, a signature, and the account's confirmation. */
  | "add"
  /** Its signature proved it, and another account holds it. Only ever after proof. */
  | "other_account"
  /** It left another account inside the cooldown. */
  | "cooling"
  /** A family Berth cannot prove yet. */
  | "coming_soon"
  /** A family Berth can prove, with nothing connected in it. */
  | "connect";

export type AddRow = {
  network: NetworkType;
  name: string;
  address: string | null;
  /** The extension the address came from, when the SDK names it. */
  extension: string | null;
  state: AddRowState;
};

export type ConnectedNetwork = {
  network: string;
  name: string;
  address: string | undefined;
  extension?: string | null;
};

/**
 * The one spelling of an address for comparison: EVM lowercase, Bitcoin
 * its canonical mainnet form (bech32 lowercase, base58 as it is),
 * everything else as is.
 */
export function addressKey(network: string, address: string): string {
  if (network === "EVM") return address.toLowerCase();
  if (network === "BITCOIN") return normalizeAddress("bitcoin", address) ?? address;
  return address;
}

export function addWalletRows({
  networks,
  linked,
  outcomes,
}: {
  /** One per enabled network (wallet-sdk-react useChainGroups), connected or not. */
  networks: readonly ConnectedNetwork[];
  /** The account's linked wallets (/api/account/wallets). */
  linked: readonly { address: string; family: string }[];
  /** What a link answered in this browser, by addressKey: learnt only after the address signed. */
  outcomes: ReadonlyMap<string, "other_account" | "cooling">;
}): { rows: AddRow[]; comingSoon: string[] } {
  const rank = (network: string) => {
    const index = NETWORK_ORDER.indexOf(network as NetworkType);
    return index === -1 ? NETWORK_ORDER.length : index;
  };
  const sorted = [...networks].sort((a, b) => rank(a.network) - rank(b.network) || a.name.localeCompare(b.name));
  const rows: AddRow[] = [];
  const comingSoon: string[] = [];
  for (const entry of sorted) {
    const network = entry.network as NetworkType;
    const family = LINKABLE[network];
    const address = entry.address ?? null;
    const extension = entry.extension ?? null;
    if (!family) {
      if (address) rows.push({ network, name: entry.name, address, extension, state: "coming_soon" });
      else comingSoon.push(entry.name);
      continue;
    }
    if (!address) {
      rows.push({ network, name: entry.name, address: null, extension: null, state: "connect" });
      continue;
    }
    const key = addressKey(network, address);
    const onAccount = linked.some((wallet) => wallet.family === family && addressKey(network, wallet.address) === key);
    rows.push({
      network,
      name: entry.name,
      address,
      extension,
      state: onAccount ? "added" : (outcomes.get(key) ?? "add"),
    });
  }
  return { rows, comingSoon };
}

/**
 * A Bitcoin wallet's message signature as the server reads it: base64,
 * which every wallet the SDK connects answers (Unisat, Xverse, OKX and Hana
 * give BIP-322 witnesses for bc1q and bc1p, BIP-137 for 1… and 3…). Raw
 * bytes, or a 65 byte BIP-137 signature in hex, are turned into base64.
 * Null for anything else.
 */
export function bitcoinSignatureBase64(signature: unknown): string | null {
  const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  if (signature instanceof Uint8Array) return signature.length > 0 ? toBase64(signature) : null;
  if (typeof signature !== "string") return null;
  if (/^[0-9a-fA-F]{130}$/.test(signature)) {
    return toBase64(Uint8Array.from(signature.match(/../g)!, (pair) => parseInt(pair, 16)));
  }
  return /^[A-Za-z0-9+/]+={0,2}$/.test(signature) && signature.length % 4 === 0 ? signature : null;
}

/**
 * A Solana wallet's signature as the server reads it (base58, 64 bytes).
 * wallet-sdk-react answers base64 for Solana (its SolanaActions signMessage);
 * a raw Uint8Array is taken as is. Null for anything else.
 */
export function solanaSignatureBytes(signature: unknown): Uint8Array | null {
  if (signature instanceof Uint8Array) return signature.length === 64 ? signature : null;
  if (typeof signature !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) return null;
  try {
    const binary = atob(signature);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return bytes.length === 64 ? bytes : null;
  } catch {
    return null;
  }
}
