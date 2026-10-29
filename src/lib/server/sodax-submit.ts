import { KNOWN_CHAIN_KEYS, type ShadowSubmitBody } from "@/lib/sodax-shadow";
import { SODAX_API_BASE, buildUpstreamHeaders } from "@/lib/server/sodax-proxy";

/**
 * The server half of the order attribution call (lib/sodax-shadow): checks
 * the body strictly and forwards it, with the key, to SODAX's
 * `POST /leverage-yield/submit-tx`. The generic proxy forwards a body
 * untouched; this one lends the key to exactly one shape, so a caller who
 * reaches the route can do no more than describe an order.
 */

export const SUBMIT_TX_URL = `${SODAX_API_BASE}/leverage-yield/submit-tx`;
export const MAX_SUBMIT_BODY_BYTES = 16_384;
export const SUBMIT_TIMEOUT_MS = 8_000;

const HEX = /^0x[0-9a-fA-F]+$/;
/** Hashes and addresses differ per chain family (base58, bech32, 0x): one printable token, bounded. */
const TOKEN = /^[A-Za-z0-9_.:\-]{1,256}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The intent's wire fields, exactly what the SDK's toWireIntent emits
 * (IntentStructSchema, minus the display-only feeAmount): bigints arrive as
 * decimal strings, the two chain ids as strings or numbers. Anything else is
 * dropped, never forwarded.
 */
const INTENT_STRINGS = [
  "intentId",
  "creator",
  "inputToken",
  "outputToken",
  "inputAmount",
  "minOutputAmount",
  "deadline",
  "srcAddress",
  "dstAddress",
  "solver",
  "data",
] as const;
const INTENT_CHAINS = ["srcChain", "dstChain"] as const;
const DANGEROUS_KEYS = ["__proto__", "constructor", "prototype"];

/** The whitelisted intent, or null when a field is missing, mistyped or oversized. */
function cleanIntent(value: unknown): Record<string, unknown> | null {
  if (!isPlainObject(value)) return null;
  if (DANGEROUS_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key))) return null;
  const out: Record<string, unknown> = {};
  for (const key of INTENT_STRINGS) {
    const v = value[key];
    if (typeof v !== "string" || v.length > 2_048) return null;
    out[key] = v;
  }
  for (const key of INTENT_CHAINS) {
    const v = value[key];
    if (typeof v === "string" ? v.length === 0 || v.length > 32 : !(typeof v === "number" && Number.isFinite(v))) return null;
    out[key] = v;
  }
  if (typeof value.allowPartialFill !== "boolean") return null;
  out.allowPartialFill = value.allowPartialFill;
  return out;
}

/** The validated body, or null. Unknown keys are dropped, not forwarded. */
export function parseSubmitBody(raw: unknown): ShadowSubmitBody | null {
  if (!isPlainObject(raw)) return null;
  const { txHash, srcChainKey, walletAddress, intent, relayData, operation } = raw;
  if (typeof txHash !== "string" || !TOKEN.test(txHash)) return null;
  if (typeof srcChainKey !== "string" || !KNOWN_CHAIN_KEYS.has(srcChainKey)) return null;
  if (typeof walletAddress !== "string" || !TOKEN.test(walletAddress)) return null;
  const cleaned = cleanIntent(intent);
  if (!cleaned) return null;
  if (typeof relayData !== "string" || relayData.length > 8_192 || !HEX.test(relayData)) return null;
  if (operation !== "deposit" && operation !== "withdraw") return null;
  return {
    txHash,
    srcChainKey,
    walletAddress,
    intent: cleaned,
    relayData,
    operation,
  };
}

export type SubmitOutcome = { status: number; body: { ok: boolean; result?: string } };

/** One server side line per submission, so Vercel logs show whether attribution works: no key, no wallet. */
function logOutcome(body: ShadowSubmitBody, outcome: string): void {
  console.info(`sodax submit-tx ${outcome} chain=${body.srcChainKey} tx=${body.txHash.slice(0, 12)}`);
}

/**
 * Forwards a validated body. Upstream's reply is reduced to inserted,
 * duplicate or failed: nothing it says is handed back, so a message that
 * echoes a header can never reach a caller. As in the SDK, a 2xx that says
 * `success: false`, or carries no `data.status`, is not accepted.
 */
export async function forwardSubmit(
  body: ShadowSubmitBody,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<SubmitOutcome> {
  try {
    const upstream = await fetchImpl(SUBMIT_TX_URL, {
      method: "POST",
      headers: buildUpstreamHeaders(apiKey),
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });
    if (!upstream.ok) {
      logOutcome(body, `refused ${upstream.status}`);
      return { status: 502, body: { ok: false } };
    }
    const json = (await upstream.json().catch(() => null)) as { success?: unknown; data?: { status?: unknown } } | null;
    const status = json?.data?.status;
    if (json?.success === false || typeof status !== "string" || status === "") {
      logOutcome(body, `refused ${upstream.status}`);
      return { status: 502, body: { ok: false } };
    }
    const result = status === "duplicate" ? "duplicate" : "inserted";
    logOutcome(body, result);
    return { status: 200, body: { ok: true, result } };
  } catch {
    logOutcome(body, "error");
    return { status: 502, body: { ok: false } };
  }
}
