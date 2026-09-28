"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type ChatTransport, type UIMessage } from "ai";

/**
 * The chat's state in the browser, the only place a conversation lives.
 * Berth's server keeps no copy (lib/server/chat/usage keeps counts and
 * cost), so the history rides along with every message, and survives a
 * reload in sessionStorage: gone with the tab, emptied by Clear.
 */

/** Why a message did not go, from the route's JSON refusal (app/api/chat). */
export type ChatErrorCode =
  | "signed_out"
  | "locked"
  | "disabled"
  | "unavailable"
  | "budget"
  | "limit_day"
  | "limit_month"
  | "limit_minute"
  | "too_long"
  | "failed";

const KNOWN: readonly ChatErrorCode[] = ["signed_out", "locked", "disabled", "unavailable", "budget", "limit_day", "limit_month", "limit_minute", "too_long"];

export function chatErrorCode(error: Error | undefined): ChatErrorCode | null {
  if (!error) return null;
  const code = /^chat:(\w+)$/.exec(error.message)?.[1];
  return code && (KNOWN as readonly string[]).includes(code) ? (code as ChatErrorCode) : "failed";
}

/**
 * The transport to app/api/chat: a refusal turned into an error whose
 * message is `chat:<code>`, so the sheet can say it in words instead of
 * showing a server's. The auth headers are not the transport's: each send
 * carries fresh ones (useBerthChat `send`).
 */
export function berthChatTransport(): ChatTransport<UIMessage> {
  return new DefaultChatTransport({
    api: "/api/chat",
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (response.ok) return response;
      let code = response.status === 401 ? "signed_out" : "failed";
      try {
        const body = (await response.json()) as { code?: unknown };
        if (typeof body.code === "string") code = body.code;
      } catch {
        // Not JSON: the status decides.
      }
      throw new Error(`chat:${code}`);
    },
  });
}

function readStored(key: string | null): UIMessage[] {
  if (!key || typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as UIMessage[]) : [];
  } catch {
    return [];
  }
}

export function useBerthChat({
  storageKey,
  transport,
  headers,
}: {
  storageKey: string | null;
  transport: ChatTransport<UIMessage>;
  /** Fresh auth headers for one send; null when no session materializes. */
  headers: () => Promise<Record<string, string> | null>;
}) {
  const initial = useMemo(() => readStored(storageKey), [storageKey]);
  const chat = useChat({
    id: storageKey ?? "berth-chat",
    messages: initial,
    transport,
    experimental_throttle: 40,
  });

  // Save once a message has settled, not on every streamed word.
  const saved = useRef<string | null>(null);
  useEffect(() => {
    if (!storageKey || chat.status === "streaming" || chat.status === "submitted") return;
    try {
      const next = JSON.stringify(chat.messages);
      if (next === saved.current) return;
      saved.current = next;
      if (chat.messages.length === 0) window.sessionStorage.removeItem(storageKey);
      else window.sessionStorage.setItem(storageKey, next);
    } catch {
      // Storage full or blocked: the chat still works for this page.
    }
  }, [storageKey, chat.messages, chat.status]);

  const [authError, setAuthError] = useState<Error | undefined>(undefined);

  const clear = () => {
    void chat.stop();
    chat.setMessages([]);
    chat.clearError();
    setAuthError(undefined);
  };

  /** Send a message with fresh auth, or say the person is signed out. */
  const send = async (text: string) => {
    chat.clearError();
    setAuthError(undefined);
    const auth = await headers();
    if (!auth) {
      setAuthError(new Error("chat:signed_out"));
      return;
    }
    await chat.sendMessage({ text }, { headers: auth });
  };

  /** Ask for the last answer again, after a failure. */
  const retry = async () => {
    chat.clearError();
    const auth = await headers();
    if (!auth) {
      setAuthError(new Error("chat:signed_out"));
      return;
    }
    await chat.regenerate({ headers: auth });
  };

  return { ...chat, clear, send, retry, errorCode: chatErrorCode(chat.error ?? authError) };
}

export type BerthChat = ReturnType<typeof useBerthChat>;
