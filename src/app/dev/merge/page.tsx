"use client";

import { Suspense } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { Panel } from "@/components/ui/panel";
import { MergeCardView } from "@/components/account-merge";
import type { MergeStep } from "@/lib/account-merge-client";

/**
 * Dev-only gallery of the account merge steps, from fixtures (404 in
 * prod). No request leaves the page; buttons do nothing.
 *
 *   /dev/merge?state=email          the email flow's confirm step
 *   /dev/merge?state=wallet-this    a wallet on another account, this one stays
 *   /dev/merge?state=wallet-other   a wallet on another account, that one stays
 *   /dev/merge?state=working        while the merge runs
 *   /dev/merge?state=changed        who would stay changed since the offer
 *   /dev/merge?state=expired        the offer or the code ran past ten minutes
 *   /dev/merge?state=done           the done state
 */

const TOGETHER = { xp: 1050, orders: 5 };

const STATES: Record<string, { kind: "email" | "wallet"; survivor: "this" | "other"; step: MergeStep }> = {
  email: { kind: "email", survivor: "other", step: "confirm" },
  "wallet-this": { kind: "wallet", survivor: "this", step: "confirm" },
  "wallet-other": { kind: "wallet", survivor: "other", step: "confirm" },
  working: { kind: "wallet", survivor: "this", step: "working" },
  changed: { kind: "wallet", survivor: "this", step: "changed" },
  expired: { kind: "email", survivor: "other", step: "expired" },
  done: { kind: "email", survivor: "other", step: "done" },
};

function Gallery() {
  const state = useSearchParams().get("state") ?? "email";
  const scene = STATES[state] ?? STATES.email;
  return (
    <Panel className="px-3 py-3">
      <MergeCardView {...scene} together={TOGETHER} xp={TOGETHER.xp} onConfirm={() => {}} onKeep={() => {}} onRestart={() => {}} />
    </Panel>
  );
}

export default function MergeGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-4 py-6">
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    </div>
  );
}
