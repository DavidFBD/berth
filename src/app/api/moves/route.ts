import { loadMoves } from "@/lib/server/moves";

export type { MoveNews, MovesResponse } from "@/lib/server/moves";

/**
 * Large moves and the news around them (lib/server/moves). Public: it says
 * nothing about anyone's account, only about the listings, and every input
 * behind it is already cached.
 */
export async function GET(): Promise<Response> {
  try {
    return Response.json(await loadMoves());
  } catch (error) {
    console.warn("[moves]", error instanceof Error ? error.message : error);
    return Response.json({ moves: [] });
  }
}
