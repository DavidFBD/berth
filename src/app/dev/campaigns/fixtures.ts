import type { CampaignProgress } from "@/lib/campaigns";
import type { StaffBalanceResponse, StaffCampaignsResponse } from "@/app/api/staff/campaigns/route";

/** Fixtures for /dev/campaigns and /dev/board?campaign=: every account, address and hash is invented. */

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 12, 9, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

const counts = { attributed: 5, buying: 0, holding: 4, qualified: 2, approved: 1, paid: 2, rejected: 1, expired: 0 };

const campaignBase = {
  amountUsd: 5,
  budgetUsd: 100,
  maxClaims: 20,
  stayDays: 14,
  perInviter: 3,
};

const C1 = "00000000-0000-4000-8000-00000000c001";
const inviterA = { userId: "00000000-0000-4000-8000-000000000201", email: "ivy.example@example.com", wallets: [{ address: addr(0xf1), family: "evm", linked: true }] };
const inviterB = { userId: "00000000-0000-4000-8000-000000000202", email: "otto.example@example.com", wallets: [{ address: addr(0xf2), family: "evm", linked: true }] };

type Claim = StaffCampaignsResponse["claims"][number];
const claim = (n: number, over: Partial<Claim>): Claim => ({
  id: `00000000-0000-4000-8000-0000000000a${n}`,
  campaignId: C1,
  campaignCode: "autumn-invite",
  campaignKind: "invite",
  state: "holding",
  userId: `00000000-0000-4000-8000-00000000010${n}`,
  email: `friend${n}.example@example.com`,
  signupAt: iso(now - 20 * DAY),
  attributedAt: iso(now - 20 * DAY + 40_000),
  onboardedAt: iso(now - 19 * DAY),
  eligibleAt: iso(now - 5 * DAY),
  lastSeenAt: iso(now - 7 * DAY),
  wallets: [{ address: addr(0xe0 + n), family: "evm", linked: true }],
  inviter: inviterA,
  payout: { address: addr(0xf1), chain: "Base", token: "USDC", amountUsd: 5 },
  paid: null,
  reason: null,
  signals: [],
  staffIneligibleAt: null,
  ...over,
});

export const QUEUE_FIXTURE: StaffCampaignsResponse = {
  campaigns: [
    {
      id: C1,
      code: "autumn-invite",
      title: "Autumn invites",
      kind: "invite",
      active: true,
      startsAt: iso(now - 25 * DAY),
      endsAt: iso(now + 20 * DAY),
      ...campaignBase,
      counts,
      reservedUsd: 35,
      paidUsd: 10,
      slots: 9,
      payoutSources: [
        { id: "00000000-0000-4000-8000-0000000000f1", address: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", addedAt: iso(now - 9 * DAY), reason: "The house wallet for October" },
      ],
    },
    {
      id: "00000000-0000-4000-8000-00000000c002",
      code: "winter-invite",
      title: "Winter invites",
      kind: "invite",
      active: false,
      startsAt: iso(now + 40 * DAY),
      endsAt: iso(now + 70 * DAY),
      ...campaignBase,
      counts: { attributed: 0, buying: 0, holding: 0, qualified: 0, approved: 0, paid: 0, rejected: 0, expired: 0 },
      reservedUsd: 0,
      paidUsd: 0,
      slots: 0,
      payoutSources: [],
    },
    {
      id: "00000000-0000-4000-8000-00000000c003",
      code: "spring-invite",
      title: "Spring invites",
      kind: "invite",
      active: false,
      startsAt: iso(now + 100 * DAY),
      endsAt: iso(now + 130 * DAY),
      ...campaignBase,
      counts: { attributed: 0, buying: 0, holding: 0, qualified: 0, approved: 0, paid: 0, rejected: 0, expired: 0 },
      reservedUsd: 0,
      paidUsd: 0,
      slots: 0,
      // A wallet is already here (as a sponsor's campaign might arrive), so its
      // confirm panel shows the funding check still unticked, not the no-wallet
      // message: /dev/campaigns?created=spring-invite shows both new hints.
      payoutSources: [{ id: "00000000-0000-4000-8000-0000000000f3", address: addr(0xf3), addedAt: iso(now - DAY), reason: "Fixture wallet" }],
    },
    {
      id: "00000000-0000-4000-8000-00000000c000",
      code: "first-buy",
      title: "First buy, retired",
      kind: "buy",
      active: false,
      startsAt: iso(now - 60 * DAY),
      endsAt: iso(now - 30 * DAY),
      ...campaignBase,
      stayDays: 7,
      counts: { attributed: 0, buying: 0, holding: 0, qualified: 0, approved: 0, paid: 0, rejected: 0, expired: 0 },
      reservedUsd: 0,
      paidUsd: 0,
      slots: 0,
      payoutSources: [],
    },
  ],
  claims: [
    claim(1, { state: "qualified" }),
    claim(2, {
      state: "qualified",
      email: "friend1.example+2@example.com",
      signupAt: iso(now - 20 * DAY + 4 * 60_000),
      wallets: [
        { address: addr(0xe2), family: "evm", linked: true },
        { address: "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV", family: "solana", linked: false },
      ],
      signals: ["email_alias", "same_inviter_close"],
    }),
    claim(3, { state: "approved", inviter: inviterB, payout: { address: addr(0xf2), chain: "Base", token: "USDC", amountUsd: 5 } }),
    claim(4, { state: "holding", signupAt: iso(now - 3 * DAY), onboardedAt: iso(now - 2 * DAY), eligibleAt: iso(now + 12 * DAY), lastSeenAt: iso(now - DAY) }),
    claim(5, { state: "paid", inviter: inviterB, payout: { address: addr(0xf2), chain: "Base", token: "USDC", amountUsd: 5 }, paid: { at: iso(now - DAY), tx: hash(0xbeef), verified: true } }),
    claim(6, { state: "rejected", lastSeenAt: iso(now - 18 * DAY), reason: "not_active" }),
  ],
};

const progress = (over: Partial<CampaignProgress>): CampaignProgress => ({
  amountUsd: 5,
  stayDays: 14,
  perInviter: 3,
  open: true,
  invited: 0,
  staying: 0,
  nextEligibleAt: null,
  qualified: 0,
  paidUsd: 0,
  paidAt: null,
  ...over,
});

/** The home lines' fixtures, by scene name (also read by /dev/board?campaign=). */
export const LINE_FIXTURES: Record<string, CampaignProgress> = {
  rules: progress({}),
  invited: progress({ invited: 1 }),
  staying: progress({ staying: 1, nextEligibleAt: iso(Date.UTC(2026, 9, 17, 14)) }),
  qualified: progress({ qualified: 1 }),
  paid: progress({ paidUsd: 5, paidAt: iso(Date.now() - DAY) }),
};

/** USDC on Base held by each fixture wallet, as the balance read answers (lowercase keys). */
export const BALANCE_FIXTURE: Record<string, StaffBalanceResponse["balance"]> = {
  "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed": { outcome: "read", raw: "100000000" },
  "0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359": { outcome: "read", raw: "42500000" },
};

/** The create form as the gallery opens it: a campaign about to be funded by a sponsor. */
export const CREATE_PREFILL: Record<string, string> = {
  code: "sponsor-invite",
  title: "Sponsored invites",
  amountUsd: "5",
  budgetUsd: "100",
  maxClaims: "20",
  stayDays: "14",
  perInviter: "3",
  startsAt: "2026-10-12T09:00",
  endsAt: "2026-11-12T09:00",
  payoutAddress: "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
};
