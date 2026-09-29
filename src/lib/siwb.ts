import { createSignInMessage, parseSignInMessage, type SiwsFields } from "@/lib/siws";

/**
 * Sign-In With Bitcoin: the SIWS text (lib/siws, the CAIP-122 shape of
 * EIP-4361) with "Bitcoin account" in the header, built by the browser
 * (hooks/use-profile useWalletAct) and read back by the server
 * (lib/server/siwb) with the same strict rule: the message must be exactly
 * what this module would write for the fields it holds. The address is the
 * canonical mainnet spelling (lib/identity/caip): bech32 lowercase, base58
 * as it is.
 */

export type SiwbFields = SiwsFields;

export function createSiwbMessage(fields: SiwbFields): string {
  return createSignInMessage("Bitcoin", fields);
}

export function parseSiwbMessage(message: string): SiwbFields | null {
  return parseSignInMessage("Bitcoin", message);
}
