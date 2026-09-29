/**
 * Sign-In With Solana (the Phantom SIWS profile of CAIP-122, the same text
 * shape as EIP-4361 with "Solana account" in the header): built by the
 * browser (hooks/use-profile useWalletAct) and read back by the server
 * (lib/server/siws). One writer and one reader, so the server can insist
 * the message it was sent is exactly the one this module would write for
 * the fields it holds: nothing extra, nothing reordered, nothing a wallet
 * would show that the check did not read.
 */

export type SiwsFields = {
  domain: string;
  /** Base58, case preserved. */
  address: string;
  statement: string;
  uri: string;
  version: "1";
  /** "mainnet": a Berth identity is never a devnet or testnet key. */
  chainId: string;
  nonce: string;
  issuedAt: string;
  resources: string[];
};

/** The networks a Berth sign-in message is written for besides EVM (SIWE, viem/siwe). */
export type SignInAccount = "Solana" | "Bitcoin";

const headerOf = (account: SignInAccount) => ` wants you to sign in with your ${account} account:`;

export function createSiwsMessage(fields: SiwsFields): string {
  return createSignInMessage("Solana", fields);
}

/**
 * The same text for another network's account: only the header's network
 * name differs, so a Solana message can never be read as a Bitcoin one or
 * the other way round.
 */
export function createSignInMessage(account: SignInAccount, fields: SiwsFields): string {
  const lines = [
    `${fields.domain}${headerOf(account)}`,
    fields.address,
    "",
    fields.statement,
    "",
    `URI: ${fields.uri}`,
    `Version: ${fields.version}`,
    `Chain ID: ${fields.chainId}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt}`,
  ];
  if (fields.resources.length > 0) {
    lines.push("Resources:");
    for (const resource of fields.resources) lines.push(`- ${resource}`);
  }
  return lines.join("\n");
}

function field(line: string | undefined, label: string): string | null {
  if (line === undefined || !line.startsWith(`${label}: `)) return null;
  const value = line.slice(label.length + 2);
  return value.length > 0 ? value : null;
}

/**
 * The fields of a SIWS message in exactly the shape createSiwsMessage
 * writes, or null. A message that parses but would be written differently
 * (extra lines, other order, trailing text) is refused.
 */
export function parseSiwsMessage(message: string): SiwsFields | null {
  return parseSignInMessage("Solana", message);
}

/** parseSiwsMessage for another network's account (createSignInMessage). */
export function parseSignInMessage(account: SignInAccount, message: string): SiwsFields | null {
  if (typeof message !== "string" || message.length > 4000) return null;
  const HEADER = headerOf(account);
  const lines = message.split("\n");
  const header = lines[0] ?? "";
  if (!header.endsWith(HEADER)) return null;
  const domain = header.slice(0, -HEADER.length);
  const address = lines[1] ?? "";
  if (!domain || !address || lines[2] !== "" || !lines[3] || lines[4] !== "") return null;
  const statement = lines[3];
  const uri = field(lines[5], "URI");
  const version = field(lines[6], "Version");
  const chainId = field(lines[7], "Chain ID");
  const nonce = field(lines[8], "Nonce");
  const issuedAt = field(lines[9], "Issued At");
  if (!uri || version !== "1" || !chainId || !nonce || !issuedAt) return null;
  const resources: string[] = [];
  if (lines.length > 10) {
    if (lines[10] !== "Resources:") return null;
    for (const line of lines.slice(11)) {
      if (!line.startsWith("- ") || line.length < 3) return null;
      resources.push(line.slice(2));
    }
  }
  const fields: SiwsFields = { domain, address, statement, uri, version, chainId, nonce, issuedAt, resources };
  return createSignInMessage(account, fields) === message ? fields : null;
}
