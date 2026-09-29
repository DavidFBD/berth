import { COPY } from "@/lib/copy";
import { shortenAddress } from "@/lib/format";

/**
 * What an account wallet proof must say, stated once for the client that
 * builds the SIWE message and the server that checks it
 * (lib/server/account-wallets-route): the statement the wallet shows, and
 * one resource naming the act and the target address, so a signature given
 * for one act on one address can never be spent on another.
 */

export type ProofAct = "link" | "link-confirm" | "home" | "unlink" | "merge";

/** The families an account can prove an address in today. */
export type ProofFamily = "evm" | "solana" | "bitcoin";

/**
 * How a target travels in a nonce token and a resource: an EVM address as
 * its lowercase hex (the phase 2 spelling, unchanged), a Solana address as
 * `solana:<base58>`, case preserved (base58 is case-sensitive), a Bitcoin
 * address as `bitcoin:<address>` in its canonical spelling (bech32
 * lowercase, base58 as it is).
 */
export function targetKey(family: ProofFamily, address: string): string {
  if (family === "solana") return `solana:${address}`;
  if (family === "bitcoin") return `bitcoin:${address}`;
  return address.toLowerCase();
}

/** The family and address a target key names. */
export function parseTargetKey(key: string): { family: ProofFamily; address: string } {
  if (key.startsWith("solana:")) return { family: "solana", address: key.slice(7) };
  if (key.startsWith("bitcoin:")) return { family: "bitcoin", address: key.slice(8) };
  return { family: "evm", address: key };
}

export function proofStatement(act: ProofAct, target: string): string {
  const { family, address } = parseTargetKey(target);
  const short = shortenAddress(family === "evm" ? address.toLowerCase() : address, 4);
  switch (act) {
    case "link":
      return COPY.walletLinkStatement;
    case "link-confirm":
      return COPY.walletLinkConfirmStatement(short);
    case "home":
      return COPY.walletHomeStatement(short);
    case "unlink":
      return COPY.walletRemoveStatement(short);
    case "merge":
      return COPY.walletMergeStatement(short);
  }
}

export function proofResource(act: ProofAct, target: string): string {
  const { family, address } = parseTargetKey(target);
  if (family === "solana") return `urn:berth:${act}:solana:${address}`;
  if (family === "bitcoin") return `urn:berth:${act}:bip122:${address}`;
  return `urn:berth:${act}:eip155:${address.toLowerCase()}`;
}
