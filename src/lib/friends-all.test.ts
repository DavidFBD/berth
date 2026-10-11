import { describe, expect, it } from "vitest";
import { FRIEND_FEATURES, friendsAllPromisesXp, friendsAllState, sameFriendFeatures } from "@/lib/friends-all";

const OFF = { visible: false, linkFace: false, shareHoldings: false, shareWeek: false };

describe("all friend features", () => {
  it("are all on only when every sharing switch is on", () => {
    expect(friendsAllState({ visible: true, linkFace: true, shareHoldings: true, shareWeek: true })).toEqual({ on: 4, total: 4, all: true, partial: false });
    expect(friendsAllState({ ...OFF, visible: true, linkFace: true, shareHoldings: true }).all).toBe(false);
  });

  it("a new profile, shown by default and nothing else, is offered all, not the rest", () => {
    expect(friendsAllState({ ...OFF, visible: true })).toEqual({ on: 1, total: 4, all: false, partial: false });
  });

  it("some chosen and some not is partial, hidden or not", () => {
    expect(friendsAllState({ ...OFF, shareWeek: true }).partial).toBe(true);
    expect(friendsAllState({ ...OFF, visible: true, linkFace: true })).toEqual({ on: 2, total: 4, all: false, partial: true });
  });

  it("judges a card staff hid without the profile switch its owner cannot turn on", () => {
    const hidden = { visible: false, linkFace: true, shareHoldings: true, shareWeek: true, staffHidden: true as const };
    expect(friendsAllState(hidden)).toEqual({ on: 3, total: 3, all: true, partial: false });
  });

  it("promises the XP only while it is unclaimed", () => {
    expect(friendsAllPromisesXp({})).toBe(true);
    expect(friendsAllPromisesXp({ friendsAllClaimed: false })).toBe(true);
    expect(friendsAllPromisesXp({ friendsAllClaimed: true })).toBe(false);
  });

  it("promises nothing while staff have hidden the card, since nothing is paid then", () => {
    expect(friendsAllPromisesXp({ staffHidden: true })).toBe(false);
  });

  it("accepts only exactly today's set of features, in any order", () => {
    expect(sameFriendFeatures([...FRIEND_FEATURES])).toBe(true);
    expect(sameFriendFeatures([...FRIEND_FEATURES].reverse())).toBe(true);
    expect(sameFriendFeatures(FRIEND_FEATURES.slice(1))).toBe(false);
    expect(sameFriendFeatures([...FRIEND_FEATURES.slice(1), "visible", "visible"].slice(0, 4))).toBe(true);
    expect(sameFriendFeatures(["visible", "visible", "linkFace", "shareWeek"])).toBe(false);
    expect(sameFriendFeatures([...FRIEND_FEATURES, "extra"])).toBe(false);
    expect(sameFriendFeatures("visible,linkFace")).toBe(false);
    expect(sameFriendFeatures(undefined)).toBe(false);
  });
});
