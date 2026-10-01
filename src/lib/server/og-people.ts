import { getSql } from "@/lib/server/db";
import { SHOWN_SQL } from "@/lib/server/social/people";
import { avatarSrc } from "@/lib/avatars";
import { lookupKey } from "@/lib/handle";
import { normalizeInviteCode } from "@/lib/invite-code";
import { rankForXp } from "@/lib/xp";
import { isFaceName, ogImage, ogPersonalImage, OG_CONTENT_TYPE, type OgPerson, type PersonalKind } from "@/lib/og/card";

/**
 * Who a link preview card may name (lib/og/card OgPerson), and the one
 * HTTP answer for /og/u/<username> and /og/r/<code>.
 *
 * A profile card names its owner only when every one of these holds: the
 * username exists, its profile is on for others (SHOWN_SQL: not hidden,
 * email still verified), the owner turned on "Show my avatar, username and rank on
 * links to my profile" (profiles.link_face, off by default), and the
 * account was not merged away. An invite card names the inviter when the
 * code is a minted one (`users.referral_code`, the lookup every invite
 * path uses), the code's own account was not merged away (its survivor did
 * not share this link), it has a username, its profile is on, and the same
 * switch is on: one switch covers both cards, so an invite link shared
 * before it existed never starts naming someone who did not opt in.
 *
 * Every other case, a name that does not exist included, gets the same
 * anonymous card: the same bytes, the same headers, the same single query
 * first, so the card cannot be used to learn whether a name exists. The
 * name drawn is always the one stored in the database, never the text of
 * the URL, so nobody can print words of their own on a Berth card.
 *
 * The caller's country plays no part: crawlers fetch from wherever their
 * servers are (mostly the United States), and a card that names someone is
 * public by its owner's own choice. The soft landing is about using Berth,
 * not about seeing a public face.
 */

type PersonRow = { handle: string; avatar_id: string | null; xp: number };

function toPerson(row: PersonRow | undefined): OgPerson | null {
  if (!row) return null;
  const file = avatarSrc(row.avatar_id)?.match(/^\/avatars\/([a-z-]+)\.svg$/)?.[1] ?? null;
  const rank = rankForXp(row.xp);
  return { handle: row.handle, face: file && isFaceName(file) ? file : null, level: rank.level, rank: rank.name };
}

/** A norm no username can have, so a malformed name still costs the one query. */
const NO_NAME = "";

/** The owner of /u/<username> as the card may draw them, or null for any reason at all. */
export async function profilePerson(username: unknown): Promise<OgPerson | null> {
  const norm = lookupKey(username) ?? NO_NAME;
  const rows = (await getSql().query(
    `select h.handle, u.avatar_id, u.xp
     from handles h
     join users u on u.id = h.user_id
     join profiles p on p.user_id = h.user_id
     where h.handle_norm = $1
       and p.link_face
       and u.retired_into is null
       and ${SHOWN_SQL("h.user_id")}`,
    [norm],
  )) as PersonRow[];
  return toPerson(rows[0]);
}

/** The inviter behind an invite code as the card may draw them, or null for any reason at all. */
export async function invitePerson(code: unknown): Promise<OgPerson | null> {
  const normalized = normalizeInviteCode(code) ?? NO_NAME;
  const rows = (await getSql().query(
    `select h.handle, u.avatar_id, u.xp
     from users u
     join handles h on h.user_id = u.id
     join profiles p on p.user_id = u.id
     where u.referral_code = $1
       and p.link_face
       and u.retired_into is null
       and ${SHOWN_SQL("u.id")}`,
    [normalized],
  )) as PersonRow[];
  return toPerson(rows[0]);
}

/**
 * The person a card may draw, or null. A database that cannot answer
 * (or a schema not yet pushed) names nobody: a link card is never worth a
 * failed page.
 */
export async function cardPerson(kind: PersonalKind, key: unknown): Promise<OgPerson | null> {
  try {
    return await (kind === "profile" ? profilePerson(key) : invitePerson(key));
  } catch (error) {
    console.warn("[og] person lookup failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Ten minutes at most before a change (a hide, a switch turned off, a new
 * face) reaches a platform that asks again: five fresh at the edge, five
 * more served stale while it is fetched anew. Never in the browser.
 */
export const PERSONAL_CARD_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Type": OG_CONTENT_TYPE,
  "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=300",
  "X-Content-Type-Options": "nosniff",
});

const anonymous: Partial<Record<PersonalKind, Promise<ArrayBuffer>>> = {};

/** The anonymous card's PNG, drawn once per process, so every fallback is the same bytes at the same speed. */
function anonymousBytes(kind: PersonalKind): Promise<ArrayBuffer> {
  anonymous[kind] ??= ogImage(kind)
    .then((response) => response.arrayBuffer())
    .catch((error: unknown) => {
      delete anonymous[kind];
      throw error;
    });
  return anonymous[kind]!;
}

/** The whole answer of /og/u/<username> (kind "profile") and /og/r/<code> (kind "invite"). */
export async function personalCardResponse(kind: PersonalKind, key: unknown): Promise<Response> {
  const person = await cardPerson(kind, key);
  const bytes = person
    ? await (await ogPersonalImage(kind, person)).arrayBuffer()
    : await anonymousBytes(kind);
  return new Response(bytes, { status: 200, headers: { ...PERSONAL_CARD_HEADERS } });
}
