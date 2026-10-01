import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InviteLanding } from "@/components/invite-landing";
import { normalizeInviteCode } from "@/lib/invite-code";
import { inviteCardMetadata } from "@/lib/invite-card";
import { cardPerson } from "@/lib/server/og-people";

/**
 * Path-based invite carrier: `/r/CODE`. Born because `?ref=` query params
 * get stripped by link handlers in the wild (WhatsApp to desktop Chrome,
 * field-tested 2026-08-07) — a path segment survives. Crawlers unfurl the
 * saved-seat card here directly; humans get the code pocketed client-side
 * and step through to the front door.
 */

type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { code } = await params;
  const normalized = normalizeInviteCode(code);
  if (!normalized) return {};
  const person = await cardPerson("invite", normalized);
  return inviteCardMetadata(person ? { code: normalized, person } : undefined);
}

export default async function InvitePage({ params }: Params) {
  const { code } = await params;
  const normalized = normalizeInviteCode(code);
  if (!normalized) redirect("/");
  return <InviteLanding code={normalized} />;
}
