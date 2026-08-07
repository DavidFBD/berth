import { describe, expect, it } from "vitest";
import { rewardsResponse } from "./rewards-route";
import type { UserRow } from "./accounts";

const stale: UserRow = {
  id: "u1",
  privy_did: null,
  wallet_address: "0xwallet",
  email: null,
  avatar_id: null,
  xp: 25,
};

describe("rewardsResponse", () => {
  it("answers with the patched row, never the stale one", async () => {
    const response = rewardsResponse(
      stale,
      { xp: 125, avatar_id: "kettle" },
      [{ kind: "avatar_set", amount: 25 }],
    );
    expect(await response.json()).toEqual({
      xp: 125,
      avatarId: "kettle",
      hasEmail: false,
      rewards: [{ kind: "avatar_set", amount: 25 }],
    });
  });

  it("keeps the rewards list empty when nothing was just paid", async () => {
    const response = rewardsResponse(stale, { xp: 25 }, []);
    expect(await response.json()).toEqual({
      xp: 25,
      avatarId: null,
      hasEmail: false,
      rewards: [],
    });
  });
});
