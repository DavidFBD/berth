"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CaretLeft } from "@phosphor-icons/react";
import { BerthMark } from "@/components/berth-mark";
import { useCopy } from "@/components/settings-provider";
import { DRAWER_RETURN_KEY, FROM_DRAWER_PARAM, backMode, readMark } from "@/lib/drawer-return";

/**
 * The top of a page the account drawer can open (a profile, the friends
 * board). Opened from the drawer in this tab: "Back", to the drawer open on
 * the screen it left, where its scroll stood (browser back does the same).
 * Opened any other way (a shared link, a copied address, a new tab): the
 * usual way home, "Back to Berth". Decided after mount, from the address
 * and this tab's mark (lib/drawer-return).
 */
export function WayBack() {
  const copy = useCopy();
  const router = useRouter();
  const [toDrawer, setToDrawer] = useState(false);
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(DRAWER_RETURN_KEY);
    } catch {
      // Storage refused: the usual way home.
    }
    const mode = backMode({
      from: new URLSearchParams(window.location.search).get(FROM_DRAWER_PARAM),
      mark: readMark(raw, Date.now()),
      path: window.location.pathname,
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address and the tab's storage are only readable after mount
    setToDrawer(mode === "drawer");
  }, []);

  if (toDrawer) {
    return (
      <button
        type="button"
        // The entry before this one is the home the drawer marked as it left.
        onClick={() => router.back()}
        className="-ml-2 flex min-h-10 items-center gap-1 self-start rounded-full px-2 text-sm text-muted-foreground transition-colors duration-150 ease-lift hover:bg-muted/60 hover:text-foreground"
      >
        <CaretLeft className="size-4" aria-hidden />
        {copy.drawer.profileBack}
      </button>
    );
  }
  return (
    <Link href="/" className="flex items-center gap-2 self-start text-sm text-muted-foreground hover:text-foreground">
      <BerthMark className="size-6" title="Berth" />
      {copy.social.back}
    </Link>
  );
}
