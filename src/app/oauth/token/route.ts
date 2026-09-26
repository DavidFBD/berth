import { getClient } from "@/lib/server/oauth/clients";
import { resourceFor } from "@/lib/server/oauth/config";
import { corsPreflight, jsonResponse, oauthError, originOf, readForm } from "@/lib/server/oauth/http";
import { exchangeCode, refreshTokens, type TokenResult } from "@/lib/server/oauth/tokens";

export const dynamic = "force-dynamic";

/**
 * The public client's client_id: from the body, or from HTTP Basic with an
 * empty secret, which some clients send even when registered as public.
 */
function clientIdOf(request: Request, form: Record<string, string>): string | null {
  const basic = request.headers.get("authorization");
  if (basic?.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(basic.slice(6).trim(), "base64").toString("utf8");
      const id = decodeURIComponent(decoded.split(":")[0] ?? "");
      if (id) return id;
    } catch {
      // Fall through to the body.
    }
  }
  return form.client_id || null;
}

/** RFC 6749 token endpoint: authorization_code (PKCE) and refresh_token (rotated). */
export async function POST(request: Request): Promise<Response> {
  const form = await readForm(request);
  const origin = originOf(request);
  const expectedResource = resourceFor(origin);
  const clientId = clientIdOf(request, form);

  // The redirect was judged when the code was issued; a known client rides out its host's bad minute.
  const client = await getClient(clientId, { allowStale: true });
  if (!client) return oauthError("invalid_client", "unknown client", 401);

  let result: TokenResult;
  if (form.grant_type === "authorization_code") {
    result = await exchangeCode({
      code: form.code,
      clientId: client.clientId,
      redirectUri: form.redirect_uri,
      codeVerifier: form.code_verifier,
      resource: form.resource,
      expectedResource,
      client,
    });
  } else if (form.grant_type === "refresh_token") {
    result = await refreshTokens({
      refreshToken: form.refresh_token,
      clientId: client.clientId,
      scope: form.scope,
      resource: form.resource,
      expectedResource,
    });
  } else {
    return oauthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
  }

  if (!result.ok) return oauthError(result.error, result.description, result.error === "invalid_client" ? 401 : 400);
  return jsonResponse(result.body);
}

export const OPTIONS = corsPreflight;
