import { describe, expect, it } from "vitest";
import { bareAddress, holdsPersonal, maskEmail, maskWallet, scrubPersonal, scrubText } from "./mask";

describe("masking", () => {
  it("keeps the first letter, a webmail domain whole, any other domain by its first letter and ending", () => {
    expect(maskEmail("dana@gmail.com")).toBe("d***@gmail.com");
    expect(maskEmail("dana@sodax.com")).toBe("d***@s****.com");
    expect(maskEmail("  A.Person+tag@mail.employer.co.uk ")).toBe("A***@m****.uk");
    expect(maskEmail("not an email")).toBe("***");
    expect(maskEmail("")).toBeNull();
    expect(maskEmail(null)).toBeNull();
  });

  it("keeps four and two of a wallet, without its namespace", () => {
    expect(maskWallet("0x1234567890abcdef1234567890abcdef123456ab")).toBe("0x12…ab");
    expect(maskWallet("eip155:0x1234567890abcdef1234567890abcdef123456ab")).toBe("0x12…ab");
    expect(maskWallet("solana:7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV")).toBe("7EcD…tV");
    expect(maskWallet("bip122:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toBe("bc1q…dq");
    expect(maskWallet("abc")).toBe("…");
    expect(bareAddress("eip155:0xab")).toBe("0xab");
  });

  it("scrubs any email or wallet out of free text and nested detail", () => {
    const text = "asked by d.vid@sodax.com about 0x1234567890abcdef1234567890abcdef123456ab and 7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV and 1BoatSLRHtKNngkdXEeobR76b53LETtpyT";
    const scrubbed = scrubText(text);
    expect(scrubbed).toBe("asked by d***@s****.com about 0x12…ab and 7EcD…tV and 1Boa…yT");
    expect(holdsPersonal(scrubbed)).toBe(false);
    expect(holdsPersonal(text)).toBe(true);
    expect(scrubPersonal({ reason: text, n: 3, list: ["x@gmail.com"] })).toEqual({ reason: scrubbed, n: 3, list: ["x***@gmail.com"] });
  });

  it("leaves transaction hashes, uuids and error codes alone", () => {
    const hash = `0x${"ab".repeat(32)}`;
    expect(scrubText(hash)).toBe(hash);
    expect(scrubText("user:7f1c2a9e-1b2c-4d5e-8f90-123456789abc")).toBe("user:7f1c2a9e-1b2c-4d5e-8f90-123456789abc");
    expect(scrubText("http_429:rate_limit_exceeded")).toBe("http_429:rate_limit_exceeded");
  });
});
