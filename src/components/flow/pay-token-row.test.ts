import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PayTokenRow } from "./pay-token-row";
import { COPY } from "@/lib/copy";

/** The picker's two row states, as markup. */
describe("PayTokenRow", () => {
  const base = {
    logo: createElement("span", null, "logo"),
    title: "USDC",
    subtitle: "on HyperEVM",
    gasHelpLabel: COPY.gasHelpLabel,
    onSelect: () => {},
  };

  it("is a button when the chain can pay its fee", () => {
    const html = renderToStaticMarkup(createElement(PayTokenRow, base));
    expect(html.startsWith("<button")).toBe(true);
    expect(html).not.toContain("data-gas-short");
    expect(html).not.toContain("aria-disabled");
  });

  it("is a disabled button, greyed, that explains itself when it cannot pay", () => {
    const tip = COPY.gasNeededToPay("HYPE", "HyperEVM");
    const html = renderToStaticMarkup(createElement(PayTokenRow, { ...base, gasTip: tip }));
    expect(html.startsWith("<button")).toBe(true);
    expect(html).toContain("data-gas-short");
    expect(html).toContain('aria-disabled="true"');
    // The reason is the row's accessible description, so a screen reader
    // hears why, not just that it is unavailable.
    const described = html.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(described).toBeTruthy();
    expect(html).toContain(`id="${described}"`);
    expect(html).toContain(tip);
    // Still shown: the person sees what they hold. One control: the row.
    expect(html).toContain("USDC");
    expect(html.match(/<button/g)?.length).toBe(1);
    // Room to tap: the row and its (?) area are past 44px.
    expect(html).toContain("min-h-14");
  });

  it("speaks plainly, without dashes or emoji", () => {
    const tip = COPY.gasNeededToPay("HYPE", "HyperEVM");
    expect(tip).toBe("You need a little HYPE on HyperEVM to pay the network fee.");
    for (const text of [tip, COPY.gasNeededNative("ETH", "Base"), COPY.ctaNeedsGas("SOL"), COPY.gasHelpLabel]) {
      expect(text).not.toMatch(/[–—]| - /);
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});
