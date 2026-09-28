import { describe, expect, it } from "vitest";
import { startRotation } from "@/lib/rotation";
import { feedSignature } from "./use-rotating-feed";

const posts = Array.from({ length: 10 }, (_, index) => ({ id: `p${index}` }));
const split = (limit: number) => [posts.slice(0, limit), posts.slice(limit)] as const;

describe("feedSignature", () => {
  it("changes when the column opens or closes, though the ids and their order do not", () => {
    const [two, twoReserve] = split(2);
    const [eight, eightReserve] = split(8);
    expect(feedSignature(two, twoReserve)).not.toBe(feedSignature(eight, eightReserve));
  });

  it("holds while nothing changes", () => {
    const [two, reserve] = split(2);
    expect(feedSignature(two, reserve)).toBe(feedSignature([...two], [...reserve]));
  });

  it("restarts to as many shown cards as the new limit", () => {
    for (const limit of [2, 8, 2]) {
      const [shown, reserve] = split(limit);
      expect(startRotation(shown, reserve).visible).toHaveLength(limit);
    }
  });
});
