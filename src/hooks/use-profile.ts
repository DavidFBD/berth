"use client";

import { isStaffAnswer } from "@/lib/staff/entry";
import { isUnavailableResponse, noteUnavailable, unavailableReasonOf } from "@/lib/unavailable-refusal";
import { reportWithRetry } from "@/lib/pour-retry";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { useAccountXAccount } from "@/hooks/use-wallet-restore";
import { ChainKeys } from "@sodax/sdk";
import { getAddress } from "viem";
import { createSiweMessage } from "viem/siwe";
import { proofResource, proofStatement, targetKey, type ProofAct, type ProofFamily } from "@/lib/account-proof";
import { createSiwsMessage } from "@/lib/siws";
import { createSiwbMessage } from "@/lib/siwb";
import { walletActOutcome } from "@/lib/account-wallets";
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
import type { ChatStatusResponse } from "@/app/api/chat/status/route";
import type { PortfolioHistoryResponse } from "@/app/api/portfolio/history/route";
import type { WalletsResponse } from "@/app/api/account/wallets/route";
import type { BenchmarkSymbol } from "@/lib/benchmarks";
import type { FirstStockResponse } from "@/lib/first-stock";
import type { LastKnownResponse } from "@/app/api/account/last-known/route";
import { shouldSave, type LastKnown, type LastKnownSnapshot } from "@/lib/last-known";
import { withSkip, withoutSkip, type FirstPathResponse, type PathStep } from "@/lib/first-path";
import type { CampaignProgress, CampaignResponse } from "@/lib/campaigns";
import type { EmailSettingsResponse, SwitchableKind } from "@/lib/email-kinds";
import { CHAT_UNLOCK_LEVEL, RANKS } from "@/lib/xp";
import { announceRewards } from "@/components/xp-toast";
import { useLinkInProgress } from "@/hooks/use-link-email";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import {
  clearPendingReferral,
  pendingReferralCode,
} from "@/lib/referral";
import { clearPendingCampaign, pendingCampaignCode } from "@/lib/campaign-pocket";
import {
  anchorWalletSession,
  keptSeparate,
  storedWalletSession,
  forgetWalletSession,
  storeWalletSession,
  subscribeWalletSessions,
  useEnsureWalletSession,
  walletSessionsVersion,
} from "@/hooks/use-wallet-session";

export type { Profile } from "@/lib/profile-types";

/**
 * Who this browser is, for the rewards account: the Privy session when
 * signed in via email (embedded address rides along so pours link up), the
 * external EVM address otherwise. `key` is the React Query identity.
 */
function useIdentity() {
  const privy = usePrivyEmbeddedWallet();
  const { getAccessToken } = usePrivy();
  // The connected wallet, or the pocketed session's address while the
  // extension reconnects after a refresh (hooks/use-wallet-restore).
  const external = useAccountXAccount({ xChainId: ChainKeys.SONIC_MAINNET });
  // A wallet account borrowing a Privy session to add an email is still a
  // wallet account: keyed on the DID for that moment, the panel would blank
  // mid-flow and a shared browser could inherit the wrong row.
  const linking = useLinkInProgress();
  // Re-read when a session or a choice is pocketed (a wallet just linked).
  useSyncExternalStore(subscribeWalletSessions, walletSessionsVersion, () => 0);
  const authenticated =
    privy.enabled && privy.authenticated && !linking && !privy.walletAccountSession;
  let wallet = authenticated ? privy.embedded?.address : external.address;
  // Connected is not signed in (docs/plans/account-linking.md, addendum):
  // when the extension switches to an address this browser holds no session
  // for, while it still holds one for the account it last signed in to,
  // NEITHER account's data shows. The browser waits, holding the earlier
  // session only as `anchor`, for the person to choose (components/
  // account-wallets SignedInAsBar): sign in with the new address (the
  // default, a signature as before), or add it to the earlier account. A
  // shared browser never shows one person's account to the next. Never a
  // signature on its own.
  let pending: string | null = null;
  let anchor: { address: string; token: string } | null = null;
  if (!authenticated && external.address) {
    const connected = external.address.toLowerCase();
    if (!storedWalletSession(connected) && !keptSeparate(connected)) {
      const last = anchorWalletSession();
      if (last && last.address !== connected) {
        anchor = last;
        pending = connected;
        wallet = undefined;
      }
    }
  }
  const key = authenticated ? (privy.user?.id ?? null) : (wallet ?? null);
  return { authenticated, wallet: wallet ?? null, key, getAccessToken, pending, anchor };
}

/**
 * A wallet session the server refused (signed before a merge moved its
 * wallet, lib/server/rewards-route) is dropped, so the next request asks
 * for a fresh sign in signature instead of sending the dead one forever.
 */
function refusedSession(response: Response, auth: Record<string, string>): void {
  const token = auth["x-wallet-session"];
  if (response.status !== 401 || !token) return;
  // Only this refusal: a 401 for a bad act signature keeps the session, and
  // a 503 (the server could not check it) keeps it for the next try.
  void response
    .clone()
    .json()
    .then((body: { error?: unknown }) => {
      if (body?.error === "wallet session required") forgetWalletSession({ token });
    })
    .catch(() => undefined);
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
  const { key, headers } = useAccountHeaders();

  const call = async <T>(
    path: string,
    body: Record<string, unknown>,
    /**
     * What a 404 means for this route, when it means something other than a
     * miss: a route that is not deployed yet reads as its empty answer.
     */
    notFound?: T,
  ): Promise<T | null> => {
    const auth = await headers();
    if (!auth) return null;
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify(body),
    });
    if (response.status === 404 && notFound !== undefined) return notFound;
    refusedSession(response, auth);
    if (isUnavailableResponse(response)) noteUnavailable(path, await unavailableReasonOf(response));
    if (!response.ok) return null;
    return response.json();
  };

  /**
   * The same POST, answering the status as well as the body, for a caller
   * whose refusals mean different things (the wallet acts: 403 is "sign in
   * again", 429 "slow down"). Status 0 when no session materialized.
   */
  const callStatus = async <T>(path: string, body: Record<string, unknown>): Promise<{ status: number; data: T | null }> => {
    const auth = await headers();
    if (!auth) return { status: 0, data: null };
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify(body),
    });
    refusedSession(response, auth);
    if (isUnavailableResponse(response)) noteUnavailable(path, await unavailableReasonOf(response));
    return { status: response.status, data: response.ok ? ((await response.json()) as T) : null };
  };

  return { key, call, callStatus };
}

/**
 * The auth ritual on its own: a fresh Privy token when signed in by email,
 * the SIWE wallet session otherwise (asking for the free signature once),
 * as request headers. Null when no session materializes. The rewards
 * calls use it, and so does the chat, whose streamed POST is not a
 * rewards call but rides the same proof of who is asking.
 */
export function useAccountHeaders({
  prompt = true,
}: {
  /**
   * false: never ask a wallet for its signature, only use a session already
   * pocketed. For reads that also work signed out (a profile), where a
   * signature request out of nowhere would be alarming.
   */
  prompt?: boolean;
} = {}): { key: string | null; headers: () => Promise<Record<string, string> | null> } {
  const { authenticated, wallet, key, getAccessToken } = useIdentity();
  const ensureWalletSession = useEnsureWalletSession();
  // Memoized: callers (useRecordLimitOrder, and effects downstream of it)
  // put this in a dependency array, and a fresh closure every render there
  // defeats their own memoization, rerunning an effect every render even
  // when nothing changed (a setState inside such an effect then loops
  // forever — "Maximum update depth exceeded").
  const headers = useCallback(async (): Promise<Record<string, string> | null> => {
    if (authenticated) {
      const token = await getAccessToken();
      return token ? { authorization: `Bearer ${token}` } : null;
    }
    const walletSession = wallet ? (prompt ? await ensureWalletSession(wallet) : storedWalletSession(wallet)) : null;
    return walletSession ? { "x-wallet-session": walletSession } : null;
  }, [authenticated, wallet, prompt, ensureWalletSession, getAccessToken]);
  return { key, headers };
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
    homeAddress: data.homeAddress ?? null,
    referralCode: data.referralCode,
  };
}

/** The account profile, synced on first read. Disabled until an identity exists. */
export function useProfile() {
  return useRewardsQuery<ProfileResponse, Profile>("profile", "/api/profile", {
    staleTime: 5 * 60_000,
    // The pocketed invite code rides along; the server only binds it to an
    // account created this very request, then it's spent either way.
    // A campaign code (/c/<code>, lib/campaign-pocket) rides the same way.
    body: () => ({ referralCode: pendingReferralCode(), campaignCode: pendingCampaignCode() }),
    onData: (data) => {
      clearPendingReferral();
      clearPendingCampaign();
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
  {
    /** Ask again with a backoff while the server answers 503 (it could not read the chain yet; lib/pour-retry). */
    retryUnread = false,
  }: { retryUnread?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const { key, call, callStatus } = useRewardsCall();
  return useMutation({
    mutationFn: async (vars: TVars) => {
      if (!key) return null;
      if (!retryUnread) return call<ProfileResponse>(path, toBody(vars));
      return (await reportWithRetry(() => callStatus<ProfileResponse>(path, toBody(vars)))).data;
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

/** Whether the in-app assistant is open to this account right now, and how many messages are left today. */
export function useChatStatus(enabled: boolean) {
  return useRewardsQuery<ChatStatusResponse>("chat-status", "/api/chat/status", {
    enabled,
    staleTime: 30_000,
    notFound: {
      state: "unavailable",
      level: 1,
      unlockLevel: CHAT_UNLOCK_LEVEL,
      unlockRankName: RANKS[CHAT_UNLOCK_LEVEL - 1].name,
      xpToUnlock: 0,
      left: null,
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
 * Rewards a filled pour. Fire-and-forget from the drawers' success paths
 * (asked again with a backoff while the server answers 503, lib/pour-retry):
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
    // A pour is reported once, from the drawer: when the server could not
    // read the chain yet it asks again, further apart each time.
    { retryUnread: true },
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
/**
 * Whether this window holds something the server accepts as proof of the
 * account: a Privy session, or an EVM wallet that can sign in. The welcome
 * gate lets anyone with ANY connected wallet through, so a window where
 * only a Solana wallet reconnected passes the gate but cannot approve.
 */
export function useCanProveAccount(): boolean {
  const { authenticated, wallet } = useIdentity();
  return authenticated || wallet !== null;
}

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
      return data?.redirect ?? null;
    },
  });
}

/** The account's email settings (app/api/account/email). Fetched only while the section is on screen. */
export function useEmailSettings(enabled: boolean) {
  return useRewardsQuery<EmailSettingsResponse>("email-settings", "/api/account/email", {
    enabled,
    staleTime: 60_000,
    // Not deployed yet: no address, so the section offers to add one.
    notFound: { address: null, deliverable: false, prefs: { orders: true, friends: true, weekly: false } },
  });
}

/** Flip one email switch; the cached settings are replaced with the answer. */
export function useSetEmailPref() {
  const queryClient = useQueryClient();
  const { key, call } = useRewardsCall();
  return useMutation({
    mutationFn: async ({ kind, enabled }: { kind: SwitchableKind; enabled: boolean }) => {
      if (!key) throw new Error("no account");
      const data = await call<EmailSettingsResponse>("/api/account/email/prefs", { kind, enabled });
      if (!data) throw new Error("not saved");
      return data;
    },
    onSuccess: (data) => queryClient.setQueryData(["email-settings", key], data),
  });
}

/**
 * The first stock card's state on this account (lib/first-stock): whether
 * "Got it" was tapped anywhere and whether the two weeks are still running.
 * Asked only while the account holds exactly one stock.
 */
export function useFirstStock(enabled: boolean) {
  // A minute fresh, so another device's "Got it" lands at the next focus.
  return useRewardsQuery<FirstStockResponse>("first-stock", "/api/first-stock", { enabled, staleTime: 60_000 });
}

/**
 * The account's last-known home (lib/last-known): read once a visit, so the
 * home can draw figures while the live reads arrive. Null when there is
 * none; undefined while it is asked.
 */
export function useLastKnown(enabled = true) {
  return useRewardsQuery<LastKnownResponse, LastKnown | null>("last-known", "/api/account/last-known", {
    enabled,
    staleTime: Infinity,
    // A route not deployed yet reads as no reading at all.
    notFound: { lastKnown: null },
    select: (data) => data.lastKnown,
  });
}

/** One save attempt per this long at most, so a server that refuses is not asked every render. */
const LAST_KNOWN_SAVE_GAP_MS = 60_000;

/**
 * Keeps a fully live reading as the account's last known, when it differs
 * from the one kept or that one has aged (lib/last-known shouldSave).
 * `next` is undefined until every part of the home was read live.
 */
export function useSaveLastKnown(next: LastKnownSnapshot | undefined) {
  const queryClient = useQueryClient();
  const { key, call } = useRewardsCall();
  const saved = useLastKnown(next !== undefined);
  const lastTry = useRef(0);
  const savedData = saved.data;
  const savedSettled = !saved.isLoading;
  useEffect(() => {
    if (!next || !key || !savedSettled) return;
    const now = Date.now();
    if (now - lastTry.current < LAST_KNOWN_SAVE_GAP_MS) return;
    if (!shouldSave(savedData, next, now)) return;
    lastTry.current = now;
    void call<LastKnownResponse>("/api/account/last-known", { save: next }).then((data) => {
      // The query keeps the selected value (useRewardsQuery selects inside its queryFn), not the envelope.
      if (data) queryClient.setQueryData<LastKnown | null>(["last-known", key], data.lastKnown);
    });
    // `call` is a fresh closure each render; the gap above is what bounds this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, key, savedData, savedSettled, queryClient]);
}

/** "Got it": the card closes at once, and the server keeps it closed on every device. */
export function useCloseFirstStock() {
  const queryClient = useQueryClient();
  const { key, call } = useRewardsCall();
  return useMutation({
    // The close is idempotent on the server, so a lost answer is simply asked again.
    retry: 3,
    retryDelay: (attempt) => Math.min(8_000, 1_000 * 2 ** attempt),
    mutationFn: async () => {
      if (!key) throw new Error("no account");
      const data = await call<FirstStockResponse>("/api/first-stock", { close: true });
      if (!data) throw new Error("not saved");
      return data;
    },
    onMutate: () =>
      queryClient.setQueryData<FirstStockResponse>(["first-stock", key], (previous) =>
        previous ? { ...previous, closed: true, show: false } : previous,
      ),
    onSuccess: (data) => queryClient.setQueryData(["first-stock", key], data),
  });
}

/**
 * The account's invite campaign line, as an inviter (app/api/campaign), for
 * the home's quiet line. Null when no invite campaign is live and nobody
 * they invited holds a claim; a route not deployed reads the same.
 */
export function useCampaignProgress(enabled: boolean) {
  return useRewardsQuery<CampaignResponse, CampaignProgress | null>("campaign", "/api/campaign", {
    enabled,
    staleTime: 5 * 60_000,
    notFound: { campaign: null },
    select: (data) => data.campaign,
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

/**
 * The wallets linked to this account, home first (app/api/account/wallets).
 * Every signed in session reads it: it decides where buys land (the home)
 * and whose hub wallets the totals add up (hooks/use-hub-account).
 */
export function useAccountWallets(enabled = true) {
  return useRewardsQuery<WalletsResponse>("account-wallets", "/api/account/wallets", {
    enabled,
    staleTime: 5 * 60_000,
    // Not deployed yet: nothing linked beyond what the session proves.
    notFound: { wallets: [], signedInWith: null },
  });
}

/**
 * Whether this account gets the drawer's quiet Staff entry (lib/staff/entry):
 * the server's yes for an account on a staff list, false for everyone else.
 */
export function useStaffEntry(enabled = true) {
  return useRewardsQuery<unknown, boolean>("staff-entry", "/api/account/staff", {
    enabled,
    staleTime: 10 * 60_000,
    notFound: {},
    select: isStaffAnswer,
  });
}

/**
 * The connected wallet the identity is waiting on, lowercase, and the
 * account session this browser signed in with before it (useIdentity).
 * Both null otherwise.
 */
export function usePendingWallet(): string | null {
  return useIdentity().pending;
}

export function useWaitingIdentity(): { pending: string | null; anchor: { address: string; token: string } | null } {
  const { pending, anchor } = useIdentity();
  return { pending, anchor };
}

export type WalletActResult =
  | { ok: true; response: WalletsResponse & { state?: string } }
  | { ok: false; reason: "declined" | "failed" | "reauth" | "slow" | "home_missing" };

type Signed = { message: string; signature: string };

/**
 * One wallet act on the account: link a wallet, make an address home, or
 * remove one. Each is a SIWE made for Berth over a nonce the server bound
 * to this account, this act and this target (lib/server/account-wallets-
 * route), saying exactly what it is for (lib/account-proof), spent once.
 * A link carries two signatures over the one nonce: the new wallet's, and
 * the account's own confirmation from its home (`confirm`); an email
 * account confirms with a recent code instead ("reauth" when it is not).
 *
 * `auth` is the session to speak as: the normal one, or, while a new
 * extension address waits, the earlier account's own session (useIdentity
 * anchor), so a wallet can join it without its data ever showing.
 */
export function useWalletAct() {
  const queryClient = useQueryClient();
  const { key, callStatus } = useRewardsCall();
  return useMutation({
    mutationFn: async (vars: {
      act: "link" | "home" | "unlink";
      /** The address acted on: the wallet to link, to make home, or to remove. */
      target: string;
      /** The target's family: "evm" (default), "solana" or "bitcoin" (link and remove only). */
      family?: ProofFamily;
      /** The address that signs the act (for a link, the target). */
      signer: string;
      /**
       * The signer's family: a Solana signer signs Sign-In With Solana, and
       * `sign` answers base58; a Bitcoin signer signs Sign-In With Bitcoin,
       * and `sign` answers base64. `signer` is then its canonical spelling.
       */
      signerFamily?: ProofFamily;
      sign: (message: string) => Promise<string | null>;
      /** A link's confirmation by the account's home, when it has one to sign with. */
      confirm?: { signer: string; sign: (message: string) => Promise<string | null> };
      /** Speak as this wallet session instead of the normal identity. */
      asSession?: string;
    }): Promise<WalletActResult> => {
      const post = async <T,>(path: string, body: Record<string, unknown>): Promise<{ status: number; data: T | null }> => {
        if (vars.asSession) {
          const response = await fetch(path, {
            method: "POST",
            headers: { "content-type": "application/json", "x-wallet-session": vars.asSession },
            body: JSON.stringify(body),
          });
          return { status: response.status, data: response.ok ? ((await response.json()) as T) : null };
        }
        if (!key) return { status: 0, data: null };
        return callStatus<T>(path, body);
      };
      const family = vars.family ?? "evm";
      const target = targetKey(family, vars.target);
      const nonce = (
        await post<{ nonce: string; nonceToken: string }>("/api/account/wallets/nonce", { act: vars.act, target: vars.target, family })
      ).data;
      if (!nonce) return { ok: false, reason: "failed" };
      const signOne = async (
        act: ProofAct,
        signer: string,
        sign: (message: string) => Promise<string | null>,
        signerFamily: ProofFamily = "evm",
      ): Promise<Signed | null> => {
        const fields = {
          domain: window.location.host,
          uri: window.location.origin,
          nonce: nonce.nonce,
          version: "1" as const,
          statement: proofStatement(act, target),
          resources: [proofResource(act, target)],
        };
        const message =
          signerFamily === "solana"
            ? createSiwsMessage({ ...fields, address: signer, chainId: "mainnet", issuedAt: new Date().toISOString() })
            : signerFamily === "bitcoin"
              ? createSiwbMessage({ ...fields, address: signer, chainId: "mainnet", issuedAt: new Date().toISOString() })
              : createSiweMessage({ ...fields, address: getAddress(signer), chainId: 146 });
        try {
          const signature = await sign(message);
          return signature ? { message, signature } : null;
        } catch {
          return null;
        }
      };
      const own = await signOne(vars.act, vars.signer, vars.sign, vars.signerFamily);
      if (!own) return { ok: false, reason: "declined" };
      let accountProof: Signed | undefined;
      if (vars.act === "link" && vars.confirm) {
        const confirmed = await signOne("link-confirm", vars.confirm.signer, vars.confirm.sign);
        if (!confirmed) return { ok: false, reason: "declined" };
        accountProof = confirmed;
      }
      const path = vars.act === "link" ? "link" : vars.act === "home" ? "home" : "remove";
      const response = await post<WalletsResponse & { state?: string; walletSession?: string; address?: string }>(
        `/api/account/wallets/${path}`,
        { ...own, nonceToken: nonce.nonceToken, address: vars.target, accountProof },
      );
      const outcome = walletActOutcome(response.status, response.data);
      if (!outcome.ok || !response.data) return outcome.ok ? { ok: false, reason: "failed" } : outcome;
      if (response.data.walletSession && response.data.address) storeWalletSession(response.data.address, response.data.walletSession);
      return { ok: true, response: response.data };
    },
    onSuccess: (result, vars) => {
      if (!result.ok || vars.asSession) return;
      const { wallets, signedInWith } = result.response;
      queryClient.setQueryData(["account-wallets", key], { wallets, signedInWith });
      // Totals and history now read another hub wallet.
      void queryClient.invalidateQueries({ queryKey: ["portfolio-history"] });
    },
  });
}

/**
 * The guided first path's record and server facts (app/api/first-path,
 * lib/first-path). A minute fresh, so a step done on another device lands
 * at the next focus. A route that is not there reads as an account that is
 * not on the path.
 */
export const FIRST_PATH_QUERY = "first-path";

export function useFirstPathRecord(enabled: boolean) {
  return useRewardsQuery<FirstPathResponse>(FIRST_PATH_QUERY, "/api/first-path", {
    enabled,
    staleTime: 60_000,
    notFound: NOT_ON_PATH,
  });
}

const NOT_ON_PATH: FirstPathResponse = {
  eligible: false,
  skipped: [],
  finished: true,
  referred: false,
  facts: { avatarSet: false, usernameSet: false, hasEmail: false, funded: false, firstBuy: false, inviteSent: false },
};

export type FirstPathWriteBody = { skip: PathStep } | { unskip: PathStep } | { funded: true } | { invited: true } | { finish: true };

/**
 * One write to the path's record. The cache moves at once (a skip, an
 * unskip, the finish), the server's answer then replaces it; each write is
 * idempotent there, so a lost answer is simply asked again.
 */
export function useFirstPathWrite() {
  const queryClient = useQueryClient();
  const { key, call } = useRewardsCall();
  return useMutation({
    retry: 3,
    retryDelay: (attempt) => Math.min(8_000, 1_000 * 2 ** attempt),
    mutationFn: async (body: FirstPathWriteBody) => {
      if (!key) throw new Error("no account");
      const data = await call<FirstPathResponse>("/api/first-path", body);
      if (!data) throw new Error("not saved");
      return data;
    },
    onMutate: (body) =>
      queryClient.setQueryData<FirstPathResponse>([FIRST_PATH_QUERY, key], (previous) => {
        if (!previous) return previous;
        if ("skip" in body) return { ...previous, skipped: withSkip(previous.skipped, body.skip) };
        if ("unskip" in body) return { ...previous, skipped: withoutSkip(previous.skipped, body.unskip) };
        if ("finish" in body) return { ...previous, finished: true };
        if ("funded" in body) return { ...previous, facts: { ...previous.facts, funded: true } };
        return { ...previous, facts: { ...previous.facts, inviteSent: true } };
      }),
    onSuccess: (data) => queryClient.setQueryData([FIRST_PATH_QUERY, key], data),
  });
}
