# Limit orders (queued 2026-09-28, after accounts phase 1)

Findings: SODAX limit orders are ordinary intents with `deadline = 0n` (never expire), resting in the hub Intents contract on Sonic until a solver fills at >= minOutputAmount or the owner cancels. SDK 2.0.0 (installed): `sodax.swaps.createLimitOrder`, `cancelLimitOrder` (= cancelIntent), hooks `useCreateLimitOrder`, `useCancelLimitOrder`, readers `getUserIntents`/`getOrderbook` (`remainingInput`, `receivedOutput`). Berth's leverageYield deposit/withdraw/vaultSwap builders accept `deadline`, so `0n` makes a limit buy/sell in one signature. Fees as a swap. Zero resting orders for Berth's listings in the live orderbook: untested for stock tokens.

Fez (SODAX product): orders fill against existing liquidity when price hits; minimum probably $1; cancel via the SDK; fill events: none known, so Berth polls status on the page and the evening cron marks fills.

Open, to settle by David's live test: cancelling a hub-wallet (Sonic) sell and where refunds land; behaviour outside US market hours.

Plan v1, behind a switch visible only to David's account:
- Order drawer: "Buy at" / "Sell at" price, "Until cancelled" or a date; minOutputAmount = input / limit price in output decimals.
- Open orders list with fill progress and a one-signature cancel.
- Assistant: draft_order gains type limit with limitPrice and optional expiry; the drawer opens prefilled; the person signs.
- Orders table: store limit price, expiry, status (resting, partial, filled, cancelled); evening cron reconciles.
- David's test: $1 limit buy far below price (rests?), cancel (refund where?), small limit sell. Then open to all.

## Placement (David, 2026-09-28)
- A thin "Waiting orders" strip under the account total, shown ONLY when the person has resting limit orders (e.g. "NVIDIA at $200 · Tesla at $340 · 1 partly filled"); tap opens the list with fill progress and Cancel. Nothing shows when there are none.
- Creation lives in the order drawer: a "Set a price" option beside the amount.
- One Assistant suggestion becomes "Buy NVIDIA if it drops to $200".
