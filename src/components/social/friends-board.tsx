"use client";

import Link from "next/link";
import { WayBack } from "@/components/social/way-back";
import { AvatarWithRank } from "@/components/rank-glyph";
import { Panel, SectionHeading } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy } from "@/components/settings-provider";
import { monthLabel } from "@/components/social/profile-card";
import { FindFriend } from "@/components/social/find-friend";
import { useFriendsBoard, useMySocial } from "@/hooks/use-social";
import { useCanProveAccount } from "@/hooks/use-profile";
import type { FriendsBoard } from "@/lib/social-types";
import { rankForXp } from "@/lib/xp";
import { cn } from "@/lib/utils";

/**
 * The friends board (ADR-0005): you and your friends this month, ranked on
 * board points, you always on it. Tap a row for the profile. How points
 * are counted sits behind the one (i); no row ever shows money.
 */
export function BoardView({ board }: { board: FriendsBoard }) {
  const copy = useCopy().social;
  const alone = board.rows.length <= 1;
  return (
    <Panel surface="sheet">
      <SectionHeading title={copy.boardMonth(monthLabel(board.month, "long"))} hint={copy.boardWhy} />
      <ol data-ph-block className="flex flex-col divide-y divide-border border-t border-border">
        {board.rows.map((row) => {
          const rank = rankForXp(row.xp);
          const body = (
            <>
              <span className="money w-6 shrink-0 text-center text-sm text-muted-foreground tabular-nums">{row.place}</span>
              <AvatarWithRank avatarId={row.avatarId} level={rank.level} size={36} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">
                  {row.handle || copy.boardYou}
                  {row.you && row.handle && <span className="font-normal text-muted-foreground">, {copy.boardYou.toLowerCase()}</span>}
                </span>
                <span className="text-xs text-muted-foreground">{rank.name}</span>
              </span>
              <span className="flex shrink-0 items-baseline gap-1">
                <span className="money text-sm text-foreground tabular-nums">{row.points.toLocaleString("en-US")}</span>
                <span className="text-xs text-muted-foreground">{copy.boardPointsUnit(row.points)}</span>
              </span>
            </>
          );
          return (
            <li key={row.handle || "you"} className={cn(row.you && "bg-muted/50")}>
              {row.handle ? (
                <Link href={`/u/${row.handle}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-muted/60">
                  {body}
                </Link>
              ) : (
                <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
      {alone && <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">{copy.boardEmpty}</p>}
    </Panel>
  );
}

export function FriendsBoardPage() {
  const copy = useCopy().social;
  const signedIn = useCanProveAccount();
  const me = useMySocial(signedIn);
  const board = useFriendsBoard(signedIn && Boolean(me.data?.handle));
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-4 pt-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
      <WayBack />
      {signedIn && me.data?.hasEmail && (
        <Panel surface="sheet" className="px-4 py-4">
          <FindFriend />
        </Panel>
      )}
      {!signedIn ? (
        <p className="text-sm text-muted-foreground">{copy.boardSignedOut}</p>
      ) : me.data && !me.data.handle ? (
        <p className="text-sm text-muted-foreground">{copy.boardNoHandle}</p>
      ) : board.data ? (
        <BoardView board={board.data} />
      ) : (
        <Skeleton className="h-72 w-full rounded-2xl" />
      )}
    </main>
  );
}
