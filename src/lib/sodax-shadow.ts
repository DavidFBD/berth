import { ChainKeys } from "@sodax/sdk";

/**
 * Attribution for the house's orders. SODAX credits volume to an organisation
 * only when a keyed `POST /v1/leverage-yield/submit-tx` carries it, and Berth
 * runs its own relay and notify, so that call never happened. This tells
 * SODAX about each broadcast order after the fact, through our own route
 * (/api/sodax/submit-tx, which holds the key), and changes nothing else: the
 * order's relay, notify and status are exactly what they were, the call is
 * not awaited, and any failure is dropped.
 *
 * The body is what the SDK's own `submitTx` sends (sdk rc.8 dist, the
 * LeverageYieldService.submitTx body, and LeverageYieldApiService.submitTx):
 * the intent without its display-only `feeAmount` (toWireIntent), bigints as
 * decimal strings (toJsonBody), `relayData.payload`, and `operation`
 * "withdraw" when the swap spends the hub wallet (`hubWalletSwap`, a sell),
 * else "deposit" (a buy).
 */

export const SHADOW_SUBMIT_PATH = "/api/sodax/submit-tx";

export type ShadowSubmitBody = {
  txHash: string;
  srcChainKey: string;
  walletAddress: string;
  intent: Record<string, unknown>;
  relayData: string;
  operation: "deposit" | "withdraw";
};

export type ShadowSubmitInput = {
  tx: string;
  srcChainKey: string;
  walletAddress: string;
  /** The intent as createVaultIntent returns it (bigint fields, plus feeAmount). */
  intent: object;
  /** createVaultIntent's relayData: { address, payload }. */
  relayData: { payload?: unknown } | undefined;
  /** The swap payload's hubWalletSwap: true for a sell. */
  hubWalletSwap?: boolean;
  /** The caller's own proof of who is asking (useAccountHeaders); read inside the fire and forget. */
  headers?: () => Promise<Record<string, string> | null>;
};

/** Mirrors the SDK's LeverageYieldApiService.toWireIntent plus toJsonBody. */
function toWire(intent: object): Record<string, unknown> {
  const rest = { ...(intent as Record<string, unknown>) };
  delete rest.feeAmount;
  return JSON.parse(
    JSON.stringify(rest, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
  ) as Record<string, unknown>;
}

/** The submit-tx body for an order, or null when it is not one this call can describe. */
export function buildShadowSubmit(input: ShadowSubmitInput): ShadowSubmitBody | null {
  const payload = input.relayData?.payload;
  if (typeof payload !== "string" || !/^0x[0-9a-fA-F]+$/.test(payload)) return null;
  if (!input.tx || !input.walletAddress || !input.srcChainKey) return null;
  return {
    txHash: String(input.tx),
    srcChainKey: input.srcChainKey,
    walletAddress: input.walletAddress,
    intent: toWire(input.intent),
    relayData: payload,
    operation: input.hubWalletSwap === true ? "withdraw" : "deposit",
  };
}

/** Every chain key the SDK knows: the only source chains the route accepts. */
export const KNOWN_CHAIN_KEYS: ReadonlySet<string> = new Set(Object.values(ChainKeys));

/**
 * Fire and forget. Never throws, never awaits in the caller's path, and the
 * browser's keepalive lets it outlive a page that closes right after.
 */
export function shadowSubmit(input: ShadowSubmitInput): void {
  try {
    const body = buildShadowSubmit(input);
    if (!body || !input.headers) return;
    const getHeaders = input.headers;
    void (async () => {
      try {
        const auth = await getHeaders();
        if (!auth) return;
        await fetch(SHADOW_SUBMIT_PATH, {
          method: "POST",
          headers: { "content-type": "application/json", ...auth },
          body: JSON.stringify(body),
          keepalive: true,
        });
      } catch (error) {
        console.debug("[sodax-shadow] submit-tx not sent", error);
      }
    })();
  } catch (error) {
    console.debug("[sodax-shadow] submit-tx not built", error);
  }
}
