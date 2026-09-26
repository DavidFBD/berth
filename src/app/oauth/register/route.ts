import { registerClient } from "@/lib/server/oauth/clients";
import { callerKey, corsPreflight, jsonResponse, oauthError } from "@/lib/server/oauth/http";

export const dynamic = "force-dynamic";

/**
 * RFC 7591 dynamic registration, public clients only. The answer echoes
 * what was registered; there is no secret to return.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return oauthError("invalid_client_metadata", "a JSON object is required");
  }
  const result = await registerClient(body, callerKey(request));
  if (!result.ok) {
    return result.error === "rate_limited"
      ? oauthError("invalid_request", result.description, 429)
      : oauthError(result.error, result.description);
  }
  const { client } = result;
  return jsonResponse(
    {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: client.name ?? undefined,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
}

export const OPTIONS = corsPreflight;
