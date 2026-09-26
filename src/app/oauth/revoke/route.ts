import { corsPreflight, jsonResponse, readForm } from "@/lib/server/oauth/http";
import { revokeToken } from "@/lib/server/oauth/tokens";

export const dynamic = "force-dynamic";

/** RFC 7009. Always 200, whatever was presented, so the answer says nothing about a token. */
export async function POST(request: Request): Promise<Response> {
  const form = await readForm(request);
  await revokeToken(form.token, form.client_id || null);
  return jsonResponse({});
}

export const OPTIONS = corsPreflight;
