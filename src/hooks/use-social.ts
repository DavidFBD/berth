"use client";

import { acceptedFromAnswer, readAtConfirm, type TermsState } from "@/lib/terms-gate";
import { TERMS_VERSION } from "@/lib/legal-version";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DISPLAY_GC_MS } from "@/lib/query-freshness";
import { useAccountHeaders } from "@/hooks/use-profile";
import { announceRewards } from "@/components/xp-toast";
import type { RewardList } from "@/lib/profile-types";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import type {
  BlockedName,
  CardAnswer,
  FirstFriendAnswer,
  FriendAction,
  FriendsBoard,
  FriendsList,
  HandleCheck,
  MySocial,
  ReportReason,
} from "@/lib/social-types";
import type { HandleRefusal } from "@/lib/handle";
import { carryMore } from "@/lib/profile-more";
import { FIRST_FRIEND_NOTICE_ID, POLICY_NOTICE_ID, SOCIAL_NOTICE_ID, type FriendsHolding, type FriendsHoldingResponse } from "@/lib/social-proof";
import type { CompareFriend, CompareFriendsResponse, FriendWeek, FriendWeekRange, FriendWeekResponse } from "@/lib/friend-week";

/**
 * The client side of the social routes (app/api/social/[op]). Every call is
 * a POST with the same proof of who is asking as the rewards calls
 * (useAccountHeaders). Opening a profile also works signed out, so that one
 * read never asks a wallet to sign: it sends a proof only if one is already
 * at hand.
 */

type Call = <T>(op: string, body?: Record<string, unknown>) => Promise<{ status: number; data: T | null }>;

function useSocialCall({ prompt = true }: { prompt?: boolean } = {}): { key: string | null; call: Call } {
  const { key, headers } = useAccountHeaders({ prompt });
  const call: Call = async <T>(op: string, body: Record<string, unknown> = {}) => {
    const auth = key ? await headers() : null;
    if (prompt && !auth) return { status: 401, data: null };
    const response = await fetch(`/api/social/${op}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth ?? {}) },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as T | null;
    return { status: response.status, data };
  };
  return { key, call };
}

async function must<T>(result: Promise<{ status: number; data: T | null }>): Promise<T> {
  const { status, data } = await result;
  if (status !== 200 || data === null) throw new Error(`social ${status}`);
  return data;
}

const KEYS = {
  me: (key: string | null) => ["social-me", key] as const,
  friends: (key: string | null) => ["social-friends", key] as const,
  link: (key: string | null) => ["social-link", key] as const,
  blocked: (key: string | null) => ["social-blocked", key] as const,
  board: (key: string | null) => ["social-board", key] as const,
  holding: (key: string | null) => ["social-holding", key] as const,
  compareFriends: (key: string | null) => ["social-compare-friends", key] as const,
  compareWeek: (key: string | null, handle: string, range: string, from: string) =>
    ["social-compare-week", key, handle, range, from] as const,
  notices: (key: string | null) => ["social-notices", key] as const,
  firstFriend: (key: string | null) => ["social-first-friend", key] as const,
  card: (key: string | null, handle: string) => ["social-card", key, handle.toLowerCase()] as const,
};

/** The viewer's own social state. */
/** `prompt: false` for a quiet read that must never ask a wallet to sign (the notice strip). */
export function useMySocial(enabled = true, { prompt = true }: { prompt?: boolean } = {}) {
  const { key, call } = useSocialCall({ prompt });
  return useQuery({
    queryKey: KEYS.me(key),
    enabled: enabled && key !== null,
    staleTime: 60_000,
    gcTime: DISPLAY_GC_MS,
    retry: 1,
    queryFn: () => must(call<MySocial>("me")),
  });
}

/**
 * The picker's live check, a beat after typing stops. Shape errors are the
 * rulebook's and are answered in the picker without a request; only a name
 * that could be one is asked about.
 */
export function useHandleCheck(value: string, enabled: boolean) {
  const { key, call } = useSocialCall();
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), 450);
    return () => clearTimeout(timer);
  }, [value]);
  const query = useQuery({
    queryKey: ["social-check", key, settled.toLowerCase()],
    enabled: enabled && key !== null && settled === value && value.length > 0,
    staleTime: 30_000,
    gcTime: DISPLAY_GC_MS,
    retry: false,
    queryFn: () => must(call<HandleCheck>("check", { handle: settled })),
  });
  return { ...query, pending: settled !== value || query.isFetching };
}

export function useSetHandle() {
  const queryClient = useQueryClient();
  const { key, call } = useSocialCall();
  return useMutation({
    mutationFn: async (
      handle: string,
    ): Promise<{ ok: true; social: MySocial; rewards: RewardList; xp: number | null } | { ok: false; reason: HandleRefusal | "failed" }> => {
      type Saved = MySocial & { rewards?: RewardList; xp?: number | null };
      const { status, data } = await call<Saved | { ok: false; reason: HandleRefusal }>("name", { handle });
      if (status === 200 && data) {
        // The first username pays username_set; the reward rides beside the social state.
        const { rewards = [], xp = null, ...social } = data as Saved;
        return { ok: true, social, rewards, xp };
      }
      if (status === 422 && data && "reason" in data) return { ok: false, reason: data.reason };
      return { ok: false, reason: "failed" };
    },
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.setQueryData(KEYS.me(key), result.social);
        if (result.rewards.length > 0 && result.xp !== null) {
          const xp = result.xp;
          announceRewards(result.rewards, xp);
          queryClient.setQueryData<{ xp: number }>(["profile", key], (previous) => (previous ? { ...previous, xp } : previous));
          void queryClient.invalidateQueries({ queryKey: ["xp-history", key] });
        }
      }
      void queryClient.invalidateQueries({ queryKey: ["social-card"] });
      void queryClient.invalidateQueries({ queryKey: KEYS.board(key) });
    },
  });
}

type WithBonus = MySocial & { rewards?: RewardList; xp?: number | null };

/**
 * A switch turned on can complete all four friend features, which pays the
 * one time friends_all_on bonus (lib/server/social/ops): announce it like
 * every reward, and keep only the social state in the cache.
 */
function useSettleSwitch() {
  const queryClient = useQueryClient();
  const { key } = useSocialCall();
  return (data: WithBonus): MySocial => {
    const { rewards = [], xp = null, ...social } = data;
    queryClient.setQueryData(KEYS.me(key), social);
    if (rewards.length > 0 && xp !== null) {
      announceRewards(rewards, xp);
      queryClient.setQueryData<{ xp: number }>(["profile", key], (previous) => (previous ? { ...previous, xp } : previous));
      void queryClient.invalidateQueries({ queryKey: ["xp-history", key] });
      void queryClient.invalidateQueries({ queryKey: ["first-path", key] });
    }
    return social;
  };
}

export function useSetVisible() {
  const { call } = useSocialCall();
  const settle = useSettleSwitch();
  return useMutation({
    mutationFn: (visible: boolean) => must(call<WithBonus>("visibility", { visible })),
    onSuccess: (data) => void settle(data),
  });
}

export function useSetLinkFace() {
  const { call } = useSocialCall();
  const settle = useSettleSwitch();
  return useMutation({
    mutationFn: (on: boolean) => must(call<WithBonus>("link-face", { on })),
    onSuccess: (data) => void settle(data),
  });
}

export function useSetShareHoldings() {
  const queryClient = useQueryClient();
  const { key, call } = useSocialCall();
  const settle = useSettleSwitch();
  return useMutation({
    mutationFn: (on: boolean) => must(call<WithBonus>("share-holdings", { on })),
    onSuccess: (data, on) => {
      settle(data);
      // Sharing found the switch the social notice points to: it is closed (lib/server/notices).
      if (on) dropNotice(queryClient, key, SOCIAL_NOTICE_ID);
      void queryClient.invalidateQueries({ queryKey: KEYS.holding(key) });
      void queryClient.invalidateQueries({ queryKey: ["social-card"] });
    },
  });
}

export function useSetShareWeek() {
  const queryClient = useQueryClient();
  const { key, call } = useSocialCall();
  const settle = useSettleSwitch();
  return useMutation({
    mutationFn: (on: boolean) => must(call<WithBonus>("share-week", { on })),
    onSuccess: (data) => {
      settle(data);
      void queryClient.invalidateQueries({ queryKey: KEYS.compareFriends(key) });
      void queryClient.invalidateQueries({ queryKey: ["social-compare-week", key] });
    },
  });
}

/**
 * "Turn on all friend features": every friend sharing switch on at once
 * (lib/server/social/handles setAllFriends). The first time pays
 * friends_all_on, which rides beside the social state like the first
 * username's XP and is announced the same way.
 */
export function useTurnOnAllFriends() {
  const queryClient = useQueryClient();
  const { key, call } = useSocialCall();
  return useMutation({
    /** `features`: the feature ids the offer's summary named, which the server checks against its own. */
    mutationFn: async (features: readonly string[]): Promise<{ social: MySocial; rewards: RewardList; xp: number | null }> => {
      type Saved = MySocial & { rewards?: RewardList; xp?: number | null };
      const { rewards = [], xp = null, ...social } = await must(call<Saved>("friends-all", { features }));
      return { social, rewards, xp };
    },
    onSuccess: ({ social, rewards, xp }) => {
      queryClient.setQueryData(KEYS.me(key), social);
      // Every friend feature is on, holdings sharing among them: the social
      // notice has nothing left to say (the server closed it too).
      dropNotice(queryClient, key, SOCIAL_NOTICE_ID);
      if (rewards.length > 0 && xp !== null) {
        announceRewards(rewards, xp);
        queryClient.setQueryData<{ xp: number }>(["profile", key], (previous) => (previous ? { ...previous, xp } : previous));
        void queryClient.invalidateQueries({ queryKey: ["xp-history", key] });
      }
      void queryClient.invalidateQueries({ queryKey: KEYS.holding(key) });
      void queryClient.invalidateQueries({ queryKey: KEYS.compareFriends(key) });
      void queryClient.invalidateQueries({ queryKey: ["social-compare-week", key] });
      void queryClient.invalidateQueries({ queryKey: ["social-card"] });
      void queryClient.invalidateQueries({ queryKey: KEYS.board(key) });
      void queryClient.invalidateQueries({ queryKey: ["first-path", key] });
    },
    // A refused list means the offer is out of date: read the state again.
    onError: () => void queryClient.invalidateQueries({ queryKey: KEYS.me(key) }),
  });
}

/** A quiet social read: only a session already at hand, never a wallet prompt; any failure reads as `empty`. */
async function quietRead<T>(headers: () => Promise<Record<string, string> | null>, op: string, body: Record<string, unknown>, empty: T): Promise<T> {
  const auth = await headers();
  if (!auth) return empty;
  const response = await fetch(`/api/social/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify(body),
  });
  if (!response.ok) return empty;
  return ((await response.json()) as T) ?? empty;
}

/**
 * The friends the benchmark picker offers (lib/server/social/compare): those
 * who compare their week, while the viewer does too. Never asks a wallet to
 * sign; says nothing without a session. Private: no-store on the route,
 * keyed on the viewer here.
 */
export function useCompareFriends(enabled = true): CompareFriend[] {
  const { key, headers } = useAccountHeaders({ prompt: false });
  const query = useQuery({
    queryKey: KEYS.compareFriends(key),
    enabled: enabled && key !== null,
    staleTime: 5 * 60_000,
    gcTime: DISPLAY_GC_MS,
    retry: false,
    queryFn: async () => (await quietRead<CompareFriendsResponse>(headers, "compare-friends", {}, { friends: [] })).friends ?? [],
  });
  // Off, nobody is offered, whatever an earlier answer cached.
  return enabled ? (query.data ?? []) : [];
}

/**
 * One friend's line, percent only, over the card's window (`range` and its
 * first day `from`). Null while it loads, when it may not be drawn, or for
 * no friend.
 */
export function useFriendWeek(
  handle: string | null,
  range: FriendWeekRange | null,
  from: string | null,
): { week: FriendWeek | null; loading: boolean } {
  const { key, headers } = useAccountHeaders({ prompt: false });
  const ready = handle !== null && range !== null && from !== null;
  const query = useQuery({
    queryKey: KEYS.compareWeek(key, handle ?? "", range ?? "", from ?? ""),
    enabled: ready && key !== null,
    staleTime: 10 * 60_000,
    gcTime: DISPLAY_GC_MS,
    retry: false,
    queryFn: async () => (await quietRead<FriendWeekResponse>(headers, "compare-week", { handle, range, from }, { week: null })).week ?? null,
  });
  return { week: ready ? (query.data ?? null) : null, loading: ready && query.isPending && query.fetchStatus !== "idle" };
}

export function useFriendsList(enabled: boolean) {
  const { key, call } = useSocialCall();
  return useQuery({
    queryKey: KEYS.friends(key),
    enabled: enabled && key !== null,
    staleTime: 30_000,
    gcTime: DISPLAY_GC_MS,
    retry: 1,
    queryFn: () => must(call<FriendsList>("friends")),
  });
}

export function useFriendLink(enabled: boolean) {
  const queryClient = useQueryClient();
  const { key, call } = useSocialCall();
  const query = useQuery({
    queryKey: KEYS.link(key),
    enabled: enabled && key !== null,
    staleTime: Infinity,
    retry: 1,
    queryFn: async () => (await must(call<{ token: string }>("link"))).token,
  });
  const fresh = useMutation({
    mutationFn: async () => (await must(call<{ token: string }>("link", { fresh: true }))).token,
    onSuccess: (token) => queryClient.setQueryData(KEYS.link(key), token),
  });
  return { ...query, fresh };
}

export function useBlocked(enabled: boolean) {
  const { key, call } = useSocialCall();
  return useQuery({
    queryKey: KEYS.blocked(key),
    enabled: enabled && key !== null,
    staleTime: 30_000,
    gcTime: DISPLAY_GC_MS,
    retry: 1,
    queryFn: async () => (await must(call<{ blocked: BlockedName[] }>("blocked"))).blocked,
  });
}

export function useFriendsBoard(enabled: boolean) {
  const { key, call } = useSocialCall();
  return useQuery({
    queryKey: KEYS.board(key),
    enabled: enabled && key !== null,
    staleTime: 60_000,
    gcTime: DISPLAY_GC_MS,
    retry: 1,
    queryFn: () => must(call<FriendsBoard>("board")),
  });
}

/**
 * Which board listings the viewer's friends hold, as counts
 * (lib/server/social-proof), by symbol. Never asks a wallet to sign: it is
 * a quiet line on the board, so it uses only a session already at hand,
 * and says nothing without one. Private: the social route answers it with
 * no-store, and the cache here is keyed on the viewer.
 */
export function useFriendsHolding(enabled = true): ReadonlyMap<string, FriendsHolding> {
  const { key, headers } = useAccountHeaders({ prompt: false });
  const query = useQuery({
    queryKey: KEYS.holding(key),
    enabled: enabled && key !== null,
    staleTime: 5 * 60_000,
    gcTime: DISPLAY_GC_MS,
    retry: false,
    queryFn: async (): Promise<FriendsHolding[]> => {
      const auth = await headers();
      if (!auth) return [];
      const response = await fetch("/api/social/holding", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: "{}",
      });
      if (!response.ok) return [];
      return ((await response.json()) as FriendsHoldingResponse).holding ?? [];
    },
  });
  return new Map((query.data ?? []).map((line) => [line.symbol, line]));
}

/** Takes a notice off this account's cached list at once; the server has closed it or no longer answers it. */
function dropNotice(queryClient: ReturnType<typeof useQueryClient>, key: string | null, notice: string): void {
  queryClient.setQueryData<string[]>(KEYS.notices(key), (pending) => pending?.filter((id) => id !== notice));
}

/**
 * Whether a once per account notice (lib/server/notices) is still due, and
 * how to close it. Never asks a wallet to sign; without a session it says
 * nothing. Closing hides it at once and records it for every device.
 */
export function useAccountNotice(notice: string): { due: boolean; close: () => void } {
  const queryClient = useQueryClient();
  const { key, call } = useSocialCall({ prompt: false });
  const query = useQuery({
    queryKey: KEYS.notices(key),
    enabled: key !== null,
    staleTime: 10 * 60_000,
    gcTime: DISPLAY_GC_MS,
    retry: false,
    queryFn: async () => {
      const { status, data } = await call<{ pending: string[] }>("notices");
      return status === 200 && data ? data.pending : [];
    },
  });
  const close = () => {
    queryClient.setQueryData<string[]>(KEYS.notices(key), (pending) => (pending ?? []).filter((id) => id !== notice));
    void call("notice-seen", { notice });
  };
  return { due: (query.data ?? []).includes(notice), close };
}

/**
 * The founder as a first friend (lib/server/social/founder): the offer, or
 * null, read quietly (never asks a wallet to sign). `add` asks him as any
 * request does, which makes friends at once; `dismiss` closes the offer for
 * good on every device. Either hides it at once.
 */
export function useFirstFriend(enabled = true): {
  offer: FirstFriendAnswer["offer"];
  add: (handlers?: { onDone?: (done: boolean) => void; onError?: () => void }) => void;
  adding: boolean;
  dismiss: () => void;
} {
  const queryClient = useQueryClient();
  const { key, call } = useSocialCall({ prompt: false });
  const action = useSocialAction();
  const query = useQuery({
    queryKey: KEYS.firstFriend(key),
    enabled: enabled && key !== null,
    staleTime: 5 * 60_000,
    gcTime: DISPLAY_GC_MS,
    retry: false,
    queryFn: async (): Promise<FirstFriendAnswer> => {
      const { status, data } = await call<FirstFriendAnswer>("first-friend");
      return status === 200 && data ? data : { offer: null };
    },
  });
  const offer = query.data?.offer ?? null;
  const hide = () => queryClient.setQueryData<FirstFriendAnswer>(KEYS.firstFriend(key), { offer: null });
  return {
    offer,
    adding: action.isPending,
    add: (handlers) => {
      if (!offer) return;
      action.mutate(
        { kind: "friend", handle: offer.handle, action: "request" },
        {
          onSuccess: (result) => {
            if (result.done) hide();
            handlers?.onDone?.(result.done);
          },
          onError: () => handlers?.onError?.(),
        },
      );
    },
    dismiss: () => {
      hide();
      void call("notice-seen", { notice: FIRST_FRIEND_NOTICE_ID });
    },
  };
}

/**
 * A profile, by username or by a friend link's token. Keyed on the viewer
 * too, so a card fetched signed out is never shown as the signed in view.
 */
export function useCard(target: { handle: string } | { token: string }) {
  const { key, call } = useSocialCall({ prompt: false });
  // Wait until the session is known: asked too early, a signed in person
  // would be answered as a visitor, which could show a card a block hides.
  const privy = usePrivyEmbeddedWallet();
  const id = "handle" in target ? target.handle : `link:${target.token}`;
  return useQuery({
    queryKey: KEYS.card(key, id),
    enabled: !privy.enabled || privy.ready,
    staleTime: 30_000,
    gcTime: DISPLAY_GC_MS,
    // Find a friend caches the plain card under the same key: the page asks
    // again for its extras (CardAnswer.more) rather than show it without them.
    refetchOnMount: (query) => (query.state.data?.found && !query.state.data.more ? "always" : true),
    retry: 1,
    queryFn: () =>
      must(call<CardAnswer>("handle" in target ? "card" : "link-card", "handle" in target ? { handle: target.handle } : { token: target.token })),
  });
}

/**
 * "Find a friend": one exact username, on a tap, never as you type. The
 * answer is the card's own (found, or the one NOT_FOUND for every miss), a
 * 429 is "slow", a 403 means no verified email. A found card is cached as
 * the profile page would cache it, so the actions on it update in place.
 */
export function useFindFriend() {
  const queryClient = useQueryClient();
  const { key, call } = useSocialCall();
  return useMutation({
    mutationFn: async (handle: string): Promise<{ kind: "answer"; answer: CardAnswer } | { kind: "slow" } | { kind: "failed" }> => {
      const { status, data } = await call<CardAnswer>("find", { handle });
      if (status === 200 && data) return { kind: "answer", answer: data };
      if (status === 429) return { kind: "slow" };
      return { kind: "failed" };
    },
    onSuccess: (result, handle) => {
      if (result.kind === "answer" && result.answer.found) queryClient.setQueryData(KEYS.card(key, handle), result.answer);
    },
  });
}

export type CardActionVars =
  | { kind: "salute"; handle: string; on: boolean }
  | { kind: "friend"; handle: string; action: FriendAction; token?: string }
  | { kind: "block"; handle: string; on: boolean }
  | { kind: "report"; handle: string; reason: ReportReason };

/**
 * Everything a person does from a profile or the friends list. The answer
 * replaces the cached card where one comes back, and the lists it touches
 * are refetched on their next open.
 */
export function useSocialAction() {
  const queryClient = useQueryClient();
  const { key, call } = useSocialCall();
  return useMutation({
    mutationFn: async (vars: CardActionVars): Promise<{ done: boolean; card: CardAnswer | null }> => {
      if (vars.kind === "salute") {
        const card = await must(call<CardAnswer>("salute", { handle: vars.handle, on: vars.on }));
        return { done: true, card };
      }
      if (vars.kind === "friend") {
        const body: Record<string, unknown> = vars.token ? { token: vars.token, action: vars.action } : { handle: vars.handle, action: vars.action };
        return must(call<{ done: boolean; card: CardAnswer }>("friend", body));
      }
      if (vars.kind === "block") {
        await must(call("block", { handle: vars.handle, on: vars.on }));
        return { done: true, card: vars.on ? { found: false } : null };
      }
      await must(call("report", { handle: vars.handle, reason: vars.reason }));
      return { done: true, card: null };
    },
    onSuccess: (result, vars) => {
      if (result.card) {
        const next = result.card;
        queryClient.setQueryData<CardAnswer>(KEYS.card(key, vars.handle), (previous) => carryMore(previous, next));
      }
      if (vars.kind === "friend" && vars.token) void queryClient.invalidateQueries({ queryKey: ["social-card", key] });
      if (vars.kind !== "report") {
        void queryClient.invalidateQueries({ queryKey: KEYS.friends(key) });
        void queryClient.invalidateQueries({ queryKey: KEYS.me(key) });
        void queryClient.invalidateQueries({ queryKey: KEYS.board(key) });
        void queryClient.invalidateQueries({ queryKey: KEYS.holding(key) });
        void queryClient.invalidateQueries({ queryKey: KEYS.blocked(key) });
        void queryClient.invalidateQueries({ queryKey: KEYS.firstFriend(key) });
        // A block, an unfriend or a removal drops a friend's line at once:
        // reset, not just marked stale, so the old line is never drawn again.
        void queryClient.resetQueries({ queryKey: KEYS.compareFriends(key) });
        void queryClient.resetQueries({ queryKey: ["social-compare-week", key] });
      }
    },
  });
}

/**
 * Whether this account accepted the current terms (lib/server/terms-acceptance),
 * as lib/terms-gate reads it, and the yes. The read never asks a wallet to
 * sign: a wallet with no session at hand reads as due, and Accept asks for
 * one. The answer is kept for the visit once known.
 */
export function useTermsAcceptance(): { state: TermsState; accept: () => Promise<boolean>; check: () => Promise<boolean> } {
  const queryClient = useQueryClient();
  const quiet = useSocialCall({ prompt: false });
  const asking = useSocialCall({ prompt: true });
  const queryKey = ["terms-acceptance", quiet.key, TERMS_VERSION] as const;
  const readAnswer = async () => {
    const { status, data } = await quiet.call<{ accepted: boolean }>("terms").catch(() => ({ status: null, data: null }));
    if (status !== 200 && status !== 401 && status !== 403) console.warn("[terms] acceptance read failed, letting the person through", status);
    return acceptedFromAnswer(status, data);
  };
  const query = useQuery({
    queryKey,
    enabled: quiet.key !== null,
    staleTime: Infinity,
    retry: 1,
    // Fails open (lib/terms-gate acceptedFromAnswer), as the server does.
    queryFn: readAnswer,
  });
  // No identity at all: nobody to ask yet, and the order drawer's own sign
  // in step comes first. Once there is an account, the answer is read and
  // a buy waits on it (lib/terms-gate).
  const state: TermsState = quiet.key === null ? "accepted" : query.isPending ? "loading" : query.data ? "accepted" : "due";
  // Read afresh, for the check when a buy is confirmed (lib/terms-gate
  // confirmBuy). No identity yet: nothing to ask, the drawer's own sign in
  // comes first.
  const check = async () => {
    if (quiet.key === null) return true;
    return readAtConfirm(query.data, () => queryClient.fetchQuery({ queryKey, queryFn: readAnswer, staleTime: 0 }));
  };
  const accept = async () => {
    const { status, data } = await asking.call<{ accepted: boolean }>("terms-accept", { version: TERMS_VERSION });
    const accepted = status === 200 && Boolean(data?.accepted);
    if (accepted) {
      queryClient.setQueryData(queryKey, true);
      // The policy notice announces these terms: accepted, it has nothing left to say.
      dropNotice(queryClient, quiet.key, POLICY_NOTICE_ID);
    }
    return accepted;
  };
  return { state, accept, check };
}
