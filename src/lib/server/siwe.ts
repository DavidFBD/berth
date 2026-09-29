import { createPublicClient, http, recoverMessageAddress, type Hex } from "viem";
import { sonic } from "viem/chains";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { siweMadeForBerth } from "@/lib/server/siwe-origin";

/**
 * The one SIWE check (EIP-4361), shared by the sign in handshake
 * (app/api/siwe/verify) and the account's wallet proofs
 * (lib/server/account-wallets): the message must carry the nonce Berth
 * issued, be inside its validity window and name Berth's own host and Sonic
 * (lib/server/siwe-origin siweMadeForBerth), and the signature must be the
 * address's. An ordinary key is recovered locally; anything else (ERC-1271
 * smart accounts, ERC-6492 pre-deploy accounts) is asked of the chain.
 * Returns the signer, lowercase, or null.
 */

const client = createPublicClient({
  chain: sonic,
  transport: http("https://sonic-rpc.publicnode.com"),
});

export type SiweVerifier = (input: { message: string; signature: string; nonce: string }) => Promise<string | null>;

/** The message and the ordinary key check, with no chain call: the signer, or null. */
async function checkLocally({ message, signature, nonce }: Parameters<SiweVerifier>[0]) {
  let fields: ReturnType<typeof parseSiweMessage>;
  try {
    fields = parseSiweMessage(message);
  } catch {
    return { ok: false as const };
  }
  if (!fields.address || !validateSiweMessage({ message: fields, nonce }) || !siweMadeForBerth(fields)) return { ok: false as const };
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) return { ok: false as const };
  const recovered = await recoverMessageAddress({ message, signature: signature as Hex }).catch(() => null);
  return { ok: true as const, address: fields.address, recovered: recovered?.toLowerCase() === fields.address.toLowerCase() };
}

/** Ordinary keys only, never the chain: the tests' verifier. */
export const verifySiweLocally: SiweVerifier = async (input) => {
  const local = await checkLocally(input);
  return local.ok && local.recovered ? local.address.toLowerCase() : null;
};

export const verifySiwe: SiweVerifier = async (input) => {
  const local = await checkLocally(input);
  if (!local.ok) return null;
  if (local.recovered) return local.address.toLowerCase();
  const valid = await client
    .verifyMessage({ address: local.address, message: input.message, signature: input.signature as Hex })
    .catch(() => false);
  return valid ? local.address.toLowerCase() : null;
};
