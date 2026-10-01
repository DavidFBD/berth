import type { CardAnswer, FriendAction } from "@/lib/social-types";
import { isReportReason, listBlocked, report, setBlock } from "@/lib/server/social/blocks";
import { friendsBoard } from "@/lib/server/social/board";
import { NOT_FOUND, readCard, SIGN_IN } from "@/lib/server/social/cards";
import { friendAction, friendLink, listFriends, readLinkCard } from "@/lib/server/social/friends";
import { checkHandle, mySocial, setHandle, setLinkFace, setVisible } from "@/lib/server/social/handles";
import { takeSocialPlace, type SocialBucket } from "@/lib/server/social/limits";
import { hasVerifiedEmail, type SocialViewer } from "@/lib/server/social/people";
import { setSalute } from "@/lib/server/social/salutes";

/**
 * Every social request, by name: the one table app/api/social/[op] routes
 * into, so the route owns only HTTP and auth and this module owns what each
 * operation may do. `viewer` is the account the rewards prologue resolved,
 * or null for a signed out visitor, who is only ever told to sign in.
 * `anonKey` stands for a signed out caller (a hash of the address).
 *
 * Every write and every lookup takes a rate limit place first.
 */

export type SocialOpResult = { status: number; body: unknown };

const FRIEND_ACTIONS: readonly FriendAction[] = ["request", "cancel", "accept", "decline", "remove"];

/** The operations a signed out visitor may call. */
export const PUBLIC_OPS = new Set(["card", "link-card"]);

const ok = (body: unknown): SocialOpResult => ({ status: 200, body });
const bad = (error: string): SocialOpResult => ({ status: 400, body: { error } });
const slow: SocialOpResult = { status: 429, body: { error: "rate limited" } };
const signedOut: SocialOpResult = { status: 401, body: { error: "sign in" } };

export async function runSocialOp(
  op: string,
  body: Record<string, unknown>,
  caller: { viewer: SocialViewer | null; anonKey: string },
): Promise<SocialOpResult> {
  const { viewer } = caller;
  const take = (bucket: SocialBucket) => takeSocialPlace(bucket, viewer ? viewer.id : `anon:${caller.anonKey}`);

  if (op === "card" || op === "link-card") {
    // Signed out, every name gets the same answer without a lookup.
    if (!viewer) return ok(SIGN_IN);
    if (op === "card") {
      // A name typed into a URL is a lookup like Find: verified email only,
      // and one 30 an hour budget for both, so guessing names is limited
      // wherever it is tried. Without an email every name gets the one
      // fixed answer, with no lookup.
      if (!hasVerifiedEmail(viewer)) return ok(NOT_FOUND);
      if (!(await take("find"))) return slow;
      return ok(await readCard(viewer, body.handle));
    }
    if (!(await take("card"))) return slow;
    const answer: CardAnswer = await readLinkCard(viewer, body.token);
    return ok(answer);
  }

  if (!viewer) return signedOut;

  switch (op) {
    case "me":
      return ok(await mySocial(viewer));
    case "find": {
      // Exact name only, verified email only, 30 an hour. The answer is the
      // card's own: missing, hidden, blocked and blocking are one NOT_FOUND.
      // The email gate reads the viewer alone, so it says nothing of the name.
      if (!hasVerifiedEmail(viewer)) return { status: 403, body: { error: "email" } };
      if (!(await take("find"))) return slow;
      return ok(await readCard(viewer, body.handle));
    }
    case "check":
      if (!(await take("check"))) return slow;
      return ok(await checkHandle(viewer, body.handle));
    case "name": {
      if (!(await take("name"))) return slow;
      const result = await setHandle(viewer, body.handle);
      return result.ok ? ok(result.social) : { status: 422, body: result };
    }
    case "visibility": {
      if (typeof body.visible !== "boolean") return bad("visible");
      if (!(await take("settings"))) return slow;
      const social = await setVisible(viewer, body.visible);
      return social ? ok(social) : bad("no username");
    }
    case "link-face": {
      if (typeof body.on !== "boolean") return bad("on");
      if (!(await take("settings"))) return slow;
      const social = await setLinkFace(viewer, body.on);
      return social ? ok(social) : bad("no username");
    }
    case "salute": {
      if (typeof body.on !== "boolean") return bad("on");
      if (!(await take("salute"))) return slow;
      return ok(await setSalute(viewer, body.handle, body.on));
    }
    case "friend": {
      const action = body.action as FriendAction;
      if (!FRIEND_ACTIONS.includes(action)) return bad("action");
      if (!(await take(action === "request" ? "request" : "friend"))) return slow;
      return ok(await friendAction(viewer, action, { handle: body.handle, token: body.token }));
    }
    case "friends":
      return ok(await listFriends(viewer));
    case "link": {
      if (body.fresh === true && !(await take("settings"))) return slow;
      const token = await friendLink(viewer, body.fresh === true);
      return token ? ok({ token }) : bad("no username");
    }
    case "block": {
      if (typeof body.on !== "boolean") return bad("on");
      if (!(await take("block"))) return slow;
      await setBlock(viewer, body.handle, body.on);
      return ok({ ok: true });
    }
    case "blocked":
      return ok({ blocked: await listBlocked(viewer) });
    case "report": {
      if (!isReportReason(body.reason)) return bad("reason");
      if (!(await take("report"))) return slow;
      await report(viewer, body.handle, body.reason);
      return ok({ ok: true });
    }
    case "board":
      return ok(await friendsBoard(viewer));
    default:
      return { status: 404, body: { error: "unknown" } };
  }
}
