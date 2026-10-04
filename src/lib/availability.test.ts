import { describe, expect, it } from "vitest";
import { availabilityFor } from "./availability";
import { COPY, TERMS_AVAILABILITY } from "./copy";

describe("availabilityFor", () => {
  it("excludes the United States and each of its territories", () => {
    for (const code of ["US", "PR", "GU", "VI", "AS", "MP", "UM"]) {
      expect(availabilityFor(code)).toEqual({ available: false, reason: "united-states" });
    }
  });

  it("treats Russia and Belarus as the United States is treated, with words of their own", () => {
    for (const code of ["RU", "BY", "ru"]) expect(availabilityFor(code)).toEqual({ available: false, reason: "not-offered" });
    for (const region of ["MOW", "SPE", null]) expect(availabilityFor("RU", region)).toEqual({ available: false, reason: "not-offered" });
  });

  it("excludes the comprehensively sanctioned countries", () => {
    for (const code of ["CU", "IR", "KP", "SY"]) {
      expect(availabilityFor(code)).toEqual({ available: false, reason: "sanctions" });
    }
  });

  it("excludes Crimea, Sevastopol, Donetsk and Luhansk, as Vercel sends them and in full", () => {
    for (const region of ["43", "40", "14", "09", "UA-43", "ua-09"]) {
      expect(availabilityFor("UA", region)).toEqual({ available: false, reason: "sanctions" });
    }
  });

  it("catches the occupied regions where a database reports them as Russia, or by their old FIPS codes", () => {
    for (const region of ["CR", "SEV", "DPR", "LPR", "RU-CR"]) {
      expect(availabilityFor("RU", region)).toEqual({ available: false, reason: "sanctions" });
    }
    expect(availabilityFor("UA", "11")).toEqual({ available: false, reason: "sanctions" });
    expect(availabilityFor("UA", "20")).toEqual({ available: false, reason: "sanctions" });
    // A free oblast whose FIPS code is an ISO one elsewhere passes.
    expect(availabilityFor("UA", "05").available).toBe(true);
  });

  it("keeps the rest of Ukraine, and a region code that belongs to another country", () => {
    expect(availabilityFor("UA", "30")).toEqual({ available: true });
    expect(availabilityFor("UA", null)).toEqual({ available: true });
    expect(availabilityFor("KZ", "43")).toEqual({ available: true });
    expect(availabilityFor("KZ", "UA-43")).toEqual({ available: true });
  });

  it("keeps everywhere else, and never refuses on a guess", () => {
    for (const code of ["NL", "GB", "CA", "DE", "BR", "nl"]) expect(availabilityFor(code).available).toBe(true);
    for (const code of [null, undefined, "", "XX1", "U"]) expect(availabilityFor(code).available).toBe(true);
  });

  it("carries no country: the answer is all that reaches the page and the logs", () => {
    for (const [country, region] of [["US", null], ["IR", null], ["UA", "43"]] as const) {
      expect(Object.keys(availabilityFor(country, region)).sort()).toEqual(["available", "reason"]);
      expect(JSON.stringify(availabilityFor(country, region))).not.toContain(country);
    }
  });

  it("names in the terms exactly the places it refuses", () => {
    const eligibility = COPY.termsOfUse.sections.find((section) => section.id === "eligibility")!.list!.join("\n");
    for (const place of [...TERMS_AVAILABILITY.excluded, ...TERMS_AVAILABILITY.sanctionedCountries, ...TERMS_AVAILABILITY.sanctionedRegions])
      expect(eligibility).toContain(place.name);
  });

  it("reads the same list the terms name, so the two cannot disagree", () => {
    for (const place of TERMS_AVAILABILITY.excluded) for (const code of place.countries) expect(availabilityFor(code).available).toBe(false);
    for (const place of TERMS_AVAILABILITY.sanctionedCountries) for (const code of place.countries) expect(availabilityFor(code).available).toBe(false);
    for (const place of TERMS_AVAILABILITY.sanctionedRegions) {
      for (const code of place.regions) {
        // The terms say "regions of Ukraine": each is, whichever country a database files it under.
        expect(/^(UA|RU)-/.test(code)).toBe(true);
        expect(availabilityFor(code.slice(0, 2), code.slice(3)).available).toBe(false);
      }
    }
  });
});

describe("the landing's words", () => {
  it("use no dashes as punctuation and no emoji", () => {
    const u = COPY.unavailable;
    const text = [
      u.title, u.sanctionsTitle, u.fundsStay, u.reason["united-states"], u.reason["not-offered"], u.reason.sanctions, u.nothingKept, u.accountKept, u.readOn, ...Object.values(u.links),
      u.support, u.haveAccount, u.drawerTitle, u.drawerBody, u.close, u.authorizeBody,
      u.noAccountTitle, u.noAccountBody, u.signOut, u.banner, u.draftRefused,
    ].join("\n");
    expect(text).not.toMatch(/ [-–—] |—|–/);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(u.reason["united-states"]).toContain("tokens issued for people outside the United States");
  });
});
