import {
  buildUpstreamHeaders,
  resolveProxyTarget,
} from "@/lib/server/sodax-proxy";

/**
 * The house's side of the SODAX API key: the browser's solver calls come here,
 * pick up `x-api-key`, and go on to api.sodax.com. See `lib/server/sodax-proxy`
 * for why the key can't ride in the client bundle and which routes pass.
 *
 * Deliberately transparent: upstream's status, body and content type are
 * handed back untouched, so the SDK sees exactly what it would have seen
 * talking to SODAX directly (it reads `response.ok` and then `response.json()`
 * on both branches, and the solver's error envelope carries the code the app's
 * error copy reads). No retry either — `SolverApiService.postExecution` already
 * wraps its fetch in one, and a second layer would only double a write.
 *
 * Without `SODAX_API_KEY` the call still goes out, unkeyed. Enforcement is off
 * upstream for now, so a local checkout with no key in `.env.local` keeps
 * working; when SODAX turns the check on, an unkeyed pour fails at the notify
 * with the solver's own 401, which the pour machine already reports.
 */

export const dynamic = "force-dynamic";

/** Generous for the three bodies in play; the largest is a quote request. */
const MAX_BODY_BYTES = 16_384;

/** Above the SDK's own patience for these calls, below any function ceiling. */
const UPSTREAM_TIMEOUT_MS = 20_000;

/** The solver's error envelope, so a proxy failure parses like a solver one. */
function solverError(message: string, status: number): Response {
  return Response.json(
    { detail: { code: -999 /* SolverIntentErrorCode.UNKNOWN */, message } },
    { status },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const target = resolveProxyTarget(path);
  if (!target) return solverError("Not a proxied SODAX route", 404);

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return solverError("Request body too large", 413);
  }

  const headers = buildUpstreamHeaders(process.env.SODAX_API_KEY);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: "POST",
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    return solverError(
      `SODAX API unreachable: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
      502,
    );
  }

  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}
