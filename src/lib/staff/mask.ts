/**
 * How the staff area shows personal identifiers by default
 * (docs/adr/0008-staff-area.md): enough to tell two rows apart and to
 * recognise someone who wrote in, never enough to contact or trace them.
 * The full value comes only through a reveal, which is audited.
 *
 *   maskEmail("dana@sodax.com")          "d***@sodax.com"
 *   maskWallet("0x12ab…(40 hex)…cdab")     "0x12…ab"
 *   maskWallet("eip155:0x12ab…cdab")       "0x12…ab"
 *   maskWallet("7EcDhSYG…FLtV")            "7EcD…tV"
 *
 * Pure, and used on every path a value leaves the server for a staff page,
 * including the audit's own `detail` (scrubPersonal).
 */

import { WEBMAIL_DOMAINS } from "@/lib/webmail";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;

/** Mail providers shared by millions (lib/webmail, one list): their name says nothing about a person, so it is shown whole. */
const WEBMAIL = WEBMAIL_DOMAINS;

/**
 * "d***@gmail.com", "d***@s****.com": the first character of the local
 * part; a shared webmail domain whole, any other domain (which can name
 * the person's employer, or the person) by its first letter and its last
 * label only.
 */
export function maskEmail(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const value = email.trim();
  if (!EMAIL_SHAPE.test(value)) return value ? "***" : null;
  const at = value.lastIndexOf("@");
  const domain = value.slice(at + 1);
  const shown = WEBMAIL.has(domain.toLowerCase()) ? domain : maskDomain(domain);
  return `${value.slice(0, 1)}***@${shown}`;
}

function maskDomain(domain: string): string {
  const labels = domain.split(".");
  if (labels.length < 2) return `${domain.slice(0, 1)}****`;
  const tld = labels[labels.length - 1];
  return `${labels[0].slice(0, 1)}****.${tld}`;
}

/** A wallet address without its CAIP-10 namespace ("eip155:0x…" is "0x…"). */
export function bareAddress(value: string): string {
  const match = value.match(/^(?:eip155|solana|bip122):(.+)$/);
  return match ? match[1] : value;
}

/** "0x12…ab" for EVM, the first four and last two otherwise. */
export function maskWallet(address: string | null | undefined): string | null {
  if (typeof address !== "string") return null;
  const value = bareAddress(address.trim());
  if (!value) return null;
  if (/^0x[0-9a-fA-F]{6,}$/.test(value)) return `${value.slice(0, 4)}…${value.slice(-2)}`;
  if (value.length <= 6) return "…";
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

/** Something that looks like an email address anywhere in a string. */
const EMAIL_ANYWHERE = /[^\s@<>"'(),;:*]+@[^\s@<>"'(),;:]+\.[a-z]{2,}/gi;
/** An EVM address, a long base58 run (Solana, legacy Bitcoin) or a bech32 Bitcoin address. */
const WALLET_ANYWHERE = /\b(?:0x[0-9a-fA-F]{40}|bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34}|[1-9A-HJ-NP-Za-km-z]{32,44})\b/g;

/** A free text (a staff member's reason) with any email or wallet in it masked. */
export function scrubText(text: string): string {
  return text
    .replace(EMAIL_ANYWHERE, (match) => maskEmail(match) ?? "***")
    .replace(WALLET_ANYWHERE, (match) => maskWallet(match) ?? "…");
}

/**
 * A JSON value with every string scrubbed (scrubText), however deep. The
 * audit's `detail` goes through this before it is written, so a reason
 * that pasted an address keeps only its mask.
 */
export function scrubPersonal<T>(value: T): T {
  if (typeof value === "string") return scrubText(value) as T;
  if (Array.isArray(value)) return value.map((item) => scrubPersonal(item)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = scrubPersonal(item);
    return out as T;
  }
  return value;
}

/** Whether a string holds an email or a wallet address anywhere (the tests' and the logger's check). */
export function holdsPersonal(text: string): boolean {
  EMAIL_ANYWHERE.lastIndex = 0;
  WALLET_ANYWHERE.lastIndex = 0;
  const found = EMAIL_ANYWHERE.test(text) || WALLET_ANYWHERE.test(text);
  EMAIL_ANYWHERE.lastIndex = 0;
  WALLET_ANYWHERE.lastIndex = 0;
  return found;
}
