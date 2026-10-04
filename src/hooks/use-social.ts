"use client";

import { acceptedFromAnswer, readAtConfirm, type TermsState } from "@/lib/terms-gate";
import { TERMS_VERSION } from "@/lib/legal-version";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccountHeaders } from "@/hooks/use-profile";
import { announceRewards } from "@/components/xp-toast";
import type { RewardList } from "@/lib/profile-types";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import type {
  BlockedName,
  CardAnswer,
  FriendAction,
  FriendsBoard,
  FriendsList,
  HandleCheck,
  MySocial,
  ReportReason,
} from "@/lib/social-types";
import type { HandleRefusal } from "@/lib/handle";
import type { FriendsHolding, FriendsHoldingResponse } from "@/lib/social-proof";

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
  notices: (key: string | null) => ["social-notices", key] as const,
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

export function useSetVisible() {
  const queryClient = useQueryClient();
  const { key, call } = useSocialCall();
  return useMutation({
    mutationFn: (visible: boolean) => must(call<MySocial>("visibility", { visible })),
    onSuccess: (social) => queryClient.setQueryData(KEYS.me(key), social),
  });
}

export function useSetLinkFace() {
  const queryClient = useQueryClient();
  const { key, call } = useSocialCall();
  return useMutation({
    mutationFn: (on: boolean) => must(call<MySocial>("link-face", { on })),
    onSuccess: (social) => queryClient.setQueryData(KEYS.me(key), social),
  });
}

export function useSetShareHoldings() {
  const queryClient = useQueryClient();
  const { key, call } = useSocialCall();
  return useMutation({
    mutationFn: (on: boolean) => must(call<MySocial>("share-holdings", { on })),
    onSuccess: (social) => {
      queryClient.setQueryData(KEYS.me(key), social);
      void queryClient.invalidateQueries({ queryKey: KEYS.holding(key) });
      void queryClient.invalidateQueries({ queryKey: ["social-card"] });
    },
  });
}

export function useFriendsList(enabled: boolean) {
  const { key, call } = useSocialCall();
  return useQuery({
    queryKey: KEYS.friends(key),
    enabled: enabled && key !== null,
    staleTime: 30_000,
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
      if (result.card) queryClient.setQueryData(KEYS.card(key, vars.handle), result.card);
      if (vars.kind === "friend" && vars.token) void queryClient.invalidateQueries({ queryKey: ["social-card", key] });
      if (vars.kind !== "report") {
        void queryClient.invalidateQueries({ queryKey: KEYS.friends(key) });
        void queryClient.invalidateQueries({ queryKey: KEYS.me(key) });
        void queryClient.invalidateQueries({ queryKey: KEYS.board(key) });
        void queryClient.invalidateQueries({ queryKey: KEYS.holding(key) });
        void queryClient.invalidateQueries({ queryKey: KEYS.blocked(key) });
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
    if (accepted) queryClient.setQueryData(queryKey, true);
    return accepted;
  };
  return { state, accept, check };
}
