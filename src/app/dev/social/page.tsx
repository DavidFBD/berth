"use client";

import { Suspense } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { Panel } from "@/components/ui/panel";
import { useCopy } from "@/components/settings-provider";
import { NamePickerView, type PickerStatus } from "@/components/social/name-picker";
import { NotFoundCard, ProfileCardView, SignInCard } from "@/components/social/profile-card";
import { ProfileExtras } from "@/components/social/profile-extras";
import { BoardView } from "@/components/social/friends-board";
import { SocialSection, type SocialDemo } from "@/components/social/social-section";
import { FindFriend } from "@/components/social/find-friend";
import type { CardAnswer, FriendsBoard, ProfileMore, Relation, Viewer } from "@/lib/social-types";
import { PolicyNoticeLineView, SocialNoticeLineView } from "@/components/board/social-notice-line";
import { TermsSheet } from "@/components/terms-sheet";
import { FRIENDS_HOLDING_FIXTURE } from "../board/social-proof-fixtures";

/**
 * Dev-only gallery of the social screens, from fixtures (404 in prod). No
 * request leaves the page; buttons do nothing.
 *
 *   /dev/social?state=profile-friends    a friend's profile, with the page's sections under the card
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
 *   /dev/social?state=section-all        Turn on all friend features, unclaimed, Details open
 *   /dev/social?state=section-all-claimed  the same offer after the bonus was paid, some on
 *   /dev/social?state=section-all-on     every friend feature on: the switches alone
 *   /dev/social?state=section-new        the drawer section before a pick
 *   /dev/social?state=section-noemail    the drawer section without an email
 *   /dev/social?state=board              the friends board
 *   /dev/social?state=find               Find a friend, before a lookup
 *   /dev/social?state=find-found         Find a friend, a card found
 *   /dev/social?state=find-missing       Find a friend, missing, hidden and blocked alike
 *   /dev/social?state=section-find       the drawer section, a card found
 *   /dev/social?state=profile-holds      a friend's profile, both sharing what they hold
 *   /dev/social?state=section-holding    the drawer section, sharing on, Your friends hold open
 *   /dev/social?state=section-holding-off  the same, sharing off (the default)
 *   /dev/social?state=section-switches   the drawer section folded, nobody blocked, nothing held: no empty folds
 *   /dev/social?state=section-details    the same, the week switch's Details open
 *   /dev/social?state=section-full       sharing on, friends holding and two blocked: both folds offered
 *   /dev/social?state=notice             the once per account notice strip
 *   /dev/social?state=policy-notice      the once per account notice of the new terms and policy
 *   /dev/social?state=terms-sheet        the terms sheet before a buy (terms-sheet-sell: before a sell; terms-sheet-pending: while the answer loads)
 *   /dev/social?state=profile-received-sharing  Accept on a card while the viewer shares what they hold
 */

const CARD = { handle: "mira_k", avatarId: "lantern", xp: 1240, memberSince: "2026-07", salutes: 14 };

const viewer = (relation: Relation, extra: Partial<Viewer> = {}): Viewer => ({
  relation,
  saluted: relation === "friends",
  hasEmail: true,
  hasHandle: true,
  ...extra,
});

/** The profile page's extras (CardAnswer.more), as a friend's page would carry them. */
const MORE_FRIENDS: ProfileMore = {
  yourXp: 1120,
  moments: [
    { kind: "rank", level: 5, on: "2026-10-03" },
    { kind: "salute", from: "them", on: "2026-10-02" },
    { kind: "rank", level: 4, on: "2026-09-21" },
    { kind: "friends", on: "2026-09-14" },
    { kind: "joined", month: "2026-07" },
  ],
  friendsSince: "2026-09-14",
  salutesBetween: 2,
  mutual: {
    faces: [
      { handle: "juno", avatarId: "compass", level: 7 },
      { handle: "harbour_kit", avatarId: "buoy", level: 4 },
      { handle: "old_salt", avatarId: null, level: 2 },
      { handle: "tidewater", avatarId: "rope", level: 1 },
    ],
    more: 2,
  },
};
/** Both share what they hold: "You both hold" joins In common. */
const MORE_FRIENDS_HOLDS: ProfileMore = { ...MORE_FRIENDS, bothHold: ["NVDA", "AAPL"] };
/** A stranger's page: only the viewer's own XP, for the ladder's comparison line. */
const MORE_STRANGER: ProfileMore = { yourXp: 1360 };
const MORE_SELF: ProfileMore = { moments: [{ kind: "rank", level: 2, on: "2026-09-12" }, { kind: "joined", month: "2026-07" }] };

const PROFILES: Record<string, CardAnswer> = {
  "profile-friends": { found: true, card: CARD, viewer: viewer("friends"), more: MORE_FRIENDS },
  "profile-holds": { found: true, card: CARD, viewer: viewer("friends"), holds: ["NVDA", "AAPL", "QQQ"], more: MORE_FRIENDS_HOLDS },
  "profile-received": { found: true, card: CARD, viewer: viewer("received"), more: MORE_STRANGER },
  "profile-received-sharing": { found: true, card: CARD, viewer: viewer("received", { sharesHoldings: true }), more: MORE_STRANGER },
  "profile-none": { found: true, card: CARD, viewer: viewer("none"), more: MORE_STRANGER },
  "profile-sent": { found: true, card: CARD, viewer: viewer("sent"), more: MORE_STRANGER },
  "profile-noemail": { found: true, card: CARD, viewer: viewer("none", { hasEmail: false, hasHandle: false }), more: MORE_STRANGER },
  "profile-self": { found: true, card: { ...CARD, handle: "old_salt", avatarId: null, xp: 180, salutes: 2 }, viewer: viewer("self"), more: MORE_SELF },
};

/** Find a friend shows the plain card: the extras are the page's alone. */
const plain = (answer: CardAnswer): CardAnswer => (answer.found ? { ...answer, more: undefined } : answer);

const PEOPLE = [
  { handle: "juno", avatarId: "compass", xp: 2600 },
  { handle: "old_salt", avatarId: null, xp: 180 },
  { handle: "harbour_kit", avatarId: "buoy", xp: 640 },
];

const SECTION: SocialDemo = {
  me: { hasEmail: true, handle: "mira_k", visible: true, linkFace: false, shareHoldings: false, shareWeek: false, nextChangeAt: null, requests: 1 },
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
  if (profile?.found)
    return (
      <>
        <ProfileCardView answer={profile} handlers={NOOP} />
        <ProfileExtras answer={profile} />
      </>
    );
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
                ? { value: "mira_k", result: { kind: "answer", answer: plain(PROFILES["profile-none"]) } }
                : { value: "someone_else", result: { kind: "answer", answer: { found: false } } }
          }
        />
      </Panel>
    );
  if (state === "notice") return <SocialNoticeLineView show onOpen={() => {}} onDismiss={() => {}} />;
  if (state === "policy-notice") return <PolicyNoticeLineView show onDismiss={() => {}} />;
  if (state === "terms-sheet" || state === "terms-sheet-sell" || state === "terms-sheet-pending")
    return (
      <TermsSheet open purpose={state === "terms-sheet-sell" ? "sell" : "buy"} pending={state === "terms-sheet-pending"} onAccept={async () => true} onLeave={() => {}} />
    );
  if (state === "section-holding" || state === "section-holding-off")
    return (
      <Panel>
        <SocialSection
          demo={{
            ...SECTION,
            me: { ...SECTION.me, shareHoldings: state === "section-holding" },
            open: "holding",
            holding: FRIENDS_HOLDING_FIXTURE,
          }}
        />
      </Panel>
    );
  if (state === "section-switches" || state === "section-details" || state === "section-full")
    return (
      <Panel>
        <SocialSection
          demo={{
            ...SECTION,
            open: undefined,
            friends: { ...SECTION.friends!, incoming: [] },
            ...(state === "section-details" ? { details: "shareWeek" as const } : {}),
            ...(state === "section-full"
              ? {
                  me: { ...SECTION.me, shareHoldings: true, requests: 0 },
                  holding: FRIENDS_HOLDING_FIXTURE,
                  blocked: [{ handle: "loud_gull" }, { handle: "spam_ship" }],
                }
              : {}),
          }}
        />
      </Panel>
    );
  if (state === "section-all" || state === "section-all-claimed" || state === "section-all-on")
    return (
      <Panel>
        <SocialSection
          demo={{
            ...SECTION,
            open: undefined,
            friends: { ...SECTION.friends!, incoming: [] },
            me: {
              ...SECTION.me,
              requests: 0,
              ...(state === "section-all-claimed" ? { friendsAllClaimed: true, linkFace: true } : {}),
              ...(state === "section-all-on" ? { friendsAllClaimed: true, linkFace: true, shareHoldings: true, shareWeek: true } : {}),
            },
            allDetails: state === "section-all",
          }}
        />
      </Panel>
    );
  if (state === "section-find")
    return (
      <Panel>
        <SocialSection demo={{ ...SECTION, find: { value: "mira_k", result: { kind: "answer", answer: plain(PROFILES["profile-none"]) } } }} />
      </Panel>
    );
  if (state === "section-new")
    return (
      <Panel>
        <SocialSection demo={{ me: { hasEmail: true, handle: null, visible: false, linkFace: false, shareHoldings: false, shareWeek: false, nextChangeAt: null, requests: 0 } }} />
      </Panel>
    );
  if (state === "section-noemail")
    return (
      <Panel>
        <SocialSection demo={{ me: { hasEmail: false, handle: null, visible: false, linkFace: false, shareHoldings: false, shareWeek: false, nextChangeAt: null, requests: 0 } }} />
      </Panel>
    );
  return (
    <Panel>
      <SocialSection demo={SECTION} />
    </Panel>
  );
}
