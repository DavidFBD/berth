"use client";

import { Suspense } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { Panel } from "@/components/ui/panel";
import { useCopy } from "@/components/settings-provider";
import { NamePickerView, type PickerStatus } from "@/components/social/name-picker";
import { NotFoundCard, ProfileCardView, SignInCard } from "@/components/social/profile-card";
import { BoardView } from "@/components/social/friends-board";
import { SocialSection, type SocialDemo } from "@/components/social/social-section";
import { FindFriend } from "@/components/social/find-friend";
import type { CardAnswer, FriendsBoard, Relation, Viewer } from "@/lib/social-types";

/**
 * Dev-only gallery of the social screens, from fixtures (404 in prod). No
 * request leaves the page; buttons do nothing.
 *
 *   /dev/social?state=profile-friends    a friend's profile
 *   /dev/social?state=profile-received   a request waiting for you
 *   /dev/social?state=profile-none       someone you are not friends with
 *   /dev/social?state=profile-sent       your request, not yet answered
 *   /dev/social?state=profile-signedout  a visitor, for any name
 *   /dev/social?state=profile-noemail    a wallet account without an email
 *   /dev/social?state=profile-self       your own profile
 *   /dev/social?state=not-found          missing, hidden and blocked alike
 *   /dev/social?state=picker             the username picker, a free name
 *   /dev/social?state=picker-taken       the picker, a taken name
 *   /dev/social?state=section            the drawer section, friends open
 *   /dev/social?state=section-new        the drawer section before a pick
 *   /dev/social?state=section-noemail    the drawer section without an email
 *   /dev/social?state=board              the friends board
 *   /dev/social?state=find               Find a friend, before a lookup
 *   /dev/social?state=find-found         Find a friend, a card found
 *   /dev/social?state=find-missing       Find a friend, missing, hidden and blocked alike
 *   /dev/social?state=section-find       the drawer section, a card found
 */

const CARD = { handle: "mira_k", avatarId: "lantern", xp: 1240, memberSince: "2026-07", salutes: 14 };

const viewer = (relation: Relation, extra: Partial<Viewer> = {}): Viewer => ({
  relation,
  saluted: relation === "friends",
  hasEmail: true,
  hasHandle: true,
  ...extra,
});

const PROFILES: Record<string, CardAnswer> = {
  "profile-friends": { found: true, card: CARD, viewer: viewer("friends") },
  "profile-received": { found: true, card: CARD, viewer: viewer("received") },
  "profile-none": { found: true, card: CARD, viewer: viewer("none") },
  "profile-sent": { found: true, card: CARD, viewer: viewer("sent") },
  "profile-noemail": { found: true, card: CARD, viewer: viewer("none", { hasEmail: false, hasHandle: false }) },
  "profile-self": { found: true, card: { ...CARD, handle: "old_salt", avatarId: null, xp: 180, salutes: 2 }, viewer: viewer("self") },
};

const PEOPLE = [
  { handle: "juno", avatarId: "compass", xp: 2600 },
  { handle: "old_salt", avatarId: null, xp: 180 },
  { handle: "harbour_kit", avatarId: "buoy", xp: 640 },
];

const SECTION: SocialDemo = {
  me: { hasEmail: true, handle: "mira_k", visible: true, linkFace: false, nextChangeAt: null, requests: 1 },
  friends: { friends: PEOPLE.slice(0, 2), incoming: [PEOPLE[2]], outgoing: [{ handle: "tidewater", avatarId: "rope", xp: 90 }] },
  blocked: [],
  token: "abcdefghjkmn",
  open: "friends",
};

const BOARD: FriendsBoard = {
  month: "2026-09",
  rows: [
    { handle: "juno", avatarId: "compass", xp: 2600, you: false, place: 1, points: 560, orderXp: 300, referralXp: 250, otherXp: 0, salutePoints: 10 },
    { handle: "mira_k", avatarId: "lantern", xp: 1240, you: true, place: 2, points: 410, orderXp: 300, referralXp: 0, otherXp: 100, salutePoints: 10 },
    { handle: "harbour_kit", avatarId: "buoy", xp: 640, you: false, place: 3, points: 150, orderXp: 0, referralXp: 0, otherXp: 150, salutePoints: 0 },
    { handle: "old_salt", avatarId: null, xp: 180, you: false, place: 4, points: 3, orderXp: 0, referralXp: 0, otherXp: 0, salutePoints: 3 },
  ],
};

const NOOP = { onSalute: () => {}, onFriend: () => {}, onBlock: () => {}, onReport: () => {} };

export default function SocialGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-4 py-6">
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    </div>
  );
}

function Picker({ value, status }: { value: string; status: PickerStatus }) {
  const copy = useCopy().social;
  return (
    <Panel className="px-3 py-3">
      <NamePickerView value={value} onChange={() => {}} status={status} onSave={() => {}} saving={false} title={{ title: copy.pickTitle, sub: copy.pickSub }} />
    </Panel>
  );
}

function Gallery() {
  const state = useSearchParams().get("state") ?? "profile-friends";
  const profile = PROFILES[state];
  if (profile?.found) return <ProfileCardView answer={profile} handlers={NOOP} />;
  if (state === "not-found") return <NotFoundCard />;
  if (state === "profile-signedout") return <SignInCard />;
  if (state === "picker") return <Picker value="mira_k" status={{ kind: "free" }} />;
  if (state === "picker-taken") return <Picker value="Harbour" status={{ kind: "refused", reason: "taken" }} />;
  if (state === "board") return <BoardView board={BOARD} />;
  if (state === "find" || state === "find-found" || state === "find-missing")
    return (
      <Panel className="px-4 py-4">
        <FindFriend
          key={state}
          demo={
            state === "find"
              ? { value: "", result: null }
              : state === "find-found"
                ? { value: "mira_k", result: { kind: "answer", answer: PROFILES["profile-none"] } }
                : { value: "someone_else", result: { kind: "answer", answer: { found: false } } }
          }
        />
      </Panel>
    );
  if (state === "section-find")
    return (
      <Panel>
        <SocialSection demo={{ ...SECTION, find: { value: "mira_k", result: { kind: "answer", answer: PROFILES["profile-none"] } } }} />
      </Panel>
    );
  if (state === "section-new")
    return (
      <Panel>
        <SocialSection demo={{ me: { hasEmail: true, handle: null, visible: false, linkFace: false, nextChangeAt: null, requests: 0 } }} />
      </Panel>
    );
  if (state === "section-noemail")
    return (
      <Panel>
        <SocialSection demo={{ me: { hasEmail: false, handle: null, visible: false, linkFace: false, nextChangeAt: null, requests: 0 } }} />
      </Panel>
    );
  return (
    <Panel>
      <SocialSection demo={SECTION} />
    </Panel>
  );
}
