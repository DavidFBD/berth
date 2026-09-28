import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { DEFAULT_SCOPE, publicOrigin, resourceFor } from "@/lib/server/oauth/config";
import { CORS_HEADERS, corsPreflight } from "@/lib/server/oauth/http";
import { verifyAccessToken } from "@/lib/server/oauth/tokens";
import { registerBerthTools } from "@/lib/server/mcp/tools";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Berth's MCP server, for assistants (Claude, ChatGPT, Grok). Streamable
 * HTTP, stateless, through Vercel's mcp-handler. Every request needs a
 * bearer token from Berth's own authorization server (lib/server/oauth);
 * without one the answer is a 401 whose WWW-Authenticate names the
 * protected resource metadata, which is how a client finds where to sign
 * the person in. The tools are in lib/server/mcp/tools: they read, and
 * draft_order writes a link the person signs in Berth. Nothing here can
 * move money.
 */

const SERVER_INFO = { name: "berth", version: "1.0.0" };

const INSTRUCTIONS =
  "Berth is self custodial software for buying tokenised US stocks and funds on Sonic with stablecoins or Bitcoin. " +
  "These tools read the person's Berth account and the market, and can draft an order as a link. " +
  "You cannot place, sign or send an order: a draft only happens if the person opens the link and signs in Berth. " +
  "Say names rather than tickers to the person. Past performance says nothing certain about the future; do not give it as advice.";

/** One handler per origin (production has one; a preview deployment another). */
const handlers = new Map<string, (request: Request) => Promise<Response>>();

function handlerFor(origin: string) {
  let handler = handlers.get(origin);
  if (!handler) {
    handler = createMcpHandler((server) => registerBerthTools(server, { origin }), {
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS,
    });
    handlers.set(origin, handler);
  }
  return handler;
}

async function verifyToken(request: Request, bearer?: string): Promise<AuthInfo | undefined> {
  if (!bearer) return undefined;
  const origin = publicOrigin(request.headers, request.url);
  const access = await verifyAccessToken(bearer, resourceFor(origin));
  if (!access) return undefined;
  return {
    token: bearer,
    clientId: access.clientId,
    scopes: access.scopes,
    expiresAt: access.expiresAt,
    extra: { userId: access.userId, grantId: access.grantId, clientName: access.clientName },
  };
}

async function handle(request: Request): Promise<Response> {
  const origin = publicOrigin(request.headers, request.url);
  const authed = withMcpAuth(handlerFor(origin), verifyToken, {
    required: true,
    resourceMetadataPath: "/.well-known/oauth-protected-resource/mcp",
    resourceUrl: origin,
  });
  const response = await authed(request);
  // Browser based clients need to read the challenge and the session headers.
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  // MCP 2025-11-25: the first challenge names the scope a client should ask
  // for. Both, since not every client steps up on a tool's
  // insufficient_scope challenge; the consent screen still names each.
  const challenge = headers.get("www-authenticate");
  if (response.status === 401 && challenge && !/\bscope=/.test(challenge)) {
    headers.set("www-authenticate", `${challenge}, scope="${DEFAULT_SCOPE}"`);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export { handle as GET, handle as POST, handle as DELETE };
export const OPTIONS = corsPreflight;
