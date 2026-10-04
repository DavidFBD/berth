import { describe, expect, it } from "vitest";
import { COPY, PRIVACY_OPERATOR, TERMS_AVAILABILITY } from "./copy";

const all = (doc: typeof COPY.termsOfUse) =>
  [doc.title, doc.status, ...doc.intro, ...doc.sections.flatMap((s) => [s.heading, ...s.body, ...(s.list ?? []), ...(s.after ?? [])])].join("\n");

describe("the terms of use", () => {
  it("names every excluded country and the operator", () => {
    const text = all(COPY.termsOfUse);
    for (const place of [
      ...TERMS_AVAILABILITY.excluded,
      ...TERMS_AVAILABILITY.sanctionedCountries,
      ...TERMS_AVAILABILITY.sanctionedRegions,
    ]) {
      expect(text).toContain(place.name);
    }
    expect(text).toContain(PRIVACY_OPERATOR.name);
    expect(text).toContain(PRIVACY_OPERATOR.email);
  });

  it("has unique section ids", () => {
    const ids = COPY.termsOfUse.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses no dashes as punctuation", () => {
    const help = COPY.assistantsHelp;
    const helpText = [help.title, ...help.intro, help.connectBody, ...help.can, ...help.cannot, ...help.disconnect, ...help.more, help.support].join("\n");
    for (const text of [all(COPY.termsOfUse), helpText]) expect(text).not.toMatch(/ [-–—] |—|–/);
  });
});

describe("the privacy policy", () => {
  it("says everything the weekly summary carries, where it is kept and where it goes", () => {
    const text = all(COPY.privacyPolicy as typeof COPY.termsOfUse);
    const weekly = text.split("\n").find((line) => line.startsWith("The weekly summary:"));
    const resend = text.split("\n").find((line) => line.startsWith("Resend,"));
    for (const line of [weekly, resend]) {
      expect(line).toBeDefined();
      for (const part of ["friends", "Salutes", "filled"]) expect(line).toContain(part);
      // Recurring buys were retired on 2026-10-04: the summary no longer carries them.
      expect(line).not.toContain("recurring");
    }
  });

  it("describes recurring buys only as retired, with no reminder email left", () => {
    const text = all(COPY.privacyPolicy as typeof COPY.termsOfUse);
    const lines = text.split("\n").filter((line) => /recurring/i.test(line));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/4 October 2026/);
    expect(text).not.toContain("Recurring buy reminders:");
  });
});
