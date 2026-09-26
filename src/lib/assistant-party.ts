/**
 * Who is really asking, as the consent screen and the account drawer say it.
 *
 * A client names itself, and a name is free to lie ("Claude", with a
 * zero width space in it). What a client cannot fake is where the code is
 * sent: its redirect host, or for a Client ID Metadata Document the host
 * that serves it. So the headline is derived from the host, never from the
 * self given name:
 *
 * - a host of one of the assistants Berth knows (below): that product's own
 *   name, "Claude", "ChatGPT" or "Grok";
 * - a loopback redirect: an app on this computer;
 * - anything else: the host itself, marked as not one Berth recognises.
 *
 * Pure, so the rules are unit tests, and shared by server and client.
 */

export type AssistantId = "claude" | "chatgpt" | "grok";

export const ASSISTANT_NAMES: Record<AssistantId, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  grok: "Grok",
};

/**
 * Domains each known assistant answers on, subdomains included. Claude's
 * connectors call back to claude.ai (and claude.com); ChatGPT's to
 * chatgpt.com; Grok's to grok.com.
 */
const KNOWN_DOMAINS: readonly (readonly [string, AssistantId])[] = [
  ["claude.ai", "claude"],
  ["claude.com", "claude"],
  ["chatgpt.com", "chatgpt"],
  ["grok.com", "grok"],
];

/**
 * Exact hosts only: openai.com and x.ai carry community and user content
 * on other subdomains, which must not borrow the assistant's name.
 */
const KNOWN_HOSTS: readonly (readonly [string, AssistantId])[] = [
  ["chat.openai.com", "chatgpt"],
  ["platform.openai.com", "chatgpt"],
  ["x.ai", "grok"],
];

export type ConsentParty =
  | { kind: "known"; assistant: AssistantId; name: string }
  | { kind: "unknown"; host: string; selfName: string | null }
  | { kind: "loopback"; selfName: string | null };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parse(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

/** The known assistant an https URL belongs to, or null. */
export function knownAssistantFor(uri: string): AssistantId | null {
  const url = parse(uri);
  if (!url || url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  for (const [domain, id] of KNOWN_DOMAINS) {
    if (host === domain || host.endsWith(`.${domain}`)) return id;
  }
  for (const [known, id] of KNOWN_HOSTS) {
    if (host === known) return id;
  }
  return null;
}

export function isLoopbackUri(uri: string): boolean {
  const url = parse(uri);
  return !!url && url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * The party behind a request: the redirect it will be answered at, and for
 * a metadata document client the URL that vouches for it.
 */
export function describeParty(
  client: { kind: "dcr" | "cimd"; clientId: string; name: string | null },
  redirectUri: string,
): ConsentParty {
  const known = knownAssistantFor(redirectUri) ?? (client.kind === "cimd" ? knownAssistantFor(client.clientId) : null);
  if (known) return { kind: "known", assistant: known, name: ASSISTANT_NAMES[known] };
  if (isLoopbackUri(redirectUri)) return { kind: "loopback", selfName: client.name };
  return { kind: "unknown", host: parse(redirectUri)?.host ?? redirectUri, selfName: client.name };
}

/** A consent party read back from a signed request, or null if it is not one. */
export function isConsentParty(value: unknown): value is ConsentParty {
  if (!value || typeof value !== "object") return false;
  const party = value as Record<string, unknown>;
  if (party.kind === "known") return typeof party.assistant === "string" && party.assistant in ASSISTANT_NAMES;
  if (party.kind === "unknown") return typeof party.host === "string";
  return party.kind === "loopback";
}

/**
 * Letters from other scripts that look like Latin ones, folded so a name
 * spelled with a Cyrillic "а" is still read as the name it imitates.
 */
const CONFUSABLES: Record<string, string> = {
  а: "a", с: "c", е: "e", о: "o", р: "p", х: "x", у: "y", і: "i", ӏ: "l", ј: "j", ԁ: "d", ɡ: "g", ο: "o", α: "a",
  ι: "i", κ: "k", τ: "t", ν: "v", ρ: "p", χ: "x", ⅼ: "l", "0": "o", "1": "l",
};

/** Words no client may call itself unless it answers on that assistant's own host. */
const RESERVED = ["claude", "chatgpt", "openai", "anthropic", "grok", "xai"];

/** Whether a self given name borrows one of the known assistants' names. */
export function isReservedName(name: string | null): boolean {
  if (!name) return false;
  const folded = [...name.normalize("NFKC").toLowerCase()]
    .map((char) => CONFUSABLES[char] ?? char)
    .join("")
    .replace(/[^a-z]/g, "");
  // Both spellings: digits read as letters ("C1aude") and digits dropped.
  const plain = name.normalize("NFKC").toLowerCase().replace(/[^a-z]/g, "");
  return RESERVED.some((word) => folded.includes(word) || plain.includes(word));
}
