import { authorizationServerMetadata, corsPreflight, jsonResponse, originOf } from "@/lib/server/oauth/http";

/** RFC 8414: Berth's authorization server, for assistants connecting to /mcp. */
export function GET(request: Request): Response {
  return jsonResponse(authorizationServerMetadata(originOf(request)), 200, { "cache-control": "public, max-age=3600" });
}

export const OPTIONS = corsPreflight;
