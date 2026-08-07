"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { useXAccount } from "@sodax/wallet-sdk-react";
import { ChainKeys } from "@sodax/sdk";
import type { AvatarId } from "@/lib/avatars";
import type {
  Profile,
  ProfileResponse,
  ReferralPanel,
  XpHistoryResponse,
} from "@/lib/profile-types";
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

async function postRewardsApi<T>(
  path: string,
  body: Record<string, unknown>,
  auth: { token: string | null; walletSession: string | null },
): Promise<T | null> {
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

const postProfileApi = postRewardsApi<ProfileResponse>;

/**
 * The auth ritual every rewards call performs: Privy token when signed in,
 * SIWE wallet session otherwise, null when neither materializes. Shared by
 * the profile query, the mutations, and the referral-corner hooks.
 */
function useRewardsAuth() {
  const { authenticated, wallet, key, getAccessToken } = useIdentity();
  const ensureWalletSession = useEnsureWalletSession();
  const resolve = async () => {
    const auth = authenticated
      ? { token: await getAccessToken(), walletSession: null }
      : {
          token: null,
          walletSession: wallet ? await ensureWalletSession(wallet) : null,
        };
    return auth.token || auth.walletSession ? auth : null;
  };
  return { key, resolve };
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
  const { key, resolve } = useRewardsAuth();
  return useQuery({
    queryKey: ["profile", key],
    enabled: key !== null,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<Profile> => {
      // Guests prove their address once (SIWE, free signature) — the server
      // no longer takes anyone's word for a wallet. Declining just means no
      // rewards session; the tea itself never needed one.
      const auth = await resolve();
      if (!auth) throw new Error("no rewards session");
      const data = await postProfileApi(
        "/api/profile",
        // The pocketed invite code rides along; the server only binds it to
        // an account created this very request, then it's spent either way.
        { referralCode: pendingReferralCode() },
        auth,
      );
      if (!data) throw new Error("profile sync failed");
      clearPendingReferral();
      toastRewards(data.rewards, data.xp);
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
  const { key, resolve } = useRewardsAuth();
  return useMutation({
    mutationFn: async (vars: TVars) => {
      if (!key) return null;
      const auth = await resolve();
      if (!auth) return null;
      return postProfileApi(path, toBody(vars), auth);
    },
    onSuccess: (data) => {
      if (!data) return;
      toastRewards(data.rewards, data.xp);
      queryClient.setQueryData<Profile>(["profile", key], profileOf(data));
      // Every award moves the ledger, and a pour can move the referral
      // corner (steeping → poured); both are cheap refetches on next open.
      void queryClient.invalidateQueries({ queryKey: ["xp-history", key] });
      void queryClient.invalidateQueries({ queryKey: ["referral-panel", key] });
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

/**
 * The referral corner's data: who set this seat, whether a code can still
 * be hand-claimed, and how the account's own invitations are brewing.
 * Fetched only while the pantry is open — `enabled` gates it.
 */
export function useReferralPanel(enabled: boolean) {
  const { key, resolve } = useRewardsAuth();
  return useQuery({
    queryKey: ["referral-panel", key],
    enabled: enabled && key !== null,
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<ReferralPanel> => {
      const auth = await resolve();
      if (!auth) throw new Error("no rewards session");
      const data = await postRewardsApi<ReferralPanel>(
        "/api/referral/panel",
        {},
        auth,
      );
      if (!data) throw new Error("referral panel failed");
      return data;
    },
  });
}

/**
 * Hand-claiming an invite code (the stripped-link recovery hatch). Success
 * replaces the cached panel; a 422 surfaces as null so the row can say
 * "didn't take" without throwing.
 */
export function useClaimInvite() {
  const queryClient = useQueryClient();
  const { key, resolve } = useRewardsAuth();
  return useMutation({
    mutationFn: async (code: string): Promise<ReferralPanel | null> => {
      if (!key) return null;
      const auth = await resolve();
      if (!auth) return null;
      return postRewardsApi<ReferralPanel>(
        "/api/referral/claim",
        { code },
        auth,
      );
    },
    onSuccess: (data) => {
      if (!data) return;
      queryClient.setQueryData<ReferralPanel>(["referral-panel", key], data);
    },
  });
}

/** The house ledger, newest first. Fetched only while it's unfolded. */
export function useXpHistory(enabled: boolean) {
  const { key, resolve } = useRewardsAuth();
  return useQuery({
    queryKey: ["xp-history", key],
    enabled: enabled && key !== null,
    staleTime: 60_000,
    retry: 1,
    queryFn: async () => {
      const auth = await resolve();
      if (!auth) throw new Error("no rewards session");
      const data = await postRewardsApi<XpHistoryResponse>(
        "/api/xp/history",
        {},
        auth,
      );
      if (!data) throw new Error("ledger fetch failed");
      return data.events;
    },
  });
}
