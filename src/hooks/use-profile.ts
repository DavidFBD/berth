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

/**
 * The one request core every rewards hook goes through: identity, the auth
 * ritual (Privy token when signed in, SIWE wallet session otherwise — guests
 * prove their address once with a free signature; the server takes nobody's
 * word for a wallet), and the authenticated POST. `call` resolves null when
 * no session materializes or the server says no — public hooks decide
 * whether null is an error (queries throw) or a quiet miss (mutations).
 */
function useRewardsCall() {
  const { authenticated, wallet, key, getAccessToken } = useIdentity();
  const ensureWalletSession = useEnsureWalletSession();

  const call = async <T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T | null> => {
    const auth = authenticated
      ? { token: await getAccessToken(), walletSession: null }
      : {
          token: null,
          walletSession: wallet ? await ensureWalletSession(wallet) : null,
        };
    if (!auth.token && !auth.walletSession) return null;
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
  };

  return { key, call };
}

/**
 * Query flavour of the core: keyed on the identity, gated on `enabled`,
 * throws on a miss so React Query owns retries. `select` unwraps the
 * envelope where the useful value sits one level in.
 */
function useRewardsQuery<TWire, TData = TWire>(
  name: string,
  path: string,
  options: {
    enabled?: boolean;
    staleTime: number;
    body?: () => Record<string, unknown>;
    select?: (data: TWire) => TData;
    onData?: (data: TWire) => void;
  },
) {
  const { key, call } = useRewardsCall();
  return useQuery({
    queryKey: [name, key],
    enabled: (options.enabled ?? true) && key !== null,
    staleTime: options.staleTime,
    retry: 1,
    queryFn: async (): Promise<TData> => {
      const data = await call<TWire>(path, options.body?.() ?? {});
      if (!data) throw new Error(`${name} failed`);
      options.onData?.(data);
      return options.select
        ? options.select(data)
        : (data as unknown as TData);
    },
  });
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
  return useRewardsQuery<ProfileResponse, Profile>("profile", "/api/profile", {
    staleTime: 5 * 60_000,
    // The pocketed invite code rides along; the server only binds it to an
    // account created this very request, then it's spent either way.
    body: () => ({ referralCode: pendingReferralCode() }),
    onData: (data) => {
      clearPendingReferral();
      toastRewards(data.rewards, data.xp);
    },
    select: profileOf,
  });
}

/**
 * Mutation flavour of the core: the no-identity guard (nothing to award to
 * means no request at all), the cache write, the reward ceremony, and the
 * invalidations every award implies. Each public hook is a path plus its
 * own body fields.
 */
function useProfileMutation<TVars>(
  path: string,
  toBody: (vars: TVars) => Record<string, unknown>,
) {
  const queryClient = useQueryClient();
  const { key, call } = useRewardsCall();
  return useMutation({
    mutationFn: async (vars: TVars) => {
      if (!key) return null;
      return call<ProfileResponse>(path, toBody(vars));
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
  return useRewardsQuery<ReferralPanel>("referral-panel", "/api/referral/panel", {
    enabled,
    staleTime: 60_000,
  });
}

/** The house ledger, newest first. Fetched only while it's unfolded. */
export function useXpHistory(enabled: boolean) {
  return useRewardsQuery<XpHistoryResponse, XpHistoryResponse["events"]>(
    "xp-history",
    "/api/xp/history",
    { enabled, staleTime: 60_000, select: (data) => data.events },
  );
}

/**
 * Hand-claiming an invite code (the stripped-link recovery hatch). Success
 * replaces the cached panel; a 422 surfaces as null so the row can say
 * "didn't take" without throwing. Pays no XP, so the profile cache is
 * untouched on purpose — the reward moment stays at the first pour.
 */
export function useClaimInvite() {
  const queryClient = useQueryClient();
  const { key, call } = useRewardsCall();
  return useMutation({
    mutationFn: async (code: string) => {
      if (!key) return null;
      return call<ReferralPanel>("/api/referral/claim", { code });
    },
    onSuccess: (data) => {
      if (!data) return;
      queryClient.setQueryData<ReferralPanel>(["referral-panel", key], data);
    },
  });
}
