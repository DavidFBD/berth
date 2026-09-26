"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { useXAccount } from "@sodax/wallet-sdk-react";
import { ChainKeys } from "@sodax/sdk";
import type { AvatarId } from "@/lib/avatars";
import type {
  Hold,
  HoldsResponse,
  Profile,
  ProfileResponse,
  ReferralPanel,
  XpHistoryResponse,
} from "@/lib/profile-types";
import type { OrdersResponse } from "@/app/api/orders/route";
import type { AssistantsResponse } from "@/app/api/assistants/route";
import type { PortfolioHistoryResponse } from "@/app/api/portfolio/history/route";
import type { BenchmarkSymbol } from "@/lib/benchmarks";
import { announceRewards } from "@/components/xp-toast";
import { useLinkInProgress } from "@/hooks/use-link-email";
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
  // A wallet account borrowing a Privy session to add an email is still a
  // wallet account: keyed on the DID for that moment, the panel would blank
  // mid-flow and a shared browser could inherit the wrong row.
  const linking = useLinkInProgress();
  const authenticated =
    privy.enabled && privy.authenticated && !linking && !privy.walletAccountSession;
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
/** What the last rewards call did, for the consent screen's diagnosis. */
let lastCall: { authenticated: boolean; wallet: boolean; stage: string; error?: string; status?: number } = {
  authenticated: false,
  wallet: false,
  stage: "none",
};

function diagnose() {
  return { ...lastCall, ua: typeof navigator === "undefined" ? "" : navigator.userAgent.slice(0, 160) };
}

function useRewardsCall() {
  const { authenticated, wallet, key, getAccessToken } = useIdentity();
  const ensureWalletSession = useEnsureWalletSession();

  const call = async <T>(
    path: string,
    body: Record<string, unknown>,
    /**
     * What a 404 means for this route, when it means something other than a
     * miss: a route that is not deployed yet reads as its empty answer.
     */
    notFound?: T,
  ): Promise<T | null> => {
    lastCall = { authenticated, wallet: !!wallet, stage: "auth" };
    const auth = authenticated
      ? { token: await getAccessToken().catch((error: unknown) => {
          lastCall.error = String(error).slice(0, 200);
          return null;
        }), walletSession: null }
      : {
          token: null,
          walletSession: wallet
            ? await ensureWalletSession(wallet).catch((error: unknown) => {
                lastCall.error = String(error).slice(0, 200);
                return null;
              })
            : null,
        };
    if (!auth.token && !auth.walletSession) {
      lastCall.stage = "no-session";
      return null;
    }
    lastCall.stage = "fetch";
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
    lastCall.status = response.status;
    if (response.status === 404 && notFound !== undefined) return notFound;
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
    /** The answer a 404 stands for; without it a 404 is a miss. */
    notFound?: TWire;
    /** More of the query's identity, after the account: a parameter of the read. */
    keyParts?: readonly string[];
    /** Keep showing the last answer while a new parameter loads. */
    keepPrevious?: boolean;
  },
) {
  const { key, call } = useRewardsCall();
  return useQuery({
    queryKey: [name, key, ...(options.keyParts ?? [])],
    // Only the same account's last answer: never another person's.
    placeholderData: options.keepPrevious
      ? (previous, previousQuery) => (previousQuery?.queryKey[1] === key ? previous : undefined)
      : undefined,
    enabled: (options.enabled ?? true) && key !== null,
    staleTime: options.staleTime,
    retry: 1,
    queryFn: async (): Promise<TData> => {
      const data = await call<TWire>(
        path,
        options.body?.() ?? {},
        options.notFound,
      );
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
      // A buy is also a hold that will come ashore in thirty days.
      void queryClient.invalidateQueries({ queryKey: ["xp-holds", key] });
      void queryClient.invalidateQueries({ queryKey: ["referral-panel", key] });
      // A pour is also a new order row (lib/server/orders), and a new
      // flow in the portfolio's line.
      void queryClient.invalidateQueries({ queryKey: ["orders", key] });
      void queryClient.invalidateQueries({ queryKey: ["portfolio-history", key] });
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
    (vars: { direction: "in" | "out"; intentTxHash: string; fillTxHash?: string }) => ({
      direction: vars.direction,
      intentTxHash: vars.intentTxHash,
      fillTxHash: vars.fillTxHash,
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
/**
 * The account's orders, for "since your first buy" beside the S&P 500 fund
 * (lib/benchmark). Refetched after every pour by useProfileMutation.
 */
export function useOrders(enabled = true) {
  return useRewardsQuery<OrdersResponse, OrdersResponse["orders"]>(
    "orders",
    "/api/orders",
    { enabled, staleTime: 5 * 60_000, select: (data) => data.orders },
  );
}

/**
 * The account's money over time beside the same money in `benchmark`
 * (lib/portfolio-history, /api/portfolio/history). Keyed by benchmark; the
 * last answer stays on screen while another benchmark loads, so the chart
 * never empties under a person choosing. Pass `enabled` false while the
 * account holds nothing: there is no line to draw.
 */
export function usePortfolioHistory(benchmark: BenchmarkSymbol, enabled = true) {
  return useRewardsQuery<PortfolioHistoryResponse>(
    "portfolio-history",
    `/api/portfolio/history?benchmark=${benchmark}`,
    { enabled, staleTime: 60_000, keyParts: [benchmark], keepPrevious: true },
  );
}

export function useXpHistory(enabled: boolean) {
  return useRewardsQuery<XpHistoryResponse, XpHistoryResponse["events"]>(
    "xp-history",
    "/api/xp/history",
    { enabled, staleTime: 60_000, select: (data) => data.events },
  );
}

/**
 * Buys still coming ashore, soonest first. Same core and auth as the ledger
 * and, like it, fetched only while the ledger is unfolded. A 404 (the route
 * not deployed yet) reads as nothing pending, not as an error.
 */
export function useXpHolds(enabled: boolean) {
  return useRewardsQuery<HoldsResponse, Hold[]>(
    "xp-holds",
    "/api/xp/holds",
    {
      enabled,
      staleTime: 60_000,
      select: (data) => data.holds,
      notFound: { holds: [] },
    },
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

/**
 * Which account this browser speaks for, as a person reads it: the email
 * of a Privy session, else the connected wallet's address. Null before
 * either exists. The consent screen says it, so nobody connects the wrong
 * account to an assistant.
 */
export function useIdentityLabel(): { email: string | null; wallet: string | null } {
  const privy = usePrivyEmbeddedWallet();
  const { authenticated, wallet } = useIdentity();
  return { email: authenticated ? (privy.user?.email?.address ?? null) : null, wallet };
}

/**
 * The person's answer on the consent screen (app/oauth/authorize). Resolves
 * to the redirect the server built, or null when it refused or there was
 * no session to prove who is approving. A decline needs no identity, but
 * goes through the same core so it is one code path.
 */
export function useAuthorizeDecision() {
  const { call } = useRewardsCall();
  return useMutation({
    mutationFn: async (vars: { request: string; decision: "approve" | "decline" }) => {
      if (vars.decision === "decline") {
        const response = await fetch("/api/oauth/decision", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(vars),
        });
        if (!response.ok) return null;
        return ((await response.json()) as { redirect?: string }).redirect ?? null;
      }
      const data = await call<{ redirect?: string }>("/api/oauth/decision", vars);
      if (data?.redirect) return data.redirect;
      // No session materialised, or the server said no. Tell the server
      // which, so a failure inside an assistant's own browser can be read
      // from the logs; it answers 401 and changes nothing.
      await fetch("/api/oauth/decision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...vars, decision: "diagnose", diag: diagnose() }),
      }).catch(() => undefined);
      return null;
    },
  });
}

/** The assistants connected to this account. Fetched only while the section is on screen. */
export function useAssistantGrants(enabled: boolean) {
  return useRewardsQuery<AssistantsResponse, AssistantsResponse["grants"]>(
    "assistant-grants",
    "/api/assistants",
    { enabled, staleTime: 30_000, select: (data) => data.grants, notFound: { grants: [] } },
  );
}

/** Disconnect one assistant; the cached list is replaced with what remains. */
export function useDisconnectAssistant() {
  const queryClient = useQueryClient();
  const { key, call } = useRewardsCall();
  return useMutation({
    mutationFn: async (grantId: string) => {
      if (!key) return null;
      return call<AssistantsResponse>("/api/assistants/disconnect", { grantId });
    },
    onSuccess: (data) => {
      if (!data) return;
      // useRewardsQuery caches the selected shape: the list itself.
      queryClient.setQueryData(["assistant-grants", key], data.grants);
    },
  });
}
