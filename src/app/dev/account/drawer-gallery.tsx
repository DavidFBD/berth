"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { AccountButton, EmailDrawerBody } from "@/components/account-button";
import { RECURRING_QUERY_KEY, type PlanView, type RecurringResponse } from "@/lib/recurring";
import type { Hold, Profile, ReferralPanel, XpHistoryEntry } from "@/lib/profile-types";
import type { FriendsList, MySocial } from "@/lib/social-types";
import type { EmailSettingsResponse } from "@/lib/email-kinds";
import { COPY } from "@/lib/copy";
import type { DrawerView } from "@/components/account-drawer-nav";

/**
 * Dev-only: the email account drawer, whole and open, from seeded data, so
 * its first screen can be reviewed (and shot) at each stage of a new
 * account without a real one.
 *
 *   /dev/account?drawer=new           just signed up on an invite: no avatar, no username
 *   /dev/account?drawer=mid           avatar chosen, no username yet
 *   /dev/account?drawer=named         avatar and username, no friends yet
 *   /dev/account?drawer=established   a rung up, friends, a request, a plan
 *   /dev/account?button=established   the real AccountButton over these fixtures (see below)
 *   &view=friends                     opened on one screen (any DrawerView)
 *
 * Every query the drawer reads is seeded under the signed-out identity (key
 * null), which is where a browser without a session looks; every act goes
 * nowhere much (the routes answer 401 without a session).
 */
export const DRAWER_SCENES = ["new", "mid", "named", "established"] as const;
export type DrawerScene = (typeof DRAWER_SCENES)[number];

const DEMO_ADDRESS = "0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be";
const DEMO_EMAIL = "gosia@example.com";
const DAY = 86_400_000;

const PLAN: PlanView = {
  id: "p1",
  symbol: "SPY",
  usd: 20,
  cadence: "weekly",
  weekday: 1,
  monthDay: null,
  timeZone: "Europe/Amsterdam",
  orderType: "market",
  dipPct: null,
  paused: false,
  nextDueAt: "2026-10-04T22:00:00.000Z",
  createdVia: "app",
  runs: [],
};

function seededClient(scene: DrawerScene): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const now = Date.now();
  const established = scene === "established";
  const profile: Profile = {
    xp: established ? 2550 : scene === "new" ? 25 : 50,
    avatarId: scene === "new" ? null : established ? "beacon" : "buoy",
    hasEmail: true,
    homeAddress: DEMO_ADDRESS,
    referralCode: established ? "harbrmkt" : null,
  };
  const history: XpHistoryEntry[] = [
    ...(scene !== "new" ? [{ kind: "avatar_set" as const, amount: 25, at: new Date(now - DAY).toISOString() }] : []),
    { kind: "account_created", amount: 25, at: new Date(now - 2 * DAY).toISOString() },
  ];
  const holds: Hold[] = [];
  const referral: ReferralPanel = {
    invitedBy: established
      ? null
      : { avatarId: "capstan", level: 4, firstPourPaid: false, friends: true, name: "harbourfan" },
    canClaim: false,
    stats: established
      ? { taps: 6, seated: 2, poured: 1, earnedXp: 250, steepingXp: 250 }
      : { taps: 0, seated: 0, poured: 0, earnedXp: 0, steepingXp: 0 },
  };
  const me: MySocial = {
    hasEmail: true,
    handle: scene === "named" ? "gosia" : established ? "harbourfan" : null,
    visible: true,
    linkFace: false,
    nextChangeAt: null,
    requests: established ? 1 : 0,
  };
  const friends: FriendsList = established
    ? {
        friends: [
          { handle: "marta", avatarId: "buoy", xp: 640 },
          { handle: "kees", avatarId: "capstan", xp: 3100 },
          { handle: "lotte", avatarId: null, xp: 80 },
        ],
        incoming: [{ handle: "pieter", avatarId: "bollard", xp: 120 }],
        outgoing: [],
      }
    : { friends: scene === "new" || scene === "mid" ? [] : [{ handle: "harbourfan", avatarId: "capstan", xp: 1400 }], incoming: [], outgoing: [] };
  const email: EmailSettingsResponse = {
    address: DEMO_EMAIL,
    deliverable: true,
    prefs: { orders: true, recurring: true, friends: true, weekly: false },
  };
  const recurring: RecurringResponse = { plans: established ? [PLAN] : [], ready: [], limitAllowed: true };
  client.setQueryData(["profile", null], profile);
  client.setQueryData(["xp-history", null], history);
  client.setQueryData(["xp-holds", null], holds);
  client.setQueryData(["referral-panel", null], referral);
  client.setQueryData(["social-me", null], me);
  client.setQueryData(["social-friends", null], friends);
  client.setQueryData(["social-link", null], "demotoken");
  client.setQueryData(["social-blocked", null], []);
  client.setQueryData(["email-settings", null], email);
  client.setQueryData(["account-wallets", null], {
    wallets: [{ address: DEMO_ADDRESS, family: "evm", isHome: true, linkedAt: new Date(now - 2 * DAY).toISOString(), embedded: true }],
    signedInWith: null,
  });
  client.setQueryData(["assistant-grants", null], []);
  client.setQueryData([...RECURRING_QUERY_KEY, null], recurring);
  return client;
}

function Seeded({ scene, children }: { scene: DrawerScene; children: ReactNode }) {
  const [client] = useState(() => seededClient(scene));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function DrawerGallery({ scene, view }: { scene: DrawerScene; view?: DrawerView }) {
  return (
    <Seeded scene={scene}>
      <Drawer open onOpenChange={() => {}}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{COPY.accountTotalLabel}</DrawerTitle>
            <DrawerDescription>{COPY.accountSignedInAs(DEMO_EMAIL)}</DrawerDescription>
          </DrawerHeader>
          <EmailDrawerBody
            address={DEMO_ADDRESS}
            mounted
            assistant={null}
            initialView={view}
            onLeave={() => {}}
            onOpenSettings={() => {}}
            onSignOut={() => {}}
          />
        </DrawerContent>
      </Drawer>
    </Seeded>
  );
}

/**
 * The real AccountButton, uncontrolled, over the same seeded data: signed
 * out of Privy on a dev page it is the wallet account's header (rank chip
 * and the wallet drawer), which is enough to drive the drawer's own way
 * back from a friend's profile, close it, and open it again.
 *
 *   /dev/account?button=established
 */
export function AccountButtonGallery({ scene }: { scene: DrawerScene }) {
  return (
    <Seeded scene={scene}>
      <div data-account-button className="flex items-center justify-end rounded-lg border border-border bg-card px-3 py-2">
        <AccountButton />
      </div>
    </Seeded>
  );
}
