import { personalCardResponse } from "@/lib/server/og-people";

/**
 * The link preview picture of an invite, /r/<code> and /?ref=<code>: the
 * inviter's face and username beside the empty seat when the code is theirs
 * and their profile is on, else the anonymous invite card, byte for byte
 * (lib/server/og-people).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ code: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { code } = await params;
  return personalCardResponse("invite", code, new URL(request.url).searchParams.get("v"));
}
