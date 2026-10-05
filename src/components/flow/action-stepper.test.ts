import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionStepper } from "./action-stepper";
import { stepMessage } from "@/lib/step-message";
import { approvalTakesTwo } from "@/lib/pour-lifecycle";
import { COPY } from "@/lib/copy";

describe("a two-prompt approval", () => {
  it("is read from the plan's reset leg", () => {
    expect(approvalTakesTwo({ ok: true, value: { resetTx: { to: "0x1" }, approveTx: { to: "0x1" } } })).toBe(true);
    expect(approvalTakesTwo({ ok: true, value: { approveTx: { to: "0x1" } } })).toBe(false);
  });

  it("counts as one when the plan cannot be read", () => {
    expect(approvalTakesTwo(null)).toBe(false);
    expect(approvalTakesTwo({ ok: false })).toBe(false);
    expect(approvalTakesTwo({ ok: true, value: "0xdeadbeef" })).toBe(false);
  });

  it("says the wallet will ask twice on the approve step only", () => {
    expect(stepMessage("approving", COPY, { approveTwice: true })).toBe(COPY.stepMsgApprovingTwice);
    expect(stepMessage("approving", COPY)).toBe(COPY.stepMsgApproving);
    expect(stepMessage("signing", COPY, { approveTwice: true })).toBe(COPY.stepMsgSigning);
    expect(COPY.stepMsgApprovingTwice).not.toMatch(/[—–]| - /);
  });

  it("keeps three dots, never a fourth", () => {
    const html = renderToStaticMarkup(createElement(ActionStepper, { step: "approving", approveTwice: true }));
    expect(html.match(/grid size-7.5/g)).toHaveLength(3);
    expect(html).toContain(COPY.stepMsgApprovingTwice.replace("…", ""));
  });

  it("asks nothing of an email account whose approve takes two sends", () => {
    const html = renderToStaticMarkup(
      createElement(ActionStepper, { step: "approving", approveTwice: true, headless: true }),
    );
    expect(html.match(/grid size-7.5/g)).toHaveLength(3);
    expect(html).toContain(COPY.stepMsgApprovingTwiceHeadless.replace("…", ""));
    expect(html).not.toContain(COPY.stepMsgApprovingTwice.replace("…", ""));
  });
});
