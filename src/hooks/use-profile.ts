"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { useXAccount } from "@sodax/wallet-sdk-react";
import { ChainKeys } from "@sodax/sdk";
import { toast } from "sonner";
import { rankForXp } from "@/lib/xp";
import type { AvatarId } from "@/lib/avatars";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";

export type Profile = {
  xp: number;
  avatarId: string | null;
  hasEmail: boolean;
};

type RewardList = { kind: string; amount: number }[];

/**
 * Who this browser is, for the rewards account: the Privy session when
 * signed in via email (embedded address rides along so pours link up), the
 * external EVM address otherwise. `key` is the React Query identity.
 */
function useIdentity() {
  const privy = usePrivyEmbeddedWallet();
  const { getAccessToken } = usePrivy();
  const external = useXAccount({ xChainId: ChainKeys.SONIC_MAINNET });
  const authenticated = privy.enabled && privy.authenticated;
  const wallet = authenticated ? privy.embedded?.address : external.address;
  const key = authenticated ? (privy.user?.id ?? null) : (wallet ?? null);
  return { authenticated, wallet: wallet ?? null, key, getAccessToken };
}

async function postProfileApi(
  path: string,
  body: Record<string, unknown>,
  token: string | null,
): Promise<(Profile & { rewards?: RewardList }) | null> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) return null;
  return response.json();
}

/**
 * One friendly line per fresh reward. The server only returns rewards it
 * just paid out, so refetches stay quiet.
 */
function toastRewards(rewards: RewardList | undefined, oldXp?: number, newXp?: number) {
  if (!rewards?.length) return;
  const total = rewards.reduce((sum, reward) => sum + reward.amount, 0);
  if (oldXp !== undefined && newXp !== undefined) {
    const before = rankForXp(oldXp);
    const after = rankForXp(newXp);
    if (after.level > before.level) {
      toast.success(`You brewed up to ${after.name}`, {
        description: `Level ${after.level}. +${total} XP for playing.`,
      });
      return;
    }
  }
  toast.success(`+${total} XP`, { description: "Rewards for playing." });
}

/** The account profile, synced on first read. Disabled until an identity exists. */
export function useProfile() {
  const { authenticated, wallet, key, getAccessToken } = useIdentity();
  return useQuery({
    queryKey: ["profile", key],
    enabled: key !== null,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<Profile> => {
      const token = authenticated ? await getAccessToken() : null;
      const data = await postProfileApi(
        "/api/profile",
        { walletAddress: wallet },
        token,
      );
      if (!data) throw new Error("profile sync failed");
      toastRewards(data.rewards);
      return { xp: data.xp, avatarId: data.avatarId, hasEmail: data.hasEmail };
    },
  });
}

export function useSetAvatar() {
  const queryClient = useQueryClient();
  const { authenticated, wallet, key, getAccessToken } = useIdentity();
  return useMutation({
    mutationFn: async (avatarId: AvatarId) => {
      const token = authenticated ? await getAccessToken() : null;
      return postProfileApi(
        "/api/profile/avatar",
        { avatarId, walletAddress: wallet },
        token,
      );
    },
    onSuccess: (data) => {
      if (!data) return;
      const previous = queryClient.getQueryData<Profile>(["profile", key]);
      toastRewards(data.rewards, previous?.xp, data.xp);
      queryClient.setQueryData<Profile>(["profile", key], {
        xp: data.xp,
        avatarId: data.avatarId,
        hasEmail: data.hasEmail,
      });
    },
  });
}

/**
 * A first taste of a mode, rewarded once per theme per account (the server
 * enforces the once; the client just reports the tasting).
 */
export function useAwardTheme() {
  const queryClient = useQueryClient();
  const { authenticated, wallet, key, getAccessToken } = useIdentity();
  return useMutation({
    mutationFn: async (mode: string) => {
      if (!key) return null;
      const token = authenticated ? await getAccessToken() : null;
      return postProfileApi(
        "/api/xp/theme",
        { mode, walletAddress: wallet },
        token,
      );
    },
    onSuccess: (data) => {
      if (!data) return;
      const previous = queryClient.getQueryData<Profile>(["profile", key]);
      toastRewards(data.rewards, previous?.xp, data.xp);
      queryClient.setQueryData<Profile>(["profile", key], {
        xp: data.xp,
        avatarId: data.avatarId,
        hasEmail: data.hasEmail,
      });
    },
  });
}

/**
 * Rewards a filled pour. Fire-and-forget from the drawers' success paths:
 * XP is garnish, so any failure stays out of the pour's own UX (the server
 * dedups by tx hash, so a retry on next sync would be safe too).
 */
export function useAwardPour() {
  const queryClient = useQueryClient();
  const { authenticated, wallet, key, getAccessToken } = useIdentity();
  return useMutation({
    mutationFn: async ({
      direction,
      intentTxHash,
    }: {
      direction: "in" | "out";
      intentTxHash: string;
    }) => {
      const token = authenticated ? await getAccessToken() : null;
      return postProfileApi(
        "/api/xp/pour",
        { direction, intentTxHash, walletAddress: wallet },
        token,
      );
    },
    onSuccess: (data) => {
      if (!data) return;
      const previous = queryClient.getQueryData<Profile>(["profile", key]);
      toastRewards(data.rewards, previous?.xp, data.xp);
      queryClient.setQueryData<Profile>(["profile", key], {
        xp: data.xp,
        avatarId: data.avatarId,
        hasEmail: data.hasEmail,
      });
    },
  });
}
