import { publicOrigin, resourceFor } from "@/lib/server/oauth/config";

/**
 * A short plain text note for language models and the people configuring
 * them: what Berth is, and where its MCP server lives.
 */
export function GET(request: Request): Response {
  const origin = publicOrigin(request.headers, request.url);
  const body = `# Berth

> A self custodial brokerage for money that already lives onchain. Buy tokenised US stocks and ETFs (Robinhood Stock Tokens on Sonic) with the stablecoins or Bitcoin you already hold, from any of 20 networks, in one signature. Idle dollars can wait in a Treasury bill fund.

## Assistants (MCP)

- MCP server (Streamable HTTP): ${resourceFor(origin)}
- Sign in: OAuth 2.1 with PKCE. Authorization server metadata at ${origin}/.well-known/oauth-authorization-server; protected resource metadata at ${origin}/.well-known/oauth-protected-resource/mcp. Dynamic client registration and client ID metadata documents are both accepted.
- Scopes: berth.read (the account's holdings, performance against a benchmark, orders, rank) and berth.draft (draft a buy or sell as a link).
- An assistant reads and drafts. It never signs, never holds keys and never moves money: a draft only becomes an order when the person opens the link, checks it and signs in Berth.

## Tools

- list_listings, get_listing, get_moves, get_market_feed: the board, prices, moves and news.
- get_account, get_holdings, get_performance, get_orders: the signed in account.
- draft_order: a buy or sell for the person to approve and sign in Berth.

## Links

- App: ${origin}
- Privacy policy (covers the MCP connector): ${origin}/privacy
`;
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
