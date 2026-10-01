import { describe, expect, it, vi } from "vitest";
import { reportWithRetry } from "./pour-retry";

describe("reportWithRetry", () => {
  it("asks again after a 503, further apart each time, and stops at the first other answer", async () => {
    const answers = [503, 503, 200];
    const attempt = vi.fn(async () => ({ status: answers.shift()!, data: null }));
    const sleep = vi.fn(async (ms: number) => void ms);
    const result = await reportWithRetry(attempt, { delays: [10, 20, 40], sleep });
    expect(result.status).toBe(200);
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([10, 20]);
  });

  it("never retries a refusal, and gives up after the schedule", async () => {
    const refused = vi.fn(async () => ({ status: 422, data: null }));
    expect((await reportWithRetry(refused, { delays: [1], sleep: async () => undefined })).status).toBe(422);
    expect(refused).toHaveBeenCalledTimes(1);
    const down = vi.fn(async () => ({ status: 503, data: null }));
    expect((await reportWithRetry(down, { delays: [1, 1], sleep: async () => undefined })).status).toBe(503);
    expect(down).toHaveBeenCalledTimes(3);
  });
});
