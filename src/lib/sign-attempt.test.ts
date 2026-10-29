import { describe, expect, it } from "vitest";
import { createSignAttempt, refusesClose } from "./sign-attempt";

describe("refusesClose", () => {
  it("refuses while preparing or locked, and only then", () => {
    expect(refusesClose({ locked: false, preparing: true })).toBe(true);
    expect(refusesClose({ locked: true, preparing: false })).toBe(true);
    expect(refusesClose({ locked: false, preparing: false })).toBe(false);
  });
});

describe("a submit handler's attempt", () => {
  // The shape of handleDeposit / handleWithdraw: await the terms and the quote, then sign.
  async function submit(attempts: ReturnType<typeof createSignAttempt>, gate: Promise<void>, sign: () => void) {
    const attempt = attempts.begin();
    await gate;
    if (!attempts.current(attempt)) return;
    sign();
  }

  it("signs when nothing closed meanwhile", async () => {
    const attempts = createSignAttempt();
    let signed = 0;
    await submit(attempts, Promise.resolve(), () => { signed += 1; });
    expect(signed).toBe(1);
  });

  it("does not start signing when the drawer closed during preparing", async () => {
    const attempts = createSignAttempt();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let signed = 0;
    const pending = submit(attempts, gate, () => { signed += 1; });
    attempts.cancel(); // closed or unmounted while the terms and quote were awaited
    release();
    await pending;
    expect(signed).toBe(0);
  });

  it("a newer attempt supersedes an older one", async () => {
    const attempts = createSignAttempt();
    const first = attempts.begin();
    const second = attempts.begin();
    expect(attempts.current(first)).toBe(false);
    expect(attempts.current(second)).toBe(true);
  });
});
