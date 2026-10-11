import { personalCardResponse } from "@/lib/server/og-people";

/**
 * The link preview picture of /u/<username>: the owner's face, username
 * and rank only if they turned that on, else the anonymous profile card,
 * byte for byte, for every other name, real or not (lib/server/og-people).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ username: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { username } = await params;
  return personalCardResponse("profile", username, new URL(request.url).searchParams.get("v"));
}
