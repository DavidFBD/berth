"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { useXAccount } from "@sodax/wallet-sdk-react";
import { ChainKeys } from "@sodax/sdk";
import type { AvatarId } from "@/lib/avatars";
import type { Profile, ProfileResponse } from "@/lib/profile-types";
import { announceRewards } from "@/components/xp-toast";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import {
  clearPendingReferral,
  pendingReferralCode,
} from "@/lib/referral";
import { useEnsureWalletSession } from "@/hooks/use-wallet-session";

export type { Profile } from "@/lib/profile-types";

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
  auth: { token: string | null; walletSession: string | null },
): Promise<ProfileResponse | null> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}),
      ...(auth.walletSession
        ? { "x-wallet-session": auth.walletSession }
        : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) return null;
  return response.json();
}

/**
 * One small ceremony per fresh reward (see xp-toast.tsx). The server only
 * returns rewards it just paid out, so refetches stay quiet.
 */
const toastRewards = announceRewards;

function profileOf(data: ProfileResponse): Profile {
  return {
    xp: data.xp,
    avatarId: data.avatarId,
    hasEmail: data.hasEmail,
    referralCode: data.referralCode,
  };
}

/** The account profile, synced on first read. Disabled until an identity exists. */
export function useProfile() {
  const { authenticated, wallet, key, getAccessToken } = useIdentity();
  const ensureWalletSession = useEnsureWalletSession();
  return useQuery({
    queryKey: ["profile", key],
    enabled: key !== null,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<Profile> => {
      // Guests prove their address once (SIWE, free signature) — the server
      // no longer takes anyone's word for a wallet. Declining just means no
      // rewards session; the tea itself never needed one.
      const auth = authenticated
        ? { token: await getAccessToken(), walletSession: null }
        : { token: null, walletSession: wallet ? await ensureWalletSession(wallet) : null };
      if (!auth.token && !auth.walletSession) {
        throw new Error("no rewards session");
      }
      const data = await postProfileApi(
        "/api/profile",
        // The pocketed invite code rides along; the server only binds it to
        // an account created this very request, then it's spent either way.
        { referralCode: pendingReferralCode() },
        auth,
      );
      if (!data) throw new Error("profile sync failed");
      clearPendingReferral();
      toastRewards(data.rewards);
      return profileOf(data);
    },
  });
}

/**
 * The one mutation core behind every XP endpoint: token fetch, wallet
 * attachment, the no-identity guard (nothing to award to means no request at
 * all), the cache write, and the reward ceremony. Each public hook is just a
 * path plus its own body fields.
 */
function useProfileMutation<TVars>(
  path: string,
  toBody: (vars: TVars) => Record<string, unknown>,
) {
  const queryClient = useQueryClient();
  const { authenticated, wallet, key, getAccessToken } = useIdentity();
  const ensureWalletSession = useEnsureWalletSession();
  return useMutation({
    mutationFn: async (vars: TVars) => {
      if (!key) return null;
      const auth = authenticated
        ? { token: await getAccessToken(), walletSession: null }
        : { token: null, walletSession: wallet ? await ensureWalletSession(wallet) : null };
      if (!auth.token && !auth.walletSession) return null;
      return postProfileApi(path, toBody(vars), auth);
    },
    onSuccess: (data) => {
      if (!data) return;
      const previous = queryClient.getQueryData<Profile>(["profile", key]);
      toastRewards(data.rewards, previous?.xp, data.xp);
      queryClient.setQueryData<Profile>(["profile", key], profileOf(data));
    },
  });
}

/** Pick a face from the preset shelf; the first pick pays a one-time reward. */
export function useSetAvatar() {
  return useProfileMutation("/api/profile/avatar", (avatarId: AvatarId) => ({
    avatarId,
  }));
}

/**
 * A first taste of a mode, rewarded once per theme per account (the server
 * enforces the once; the client just reports the tasting).
 */
export function useAwardTheme() {
  return useProfileMutation("/api/xp/theme", (mode: string) => ({ mode }));
}

/**
 * Rewards a filled pour. Fire-and-forget from the drawers' success paths:
 * XP is garnish, so any failure stays out of the pour's own UX (the server
 * dedups by tx hash, so a retry on next sync would be safe too).
 */
export function useAwardPour() {
  return useProfileMutation(
    "/api/xp/pour",
    (vars: { direction: "in" | "out"; intentTxHash: string }) => ({
      direction: vars.direction,
      intentTxHash: vars.intentTxHash,
    }),
  );
}
