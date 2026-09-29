"use client";

import { useState } from "react";
import type { Listing } from "@/lib/listings";
import {
  limitDeadline,
  limitProblem,
  parseLimitPrice,
  priceFromNumber,
  priceText as toPriceText,
  type LimitExpiry,
} from "@/lib/limit-orders";
import type { OrderMode } from "@/components/flow/limit-price";
import { useLimitOrders } from "@/hooks/use-limit-orders";

/** A limit order an assistant drafted (lib/draft-order): a dollar price and, optionally, a last day. */
export type LimitPrefill = { price: number; expires?: string };

/**
 * The drawer side of a limit order: whether this person may set a price
 * at all (the switch, and only on a stock), the typed price and expiry,
 * and whether the summary is showing. A draft's price goes in once per
 * opening; switching to "Set a price" with an empty field starts it at
 * today's price. Render-time adjustments, per house pattern.
 */
export function useLimitDraft({
  open,
  listing,
  marketPrice,
  prefill,
  force,
  side,
  unavailable = false,
}: {
  /** True when this order cannot be a limit order here (a sell from a hub wallet that is not the home). */
  unavailable?: boolean;
  side: "buy" | "sell";
  open: boolean;
  listing: Listing | null;
  marketPrice: number | undefined;
  prefill?: LimitPrefill | null;
  /** Dev galleries only: the switch as if the server had said yes. */
  force?: boolean;
}) {
  const switchOn = useLimitOrders({ poll: false }).enabled;
  const allowed = (force ?? switchOn) && listing?.kind === "stock" && !unavailable;
  const [mode, setModeState] = useState<OrderMode>("now");
  const [priceText, setPriceText] = useState("");
  const [expiry, setExpiry] = useState<LimitExpiry>({ kind: "never" });
  const [reviewing, setReviewing] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  if (!open && (prefilled || mode !== "now" || reviewing || priceText)) {
    setPrefilled(false);
    setModeState("now");
    setPriceText("");
    setExpiry({ kind: "never" });
    setReviewing(false);
  }
  if (open && allowed && prefill && !prefilled) {
    const price = priceFromNumber(prefill.price);
    setPrefilled(true);
    if (price) {
      setModeState("price");
      setPriceText(toPriceText(price));
      setExpiry(prefill.expires ? { kind: "date", day: prefill.expires } : { kind: "never" });
    }
  }

  const setMode = (next: OrderMode) => {
    setModeState(next);
    setReviewing(false);
    if (next === "price" && !priceText && marketPrice !== undefined) {
      const start = priceFromNumber(marketPrice);
      if (start) setPriceText(toPriceText(start));
    }
  };

  const active = allowed && mode === "price";
  const price = parseLimitPrice(priceText);
  return {
    allowed,
    active,
    mode,
    setMode,
    priceText,
    setPriceText: (text: string) => {
      setReviewing(false);
      setPriceText(text);
    },
    expiry,
    setExpiry: (next: LimitExpiry) => {
      setReviewing(false);
      setExpiry(next);
    },
    price,
    problem: active ? limitProblem({ price, expiry, side, marketPrice }) : null,
    /** Checked again at the moment of signing: a review left open past midnight, or a price the market moved through. */
    recheck: () => (active ? limitProblem({ price, expiry, side, marketPrice, now: new Date() }) : null),
    deadline: limitDeadline(expiry),
    reviewing: active && reviewing,
    setReviewing,
  };
}
