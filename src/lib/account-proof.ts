import { COPY } from "@/lib/copy";
import { shortenAddress } from "@/lib/format";

/**
 * What an account wallet proof must say, stated once for the client that
 * builds the SIWE message and the server that checks it
 * (lib/server/account-wallets-route): the statement the wallet shows, and
 * one resource naming the act and the target address, so a signature given
 * for one act on one address can never be spent on another.
 */

export type ProofAct = "link" | "link-confirm" | "home" | "unlink";

export function proofStatement(act: ProofAct, target: string): string {
  const short = shortenAddress(target.toLowerCase(), 4);
  switch (act) {
    case "link":
      return COPY.walletLinkStatement;
    case "link-confirm":
      return COPY.walletLinkConfirmStatement(short);
    case "home":
      return COPY.walletHomeStatement(short);
    case "unlink":
      return COPY.walletRemoveStatement(short);
  }
}

export function proofResource(act: ProofAct, target: string): string {
  return `urn:berth:${act}:eip155:${target.toLowerCase()}`;
}
