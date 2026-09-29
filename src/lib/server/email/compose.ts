import { COPY } from "@/lib/copy";
import type { WalletFamily } from "@/lib/identity/caip";
import type { EmailKind } from "@/lib/email-kinds";
import { shortenAddress } from "@/lib/format";

/**
 * What each notice says, as data: the layout (template.tsx) renders it as
 * HTML and as plain text. Pure, so the words and what they may contain are
 * testable without a mail provider. A notice never carries the recipient's
 * email address, a full wallet address, or an account id.
 */

export type Notice =
  | { type: "wallet_added"; family: WalletFamily; address: string }
  | { type: "wallet_removed"; family: WalletFamily; address: string }
  | { type: "accounts_merged" }
  | { type: "assistant_connected"; app: string; scopes: readonly string[] }
  | {
      type: "order_filled";
      side: "buy" | "sell";
      /** The listing's plain name, never the ticker. */
      name: string;
      /** The limit price, formatted: "$198.20". */
      price: string;
      /** What arrived, formatted with its unit, when known: "0.5046 NVIDIA", "99.40 USDC". */
      received: string | null;
    }
  | { type: "order_expired"; side: "buy" | "sell"; name: string }
  | { type: "friend_request"; username: string };

export type NoticeType = Notice["type"];

export const NOTICE_KIND: Readonly<Record<NoticeType, EmailKind>> = {
  wallet_added: "security",
  wallet_removed: "security",
  accounts_merged: "security",
  assistant_connected: "security",
  order_filled: "orders",
  order_expired: "orders",
  friend_request: "friends",
};

export type EmailContent = {
  kind: EmailKind;
  subject: string;
  /** The inbox preview line. */
  preview: string;
  heading: string;
  paragraphs: string[];
  list?: string[];
  after?: string[];
  /** Label and value pairs, values in the mono face (prices, amounts). */
  facts?: { label: string; value: string }[];
  button: { label: string; href: string };
  /** Why this email arrived. */
  why: string;
};

/** Anything a person or a client named (an app name, a username) is cut short and kept to one line. */
function plain(value: string, max = 60): string {
  const flat = value.replace(/[\r\n\t]+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function composeNotice(notice: Notice, baseUrl: string): EmailContent {
  const email = COPY.email;
  const kind = NOTICE_KIND[notice.type];
  const button = { label: email.openBerth, href: `${baseUrl}/` };
  const why = kind === "security" ? email.securityWhy : email.why[kind as "orders" | "friends" | "weekly"];
  switch (notice.type) {
    case "wallet_added":
    case "wallet_removed": {
      const words = notice.type === "wallet_added" ? email.walletAdded : email.walletRemoved;
      const body = words.body(email.family[notice.family], shortenAddress(notice.address));
      return { kind, subject: words.subject, preview: body, heading: words.heading, paragraphs: [body], button, why };
    }
    case "accounts_merged":
      return {
        kind,
        subject: email.accountsMerged.subject,
        preview: email.accountsMerged.body,
        heading: email.accountsMerged.heading,
        paragraphs: [email.accountsMerged.body],
        button,
        why,
      };
    case "assistant_connected": {
      const app = plain(notice.app);
      const words = email.assistantConnected;
      const list = (["read", "draft"] as const)
        .filter((scope) => notice.scopes.includes(`berth.${scope}`))
        .map((scope) => words.scopes[scope]);
      return {
        kind,
        subject: words.subject(app),
        preview: words.body(app).replace(/:$/, "."),
        heading: words.heading,
        paragraphs: [words.body(app)],
        list,
        after: [words.after],
        button,
        why,
      };
    }
    case "order_filled": {
      const words = email.orderFilled;
      const body = words.body(notice.name, notice.side, notice.price);
      const facts = [{ label: words.priceLabel, value: notice.price }];
      if (notice.received) facts.push({ label: words.receivedLabel, value: notice.received });
      return { kind, subject: words.subject(notice.name, notice.side), preview: body, heading: words.heading, paragraphs: [body], facts, button, why };
    }
    case "order_expired": {
      const words = email.orderExpired;
      const body = words.body(notice.name, notice.side);
      return { kind, subject: words.subject(notice.name, notice.side), preview: body, heading: words.heading, paragraphs: [body], button, why };
    }
    case "friend_request": {
      const words = email.friendRequest;
      const username = plain(notice.username, 32);
      const body = words.body(username);
      return { kind, subject: words.subject(username), preview: body, heading: words.heading, paragraphs: [body], button, why };
    }
  }
}
