import { describe, expect, it } from "vitest";
import { CHIP_SCROLL_MARGIN, edgeFades, scrollToShow } from "./chip-scroll";

// A 280px row holding 360px of chips: First buy, the default, is the last, at 270 to 360.
const row = { scrollLeft: 0, clientWidth: 280, scrollWidth: 360 };

describe("the range row on a narrow phone", () => {
  it("scrolls the selected chip into view, as far as the row's end and no further", () => {
    expect(scrollToShow(row, { left: 270, width: 90 })).toBe(80);
  });

  it("leaves a chip already in view where it is", () => {
    expect(scrollToShow(row, { left: 0, width: 40 })).toBe(0);
    expect(scrollToShow({ ...row, scrollLeft: 50 }, { left: 100, width: 40 })).toBe(50);
  });

  it("scrolls back for a chip hidden at the start, with room beside it", () => {
    expect(scrollToShow({ ...row, scrollLeft: 80 }, { left: 40, width: 40 })).toBe(40 - CHIP_SCROLL_MARGIN);
    expect(scrollToShow({ ...row, scrollLeft: 80 }, { left: 0, width: 40 })).toBe(0);
  });

  it("does nothing when everything fits", () => {
    expect(scrollToShow({ scrollLeft: 0, clientWidth: 400, scrollWidth: 360 }, { left: 270, width: 90 })).toBe(0);
  });

  it("fades only the edges with chips past them", () => {
    expect(edgeFades(row)).toEqual({ start: false, end: true });
    expect(edgeFades({ ...row, scrollLeft: 80 })).toEqual({ start: true, end: false });
    expect(edgeFades({ ...row, scrollLeft: 40 })).toEqual({ start: true, end: true });
    expect(edgeFades({ scrollLeft: 0, clientWidth: 400, scrollWidth: 360 })).toEqual({ start: false, end: false });
  });
});
