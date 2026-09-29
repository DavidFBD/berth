"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RankChip, RewardsPanel } from "@/components/rewards-panel";
import { LevelUpCard } from "@/components/xp-toast";
import type { Hold } from "@/lib/profile-types";
import type {
  Profile,
  ReferralPanel,
  XpHistoryEntry,
} from "@/lib/profile-types";
import { RANKS, rankForXp, REWARD_REASONS } from "@/lib/xp";

/**
 * Dev-only: the rewards drawer at a chosen rung, from seeded data, so the
 * ladder, the rank marks, the locked faces and the ledger can be reviewed
 * (and screenshotted) without an account at that rank.
 *
 *   /dev/account?rewards=1     First Line, no face yet, grid open
 *   /dev/account?rewards=3     Berth Holder, invite open
 *   /dev/account?rewards=7     Pier, the Beacon open, Bell and Capstan locked
 *   /dev/account?rewards=10    Harbour Master, every face open
 *
 * Each panel gets its own QueryClient with the rewards queries seeded under
 * the signed-out identity (key null), which is where a browser without a
 * session looks; signed in, the real account's data shows instead.
 */
const SCENES: Record<number, { xp: number; avatarId: string | null }> = {
  1: { xp: 40, avatarId: null },
  3: { xp: 320, avatarId: "buoy" },
  7: { xp: 2550, avatarId: "beacon" },
  10: { xp: 7800, avatarId: "capstan" },
};

const DAY = 86_400_000;

function seededClient(level: number): QueryClient {
  const scene = SCENES[level] ?? { xp: RANKS[level - 1]?.xp ?? 0, avatarId: "bollard" };
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const now = Date.now();
  const profile: Profile = {
    xp: scene.xp,
    avatarId: scene.avatarId,
    hasEmail: true,
    referralCode: level >= 3 ? "harbrmkt" : null,
  };
  const history: XpHistoryEntry[] = [
    { kind: "pour_in", amount: 100, at: new Date(now - 2 * DAY).toISOString() },
    { kind: "avatar_set", amount: 25, at: new Date(now - 9 * DAY).toISOString() },
    { kind: "account_created", amount: 25, at: new Date(now - 12 * DAY).toISOString() },
  ];
  const holds: Hold[] = [
    {
      ref: "0xhold1",
      pouredAt: new Date(now - 20 * DAY).toISOString(),
      dueAt: new Date(now + 10 * DAY).toISOString(),
      amount: 250,
      name: "NVIDIA",
    },
    {
      ref: "0xhold2",
      pouredAt: new Date(now - 2 * DAY).toISOString(),
      dueAt: new Date(now + 28 * DAY).toISOString(),
      amount: 100,
      name: null,
    },
  ];
  const referral: ReferralPanel = {
    invitedBy: null,
    canClaim: false,
    stats: { taps: 0, seated: 0, poured: 0, earnedXp: 0, steepingXp: 0 },
  };
  client.setQueryData(["profile", null], profile);
  client.setQueryData(["xp-history", null], level === 1 ? [] : history);
  client.setQueryData(["xp-holds", null], level === 1 ? [] : holds);
  client.setQueryData(["referral-panel", null], referral);
  return client;
}

function Seeded({ level, children }: { level: number; children: ReactNode }) {
  const [client] = useState(() => seededClient(level));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function RewardsGallery({ level }: { level: number }) {
  const scene = SCENES[level];
  const rank = rankForXp(scene?.xp ?? RANKS[level - 1]?.xp ?? 0);
  return (
    <Seeded level={level}>
      <div className="flex flex-col gap-4">
        {/* The header strip, as the board wears it. */}
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
          <span className="font-wordmark text-base text-foreground">Berth</span>
          <div className="flex items-center gap-1.5">
            <RankChip onClick={() => {}} />
            <RankChip onClick={() => {}} presence placeholder="Account" />
          </div>
        </div>
        <RewardsPanel initialGridOpen initialLedgerOpen />
        {rank.level > 1 && (
          <LevelUpCard
            rank={rank}
            total={250}
            reason={REWARD_REASONS.pour_in}
          />
        )}
      </div>
    </Seeded>
  );
}
