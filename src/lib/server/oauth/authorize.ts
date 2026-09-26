import { SignJWT, jwtVerify } from "jose";
import { CONSENT_TTL_SECONDS, resourceFor } from "@/lib/server/oauth/config";
import { consentSigningKey, isValidChallenge } from "@/lib/server/oauth/crypto";
import { getClient, type OAuthClient } from "@/lib/server/oauth/clients";
import { describeParty, isConsentParty, type ConsentParty } from "@/lib/assistant-party";
import type { SafeFetcher } from "@/lib/server/oauth/ssrf";
import { redirectHost, redirectUriMatches, resolveScope } from "@/lib/server/oauth/validation";

/**
 * The authorization request, judged before anyone is asked anything
 * (RFC 6749 section 4.1, with PKCE required and the RFC 8707 resource
 * pinned to our one MCP server).
 *
 * Two kinds of failure, as the spec insists: when the client or its
 * redirect URI cannot be trusted, nothing is redirected anywhere and the
 * page says so itself (an open redirector is the classic hole); every
 * other problem goes back to the client's redirect URI as an error.
 *
 * A request that passes becomes a consent request: its validated fields,
 * signed, carried by the page, and sent back with the person's decision.
 * The decision route trusts nothing the browser adds; it verifies the
 * signature and reads the fields from inside it.
 */

export type AuthorizeParams = {
  response_type?: string | null;
  client_id?: string | null;
  redirect_uri?: string | null;
  scope?: string | null;
  state?: string | null;
  code_challenge?: string | null;
  code_challenge_method?: string | null;
  resource?: string | null;
};

export type ConsentRequest = {
  clientId: string;
  /** Who is asking, derived from the redirect host, never the self given name (lib/assistant-party). */
  party: ConsentParty;
  redirectUri: string;
  /** Whether the request named redirect_uri; if it did not, the token request need not repeat it. */
  redirectUriSent: boolean;
  redirectHost: string;
  scope: string;
  state: string | null;
  codeChallenge: string;
  resource: string;
};

export type AuthorizeOutcome =
  /** Show the consent screen. */
  | { kind: "consent"; request: ConsentRequest; client: OAuthClient }
  /** Send the browser back to the client with an error. */
  | { kind: "redirect"; url: string }
  /** Say so on our own page; there is nowhere safe to send the browser. */
  | { kind: "error"; reason: "unknown_client" | "bad_redirect_uri" };

/** The client's redirect URI with an OAuth response appended (code or error), plus state and iss. */
export function buildRedirect(
  redirectUri: string,
  params: Record<string, string | null | undefined>,
  issuer: string,
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.set(key, value);
  }
  // RFC 9207: say who answered, so a client talking to two servers cannot be mixed up.
  url.searchParams.set("iss", issuer);
  return url.toString();
}

export async function judgeAuthorizeRequest(
  params: AuthorizeParams,
  origin: string,
  options: { fetcher?: SafeFetcher; fetchKey?: string } = {},
): Promise<AuthorizeOutcome> {
  const client = await getClient(params.client_id ?? null, options);
  if (!client) return { kind: "error", reason: "unknown_client" };

  // No redirect_uri is allowed only when exactly one is registered (RFC 6749 3.1.2.3).
  const redirectUri =
    params.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : null);
  if (!redirectUri || !redirectUriMatches(redirectUri, client.redirectUris)) {
    return { kind: "error", reason: "bad_redirect_uri" };
  }

  const state = params.state ?? null;
  const fail = (error: string, description: string): AuthorizeOutcome => ({
    kind: "redirect",
    url: buildRedirect(redirectUri, { error, error_description: description, state }, origin),
  });

  if (params.response_type !== "code") return fail("unsupported_response_type", "response_type must be code");
  if (!params.code_challenge || !isValidChallenge(params.code_challenge)) {
    return fail("invalid_request", "PKCE code_challenge is required");
  }
  if (params.code_challenge_method !== "S256") {
    return fail("invalid_request", "code_challenge_method must be S256");
  }
  const expectedResource = resourceFor(origin);
  if (params.resource && params.resource.replace(/\/+$/, "") !== expectedResource) {
    return fail("invalid_target", `resource must be ${expectedResource}`);
  }
  const scope = resolveScope(params.scope);
  if (!scope.ok) return fail("invalid_scope", "unknown scope requested");

  return {
    kind: "consent",
    client,
    request: {
      clientId: client.clientId,
      party: describeParty(client, redirectUri),
      redirectUri,
      redirectUriSent: params.redirect_uri != null,
      redirectHost: redirectHost(redirectUri),
      scope: scope.scope,
      state,
      codeChallenge: params.code_challenge,
      resource: expectedResource,
    },
  };
}

/** Sign a consent request for the page to carry. Bound to the issuer, so another deployment's cannot be replayed here. */
export async function signConsent(request: ConsentRequest, issuer: string): Promise<string> {
  return new SignJWT({ purpose: "oauth-consent", req: request })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime(`${CONSENT_TTL_SECONDS}s`)
    .sign(consentSigningKey());
}

/** The consent request inside a signed token, or null for anything forged, expired or foreign. */
export async function readConsent(token: unknown, issuer: string): Promise<ConsentRequest | null> {
  if (typeof token !== "string" || token.length > 8000) return null;
  try {
    const { payload } = await jwtVerify(token, consentSigningKey(), { issuer });
    if (payload.purpose !== "oauth-consent") return null;
    const req = payload.req as ConsentRequest | undefined;
    if (!req || typeof req.clientId !== "string" || typeof req.redirectUri !== "string" || !isConsentParty(req.party)) {
      return null;
    }
    return req;
  } catch {
    return null;
  }
}
