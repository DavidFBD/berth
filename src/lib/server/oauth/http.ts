import { MCP_PATH, SCOPES_SUPPORTED, publicOrigin, resourceFor } from "@/lib/server/oauth/config";

/**
 * The HTTP face of the authorization server: the two discovery documents,
 * CORS for the endpoints a browser based client may call, error envelopes,
 * and reading a token request in either of the encodings clients send.
 */

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id",
  "Access-Control-Expose-Headers": "www-authenticate, mcp-session-id, mcp-protocol-version",
  "Access-Control-Max-Age": "86400",
};

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", pragma: "no-cache", ...CORS_HEADERS, ...extra },
  });
}

export function oauthError(error: string, description: string, status = 400): Response {
  return jsonResponse({ error, error_description: description }, status);
}

/** RFC 8414 authorization server metadata. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    scopes_supported: [...SCOPES_SUPPORTED],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/llms.txt`,
  };
}

/** RFC 9728 protected resource metadata for the MCP server. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: resourceFor(origin),
    authorization_servers: [origin],
    scopes_supported: [...SCOPES_SUPPORTED],
    bearer_methods_supported: ["header"],
    resource_name: "Berth",
    resource_documentation: `${origin}/assistants`,
  };
}

export function originOf(request: Request): string {
  return publicOrigin(request.headers, request.url);
}

export { MCP_PATH };

/** A token or revoke request body, form encoded (the standard) or JSON (what some clients send). */
export async function readForm(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  const text = await request.text().catch(() => "");
  if (text.length > 16_000) return {};
  if (type.includes("application/json")) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed)
          .filter(([, value]) => typeof value === "string")
          .map(([key, value]) => [key, value as string]),
      );
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

/** A key for rate limiting one caller: the first forwarded address, else nothing better than a constant. */
export function callerKey(request: Request): string {
  return callerKeyFrom(request.headers);
}

export function callerKeyFrom(headers: Headers): string {
  return headers.get("x-real-ip")?.trim() || headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
