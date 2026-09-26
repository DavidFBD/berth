import { corsPreflight, jsonResponse, originOf, protectedResourceMetadata } from "@/lib/server/oauth/http";

/** RFC 9728: where the MCP server's tokens come from. Also served at the /mcp suffixed path. */
export function GET(request: Request): Response {
  return jsonResponse(protectedResourceMetadata(originOf(request)), 200, { "cache-control": "public, max-age=3600" });
}

export const OPTIONS = corsPreflight;
