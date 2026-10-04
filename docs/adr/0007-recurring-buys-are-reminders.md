# No automatic buying: recurring buys are reminders the person signs

**Status: superseded on 2026-10-04. The feature is removed.**

## Superseded, 2026-10-04

David removed recurring buys on 2026-10-04 because reminders are not true
recurring buys: a plan only ever sent a reminder that the person still had
to open and sign, so it promised a habit it could not keep on its own, and
the name said more than the product did.

- **What went.** The plan sheet and its entry points (the buy drawer's
  "Make this recurring", the account drawer's row, the home strip, the
  Assistant's plan card), `/api/recurring`, the morning cron's recurring
  stage, the `recurring_due` email with its switch and its half of the
  daily cap (returned to the general budget), the weekly summary's
  recurring section, the `list_recurring` and `draft_recurring` tools on
  both doors, and their copy. No XP kind was ever tied to recurring, so the
  ledger's history is unchanged.
- **What stays.** `recurring_plans` and `recurring_runs` are kept in
  `db/schema.sql`, marked retired; nothing reads or writes them. The
  `recurring` row kind in `email_prefs` stays valid for the rows already
  written. An unsubscribe link for the retired kind still opens a calm
  page saying there is nothing left to turn off (`lib/email-kinds`
  `RETIRED_KINDS`).
- **True recurring buys, if ever.** Research on 2026-10-04
  (`~/Github/_scratch-berth/reports/solana-subscriptions.md`) looked at
  Solana's Subscriptions and Allowances program. It is real and audited,
  but a pull is only a token transfer to an account the puller names: it
  cannot make the person's own wallet the creator of a SODAX intent, so on
  its own it makes Berth the buyer and the refund owner, which is custody
  in substance. The only designs that keep the person's wallet as payer
  and creator are Privy session signers with a policy on embedded wallets
  (EVM and Solana), or ERC-7715 delegations on smart accounts. Both give
  Berth standing authority to trade, so true recurring would need Privy
  session signers and counsel's clearance first, written up as its own
  decision record. The question for counsel: is a server signed,
  pre-authorised, capped, revocable buy from the person's own wallet, on a
  schedule they set, order transmission or portfolio management?

## The original decision, 2026-09-30

Decided by David on 2026-09-30. Replaces "recurring DCA" on CONTEXT.md's cut
list. The cut stands for anything that buys by itself; what ships is a
reminder with a draft attached, which the person signs or lets pass.

- **What a plan is.** A listing (stocks and funds, not cash), a dollar
  amount from $1 to $10,000, weekly on a weekday or monthly on a day from 1
  to 28 (so February never skips), read in the person's own time zone. At
  most ten plans an account. `recurring_plans`, rules in `lib/recurring`.
- **What happens on the day.** A run (`recurring_runs`) comes due at the
  start of that day where the person is. The morning run
  (`/api/cron/morning`, 06:00 UTC, the hold check's old slot, so Berth stays
  at Hobby's two crons) makes it for every day starting within five hours,
  and a page load makes one whose day has already begun. One reminder
  email per run (type `recurring_due`, deduped by the run's id in
  `email_sends`, behind its own switch, on by default, and inside the daily
  cap), and a strip under the account total that opens the buy drawer
  filled in. The draft link carries `run=<id>`. Reminders take at most
  half the day's cap, so order and friend notices keep room, and one not
  sent (the cap, a provider error, the stage's deadline) is retried each
  morning for the run's three days. A day already past its three days
  when the run would be made (a long outage) makes no run.
- **When the email arrives is a fact of one cron, not a promise.** One run
  at 06:00 UTC with a five hour lookahead means the local hour varies by
  zone: the Americas get it as their day begins (Los Angeles about 23:00
  the evening before, Hawaii about 20:00), Europe early morning, Tokyo and
  Sydney mid afternoon unless a page load made the run first. So the copy
  says a buy "is ready", never "this morning".
- **How a run ends.** Opened when the person opens its draft. Placed when an
  order for that listing, within 10% of the amount, is recorded inside its
  window, whichever way it is recorded (the pour route, the evening pass
  over pour claims, a limit buy's placement or fill, orders-recover), once
  per order and only for the account that owns it; a buy signed that day
  before the run was made answers it as it is made. Skipped when the person
  says so, when the next run of the plan comes, or three days after it came
  due. A paused plan's waiting run goes quietly; a resumed one starts from
  the next day it names, never with a backlog.
- **Why not automatic.** Every way to buy without the person present
  (ERC-7715 permissions, session keys, Privy server signers) is "agent as
  wallet" in another form: Berth would hold standing authority over a
  person's money, which it never does, and which regulators read as
  automated order handling. Revisit only with legal advice, as its own
  decision record.
- **Buy on the dip.** Only for accounts with limit orders switched on
  (`LIMIT_ORDERS_USERS`): the run's draft is a limit buy `dip_pct` under the
  price at reminder time, waiting until the day before the next run.
- **No XP for frequency, no streaks.** A run that fills earns the ordinary
  order XP, nothing more. Skipping costs nothing and is never framed as a
  loss.
- **The Assistant.** `list_recurring` (berth.read) and `draft_recurring`
  (berth.draft). A draft is a link, or a card in the chat, that opens the
  plan sheet filled in; the Assistant can never save, pause or delete a
  plan, as it can never sign an order.
- **Copy.** "Berth reminds you. You sign." Never "automatic", "autopilot",
  "set and forget" or "DCA", and never a claim that buying regularly lowers
  risk.
