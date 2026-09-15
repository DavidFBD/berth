import { describe, expect, it } from "vitest";
import {
  SODAX_API_BASE,
  buildUpstreamHeaders,
  resolveProxyTarget,
} from "./sodax-proxy";

describe("resolveProxyTarget", () => {
  it("forwards the three solver routes the SDK calls", () => {
    for (const route of ["intent/quote", "intent/status", "intent/execute"]) {
      expect(resolveProxyTarget(route.split("/"))).toBe(
        `${SODAX_API_BASE}/${route}`,
      );
    }
  });

  it("refuses any other path on the SODAX API", () => {
    expect(resolveProxyTarget(["swaps", "intents", "submit"])).toBeNull();
    expect(resolveProxyTarget(["be", "config"])).toBeNull();
    expect(resolveProxyTarget(["intent"])).toBeNull();
    expect(resolveProxyTarget(["intent", "quote", "extra"])).toBeNull();
  });

  it("refuses traversal and casing dodges", () => {
    expect(resolveProxyTarget(["intent", "..", "swaps", "quote"])).toBeNull();
    expect(resolveProxyTarget(["..", "..", "admin"])).toBeNull();
    expect(resolveProxyTarget(["Intent", "Quote"])).toBeNull();
  });

  it("refuses an empty path", () => {
    expect(resolveProxyTarget([])).toBeNull();
    expect(resolveProxyTarget(undefined)).toBeNull();
  });
});

describe("buildUpstreamHeaders", () => {
  it("attaches the key as x-api-key", () => {
    expect(buildUpstreamHeaders("sodax_MX4cu8x_test")).toMatchObject({
      "x-api-key": "sodax_MX4cu8x_test",
    });
  });

  it("sends no key header when none is configured", () => {
    expect(buildUpstreamHeaders(undefined)).not.toHaveProperty("x-api-key");
    expect(buildUpstreamHeaders("")).not.toHaveProperty("x-api-key");
  });

  it("carries nothing but JSON negotiation besides the key", () => {
    expect(Object.keys(buildUpstreamHeaders("k")).sort()).toEqual([
      "Accept",
      "Content-Type",
      "x-api-key",
    ]);
  });
});
