# Draft upstream issue: Bitcoin sourced vault swaps report a relay timeout as a failure, and lose the payment hash

Status: filed as https://github.com/icon-project/sodax-sdks/issues/489 on 2026-09-26. For the SODAX SDK repo (`@sodax/sdk` 2.0.0,
`@sodax/dapp-kit` 2.0.0). Line numbers are `dist/index.mjs` of 2.0.0.

## Summary

`LeverageYieldService.vaultSwap` (and `SwapService.swap` the same way) waits
for the relay with a chain agnostic 120 s default and builds intents that
expire 5 minutes after hub time. A Bitcoin payment needs a block (about ten
minutes on average) before it can reach Sonic. The result for a Bitcoin
source in USER wallet mode:

1. The PSBT is signed and broadcast (`signAndBroadcastTransaction`, 16133).
2. `verifyTxHash` returns true at once for Bitcoin (25342, no wait).
3. `relayTxAndWaitPacket` submits to the relayer, then polls for 120 s
   (`DEFAULT_RELAY_TX_TIMEOUT`, 3485; loop in `waitUntilIntentExecuted`,
   4813) and gives up with `RELAY_TIMEOUT`.
4. `vaultSwap` returns `{ ok: false, error: RELAY_TIMEOUT }` (39694 to 39704).
   The Bitcoin is already gone from the user's wallet.

## Problems

### 1. The error drops the spoke transaction hash

`mapRelayFailure` (4879) builds the `SodaxError` context from `action`,
`srcChainKey`, `dstChainKey`, `phase` and `relayCode` only. The spoke tx hash,
the intent and the `relayData` that `createVaultIntent` just produced are not
on the error. A caller that sees `RELAY_TIMEOUT` (or `TX_SUBMIT_FAILED`,
`RELAY_FAILED`) after broadcast therefore cannot:

- show the user where their payment is (mempool.space),
- keep waiting for the packet itself,
- call `notifySolver` once the packet lands (step 4 of `vaultSwap`, 39709,
  never runs after a timeout).

Same in `SwapService.fallbackSwapSteps` (26945, relay at 26961).

Ask: put `srcTxHash` (and ideally `intent` / `relayData`) on the context of
every post-broadcast relay error, or return a partial result.

### 2. Chain agnostic defaults that cannot fit Bitcoin

- Relay wait: `DEFAULT_RELAY_TX_TIMEOUT = 120 s` (3485). `timeout` is
  plumbed through `VaultSwapActionParams` (types `SpokeExecActionParams`
  `timeout?: number`), so a caller can raise it, but then `vaultSwap` does
  not resolve until the packet arrives: the caller cannot tell "signed and
  broadcast" from "still at the wallet" for the whole wait.
- Intent deadline: `INTENT_DEADLINE_BUFFER_SECONDS = 5 * 60` (39264, applied
  in `resolveDeadline`, 39332). A Bitcoin payment that takes longer than five
  minutes to relay lands an intent that is already expired. `deadline` can be
  passed to `deposit` / `withdraw`, but nothing tells an integrator that a
  Bitcoin source needs it.

Ask: per chain defaults (or a documented Bitcoin profile) for both, and a
callback or event when the spoke tx is broadcast, e.g.
`onSpokeTxBroadcast(hash)` on `vaultSwap` / `swap`.

Questions for the SDK team:

- How many Bitcoin confirmations does the relayer wait for before it
  delivers the packet?
- Does the solver fill an intent that reached the hub without a
  `notifySolver` call? If not, a user who closes the tab during the relay
  wait leaves an intent nobody fills.

### 3. One relayer error ends the whole wait

`waitUntilIntentExecuted` (4813) stops at the first packet poll that fails
with anything but a 404 (`pollForExecutedPacket`, 4792 to 4799; the loop
breaks at 4825) and returns `RELAY_POLLING_FAILED`. A single 502 or 429, or
a Safari tab resuming from the background, ends a wait that for Bitcoin has
to last most of an hour, and `notifySolver` then never runs.

Ask: back off and keep polling on transient relayer errors until the
timeout, and only then report.

### 4. `vaultSwap` relays a Bitcoin on-demand payload under the wrong id

For a vault withdraw from a Bitcoin derived hub wallet (`hubWalletSwap:
true`), `createVaultIntent` returns the signed on-demand payload JSON from
`spoke.sendMessage`. The money market service relays it via
`getOnDemandRelayIdentity` (15790; used at 37433): submit as `withdraw`, poll
`od:<keccak(payload_hex)>`. `vaultSwap` passes the JSON itself as `srcTxHash`
and no `pollTxHash` (39694), so the relay is submitted and polled under an
id it never tracks. We expect every such withdraw to end in `RELAY_TIMEOUT`
or `TX_SUBMIT_FAILED`. Not reproduced live.

Ask: use `getOnDemandRelayIdentity` in `vaultSwap` (and any other
`hubWalletSwap` path) for Bitcoin sources.

## What Berth does meanwhile

For Bitcoin sources the app calls `createVaultIntent`, `submitTransaction`,
`waitUntilIntentExecuted` (in its own loop that rides out relayer errors,
src/lib/slow-order.ts) and `notifySolver` itself (src/hooks/use-vault-action.ts `sendSlow`): it
moves to a waiting state the moment the payment is broadcast, waits up to 90
minutes for the relay, builds the intent with a three hour deadline, uses the
on-demand relay identity for Bitcoin withdraws, and treats a relay wait that
runs out as an unsettled order with the payment hash reported, never as a
failed one.
