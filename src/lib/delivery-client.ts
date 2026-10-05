import { ChainKeys, type CreateIntentParams, type SpokeChainKey } from "@sodax/sdk";
import { isAddress, type Address } from "viem";
import { hubDelivery, type Delivery, type DeliveryReason } from "@/lib/delivery";

/**
 * The browser's side of the delivery switch (lib/delivery, app/api/delivery,
 * plan P1a and P2b). Pure: the hooks (hooks/use-delivery) and the order
 * machine (hooks/use-vault-action) call these, and the tests hold them.
 *
 * The rule the whole file keeps: only a 200 that says `robinhood` with a
 * valid address is Robinhood Chain. Anything else, an error, a timeout, a
 * 401, a 5xx, a body that does not parse, is the hub, today's path.
 */

/** How long the browser waits for the route before it reads as the hub. */
export const DELIVERY_ASK_MS = 8_000;

const REASONS: ReadonlySet<string> = new Set<DeliveryReason>([
  "not_listed",
  "no_new_buys",
  "read_failed",
  "no_evm_wallet",
  "not_eoa",
  "restricted_country",
  "unknown_country",
]);

/** The route's answer, read strictly: Robinhood Chain only from a 200 naming it with a valid address. */
export function readDeliveryAnswer(status: number, body: unknown): Delivery {
  if (status !== 200 || typeof body !== "object" || body === null) return hubDelivery("read_failed");
  const answer = body as { chainKey?: unknown; address?: unknown; reason?: unknown };
  if (answer.chainKey === "robinhood") {
    return typeof answer.address === "string" && isAddress(answer.address, { strict: true })
      ? { chainKey: "robinhood", address: answer.address as Address, reason: "switched_on" }
      : hubDelivery("read_failed");
  }
  return hubDelivery(typeof answer.reason === "string" && REASONS.has(answer.reason) ? (answer.reason as Exclude<DeliveryReason, "switched_on">) : "read_failed");
}

/** The route's answer as the browser holds it: `answered` false when no 200 came back at all. */
export type DeliveryAnswer = { delivery: Delivery; answered: boolean };

/**
 * Whether the account is on the switch at all, whatever the answer for
 * this buy: a switched account abroad, or whose wallet read failed on the
 * server, still holds what was delivered before and sees it. Only an
 * answer from the route counts; a request that failed is not a yes.
 */
export function onTheSwitch(answer: DeliveryAnswer): boolean {
  return answer.answered && answer.delivery.reason !== "not_listed";
}

/**
 * Ask the route once, from the signed-in session. Never throws: no
 * session, a failed request, a slow one (past `timeoutMs`) or an odd
 * answer all read as the hub, unanswered.
 */
export async function askDelivery({
  headers,
  fetcher = fetch,
  timeoutMs = DELIVERY_ASK_MS,
}: {
  headers: () => Promise<Record<string, string> | null>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<DeliveryAnswer> {
  const unanswered: DeliveryAnswer = { delivery: hubDelivery("read_failed"), answered: false };
  try {
    const auth = await headers();
    if (!auth) return unanswered;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher("/api/delivery", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: "{}",
        signal: controller.signal,
      });
      if (response.status !== 200) return unanswered;
      const body: unknown = await response.json();
      const delivery = readDeliveryAnswer(response.status, body);
      // A 200 whose body could not be read is no answer either.
      const parsed = typeof body === "object" && body !== null && ((body as { chainKey?: unknown }).chainKey === "sonic" || delivery.chainKey === "robinhood");
      return { delivery, answered: parsed };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return unanswered;
  }
}

/** Where one buy goes, as the order machine settles it. */
export type BuyDestination =
  | { kind: "hub" }
  | { kind: "robinhood"; address: Address; rhAddress: Address }
  /** The drawer quoted and showed Robinhood Chain, and the fresh answer no longer says so: stop, never deliver elsewhere unasked. */
  | { kind: "changed" };

/**
 * The destination of a buy, from what the drawer quoted and showed
 * (`quoted`) and the route's answer asked again as the order starts
 * (`fresh`). Robinhood Chain only when both say it, to the same address,
 * and the listing has a token there. A drawer that showed the hub
 * delivers to the hub whatever the fresh answer, since the quote and the
 * screen were for the hub; a drawer that showed Robinhood Chain stops when
 * the fresh answer differs, since the person was told where it would
 * arrive.
 */
export function buyDestination({
  quoted,
  fresh,
  rhAddress,
}: {
  quoted: Delivery;
  fresh: Delivery;
  rhAddress: Address | undefined;
}): BuyDestination {
  if (quoted.chainKey !== "robinhood" || !rhAddress) return { kind: "hub" };
  if (fresh.chainKey !== "robinhood" || fresh.address.toLowerCase() !== quoted.address.toLowerCase()) return { kind: "changed" };
  return { kind: "robinhood", address: fresh.address, rhAddress };
}

/**
 * The buy's intent params delivered to Robinhood Chain: today's build
 * with exactly three fields replaced, the same shape as the hub
 * `deliverTo` override (`deposit()` keeps `data` "0x", so nothing else in
 * the params depends on the destination). `dstAddress` is exactly the
 * address the route answered; the server refuses any other
 * (lib/server/delivery `other_address`).
 */
export function robinhoodParams<P extends Pick<CreateIntentParams, "dstChainKey" | "outputToken" | "dstAddress">>(
  params: P,
  destination: { address: Address; rhAddress: Address },
): P {
  return {
    ...params,
    dstChainKey: ChainKeys.ROBINHOOD_MAINNET as SpokeChainKey,
    outputToken: destination.rhAddress,
    dstAddress: destination.address,
  };
}
