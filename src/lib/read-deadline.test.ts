import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAIN_READ_DEADLINE_MS, ReadDeadlineError, retryBoundedRead, withDeadline } from "@/lib/read-deadline";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("withDeadline", () => {
  it("answers what the read answers, in time", async () => {
    const read = new Promise<number>((resolve) => setTimeout(() => resolve(7), 1_000));
    const bounded = withDeadline(read, CHAIN_READ_DEADLINE_MS, "polygon");
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(bounded).resolves.toBe(7);
  });
  it("gives up on a read past its deadline, so it cannot hold the page", async () => {
    const hung = new Promise<number>(() => {});
    const bounded = withDeadline(hung, CHAIN_READ_DEADLINE_MS, "polygon");
    const settled = expect(bounded).rejects.toBeInstanceOf(ReadDeadlineError);
    await vi.advanceTimersByTimeAsync(CHAIN_READ_DEADLINE_MS);
    await settled;
  });
  it("passes a quick failure through as it is", async () => {
    const failed = Promise.reject(new Error("HTTP 529"));
    await expect(withDeadline(failed, CHAIN_READ_DEADLINE_MS, "polygon")).rejects.toThrow("HTTP 529");
  });
});

describe("retryBoundedRead", () => {
  it("asks a quick failure once more, never a read past its deadline", () => {
    expect(retryBoundedRead(0, new Error("HTTP 503"))).toBe(true);
    expect(retryBoundedRead(1, new Error("HTTP 503"))).toBe(false);
    expect(retryBoundedRead(0, new ReadDeadlineError("polygon", CHAIN_READ_DEADLINE_MS))).toBe(false);
  });
});
