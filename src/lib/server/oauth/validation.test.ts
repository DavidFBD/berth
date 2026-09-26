import { afterEach, describe, expect, it } from "vitest";
import { publicOrigin } from "./config";
import { isValidChallenge, s256Challenge, verifyPkce } from "./crypto";
import { isBlockedAddress, safeFetch } from "./ssrf";
import {
  cleanClientName,
  isAllowedRedirectUri,
  isCimdClientId,
  redirectUriMatches,
  resolveScope,
} from "./validation";
import { parseCimdDocument, parseRegistration } from "./clients";

describe("PKCE", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

  it("accepts the RFC 7636 appendix B pair", () => {
    expect(s256Challenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(verifyPkce(verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
  });

  it("refuses a wrong verifier, a short verifier and a malformed challenge", () => {
    expect(verifyPkce(`${verifier.slice(0, -1)}A`, s256Challenge(verifier))).toBe(false);
    expect(verifyPkce("short", s256Challenge("short"))).toBe(false);
    expect(isValidChallenge("plain-text-challenge")).toBe(false);
  });
});

describe("redirect URIs", () => {
  it("allows https and loopback http only", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:6274/oauth/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:33418/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://[::1]:8080/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://example.com/cb")).toBe(false);
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedRedirectUri("myapp://callback")).toBe(false);
    expect(isAllowedRedirectUri("https://example.com/cb#frag")).toBe(false);
    expect(isAllowedRedirectUri("https://user:pw@example.com/cb")).toBe(false);
    expect(isAllowedRedirectUri(42)).toBe(false);
  });

  it("matches exactly, except the port of a loopback redirect", () => {
    const registered = ["https://chatgpt.com/connector_platform_oauth_redirect", "http://127.0.0.1:3000/cb"];
    expect(redirectUriMatches("https://chatgpt.com/connector_platform_oauth_redirect", registered)).toBe(true);
    expect(redirectUriMatches("https://chatgpt.com/connector_platform_oauth_redirect/", registered)).toBe(false);
    expect(redirectUriMatches("https://chatgpt.com/connector_platform_oauth_redirect?x=1", registered)).toBe(false);
    expect(redirectUriMatches("https://evil.example/cb", registered)).toBe(false);
    expect(redirectUriMatches("http://127.0.0.1:51234/cb", registered)).toBe(true);
    expect(redirectUriMatches("http://127.0.0.1:51234/other", registered)).toBe(false);
    expect(redirectUriMatches("http://localhost:51234/cb", registered)).toBe(false);
  });
});

describe("scope", () => {
  it("grants the default for no scope and orders what was asked", () => {
    expect(resolveScope(undefined)).toEqual({ ok: true, scope: "berth.read berth.draft" });
    expect(resolveScope("")).toEqual({ ok: true, scope: "berth.read berth.draft" });
    expect(resolveScope("berth.draft berth.read berth.draft")).toEqual({ ok: true, scope: "berth.read berth.draft" });
    expect(resolveScope("berth.read")).toEqual({ ok: true, scope: "berth.read" });
  });

  it("refuses anything unknown and anything beyond what is allowed", () => {
    expect(resolveScope("berth.read berth.trade")).toEqual({ ok: false });
    expect(resolveScope("openid")).toEqual({ ok: false });
    expect(resolveScope("berth.draft", "berth.read")).toEqual({ ok: false });
    expect(resolveScope(undefined, "berth.read")).toEqual({ ok: true, scope: "berth.read" });
  });
});

describe("client metadata", () => {
  it("cleans a client name", () => {
    expect(cleanClientName("  Claude  ")).toBe("Claude");
    expect(cleanClientName("Evil‮edualC")).toBe("EviledualC");
    expect(cleanClientName("")).toBeNull();
    expect(cleanClientName(7)).toBeNull();
    expect(cleanClientName("x".repeat(200))).toHaveLength(80);
  });

  it("parses a registration for public clients only", () => {
    expect(parseRegistration({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], client_name: "Claude" })).toEqual({
      ok: true,
      name: "Claude",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    });
    expect(parseRegistration({}).ok).toBe(false);
    expect(parseRegistration({ redirect_uris: ["http://evil.example/cb"] }).ok).toBe(false);
    expect(parseRegistration({ redirect_uris: ["https://a.example/cb"], token_endpoint_auth_method: "client_secret_basic" }).ok).toBe(false);
    expect(parseRegistration({ redirect_uris: ["https://a.example/cb"], grant_types: ["client_credentials"] }).ok).toBe(false);
    expect(parseRegistration({ redirect_uris: Array.from({ length: 11 }, (_, i) => `https://a.example/${i}`) }).ok).toBe(false);
  });

  it("takes Claude's published document, extra grant types and all", () => {
    const doc = {
      client_id: "https://claude.ai/oauth/mcp-oauth-client-metadata",
      client_name: "Claude",
      client_uri: "https://claude.ai",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:jwt-bearer"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
    expect(parseRegistration(doc, doc.client_id).ok).toBe(true);
    expect(parseRegistration({ ...doc, grant_types: ["refresh_token"] }, doc.client_id).ok).toBe(false);
  });

  it("knows a metadata document URL when it sees one", () => {
    expect(isCimdClientId("https://claude.ai/oauth/mcp-oauth-client-metadata")).toBe(true);
    expect(isCimdClientId("https://example.com/")).toBe(false);
    expect(isCimdClientId("https://example.com")).toBe(false);
    expect(isCimdClientId("http://example.com/client.json")).toBe(false);
    expect(isCimdClientId("https://example.com/a/../client.json")).toBe(false);
    expect(isCimdClientId("https://example.com/client.json#x")).toBe(false);
    expect(isCimdClientId("https://u:p@example.com/client.json")).toBe(false);
    expect(isCimdClientId("berth_abc")).toBe(false);
  });

  it("judges a metadata document", () => {
    const id = "https://client.example/meta.json";
    const good = JSON.stringify({ client_id: id, client_name: "Example", redirect_uris: ["https://client.example/cb"] });
    expect(parseCimdDocument(id, good)).toEqual({ ok: true, name: "Example", redirectUris: ["https://client.example/cb"] });
    expect(parseCimdDocument(id, JSON.stringify({ client_id: "https://other.example/meta.json", redirect_uris: ["https://client.example/cb"] })).ok).toBe(false);
    expect(parseCimdDocument(id, JSON.stringify({ client_id: id, redirect_uris: ["http://client.example/cb"] })).ok).toBe(false);
    expect(parseCimdDocument(id, JSON.stringify({ client_id: id, redirect_uris: ["https://client.example/cb"], client_secret: "x" })).ok).toBe(false);
    expect(parseCimdDocument(id, "<html>").ok).toBe(false);
    expect(parseCimdDocument(id, "[]").ok).toBe(false);
  });
});

describe("SSRF blocklist", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:a9fe:a9fe",
    "64:ff9b::a9fe:a9fe",
    "2002:7f00:1::",
    "2001:db8::1",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["1.1.1.1", "8.8.8.8", "172.32.0.1", "192.169.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  it("refuses plain http and literal private addresses without connecting", async () => {
    expect(await safeFetch("http://example.com/meta.json")).toEqual({ ok: false, reason: "not https" });
    expect(await safeFetch("https://127.0.0.1/meta.json")).toEqual({ ok: false, reason: "not a public address" });
    expect(await safeFetch("https://[::1]/meta.json")).toEqual({ ok: false, reason: "not a public address" });
    expect(await safeFetch("https://169.254.169.254/latest/meta-data")).toEqual({ ok: false, reason: "not a public address" });
  });

  it("refuses a name that resolves to a private address", async () => {
    const result = await safeFetch("https://localhost/meta.json");
    expect(result.ok).toBe(false);
  });
});

describe("the issuer", () => {
  const headers = new Headers({ host: "berth-git-preview.vercel.app", "x-forwarded-proto": "https" });
  const saved = { issuer: process.env.OAUTH_ISSUER, env: process.env.VERCEL_ENV };
  afterEach(() => {
    process.env.OAUTH_ISSUER = saved.issuer;
    process.env.VERCEL_ENV = saved.env;
    if (saved.issuer === undefined) delete process.env.OAUTH_ISSUER;
    if (saved.env === undefined) delete process.env.VERCEL_ENV;
  });

  it("follows the host outside production and is pinned in it", () => {
    delete process.env.OAUTH_ISSUER;
    process.env.VERCEL_ENV = "preview";
    expect(publicOrigin(headers)).toBe("https://berth-git-preview.vercel.app");
    process.env.VERCEL_ENV = "production";
    expect(publicOrigin(headers)).toBe("https://www.berthmarkets.com");
    process.env.OAUTH_ISSUER = "https://issuer.example/";
    expect(publicOrigin(headers)).toBe("https://issuer.example");
  });
});
