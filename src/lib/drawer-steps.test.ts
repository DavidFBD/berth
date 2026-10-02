import { describe, expect, it } from "vitest";
import { chooseNextStep, inviteDismissKey } from "@/lib/drawer-steps";

const base = {
  kind: "email" as const,
  avatarId: "buoy",
  hasEmail: true,
  emailAsked: false,
  social: { hasEmail: true, handle: "gosia" },
  friendsAndSent: 1,
  level: 1,
  ageDays: 1,
  inviteDismissed: false,
};

describe("chooseNextStep", () => {
  it("runs avatar, username, invite for an email account", () => {
    expect(chooseNextStep({ ...base, avatarId: null, social: { hasEmail: true, handle: null } })).toBe("avatar");
    expect(chooseNextStep({ ...base, social: { hasEmail: true, handle: null } })).toBe("username");
    expect(chooseNextStep(base)).toBe("invite");
  });
  it("asks a wallet account for its avatar first, then its email, one at a time", () => {
    const wallet = { ...base, kind: "wallet" as const, hasEmail: false, social: { hasEmail: false, handle: null } };
    expect(chooseNextStep({ ...wallet, avatarId: null })).toBe("avatar");
    expect(chooseNextStep(wallet)).toBe("email");
  });
  it("puts the email first when it was asked for (the nudge)", () => {
    expect(chooseNextStep({ ...base, kind: "wallet", hasEmail: false, avatarId: null, emailAsked: true })).toBe("email");
    // An email account has one already: the ask changes nothing.
    expect(chooseNextStep({ ...base, avatarId: null, emailAsked: true })).toBe("avatar");
  });
  it("invites only a young account, with fewer than two friends, not dismissed", () => {
    expect(chooseNextStep({ ...base, friendsAndSent: 2 })).toBeNull();
    expect(chooseNextStep({ ...base, inviteDismissed: true })).toBeNull();
    expect(chooseNextStep({ ...base, level: 5, ageDays: 40 })).toBeNull();
    expect(chooseNextStep({ ...base, level: 5, ageDays: 3 })).toBe("invite");
    expect(chooseNextStep({ ...base, level: 2, ageDays: 400 })).toBe("invite");
    expect(chooseNextStep({ ...base, level: 5, ageDays: null })).toBeNull();
  });
  it("waits for what it has not read yet", () => {
    expect(chooseNextStep({ ...base, social: null })).toBeNull();
    expect(chooseNextStep({ ...base, friendsAndSent: null })).toBeNull();
  });
});

describe("inviteDismissKey", () => {
  it("is per account", () => {
    expect(inviteDismissKey("did:privy:A")).not.toBe(inviteDismissKey("did:privy:B"));
    expect(inviteDismissKey("0xABC")).toBe(inviteDismissKey("0xabc"));
  });
});
