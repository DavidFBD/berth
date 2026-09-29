import { NextResponse, type NextRequest } from "next/server";
import { applyWebhookEvent, verifyWebhook } from "@/lib/server/email/webhook";

export const dynamic = "force-dynamic";

/**
 * POST /api/email/webhook: Resend's delivery events, svix signed. Without
 * RESEND_WEBHOOK_SECRET the route does not exist (404), so an unsigned
 * caller can never write the suppression list. A bad signature is 401;
 * anything verified answers 200, ignored events included, so Resend does
 * not retry what Berth chose not to act on.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return new NextResponse(null, { status: 404 });
  const body = await request.text();
  const verified = verifyWebhook(
    secret,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    body,
  );
  if (!verified) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  try {
    const result = await applyWebhookEvent(event as Parameters<typeof applyWebhookEvent>[0]);
    return NextResponse.json({ result });
  } catch (error) {
    // Resend retries a 5xx, which is what a database hiccup deserves.
    console.warn("[email] webhook not applied:", error instanceof Error ? error.name : "error");
    return NextResponse.json({ error: "not applied" }, { status: 500 });
  }
}
