import type { SiweMessage } from "viem/siwe";

/**
 * A SIWE message says which site asked for it (domain and uri). The wallet
 * shows that site, so a phishing page can collect a genuine signature by
 * naming itself. The server must therefore refuse any message that names a
 * host other than Berth's own, or it would accept a signature the person gave
 * to someone else.
 */
const PRODUCTION_HOSTS = ["www.berthmarkets.com", "berthmarkets.com"];

/** Sonic, where the rewards identity lives (hooks/use-wallet-session). */
export const SIWE_CHAIN_ID = 146;

function allowedHosts(): string[] {
  const hosts = [...PRODUCTION_HOSTS];
  for (const url of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]) {
    if (url) hosts.push(url.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
  }
  return hosts;
}

function hostAllowed(host: string): boolean {
  const lower = host.toLowerCase();
  if (allowedHosts().includes(lower)) return true;
  // Local development only: localhost on any port.
  return process.env.NODE_ENV !== "production" && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(lower);
}

/**
 * True when the message was made for Berth, on Sonic: the domain, that the
 * uri is on the same host, and the chain id. Freshness is the nonce's job
 * (its token expires after ten minutes, lib/server/wallet-session); the
 * message's own issuedAt comes from the person's clock, which may be off.
 */
export function siweMadeForBerth(fields: Partial<SiweMessage>): boolean {
  if (!fields.domain || !hostAllowed(fields.domain)) return false;
  if (!fields.uri) return false;
  try {
    if (new URL(fields.uri).host.toLowerCase() !== fields.domain.toLowerCase()) return false;
  } catch {
    return false;
  }
  return fields.chainId === SIWE_CHAIN_ID;
}
