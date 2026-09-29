import { PRODUCTION_ORIGIN } from "@/lib/server/oauth/config";

/**
 * Email settings, read from the environment at the moment of use (never at
 * module scope, so a build without them still compiles).
 *
 * - RESEND_API_KEY: a send only key. Without it nothing is sent.
 * - EMAIL_SENDING=off: the kill switch. Everything stops, security too.
 * - EMAIL_FROM: the sender, "Berth <hello@mail.berthmarkets.com>" by default.
 * - EMAIL_BASE_URL: where links point, the production origin by default.
 * - EMAIL_REPLY_TO: replies and the security notices' contact, support@berthmarkets.com by default.
 * - EMAIL_TOKEN_SECRET: the key for unsubscribe links; SESSION_SECRET, then
 *   PRIVY_APP_SECRET, stand in when it is unset.
 */
export const DEFAULT_FROM = "Berth <hello@mail.berthmarkets.com>";

export function emailSendingOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.RESEND_API_KEY) && env.EMAIL_SENDING !== "off";
}

export function emailFrom(env: NodeJS.ProcessEnv = process.env): string {
  return env.EMAIL_FROM?.trim() || DEFAULT_FROM;
}

/** Where replies and "Not you?" go: support@berthmarkets.com (forwarded), unless EMAIL_REPLY_TO says otherwise. */
export const DEFAULT_REPLY_TO = "support@berthmarkets.com";

export function emailReplyTo(env: NodeJS.ProcessEnv = process.env): string {
  return env.EMAIL_REPLY_TO?.trim() || DEFAULT_REPLY_TO;
}

export function emailBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.EMAIL_BASE_URL?.trim() || PRODUCTION_ORIGIN).replace(/\/+$/, "");
}

/** The mark in the header, served from the site itself (no image host of anyone else's). */
export function emailMarkUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${emailBaseUrl(env)}/berth-brand/mark/berth-logo.png`;
}
