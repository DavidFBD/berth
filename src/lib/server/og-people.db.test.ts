import type { ReactElement, ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { setHandle, setVisible } from "@/lib/server/social/handles";
import { runSocialOp } from "@/lib/server/social/ops";
import type { SocialViewer } from "@/lib/server/social/people";
import { COPY } from "@/lib/copy";
import { ogImage, ogPersonalElement } from "@/lib/og/card";
import { invitePerson, personalCardResponse, profilePerson } from "./og-people";
import { generateMetadata as profileMetadata } from "@/app/u/[username]/page";
import { generateMetadata as inviteMetadata } from "@/app/r/[code]/page";

vi.mock("@/components/social/profile-page", () => ({ ProfilePage: () => null }));
vi.mock("@/components/invite-landing", () => ({ InviteLanding: () => null }));

/**
 * The personal link preview cards (lib/server/og-people) against the real
 * schema: who may be named, and that every case that names no one is the
 * same answer, byte for byte and header for header.
 */

let sql: SqlClient;
let close: () => Promise<void>;

beforeAll(async () => {
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
});

afterAll(async () => {
  setSqlClient(null);
  await close();
});

let n = 0;
async function person(name: string, opts: { avatar?: string | null; xp?: number; code?: string } = {}): Promise<SocialViewer> {
  n += 1;
  const rows = (await sql.query(
    `insert into users (privy_did, email, avatar_id, xp, referral_code) values ($1, $2, $3, $4, $5) returning id`,
    [`did:privy:og${n}`, `og${n}@example.com`, opts.avatar ?? null, opts.xp ?? 0, opts.code ?? null],
  )) as { id: string }[];
  const viewer = { id: rows[0].id, email: `og${n}@example.com` };
  const set = await setHandle(viewer, name);
  if (!set.ok) throw new Error(`could not name ${name}: ${set.reason}`);
  return viewer;
}

const linkFace = (viewer: SocialViewer, on: boolean) => runSocialOp("link-face", { on }, { viewer, anonKey: "x" });

async function answer(kind: "profile" | "invite", key: string) {
  const response = await personalCardResponse(kind, key);
  return {
    status: response.status,
    headers: [...response.headers.entries()].sort(),
    bytes: Buffer.from(await response.arrayBuffer()).toString("base64"),
  };
}

function texts(node: ReactNode): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  return texts((node as ReactElement<{ children?: ReactNode }>).props?.children);
}

let kit: SocialViewer;
let quiet: SocialViewer;
let hidden: SocialViewer;
let merged: SocialViewer;
let survivor: SocialViewer;

beforeAll(async () => {
  // Opted in, with a face and a rank (Mooring Ring at 900 XP).
  kit = await person("harbour_kit", { avatar: "ring", xp: 900, code: "kaykaykt" });
  // A real name, switch left off (the default).
  quiet = await person("quiet_gull", { avatar: "cleat", xp: 40, code: "quaqqqqq" });
  // Opted in, then hid the profile.
  hidden = await person("hidden_heron", { avatar: "tidemark", code: "hddenhhh" });
  // Opted in, then merged away into another account.
  merged = await person("merged_seal", { avatar: "bollard", code: "mergedmm" });
  survivor = await person("survivor_sea", { avatar: "buoy" });
  for (const v of [kit, hidden, merged]) expect((await linkFace(v, true)).status).toBe(200);
  await setVisible(hidden, false);
  await sql.query(`update users set retired_into = $2 where id = $1`, [merged.id, survivor.id]);
}, 60_000);

describe("the switch", () => {
  it("is off by default and the owner's own to turn", async () => {
    const off = await runSocialOp("me", {}, { viewer: quiet, anonKey: "x" });
    expect((off.body as { linkFace: boolean }).linkFace).toBe(false);
    const on = await linkFace(quiet, true);
    expect((on.body as { linkFace: boolean }).linkFace).toBe(true);
    expect(await profilePerson("quiet_gull")).not.toBeNull();
    const back = await linkFace(quiet, false);
    expect((back.body as { linkFace: boolean }).linkFace).toBe(false);
    expect(await profilePerson("quiet_gull")).toBeNull();
    expect((await linkFace(quiet, "yes" as unknown as boolean)).status).toBe(400);
  });
});

describe("who a profile card names", () => {
  it("only an owner who opted in, as stored in the database", async () => {
    expect(await profilePerson("harbour_kit")).toEqual({ handle: "harbour_kit", face: "otter", level: 5, rank: "Mooring Ring" });
    // The URL's own spelling never reaches the card: the stored name does.
    expect((await profilePerson("HARBOUR_KIT"))?.handle).toBe("harbour_kit");
    expect((await profilePerson("@harbour_kit"))?.handle).toBe("harbour_kit");
  });

  it("nobody for the switch off, hidden, merged away, unknown or malformed", async () => {
    for (const name of ["quiet_gull", "hidden_heron", "merged_seal", "no_such_name", "harbour_kit is a scam", "<b>buy</b>", ""]) {
      expect(await profilePerson(name)).toBeNull();
    }
  });
});

describe("the profile card's answer", () => {
  it("is the anonymous card, same bytes and headers, for every name it may not draw", async () => {
    const reference = await answer("profile", "no_such_name");
    expect(reference.status).toBe(200);
    expect(reference.bytes).toBe(Buffer.from(await (await ogImage("profile")).arrayBuffer()).toString("base64"));
    for (const name of ["quiet_gull", "hidden_heron", "merged_seal", "Free%20money%20at%20example.com", "x".repeat(300)]) {
      expect(await answer("profile", name)).toEqual(reference);
    }
  }, 60_000);

  it("draws an opted in owner with a short edge cache and the same header names", async () => {
    const reference = await answer("profile", "no_such_name");
    const kitCard = await answer("profile", "harbour_kit");
    expect(kitCard.bytes).not.toBe(reference.bytes);
    expect(kitCard.headers).toEqual(reference.headers);
    const cache = new Map(kitCard.headers).get("cache-control");
    expect(cache).toBe("public, max-age=0, s-maxage=300, stale-while-revalidate=300");
    // The caller's country plays no part: no Vary on it.
    expect(new Map(kitCard.headers).has("vary")).toBe(false);
  }, 60_000);

  it("draws only the username, the rank name and the card's own words: no digits, no money", async () => {
    const owner = (await profilePerson("harbour_kit"))!;
    const drawn = texts(await ogPersonalElement("profile", owner));
    const allowed = new Set([COPY.og.profileOwner.eyebrow, "harbour_kit", COPY.og.profileOwner.line("Mooring Ring"), COPY.og.domain]);
    for (const text of drawn) expect(allowed).toContain(text);
    expect(drawn).toContain("harbour_kit");
    expect(drawn.join(" ")).not.toMatch(/\d|\$|usd|balance|holding|return|xp|@/i);
  });
});

describe("the invite card", () => {
  it("names the inviter by the code they were minted, as stored", async () => {
    // One switch covers both cards: with it off, an invite names nobody.
    expect(await invitePerson("quaqqqqq")).toBeNull();
    await linkFace(quiet, true);
    expect((await invitePerson("quaqqqqq"))?.handle).toBe("quiet_gull");
    await linkFace(quiet, false);
    expect((await invitePerson(" KAYKAYKT "))?.handle).toBe("harbour_kit");
  });

  it("names nobody for a hidden inviter, a merged away code, or a code nobody holds", async () => {
    for (const code of ["hddenhhh", "mergedmm", "zzzzzzzz", "harbour_kit", "kaykayk"]) expect(await invitePerson(code)).toBeNull();
  });

  it("is the anonymous invite card, same bytes and headers, wherever it names nobody", async () => {
    const reference = await answer("invite", "zzzzzzzz");
    expect(reference.bytes).toBe(Buffer.from(await (await ogImage("invite")).arrayBuffer()).toString("base64"));
    for (const code of ["quaqqqqq", "hddenhhh", "mergedmm", "not a code at all"]) expect(await answer("invite", code)).toEqual(reference);
    expect((await answer("invite", "kaykaykt")).bytes).not.toBe(reference.bytes);
  }, 60_000);

  it("draws only the inviter's username beside the invite's own words", async () => {
    const inviter = (await invitePerson("kaykaykt"))!;
    const drawn = texts(await ogPersonalElement("invite", inviter));
    expect(drawn).toContain(COPY.og.inviteFrom.eyebrow("harbour_kit"));
    expect(drawn).toContain("harbour_kit invited you");
    const allowed = new Set([COPY.og.inviteFrom.eyebrow("harbour_kit"), COPY.og.invite.title, COPY.og.invite.line, COPY.og.domain]);
    for (const text of drawn) expect(allowed).toContain(text);
    // No rank, no XP, no other name.
    expect(drawn.join(" ")).not.toMatch(/Mooring|quiet_gull|\$|balance/i);
  });
});

describe("the pages' own metadata", () => {
  const profile = (username: string) => profileMetadata({ params: Promise.resolve({ username }) });
  const invite = (code: string) => inviteMetadata({ params: Promise.resolve({ code }) });

  it("is the same for a name that does not exist and one whose owner did not opt in", async () => {
    const reference = await profile("no_such_name");
    for (const name of ["quiet_gull", "hidden_heron", "merged_seal"]) expect(await profile(name)).toEqual(reference);
    expect(JSON.stringify(reference)).toContain("/u/opengraph-image?v=");
  });

  it("names an opted in owner's picture by the stored name, versioned", async () => {
    const meta = JSON.stringify(await profile("HARBOUR_KIT"));
    expect(meta).toMatch(/\/og\/u\/harbour_kit\?v=[0-9a-f]{12}/);
    expect(meta).not.toContain("HARBOUR_KIT");
  });

  it("gives an invite the inviter's picture only where the card may name them", async () => {
    const reference = await invite("zzzzzzzz");
    for (const code of ["quaqqqqq", "hddenhhh", "mergedmm"]) expect(await invite(code)).toEqual(reference);
    expect(JSON.stringify(await invite("kaykaykt"))).toMatch(/\/og\/r\/kaykaykt\?v=[0-9a-f]{12}/);
  });
});
