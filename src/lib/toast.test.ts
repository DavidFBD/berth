import { afterEach, describe, expect, it } from "vitest";
import { toast, toastQueue } from "@/lib/toast";

afterEach(() => toast.dismiss());

const kinds = () => {
  const { visible, waiting } = toastQueue.snapshot();
  return [...visible, ...waiting].map((entry) => entry.content.kind);
};

describe("toast.rewards", () => {
  it("is quiet for an empty batch", () => {
    toast.rewards([], 100);
    toast.rewards(undefined, 100);
    expect(kinds()).toEqual([]);
  });

  it("joins a buy's XP to its message, so a buy is one toast", () => {
    toast.success("Bought.", { description: "It is in your account." });
    toast.rewards([{ kind: "pour_in", amount: 100 }], 350);
    expect(kinds()).toEqual(["message"]);
  });

  it("gives a single reward that crosses a rank only the card, its reason on it", () => {
    toast.rewards([{ kind: "avatar_set", amount: 50 }], 130);
    expect(kinds()).toEqual(["levelup"]);
  });

  it("gives a batch that crosses a rank the card and one XP line", () => {
    toast.rewards([{ kind: "theme_tried", amount: 25 }, { kind: "email_linked", amount: 100 }], 120);
    expect(kinds()).toEqual(["levelup", "xp"]);
  });
});
