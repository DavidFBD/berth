import { publicOrigin, resourceFor } from "@/lib/server/oauth/config";
import { BERTH_X_URL } from "@/lib/berth-x";

/**
 * A short plain text note for language models and the people configuring
 * them: what Berth is, and where its MCP server lives.
 */
export function GET(request: Request): Response {
  const origin = publicOrigin(request.headers, request.url);
  const body = `# Berth

> Wall Street, in your wallet. Self custodial software for buying US stocks and funds with the crypto you hold: stablecoins, ETH, SOL or Bitcoin, from more than 20 networks, in one signature. Each is a token that tracks a share, issued by a third party (Robinhood Stock Tokens, on Sonic or on Robinhood Chain), not the share itself. What a person buys is held in their own Berth account on the SODAX hub (Sonic), designed so that only their wallet's signature moves it. A stock bought at the market price lands instead as the issuer's own token in the person's own wallet on Robinhood Chain, which only their keys control, where Robinhood offers its tokens; limit orders and the Treasury bill fund stay in the Berth account. Orders fill any day, weekends included. Idle dollars can wait in a Treasury bill fund at the T-bill rate. Not available in the United States or where local law or sanctions forbid it.

## Assistants (MCP)

- MCP server (Streamable HTTP): ${resourceFor(origin)}
- Sign in: OAuth 2.1 with PKCE. Authorization server metadata at ${origin}/.well-known/oauth-authorization-server; protected resource metadata at ${origin}/.well-known/oauth-protected-resource/mcp. Dynamic client registration and client ID metadata documents are both accepted.
- Scopes: berth.read (the account's holdings, performance against a benchmark, orders, rank) and berth.draft (draft a buy or sell as a link).
- An assistant reads and drafts. It never signs, never holds keys and never moves money: a draft only becomes an order when the person opens the link, checks it and signs in Berth.

## Tools

- list_listings, get_listing, get_moves, get_market_feed: the board, prices, moves and news.
- get_account, get_holdings, get_performance, get_orders: the signed in account.
- get_my_profile, get_friends_board: the signed in person's own card and friends board. Never anyone else's.
- draft_order: a buy or sell for the person to approve and sign in Berth.

## Links

- App: ${origin}
- Privacy policy (covers the MCP connector): ${origin}/privacy
- Terms of use: ${origin}/terms
- How to connect an assistant, what it can and cannot do, and support: ${origin}/assistants
- Berth on X: ${BERTH_X_URL}
`;
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
