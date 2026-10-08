import { describe, expect, it } from "vitest";
import { decodeEntities } from "@/lib/html-entities";

describe("decodeEntities", () => {
  it("decodes the named entities headlines carry", () => {
    expect(decodeEntities("Jensen Huang Said Nvidia Now Has &quot;a Lot Greater Visibility&quot;")).toBe(
      'Jensen Huang Said Nvidia Now Has "a Lot Greater Visibility"',
    );
    expect(decodeEntities("AT&amp;T &lt;and&gt; Apple&apos;s")).toBe("AT&T <and> Apple's");
  });

  it("decodes numeric entities, decimal and hex", () => {
    expect(decodeEntities("Apple&#39;s &#x2019;quote&#X2019;")).toBe("Apple's ’quote’");
  });

  it("decodes once, never twice, and leaves what it does not know", () => {
    expect(decodeEntities("&amp;quot;")).toBe("&quot;");
    expect(decodeEntities("R&D &bogus; &#0; &#xD800; Q&A")).toBe("R&D &bogus; &#0; &#xD800; Q&A");
    expect(decodeEntities("plain")).toBe("plain");
  });

  it("never turns text into markup it would run", () => {
    expect(decodeEntities("&lt;img src=x onerror=alert(1)&gt;")).toBe("<img src=x onerror=alert(1)>");
  });
});
