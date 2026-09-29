import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const runHoldCheck = vi.fn();
vi.mock("@/lib/server/holds", () => ({ runHoldCheck: () => runHoldCheck() }));

import { GET } from "./route";

const SECRET = "a".repeat(64);
const call = (authorization?: string) =>
  GET(
    new NextRequest("http://localhost/api/cron/held", {
      headers: authorization ? { authorization } : {},
    }),
  );

describe("GET /api/cron/held", () => {
  beforeEach(() => {
    runHoldCheck.mockReset();
    runHoldCheck.mockResolvedValue({ checked: 3, paid: 1, forfeited: 1, retried: 1 });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed with 503 when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(runHoldCheck).not.toHaveBeenCalled();
  });

  it("answers 401 without the header or with the wrong secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await call()).status).toBe(401);
    expect((await call(`Bearer ${"b".repeat(64)}`)).status).toBe(401);
    expect((await call(SECRET)).status).toBe(401);
    expect(runHoldCheck).not.toHaveBeenCalled();
  });

  it("runs the check and returns its summary with the right secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    // The morning email pass rides along; with no key it does nothing.
    expect(await response.json()).toEqual({ checked: 3, paid: 1, forfeited: 1, retried: 1, emails: { retried: 0, sent: 0, gaveUp: 0 } });
    expect(runHoldCheck).toHaveBeenCalledOnce();
  });
});
