import { describe, expect, it } from "vitest";
import { ALWAYS_SENT_KINDS, EMAIL_KINDS, isAlwaysSent, isSwitchableKind, SWITCHABLE_KINDS } from "./email-kinds";
import { NOTICE_KIND } from "@/lib/server/email/compose";

describe("email kinds", () => {
  it("splits every kind into always sent or a switch, never both", () => {
    for (const kind of EMAIL_KINDS) expect(isAlwaysSent(kind)).toBe(!isSwitchableKind(kind));
    expect([...ALWAYS_SENT_KINDS, ...SWITCHABLE_KINDS].sort()).toEqual([...EMAIL_KINDS].sort());
  });

  it("sends a paid reward as an account notice, out of the orders switch, with no unsubscribe", () => {
    expect(NOTICE_KIND.campaign_paid).toBe("account");
    expect(isAlwaysSent(NOTICE_KIND.campaign_paid)).toBe(true);
    expect(isSwitchableKind("account")).toBe(false);
    expect(NOTICE_KIND.order_filled).toBe("orders");
  });
});
