import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const reduced = { value: false };
vi.mock("motion/react", async (original) => ({ ...(await original<typeof import("motion/react")>()), useReducedMotion: () => reduced.value }));
const { RollingNumber, rollDirection } = await import("./rolling-number");

const render = (value: string) => renderToStaticMarkup(createElement(RollingNumber, { value }));

describe("rolling number", () => {
  it("gives screen readers the whole figure once and hides the digit columns", () => {
    reduced.value = false;
    const html = render("$1,234.50");
    expect(html).toContain('<span class="sr-only">$1,234.50</span>');
    expect(html).toContain('aria-hidden="true"');
    // Every digit sits inside the hidden part, none outside it.
    const visible = html.replace(/<span class="sr-only">.*?<\/span>/, "").replace(/<span aria-hidden="true".*$/, "");
    expect(visible).not.toMatch(/\d/);
  });

  it("keeps separators and symbols static and rolls only digits", () => {
    reduced.value = false;
    const html = render("$1,234.50");
    expect(html.match(/<span class="relative inline-block">/g)).toHaveLength(6);
    expect(html).toContain("<span>$</span>");
    expect(html).toContain("<span>,</span>");
    expect(html).toContain("<span>.</span>");
  });

  it("paints the first mount at rest, with no entering offset", () => {
    reduced.value = false;
    const html = render("$10.00");
    expect(html).not.toMatch(/translateY|translate3d|opacity:0/);
  });

  it("swaps instantly under reduced motion: plain text, no columns", () => {
    reduced.value = true;
    const html = render("$1,234.50");
    expect(html).toBe("<span>$1,234.50</span>");
    reduced.value = false;
  });

  it("reads direction from the value: up when it rises, down when it falls", () => {
    expect(rollDirection("$999.00", "$1,000.00")).toBe(1);
    expect(rollDirection("$1,000.00", "$999.00")).toBe(-1);
    expect(rollDirection("$5.00", "$5.00")).toBe(0);
    expect(rollDirection("-$5.00", "-$6.00")).toBe(-1);
  });

  it("reads trimmed token amounts and compact figures by value, not by digit count", () => {
    expect(rollDirection("0.5", "0.123456")).toBe(-1);
    expect(rollDirection("0.12", "0.5")).toBe(1);
    expect(rollDirection("950,000", "1.2M")).toBe(1);
    expect(rollDirection("1.2M", "999,999.5")).toBe(-1);
    expect(rollDirection("<0.000001", "0.0001")).toBe(1);
  });
});
