import { describe, expect, it } from "vitest";
import { CORS_HEADERS, corsPreflight } from "./http";

describe("CORS for the MCP server", () => {
  it("allows DELETE, which Streamable HTTP uses to end a session", () => {
    const methods = CORS_HEADERS["Access-Control-Allow-Methods"].split(",").map((part) => part.trim());
    expect(methods).toEqual(expect.arrayContaining(["GET", "POST", "DELETE", "OPTIONS"]));
    expect(corsPreflight().headers.get("access-control-allow-methods")).toContain("DELETE");
  });
});
