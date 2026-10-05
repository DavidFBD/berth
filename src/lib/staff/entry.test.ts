import { describe, expect, it, vi } from "vitest";
import { isStaffAnswer, openStaffSession, phaseOnPageShow, STAFF_SIGN_IN_TIMEOUT_MS, staffEntryView, withTimeout } from "./entry";

describe("isStaffAnswer", () => {
  it("is true only for exactly staff: true", () => {
    expect(isStaffAnswer({ staff: true })).toBe(true);
    for (const other of [{}, null, undefined, { staff: "true" }, { staff: 1 }, { role: "admin" }, "staff", true]) {
      expect(isStaffAnswer(other)).toBe(false);
    }
  });
});

describe("staffEntryView", () => {
  it("hides the entry from anyone the server did not say yes for", () => {
    expect(staffEntryView(false, "email")).toBe("hidden");
    expect(staffEntryView(undefined, "email")).toBe("hidden");
    expect(staffEntryView(false, "wallet")).toBe("hidden");
    expect(staffEntryView(undefined, "wallet")).toBe("hidden");
  });

  it("links straight to the area in an email session", () => {
    expect(staffEntryView(true, "email")).toBe("link");
  });

  it("asks a wallet session to sign in with the email code first", () => {
    expect(staffEntryView(true, "wallet")).toBe("email-first");
  });
});

describe("openStaffSession", () => {
  const never = () => new Promise<never>(() => undefined);

  it("is true only for the server's yes", async () => {
    const post = vi.fn(async () => ({ ok: true }));
    expect(await openStaffSession({ login: async () => undefined, getToken: async () => "t", post })).toBe(true);
    expect(post).toHaveBeenCalledWith("t", expect.any(AbortSignal));
    expect(await openStaffSession({ login: async () => undefined, getToken: async () => "t", post: async () => ({ ok: false }) })).toBe(false);
  });

  it("is false without a token, or when the login fails", async () => {
    const post = vi.fn(async () => ({ ok: true }));
    expect(await openStaffSession({ login: async () => undefined, getToken: async () => null, post })).toBe(false);
    expect(await openStaffSession({ login: async () => { throw new Error("wrong code"); }, getToken: async () => "t", post })).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it("lets go when the token or the trade hangs, and aborts the trade", async () => {
    vi.useFakeTimers();
    try {
      const hungToken = openStaffSession({ login: async () => undefined, getToken: never, post: async () => ({ ok: true }), timeoutMs: 20_000 });
      let signal: AbortSignal | undefined;
      const hungPost = openStaffSession({
        login: async () => undefined,
        getToken: async () => "t",
        post: (_token, given) => {
          signal = given;
          return never();
        },
        timeoutMs: 20_000,
      });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await hungToken).toBe(false);
      expect(await hungPost).toBe(false);
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits the default 20 seconds", () => {
    expect(STAFF_SIGN_IN_TIMEOUT_MS).toBe(20_000);
  });
});

describe("withTimeout", () => {
  it("passes a prompt answer through", async () => {
    expect(await withTimeout(Promise.resolve(7), 1_000)).toBe(7);
  });
});

describe("phaseOnPageShow", () => {
  it("closes a flow restored from the back and forward cache", () => {
    expect(phaseOnPageShow(true, "opening")).toBe("closed");
    expect(phaseOnPageShow(true, "verifying")).toBe("closed");
  });

  it("leaves an ordinary page show alone", () => {
    expect(phaseOnPageShow(false, "code")).toBe("code");
  });
});
