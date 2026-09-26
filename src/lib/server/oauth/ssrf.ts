import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import { isIP } from "node:net";

/**
 * Fetching a URL a stranger handed us, safely. A Client ID Metadata
 * Document is fetched from whatever https URL a client names as its id, so
 * that fetch must never reach inside our own network: every address the
 * name resolves to is checked, and the check runs inside the connection's
 * own DNS lookup, so a name cannot resolve to a public address for the
 * check and a private one for the connect (DNS rebinding). Redirects are
 * not followed at all, the body is capped, and the whole thing times out.
 */

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

const BLOCKED_V4: readonly [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function blockedV4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(base) & mask);
  });
}

/** Expand an IPv6 address to eight 16 bit groups, or null when it is not one. */
function ipv6Groups(ip: string): number[] | null {
  let address = ip.toLowerCase();
  const zone = address.indexOf("%");
  if (zone >= 0) address = address.slice(0, zone);
  // A trailing dotted quad (::ffff:1.2.3.4) becomes two groups.
  const dotted = address.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (isIP(dotted[1]) !== 4) return null;
    const value = ipv4ToInt(dotted[1]);
    address = `${address.slice(0, -dotted[1].length)}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (halves.length === 2 && missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail].map((group) =>
    /^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN,
  );
  return groups.length === 8 && groups.every((group) => Number.isFinite(group)) ? groups : null;
}

function blockedV6(ip: string): boolean {
  const g = ipv6Groups(ip);
  if (!g) return true;
  const allZero = (from: number, to: number) => g.slice(from, to).every((group) => group === 0);
  // :: and ::1
  if (allZero(0, 7) && (g[7] === 0 || g[7] === 1)) return true;
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d: judge the IPv4.
  if (allZero(0, 5) && (g[5] === 0xffff || g[5] === 0)) {
    return blockedV4(`${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`);
  }
  // NAT64 64:ff9b::/96 carries an IPv4 too.
  if (g[0] === 0x64 && g[1] === 0xff9b && allZero(2, 6)) {
    return blockedV4(`${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`);
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link local fe80::/10
  if ((g[0] & 0xffc0) === 0xfec0) return true; // site local fec0::/10 (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast ff00::/8
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0100 && allZero(1, 4)) return true; // discard 100::/64
  if (g[0] === 0x2002) {
    // 6to4 embeds an IPv4 in groups 1 and 2.
    return blockedV4(`${g[1] >> 8}.${g[1] & 0xff}.${g[2] >> 8}.${g[2] & 0xff}`);
  }
  return false;
}

/** Whether an address is private, loopback, link local, reserved or otherwise not the open internet. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return blockedV4(ip);
  if (family === 6) return blockedV6(ip);
  return true;
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** dns.lookup that refuses to hand back a blocked address, for use as a socket's lookup. */
export function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number } | number | undefined,
  callback: LookupCallback,
): void {
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error, []);
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((entry) => isBlockedAddress(entry.address))) {
      const refused = new Error(`refused to connect to ${hostname}: not a public address`) as NodeJS.ErrnoException;
      refused.code = "EBLOCKED";
      return callback(refused, []);
    }
    const wantsAll = typeof options === "object" && options?.all;
    if (wantsAll) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

export type SafeFetchResult =
  | { ok: true; status: number; body: string; contentType: string | null }
  | { ok: false; reason: string };

export type SafeFetcher = (url: string) => Promise<SafeFetchResult>;

export const SAFE_FETCH_TIMEOUT_MS = 5_000;
export const SAFE_FETCH_MAX_BYTES = 32 * 1024;

/**
 * GET an https URL through the guarded lookup: no redirects (a 3xx is a
 * failure), at most SAFE_FETCH_MAX_BYTES, at most SAFE_FETCH_TIMEOUT_MS. A
 * literal IP in the URL is checked directly, since no lookup happens then.
 */
export const safeFetch: SafeFetcher = (target) =>
  new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      return resolve({ ok: false, reason: "not a url" });
    }
    if (url.protocol !== "https:") return resolve({ ok: false, reason: "not https" });
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && isBlockedAddress(host)) return resolve({ ok: false, reason: "not a public address" });

    let settled = false;
    const finish = (result: SafeFetchResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const req = request(
      url,
      {
        method: "GET",
        headers: { accept: "application/json", "user-agent": "Berth-OAuth/1 (+https://www.berthmarkets.com)" },
        lookup: guardedLookup as never,
        timeout: SAFE_FETCH_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          req.destroy();
          return finish({ ok: false, reason: `redirect ${status} not followed` });
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > SAFE_FETCH_MAX_BYTES) {
            req.destroy();
            finish({ ok: false, reason: "document too large" });
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          finish({
            ok: true,
            status,
            body: Buffer.concat(chunks).toString("utf8"),
            contentType: res.headers["content-type"] ?? null,
          }),
        );
        res.on("error", (error) => finish({ ok: false, reason: error.message }));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      finish({ ok: false, reason: "timed out" });
    }, SAFE_FETCH_TIMEOUT_MS);
    req.on("close", () => clearTimeout(timer));
    req.on("timeout", () => {
      req.destroy();
      finish({ ok: false, reason: "timed out" });
    });
    req.on("error", (error) => finish({ ok: false, reason: error.message }));
    req.end();
  });
