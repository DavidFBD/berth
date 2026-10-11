import { campaignCardResponse } from "@/lib/server/og-campaign";

/**
 * The link preview picture of a campaign link, /c/<code>: the campaign's
 * own amount while it is live, else the home card with no promise in it
 * (lib/server/og-campaign).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ code: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { code } = await params;
  return campaignCardResponse(code, new URL(request.url).searchParams);
}
