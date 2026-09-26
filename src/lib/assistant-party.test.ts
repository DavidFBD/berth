import { describe, expect, it } from "vitest";
import { describeParty, isReservedName, knownAssistantFor } from "./assistant-party";
import { parseCimdDocument, parseRegistration } from "./server/oauth/clients";
import { cleanClientName } from "./server/oauth/validation";

describe("who is asking", () => {
  it("knows the assistants by host, subdomains included, https only", () => {
    expect(knownAssistantFor("https://claude.ai/api/mcp/auth_callback")).toBe("claude");
    expect(knownAssistantFor("https://claude.com/api/mcp/auth_callback")).toBe("claude");
    expect(knownAssistantFor("https://chatgpt.com/connector_platform_oauth_redirect")).toBe("chatgpt");
    expect(knownAssistantFor("https://platform.openai.com/apps-manage/oauth")).toBe("chatgpt");
    expect(knownAssistantFor("https://chat.openai.com/cb")).toBe("chatgpt");
    expect(knownAssistantFor("https://grok.com/cb")).toBe("grok");
    expect(knownAssistantFor("https://x.ai/cb")).toBe("grok");
    expect(knownAssistantFor("https://api.x.ai/cb")).toBeNull();
    expect(knownAssistantFor("https://community.openai.com/cb")).toBeNull();
    expect(knownAssistantFor("https://claude.ai.evil.example/cb")).toBeNull();
    expect(knownAssistantFor("https://notclaude.ai/cb")).toBeNull();
    expect(knownAssistantFor("http://claude.ai/cb")).toBeNull();
  });

  it("names the party by where the code goes, never by the name it gives itself", () => {
    const dcr = (name: string | null) => ({ kind: "dcr" as const, clientId: "berth_x", name });
    expect(describeParty(dcr("anything"), "https://claude.ai/api/mcp/auth_callback")).toEqual({
      kind: "known",
      assistant: "claude",
      name: "Claude",
    });
    expect(describeParty(dcr("Portfolio Helper"), "https://helper.example/cb")).toEqual({
      kind: "unknown",
      host: "helper.example",
      selfName: "Portfolio Helper",
    });
    expect(describeParty(dcr(null), "http://127.0.0.1:33418/callback")).toEqual({ kind: "loopback", selfName: null });
    // A metadata document served from a known host vouches for its redirect.
    expect(
      describeParty({ kind: "cimd", clientId: "https://claude.ai/oauth/claude-code.json", name: "Claude Code" }, "http://localhost:5555/cb"),
    ).toMatchObject({ kind: "known", assistant: "claude" });
  });

  it("spots borrowed names through case, spacing, zero width and look alike letters", () => {
    for (const name of ["Claude", "my claude helper", "Chat GPT", "OpenAI tools", "ANTHROPIC", "Grok", "xAI", "C1aude", "Сlaude"]) {
      expect(isReservedName(cleanClientName(name)), name).toBe(true);
    }
    expect(isReservedName(cleanClientName("Cl​au‍de"))).toBe(true);
    expect(isReservedName("Portfolio Helper")).toBe(false);
    expect(isReservedName(null)).toBe(false);
  });
});

describe("registration names", () => {
  it("strips zero width and bidi characters", () => {
    expect(cleanClientName("Cl​aude﻿")).toBe("Claude");
    expect(cleanClientName("⁦Evil⁩‪name‬")).toBe("Evilname");
    expect(cleanClientName("‎‏")).toBeNull();
  });

  it("refuses an assistant's name unless every redirect is on its hosts", () => {
    expect(parseRegistration({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], client_name: "Claude" })).toMatchObject({
      ok: true,
      name: "Claude",
    });
    expect(parseRegistration({ redirect_uris: ["https://evil.example/cb"], client_name: "Claude" })).toMatchObject({
      ok: false,
      error: "invalid_client_metadata",
    });
    expect(
      parseRegistration({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback", "https://evil.example/cb"], client_name: "Claude" }),
    ).toMatchObject({ ok: false });
    expect(parseRegistration({ redirect_uris: ["https://evil.example/cb"], client_name: "Cl​aude" })).toMatchObject({ ok: false });
    // A desktop app on loopback keeps its registration, not the name.
    expect(parseRegistration({ redirect_uris: ["http://localhost:3334/callback"], client_name: "Claude Code" })).toMatchObject({
      ok: true,
      name: null,
    });
  });

  it("lets a metadata document on a known host carry the name", () => {
    const id = "https://claude.ai/oauth/client.json";
    const body = JSON.stringify({ client_id: id, client_name: "Claude", redirect_uris: ["https://claude.ai/cb"] });
    expect(parseCimdDocument(id, body)).toMatchObject({ ok: true, name: "Claude" });
    const evil = "https://evil.example/client.json";
    const evilBody = JSON.stringify({ client_id: evil, client_name: "ChatGPT", redirect_uris: ["https://evil.example/cb"] });
    expect(parseCimdDocument(evil, evilBody)).toMatchObject({ ok: false });
  });
});
