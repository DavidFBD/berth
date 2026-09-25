import type { ErrorReportPayload, ErrorReportResult } from "@/lib/error-report";
import {
  buildIssueBody,
  fingerprintMarker,
  followUpComment,
  issueTitle,
} from "@/lib/server/issue-body";

/**
 * Files a failed pour as a GitHub issue on the app repo, so the team (or an AI
 * triage pass over the issue list) can work from real logs instead of a
 * screenshot.
 *
 * Deduplicates by fingerprint: the same cause comments on the existing open
 * issue rather than opening another, so a retry storm or a shared bug across
 * users stays one thread with a visible occurrence count.
 *
 * This endpoint creates GitHub issues from unauthenticated browser traffic, so
 * it is deliberately defensive: payload size cap, per-IP rate limit, fixed
 * label, and a token that never reaches the client. It always answers 200 with
 * a status — reporting is a courtesy and must never surface as a second error
 * on top of the one being reported.
 */

const REPO = process.env.GITHUB_ISSUE_REPO ?? "DavidFBD/lsteatime";
const TOKEN = process.env.GITHUB_ISSUE_TOKEN;
const ENABLED = process.env.ERROR_REPORTING_ENABLED !== "false";

const LABEL = "auto-reported";
const MAX_BODY_BYTES = 64 * 1024;

/** Per-IP cap. Best-effort: serverless instances don't share memory, so this
 *  thins abuse rather than eliminating it — fingerprint dedup does the rest. */
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter(
    (at) => now - at < RATE_LIMIT_WINDOW_MS,
  );
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5_000) hits.clear(); // crude bound on memory
  return recent.length > RATE_LIMIT_MAX;
}

function gh(path: string, init?: RequestInit) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
}

function ok(result: ErrorReportResult) {
  return Response.json(result);
}

/** Create the grouping label once per instance; harmless if it already exists. */
let labelChecked = false;
async function ensureLabel() {
  if (labelChecked) return;
  labelChecked = true;
  try {
    await gh(`/repos/${REPO}/labels`, {
      method: "POST",
      body: JSON.stringify({
        name: LABEL,
        color: "d93f0b",
        description: "Filed automatically by the app from a user-facing error",
      }),
    });
  } catch {
    // Already exists, or no permission to manage labels — issue creation below
    // tolerates a missing label.
  }
}

export async function POST(request: Request) {
  if (!ENABLED) return ok({ status: "skipped", reason: "reporting disabled" });
  if (!TOKEN) {
    return ok({ status: "skipped", reason: "GITHUB_ISSUE_TOKEN not set" });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) {
    return ok({ status: "skipped", reason: "rate limited" });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return ok({ status: "skipped", reason: "payload too large" });
  }

  let payload: ErrorReportPayload;
  try {
    payload = JSON.parse(raw) as ErrorReportPayload;
  } catch {
    return ok({ status: "skipped", reason: "malformed payload" });
  }
  if (
    !payload?.fingerprint ||
    !payload?.friendlyMessage ||
    !/^[a-f0-9]{8}$/.test(payload.fingerprint)
  ) {
    return ok({ status: "skipped", reason: "incomplete payload" });
  }

  const marker = fingerprintMarker(payload.fingerprint);
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);

  try {
    // Dedup by scanning open auto-reported issues. Deliberately not the search
    // API, which is eventually consistent and would double-file bursts.
    const existingResponse = await gh(
      `/repos/${REPO}/issues?state=open&labels=${LABEL}&per_page=100`,
    );
    if (existingResponse.ok) {
      const existing = (await existingResponse.json()) as Array<{
        number: number;
        body: string | null;
      }>;
      const match = existing.find((issue) => issue.body?.includes(marker));
      // A follow-up only ever annotates the issue it follows. With no open
      // issue to land on (closed, or the report never filed) it is dropped
      // rather than opening an issue about an order that has now ended.
      if (payload.followUp) {
        if (!match) return ok({ status: "skipped", reason: "no issue to follow up" });
        await gh(`/repos/${REPO}/issues/${match.number}/comments`, {
          method: "POST",
          body: JSON.stringify({ body: followUpComment(payload) }),
        });
        return ok({ status: "duplicate", issueNumber: match.number });
      }
      if (match) {
        await gh(`/repos/${REPO}/issues/${match.number}/comments`, {
          method: "POST",
          body: JSON.stringify({
            body: [
              `Happened again at ${payload.page.at}.`,
              "",
              buildIssueBody(payload, sha),
            ].join("\n"),
          }),
        });
        return ok({ status: "duplicate", issueNumber: match.number });
      }
    }

    if (payload.followUp) {
      return ok({ status: "skipped", reason: "no issue to follow up" });
    }

    await ensureLabel();

    const created = await gh(`/repos/${REPO}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: issueTitle(payload),
        body: buildIssueBody(payload, sha),
        labels: [LABEL],
      }),
    });

    if (!created.ok) {
      return ok({
        status: "failed",
        reason: `GitHub responded ${created.status}`,
      });
    }
    const issue = (await created.json()) as { number: number };
    return ok({ status: "filed", issueNumber: issue.number });
  } catch (error) {
    return ok({
      status: "failed",
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }
}
