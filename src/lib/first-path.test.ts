import { describe, expect, it } from "vitest";
import {
  NUDGES_SAID_BY_PATH,
  buyStepState,
  pathPlace,
  establishedPrompt,
  PATH_SINCE,
  PATH_STEPS,
  finishedStep,
  firstPath,
  isPathStep,
  pathEligible,
  pathLive,
  stepXp,
  stepsFor,
  withSkip,
  withoutSkip,
  type PathContext,
  type PathFacts,
  type PathRecord,
  type PathView,
} from "@/lib/first-path";
import { XP_ACTIONS } from "@/lib/xp";

const NEW: PathFacts = {
  avatarSet: false,
  usernameSet: false,
  hasEmail: true,
  funded: false,
  firstBuy: false,
  inviteSent: false,
};
const RECORD: PathRecord = { eligible: true, skipped: [], finished: false };
const EMAIL: PathContext = { account: "email", canBuy: true };
const WALLET: PathContext = { account: "wallet", canBuy: true };
const AWAY: PathContext = { account: "email", canBuy: false };

function view(facts: Partial<PathFacts> = {}, record: Partial<PathRecord> = {}, context: PathContext = EMAIL): PathView {
  return firstPath({ facts: { ...NEW, ...facts }, record: { ...RECORD, ...record }, context });
}

function current(v: PathView): string {
  if (v.kind === "step") return `${v.step} ${v.index}/${v.total}`;
  return v.kind;
}

describe("the path, step by step", () => {
  it("starts at the avatar, step 1 of 5", () => {
    expect(current(view())).toBe("avatar 1/5");
  });

  it("walks every transition in order and ends with You're set up", () => {
    let facts: Partial<PathFacts> = {};
    const seen: string[] = [current(view(facts))];
    for (const next of [
      { avatarSet: true },
      { usernameSet: true },
      { funded: true },
      { firstBuy: true },
      { inviteSent: true },
    ] satisfies Partial<PathFacts>[]) {
      facts = { ...facts, ...next };
      seen.push(current(view(facts)));
    }
    expect(seen).toEqual(["avatar 1/5", "username 2/5", "money 3/5", "firstBuy 4/5", "invite 5/5", "complete"]);
  });

  it("is off for good once finished", () => {
    expect(view({}, { finished: true }).kind).toBe("off");
    const done = { avatarSet: true, usernameSet: true, funded: true, firstBuy: true, inviteSent: true };
    expect(view(done, { finished: true }).kind).toBe("off");
  });

  it("never shows to an established account", () => {
    expect(view({}, { eligible: false }).kind).toBe("off");
    expect(pathEligible(PATH_SINCE - 1)).toBe(false);
    expect(pathEligible(PATH_SINCE)).toBe(true);
  });

  it("waits while the server has not answered", () => {
    expect(firstPath({ facts: NEW, record: undefined, context: EMAIL }).kind).toBe("wait");
  });

  it("knows every step by name", () => {
    for (const step of PATH_STEPS) expect(isPathStep(step)).toBe(true);
    expect(isPathStep("nope")).toBe(false);
    expect(isPathStep(3)).toBe(false);
  });
});

describe("facts out of order", () => {
  it("a first buy before anything else closes money and buy, and the path asks for the avatar", () => {
    const v = view({ firstBuy: true });
    expect(current(v)).toBe("avatar 1/5");
    expect(v.kind === "step" && v.steps.map((s) => s.state)).toEqual(["open", "open", "done", "done", "open"]);
  });

  it("a username before an avatar is skipped over once the avatar is in", () => {
    expect(current(view({ usernameSet: true }))).toBe("avatar 1/5");
    expect(current(view({ usernameSet: true, avatarSet: true }))).toBe("money 3/5");
  });

  it("an invite sent early is done when its turn comes", () => {
    const facts = { avatarSet: true, usernameSet: true, funded: true, firstBuy: true, inviteSent: true };
    expect(view(facts).kind).toBe("complete");
  });

  it("money already in the wallet means the next step is the first buy", () => {
    expect(current(view({ avatarSet: true, usernameSet: true, funded: true }))).toBe("firstBuy 4/5");
  });

  it("waits only when the unknown fact is the one that decides the current step", () => {
    // Balances unknown, but the avatar comes first: no wait.
    expect(current(view({ funded: undefined, firstBuy: undefined }))).toBe("avatar 1/5");
    // At the money step with balances unknown: hold its place.
    expect(view({ avatarSet: true, usernameSet: true, funded: undefined }).kind).toBe("wait");
    // A filled buy proves money even while balances are unknown.
    expect(current(view({ avatarSet: true, usernameSet: true, funded: undefined, firstBuy: true }))).toBe("invite 5/5");
    // At the buy step with orders unknown: hold its place.
    expect(view({ avatarSet: true, usernameSet: true, funded: true, firstBuy: undefined }).kind).toBe("wait");
  });
});

describe("skip and unskip", () => {
  it("a skip moves to the next step and keeps the count", () => {
    expect(current(view({}, { skipped: ["avatar"] }))).toBe("username 2/5");
  });

  it("an unskip brings the step back to its place", () => {
    const skipped = withSkip([], "avatar");
    expect(current(view({}, { skipped }))).toBe("username 2/5");
    expect(current(view({}, { skipped: withoutSkip(skipped, "avatar") }))).toBe("avatar 1/5");
  });

  it("skipping twice is skipping once, and unskipping what was never skipped changes nothing", () => {
    expect(withSkip(withSkip([], "invite"), "invite")).toEqual(["invite"]);
    expect(withoutSkip(["avatar"], "invite")).toEqual(["avatar"]);
  });

  it("a fact beats a skip", () => {
    const v = view({ avatarSet: true }, { skipped: ["avatar"] });
    expect(v.kind === "step" && v.steps[0].state).toBe("done");
  });

  it("skipping every open step completes, naming what was set aside", () => {
    const v = view({ avatarSet: true }, { skipped: ["username", "money", "firstBuy", "invite"] });
    expect(v.kind).toBe("complete");
    expect(v.kind === "complete" && v.skipped).toEqual(["username", "money", "firstBuy", "invite"]);
  });

  it("an invite without a username stays open, so its card can offer the username", () => {
    const facts = { avatarSet: true, funded: true, firstBuy: true };
    expect(current(view(facts, { skipped: ["username"] }))).toBe("invite 5/5");
  });
});

describe("where Berth cannot take an order", () => {
  it("has no money step and no buy step", () => {
    expect(stepsFor(AWAY)).toEqual(["avatar", "username", "invite"]);
    expect(current(view({}, {}, AWAY))).toBe("avatar 1/3");
    expect(current(view({ avatarSet: true }, {}, AWAY))).toBe("username 2/3");
    expect(current(view({ avatarSet: true, usernameSet: true }, {}, AWAY))).toBe("invite 3/3");
    expect(view({ avatarSet: true, usernameSet: true, inviteSent: true }, {}, AWAY).kind).toBe("complete");
  });

  it("never waits on balances it will not ask about", () => {
    expect(current(view({ avatarSet: true, usernameSet: true, funded: undefined, firstBuy: undefined }, {}, AWAY))).toBe("invite 3/3");
  });
});

describe("wallet and email accounts", () => {
  it("walk the same five steps", () => {
    expect(stepsFor(WALLET)).toEqual(stepsFor(EMAIL));
    expect(current(view({ avatarSet: true }, {}, WALLET))).toBe("username 2/5");
  });

  it("a wallet account without an email is still asked for a username (the card adds the email first)", () => {
    expect(current(view({ avatarSet: true, hasEmail: false }, {}, WALLET))).toBe("username 2/5");
  });

  it("a wallet that already holds money passes the money step at once", () => {
    expect(current(view({ avatarSet: true, usernameSet: true, funded: true }, {}, WALLET))).toBe("firstBuy 4/5");
  });
});

describe("the Done moment", () => {
  it("names the step a fact just finished", () => {
    expect(finishedStep(view(), view({ avatarSet: true }))).toBe("avatar");
    const last = view({ avatarSet: true, usernameSet: true, funded: true, firstBuy: true });
    expect(finishedStep(last, view({ avatarSet: true, usernameSet: true, funded: true, firstBuy: true, inviteSent: true }))).toBe("invite");
  });

  it("stays quiet for a skip, for no change and from a wait", () => {
    expect(finishedStep(view(), view({}, { skipped: ["avatar"] }))).toBeNull();
    expect(finishedStep(view(), view())).toBeNull();
    expect(finishedStep({ kind: "wait" }, view({ avatarSet: true }))).toBeNull();
    expect(finishedStep(view(), { kind: "off" })).toBeNull();
  });
});

describe("what the path pays and says", () => {
  it("pays only through the existing XP kinds", () => {
    expect(stepXp("avatar", { referred: false })).toBe(XP_ACTIONS.avatar_set.amount);
    expect(stepXp("username", { referred: false })).toBeNull();
    expect(stepXp("money", { referred: false })).toBeNull();
    expect(stepXp("firstBuy", { referred: false })).toBe(XP_ACTIONS.pour_in.amount);
    expect(stepXp("firstBuy", { referred: true })).toBe(XP_ACTIONS.pour_in.amount + XP_ACTIONS.invite_accepted.amount);
    // The friend link pays nothing; friend_poured is the level 3 invite code's.
    expect(stepXp("invite", { referred: false })).toBeNull();
  });

  it("keeps Jev's news line and hides the lines the path says", () => {
    expect(NUDGES_SAID_BY_PATH).not.toContain("heldNews");
    expect(NUDGES_SAID_BY_PATH).toEqual(expect.arrayContaining(["addFunds", "firstBuy", "invite"]));
  });

  it("is live for a step and for You're set up, not for wait or off", () => {
    expect(pathLive(view())).toBe(true);
    expect(pathLive(view({ avatarSet: true, usernameSet: true, funded: true, firstBuy: true, inviteSent: true }))).toBe(true);
    expect(pathLive({ kind: "wait" })).toBe(false);
    expect(pathLive({ kind: "off" })).toBe(false);
  });
});

describe("the first buy step's line", () => {
  it("money proven this visit: the ready line and the XP line", () => {
    expect(buyStepState({ everFunded: true, stage: "funded", liveStage: "funded" })).toEqual({ unfunded: false, loading: false, earnsXp: true });
  });

  it("funded once but empty now is unfunded, never a line that waits for good", () => {
    expect(buyStepState({ everFunded: true, stage: "empty", liveStage: "empty" })).toEqual({ unfunded: true, loading: false, earnsXp: false });
  });

  it("money set aside (the money step skipped) is unfunded", () => {
    expect(buyStepState({ everFunded: false, stage: "empty", liveStage: "empty" }).unfunded).toBe(true);
    expect(buyStepState({ everFunded: undefined, stage: undefined, liveStage: undefined }).unfunded).toBe(true);
  });

  it("a remembered funded stage waits for this visit's balances, without promising XP", () => {
    expect(buyStepState({ everFunded: true, stage: "funded", liveStage: undefined })).toEqual({ unfunded: false, loading: true, earnsXp: false });
  });
});

describe("the path's place on the home", () => {
  it("is the card while shown, a held place while read, else nothing", () => {
    expect(pathPlace({ shown: true, waiting: false })).toBe("card");
    expect(pathPlace({ shown: false, waiting: true })).toBe("hold");
    expect(pathPlace({ shown: false, waiting: false })).toBeNull();
    expect(pathPlace(undefined)).toBeNull();
  });
});

describe("an established account's one quiet prompt", () => {
  it("asks for a face first, then a username, and never an invite", () => {
    expect(establishedPrompt({ avatarSet: false, usernameSet: false, hasEmail: true })).toBe("avatar");
    expect(establishedPrompt({ avatarSet: true, usernameSet: false, hasEmail: true })).toBe("username");
    expect(establishedPrompt({ avatarSet: true, usernameSet: true, hasEmail: true })).toBeNull();
  });

  it("does not ask a username of an account without an email", () => {
    expect(establishedPrompt({ avatarSet: true, usernameSet: false, hasEmail: false })).toBeNull();
  });
});
