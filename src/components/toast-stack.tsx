"use client";

import { useEffect } from "react";
import { toast as sonner, type ExternalToast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { toast, toastQueue } from "@/lib/toast";
import { MAX_VISIBLE, type ToastEntry, type ToastSink } from "@/lib/toast-queue";
import { rankForXp, levelUpRank, REWARD_REASONS } from "@/lib/xp";
import { LevelUpCard, XpLine, XpPill } from "@/components/xp-toast";

/**
 * The one place toasts are drawn. lib/toast-queue decides what shows; this
 * hands each decision to sonner, laid out open (`expand`) so two toasts sit
 * one above the other with a gap instead of folding under each other, and
 * reports back when sonner closes one so the next in line can show.
 *
 * Bottom of the screen, above the phone's Ask dock while it shows (the dock
 * publishes its height as --ask-dock-clearance) and above the home
 * indicator otherwise. Sonner's region is aria-live polite, and only what
 * the queue lets through is ever in it, so each toast is announced once,
 * when it shows, not while it waits.
 */

// The analytics consent card (components/analytics/consent-card), while it
// shows, publishes its height as --consent-clearance; toasts rise above it.
const BOTTOM = "calc(max(var(--ask-dock-clearance, 0px), env(safe-area-inset-bottom)) + 16px + var(--consent-clearance, 0px))";

function render(entry: ToastEntry) {
  const { id, content, revision } = entry;
  const options: ExternalToast = {
    id,
    // Sonner restarts a toast's clock only when its duration changes; the
    // revision nudges it by a millisecond so a merge gives the toast its
    // full time again.
    duration: entry.duration + revision,
    onDismiss: () => toastQueue.close(id),
    onAutoClose: () => toastQueue.close(id),
  };
  if (content.kind === "xp") {
    sonner.custom(() => <Centered><XpPill rewards={content.rewards} /></Centered>, options);
    return;
  }
  if (content.kind === "levelup") {
    const total = content.rewards.reduce((sum, reward) => sum + reward.amount, 0);
    const reached = levelUpRank(content.newXp - total, content.newXp) ?? rankForXp(content.newXp);
    const reason = content.rewards.length === 1 ? REWARD_REASONS[content.rewards[0].kind] : null;
    sonner.custom(
      () => (
        <Centered>
          <LevelUpCard rank={reached} fromLevel={rankForXp(content.newXp - total).level} total={total} reason={reason} />
        </Centered>
      ),
      options,
    );
    return;
  }
  const description =
    content.rewards?.length ? (
      <span className="flex flex-col">
        {content.description && <span>{content.description}</span>}
        <XpLine rewards={content.rewards} />
      </span>
    ) : (
      content.description
    );
  const full: ExternalToast = {
    ...options,
    description,
    action: content.action,
  };
  if (content.tone === "success") sonner.success(content.title, full);
  else if (content.tone === "error") sonner.error(content.title, full);
  else if (content.tone === "info") sonner.info(content.title, full);
  else sonner(content.title, full);
}

/** A pill or card is narrower than a message: centred on a phone, right-aligned beside the messages on a wide screen. */
function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex w-full justify-center min-[601px]:justify-end">{children}</div>;
}

const sink: ToastSink = {
  show: render,
  update: render,
  hide: (id) => sonner.dismiss(id),
};

export function ToastStack() {
  useEffect(() => {
    toastQueue.attach(sink);
    // Dev only: headless smoke tests fire toasts via window.toast (no toast
    // is reachable pre-auth). Compiled out of production builds.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { toast: typeof toast }).toast = toast;
    }
    return () => toastQueue.attach(null);
  }, []);
  // data-ph-mask: toasts name amounts and friends; a replay shows them masked (lib/analytics).
  return (
    <div data-ph-mask className="contents">
      <Toaster
        expand
        visibleToasts={MAX_VISIBLE}
        gap={10}
        offset={{ bottom: BOTTOM, right: 24 }}
        mobileOffset={{ bottom: BOTTOM, left: 16, right: 16 }}
      />
    </div>
  );
}
