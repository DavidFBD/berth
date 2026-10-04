# Directory submissions: Claude connectors and ChatGPT plugins

Prepared 2026-09-28 for the MCP server at https://www.berthmarkets.com/mcp. Research and drafts only: nothing has
been submitted, no account created, no form filled. Code was read on branch `benchmark-message`
(`_scratch-berth/privacy`), live endpoints were probed the same day.

**Status 2026-10-01.** Since this was written, `/terms` and `/assistants` are live, Berth is closed to the United
States and to sanctioned places (`TERMS_AVAILABILITY` in `src/lib/copy.ts`), support is support@berthmarkets.com,
and the listing copy in section 4 follows `docs/product/features.md` (lead line, tokens that track a share, names
by listing). The research in sections 1 to 3 is kept as it was found.

Sources read:
- https://claude.com/docs/connectors/building/submission (portal steps, requirements)
- https://claude.com/docs/connectors/building/review-criteria (reviewer checklist)
- https://claude.com/docs/connectors/building/authentication (OAuth details)
- https://claude.com/docs/directory/publish (who can submit)
- https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy
- https://www.anthropic.com/legal/aup (high risk use cases: finance)
- https://developers.openai.com/apps-sdk/app-submission-guidelines
- https://developers.openai.com/plugins/deploy/submission
- The old FAQ (support.claude.com/.../11596036) now only points to the docs above. OpenAI's help article
  (help.openai.com/.../20001040) answered 403.

---

## 1. What each directory asks for

### Anthropic, Claude Connectors Directory

Portal: https://claude.ai/directory/manage, Submit new, MCP connector. Escalations: mcp-review@anthropic.com.

**Who can submit.** Any paid Claude plan (Pro, Max, Team, Enterprise). On Pro/Max you submit as yourself; on
Team/Enterprise only an Owner (or a custom role with the Directory permission). The listing belongs to the
organization you submit from, so submit from the account that should own Berth long term (David's own account,
not a SODAX Team org, since the operator is RD Norra-Winkels). No partner program, no domain verification, no
Verified application: every submission is scanned automatically and listed as **Community** by default;
Anthropic may escalate it to **Verified** review, where a person tests each tool.

**Hard requirements.**
- Remote, HTTPS, reachable from Anthropic's egress range 160.79.104.0/21.
- OAuth 2.0 for anything on a user's account: DCR or CIMD supported by default. 401 with
  `WWW-Authenticate: Bearer resource_metadata=...`; `resource` must equal the URL exactly; first entry of
  `authorization_servers` is the only one used; S256 PKCE advertised; redirect `https://claude.ai/api/mcp/auth_callback`
  plus port agnostic loopback for Claude Code (`http://localhost/callback`, `http://127.0.0.1/callback`);
  token endpoint accepts form-urlencoded; `invalid_grant` on dead refresh tokens; rotate refresh tokens for public
  clients; discovery/token under 10 s, refresh under 30 s.
- Every tool has a `title` and the applicable `readOnlyHint` or `destructiveHint`. Tool names 64 characters or fewer.
- Read and write split into separate tools; no catch-all request tool.
- Descriptions narrow and accurate; no prompt injection patterns (no telling Claude to call other tools, pull
  instructions from elsewhere, override system instructions, promote products).
- Actionable errors, never a bare "Internal Server Error". Reasonably sized responses.
- No collection of conversation data beyond the tool's need; never query Claude's memory, history or files.
- First party API, or one legitimately proxied; MCP domain matches the service.
- **Not accepted:** connectors that "transfer money, cryptocurrency, or other financial assets" (policy wording:
  or "executes financial transactions on behalf of users"), and AI image/video/audio generation.
- Privacy policy URL (collection, use and storage, third party sharing, retention, contact). Missing or
  incomplete policy means immediate rejection.
- Public documentation by the publish date (a blog post or help article is enough; can be shared privately
  during review).
- Test credentials for a **fully populated** account; at least three working example prompts.
- Optional: allowed link URIs if the server uses `ui/open-link` (Berth does not; its links are plain text).
- Screenshots only for MCP Apps (interactive UI). Berth has no UI resources, so none are needed.

**Portal steps and fields.**
1. Connection: server URL (Universal URL).
2. Tools: synced from the server, grouped read only versus write; flags missing titles or annotations.
3. Listing: name (max 100), one-liner (max 200), description (max 2,000, Anthropic cannot edit it), 1 to 5
   categories, documentation URL, privacy policy URL, support contact, icon, URL slug (permanent).
4. Use cases: primary use cases, what users need before connecting, reads / writes / both.
5. Company: company name, website, primary contact for review updates.
6. Authentication: OAuth DCR, CIMD, Anthropic-held credentials, custom connection, or none.
7. Data handling: own API / partner proxy with permission / third party; personal health data; sponsored content.
8. Test & launch: reviewer access instructions and credentials; confirm every tool was run (Inspector or custom connector).
9. Compliance: seven acknowledgments: directory guidelines, first party API usage, **financial transactions**,
   AI media generation, prompt injection, conversation data collection, public documentation.
10. Review and submit.

Icon spec is not published on the pages read; the portal asks for "an icon". Use the square
`public/berth-brand/icons/app-icon-1024.png` (or `icon-512.png`), and have `public/berth-mark.svg` ready.

### OpenAI, ChatGPT plugin directory (formerly "apps")

Portal: OpenAI Platform dashboard, plugin submission, "With MCP". Published plugins appear in the directory
shared by ChatGPT and Codex.

**Who can submit.** A member of an OpenAI Platform organization with **Apps Management: Write** (owners have it).
Every public submission needs a **verified individual or business identity** in the Platform, and that identity
must match the listing name, website, support contact, privacy policy and terms. For Berth this means individual
verification as RD Norra-Winkels (or business verification if Berth is registered as a business). No ChatGPT plan
requirement is stated.

**Hard requirements.**
- Public HTTPS production MCP URL (Universal).
- **Domain verification:** serve the token the portal shows at `https://www.berthmarkets.com/.well-known/openai-apps-challenge`,
  plain text, that token only (no JSON, no list). Berth answers 404 there today.
- CSP listing the exact domains any UI fetches from (Berth has no UI; expect to declare none).
- Tool annotations on every tool: `readOnlyHint`, `destructiveHint`, `openWorldHint`. "Incorrect or missing action
  labels are a common cause of rejection." readOnly is true only when the tool "fetches, looks up, lists,
  retrieves, previews, or computes information and doesn't change anything".
- Reviewer demo credentials for a fully featured account with sample data that work **without MFA, SMS, email
  confirmation, or private network access**.
- Privacy policy: categories of personal data, purposes, categories of recipients, retention.
- Support contact, website, **terms URL**, all public and matching the publisher.
- Minimal data: no secrets, debug payloads, session/trace/request ids or undisclosed user fields in tool responses;
  no raw location fields in inputs; no PCI, PHI, government ids or credentials.
- General audiences, including ages 13 to 17. No ads. Commerce only for physical goods; must not "link directly to a
  checkout or other transactional page".
- **Prohibited:** "Execution of money transfers, crypto transfers, or investment trades"; "Crypto or NFT offerings
  involving speculation, consumer deception, or financial abuse"; "Unregulated, deceptive, or abusive financial services".

**Portal tabs and fields.**
1. Info: plugin name, short description, long description, verified developer identity, logo, category,
   website URL, support URL, privacy policy URL, terms URL. No character limits or logo spec published; use the
   1024 px square icon.
2. MCP: URL type (Universal), server URL, auth config and demo credentials, CSP, domain verification, Scan Tools.
3. Skills: optional; skip.
4. Prompts: starter prompts.
5. Testing: **at least 5 positive** test cases (prompt, expected tool behaviour, expected result shape, account data
   needed) and **at least 3 negative** (prompt, expected refusal or safe fallback, why).
6. Global: countries or regions where publisher, product, support and legal terms are ready.
7. Submit: release notes, attestation that everything is accurate.

Screenshots are optional and only for plugins with UI; Berth should submit none. Review time is not stated.

---

## 2. Berth against each requirement

| Requirement | Berth today | Status |
|---|---|---|
| Remote HTTPS, Streamable HTTP | `/mcp` via `mcp-handler`, stateless, GET/POST/DELETE | OK |
| 401 with `resource_metadata` | Live: `Bearer ... resource_metadata=".../.well-known/oauth-protected-resource/mcp", scope="berth.read berth.draft"` | OK |
| Protected resource metadata `resource` equals URL | `https://www.berthmarkets.com/mcp`, one authorization server | OK |
| AS metadata, S256, DCR, CIMD | `registration_endpoint`, `client_id_metadata_document_supported: true`, `token_endpoint_auth_methods_supported: ["none"]`, S256 | OK (CIMD will be chosen by Claude) |
| Claude and ChatGPT callbacks, loopback any port | Tests cover `claude.ai/api/mcp/auth_callback`, `chatgpt.com/connector_platform_oauth_redirect`, loopback port agnostic | OK |
| Refresh rotation, `invalid_grant` | Not re-checked in this pass; was built to spec on 2026-09-26 | Verify once with Inspector |
| Titles on every tool | All nine have `title` in the registration and in annotations | OK |
| read/destructive hints | Eight read tools: `readOnlyHint: true, destructiveHint: false, openWorldHint` false, or true for the X/news tools. `draft_order`: `readOnlyHint: false, destructiveHint: false` | See gap 3 |
| Tool names at most 64 chars | Longest is `get_market_feed` (15) | OK |
| Read and write separated | Yes, one write-like tool | OK |
| Descriptions free of injection patterns | Mostly. `draft_order` ends "Show the person the link."; `list_listings` says "Use the ticker or name from here in the other tools." | Low risk, see gap 4 |
| Actionable errors | `refuse(...)` with plain sentences; `guarded()` wraps failures | OK |
| No conversation data stored | `mcp_calls` stores user, grant, assistant, tool, ok, error, duration only; privacy page says so | OK |
| Privacy policy | https://www.berthmarkets.com/privacy (effective 2026-09-28): operator RD Norra-Winkels, Netherlands; david@sodax.com; categories, purposes, recipients (Privy, Neon, Vercel, SODAX, chains, GitHub, OpenAI, TypeSafe, price/news sources), retention incl. assistant tokens and 90 day request logs; EU rights and the Dutch DPA; a section on the connector | OK for both |
| Terms of service URL | `/terms` is 404 | **Gap 1 (OpenAI requires it)** |
| Support URL | `/support` is 404; email only | Gap 2 (email is enough for Claude; OpenAI asks for a URL) |
| Public documentation | `/llms.txt` (plain text, accurate); no human page | Gap 2 |
| Domain verification (OpenAI) | `/.well-known/openai-apps-challenge` is 404 | **Gap 5** |
| Icon | `public/berth-brand/icons/app-icon-1024.png`, `icon-512.png`, `public/berth-mark.svg`; `public/berth-app-icon.png` is only 180 px | OK, use the 1024 |
| Reviewer account without email code | Sign in is Privy email code or wallet | **Blocker, see section 5** |
| Region fit | No geo restriction in the app | **Open question, section 3** |

### Gaps to fix in Berth (small, in value order)

1. **Terms page.** Add `/terms` (copy in `src/lib/copy.ts`): who operates Berth, that it is self custodial, that an
   assistant can only draft, that nothing is advice, fees, eligible jurisdictions, liability, Dutch law. OpenAI
   requires a terms URL that matches the verified identity.
2. **A human documentation and support page**, e.g. `/assistants`: how to connect in Claude and ChatGPT, the two
   scopes, the tool list, how to disconnect, and "Write to david@sodax.com". Use it as documentation URL and
   support URL. Point `resource_documentation` at it too, keeping llms.txt.
3. **Decide the `draft_order` annotation.** It persists nothing (only the shared usage log row): by OpenAI's own
   wording ("previews, or computes information and doesn't change anything") it is read only, and a reviewer can
   call `readOnlyHint: false` incorrect. Keeping it false makes Claude ask before each draft, which reads well to a
   financial reviewer. Recommendation: for ChatGPT, leave it out entirely (section 3); for Claude, keep
   `readOnlyHint: false, destructiveHint: false` and say in the submission notes that it is marked as a write only
   so the person confirms each draft.
4. **Tidy two descriptions.** Change "Show the person the link." to "The link is for the person to open."; keep the
   rest. Consider dropping the word "brokerage" from the server `INSTRUCTIONS` and llms.txt ("self custodial
   brokerage"): Berth is not a licensed broker, and the word invites the "unregulated financial services" reading.
5. **OpenAI domain challenge route.** `src/app/.well-known/openai-apps-challenge/route.ts` returning
   `process.env.OPENAI_APPS_CHALLENGE` as `text/plain`, set in Vercel once the portal shows the token.
6. **A read only server for ChatGPT** (if David submits there): the same handler with `draft_order` not
   registered, at e.g. `/mcp/read`, or a switch on the registered client. Needs its own protected resource
   metadata path and `resource`.
7. Minor: CORS `access-control-allow-methods` omits DELETE although the route exports it.

---

## 3. Policy risk, honestly

**What Berth does.** It reads the board (tokenised US stocks and funds, Robinhood Stock Tokens on Sonic), market
posts and headlines, and the signed in person's holdings, performance and orders. `draft_order` returns a link to
Berth's order screen with the listing and amount filled in. Nothing is placed, reserved or signed by the assistant;
no key exists on the server; the person signs in Berth or closes it.

### Claude directory: moderate to low risk. Likely accepted as Community, Verified unlikely soon.

- The directory bar is "transfer money, cryptocurrency, or other financial assets" or "execute financial
  transactions on behalf of users". Berth does neither, and the architecture proves it (no signing key, public
  client, scopes `berth.read` and `berth.draft` only). The Compliance step's "financial transactions"
  acknowledgment can be given truthfully.
- The risk is an automated scan reading "buy or sell" and "order" as trading. Counter it with copy that says
  plainly, in the tool description and the listing, that the person signs in Berth and the assistant cannot.
- Usage Policy: "investment advice" is a high risk use case requiring a qualified human review and AI disclosure
  when a business presents model advice to consumers. Berth's tools return facts, not recommendations; the server
  instructions already say not to present past performance as advice. The reading of posts is AI output shown
  to people, and it is disclosed in the privacy policy as a news-relevance model from TypeSafe. Users are not told its name elsewhere.
- Data handling: answer "our own API". Berth's server calls its own backend, which aggregates licensed third party
  data (X API, TypeSafe, news and price feeds). Before submitting, confirm the X API and the news/price terms allow
  redistribution into an assistant.

### ChatGPT directory: high risk. Expect rejection with `draft_order`; a read only listing is plausible but uncertain.

- "Execution of ... investment trades" is prohibited. Berth does not execute, but a reviewer may treat drafting a
  trade and handing over a signing link as close enough, and the rule against linking "directly to a checkout or
  other transactional page" fits `draft_order`'s link almost exactly.
- "Crypto ... offerings involving speculation" and "unregulated ... financial services" are judgement calls a
  reviewer can make against a crypto rails stock app from an individual developer with no licence page. A terms
  page, a clear self custody statement and no hype are the best defence, not a guarantee.
- Recommendation: submit to Claude first. For ChatGPT, submit only a read only variant (gap 6), describe it as
  "read your Berth account and the market", and do not mention buying in the listing.
- **Region question for David, before choosing countries:** Robinhood's stock tokens are issued for customers
  outside the United States (the offering launched for the EU). Berth has no geo restriction. Decide, ideally with
  counsel, where Berth may be offered, state it in the terms, and pick OpenAI's country list to match (likely the
  EU/EEA and other non US markets, not the US). Anthropic has no region field, but the terms should say the same.

### How to frame the listing accurately

- Say what it is: a way to read your Berth account and the market for tokenised US stocks and funds.
- Say what it cannot do, early: it never places, signs or sends an order, holds no keys, moves no money.
- Say what the draft is: a link to Berth's own order screen, which the person checks and signs, or closes.
- Say it is not advice, and name the data sources.
- Avoid: "trade from Claude", "invest with AI", "brokerage", "earn", "yield", any return figure.

---

## 4. Listing copy (Berth's voice)

Operator: RD Norra-Winkels, Netherlands. Website: https://www.berthmarkets.com. Support: support@berthmarkets.com.
Privacy: https://www.berthmarkets.com/privacy. Terms: https://www.berthmarkets.com/terms.
Documentation: https://www.berthmarkets.com/assistants (and https://www.berthmarkets.com/llms.txt).

### Claude connector form

- **Server URL:** https://www.berthmarkets.com/mcp (Universal URL)
- **Name (max 100):** Berth
- **Slug (permanent):** berth
- **One-liner (max 200):**
  Wall Street, in your wallet. Read your Berth account and the market for US stocks and funds, and draft a buy or sell that you check and sign in Berth yourself.
- **Categories (1 to 5):** Finance (add "Productivity" only if Finance is not offered; the category list is not published)
- **Description (max 2,000):**

  > Berth is software for buying US stocks and funds with the crypto you hold, stablecoins, ETH, SOL or Bitcoin on more than 20 networks, and keeping them in your own wallet. Each is a token that tracks a share, issued by a third party. This connector lets Claude read your Berth account and the market beside it, in plain words.
  >
  > Ask what you own and what it is worth now, how your money has done over a week, a month, three months or since your first buy, and how the same dollars would have done in the S&P 500 ETF, the Nasdaq 100 ETF, Gold, Bitcoin or Treasury bills. Ask for your past orders, what moved on the last trading day, and what companies and the press have been saying, with links to the posts and headlines.
  >
  > Claude can also draft a buy or a sell. A draft is a link to Berth's own order screen with the listing and amount filled in. Nothing is placed, reserved or sent. You open the link, check the amount and what you pay with, and sign in Berth, or close it. Claude cannot sign, holds no keys and cannot move money.
  >
  > Berth reports prices, history and what was said. It does not give advice, and past performance tells nothing certain about the future. Berth is not available in the United States or where local law or sanctions forbid it.
  >
  > You sign in with your Berth account and choose what Claude may do: read the account, draft orders, or both. You can disconnect at any time in Berth or in Claude. Berth keeps a short record of which tools were called, never what you asked or what it answered.

- **Use cases:** see what I own and what it is worth; compare my performance with a benchmark; review my orders; see what moved and why people were talking about it; prepare an order to sign in Berth.
- **Before connecting:** a Berth account (free, at berthmarkets.com, email or wallet sign in). Holdings are needed for the account tools; the market tools work with an empty account.
- **Reads or writes:** Both. Eight tools only read. `draft_order` writes nothing lasting; it returns a link, and is marked as a write so you confirm each draft.
- **Company:** RD Norra-Winkels (Berth), Netherlands, https://www.berthmarkets.com. Primary contact: David, support@berthmarkets.com.
- **Authentication:** OAuth, client ID metadata document (DCR also accepted).
- **Data handling:** our own API. Market data comes from licensed sources Berth pays for or is permitted to use (X, TypeSafe, price and news feeds). No health data. No sponsored content.
- **Example prompts (three required, five offered):**
  1. What do I own on Berth, and what is it worth right now?
  2. How has my money done since my first buy, compared with the S&P 500 ETF?
  3. Which of Berth's listings moved most on the last trading day, and what was being said about them?
  4. Show me my last ten orders.
  5. Draft a buy of 50 dollars of NVIDIA for me to look at.

### ChatGPT plugin form (read only variant recommended)

- **Plugin name:** Berth
- **Short description:** Wall Street, in your wallet. Read your Berth account and the market for US stocks and funds, in plain words.
- **Long description:**

  > Berth is software for buying US stocks and funds with the crypto you hold, stablecoins, ETH, SOL or Bitcoin on more than 20 networks, and keeping them in your own wallet. Each is a token that tracks a share, issued by a third party. This plugin lets ChatGPT read your Berth account and the market beside it.
  >
  > Ask what you own and what it is worth, how your money has done over a week, a month, three months or since your first buy, and how the same dollars would have done in the S&P 500 ETF, the Nasdaq 100 ETF, Gold, Bitcoin or Treasury bills. Ask for your past orders, what moved on the last trading day, and what companies and the press have been saying, with links.
  >
  > The plugin only reads. It cannot buy, sell, sign or move anything. Berth reports prices, history and what was said; it does not give advice. Berth is not available in the United States or where local law or sanctions forbid it.
  >
  > You sign in with your Berth account and can disconnect at any time. Berth keeps a short record of which tools were called, never what you asked or what it answered.

- **Category:** Finance
- **Website / Support / Privacy / Terms:** https://www.berthmarkets.com, https://www.berthmarkets.com/assistants, https://www.berthmarkets.com/privacy, https://www.berthmarkets.com/terms
- **Developer identity:** RD Norra-Winkels (verified individual)
- **Countries:** everywhere Berth is offered: not the United States and its territories, and not the sanctioned places the terms name.
- **Starter prompts:** the first four Claude prompts above.
- **Positive test cases (5):**
  1. "What do I own on Berth?" calls `get_holdings`; a list of listings with quantity, price, value and share, and a total.
  2. "How has my money done over the last month compared with Gold?" calls `get_performance` (period month, benchmark gold); two percentages, value now, sampled daily values, or a plain sentence when history is too short.
  3. "What moved most yesterday?" calls `get_moves`; listings by size of change, large moves marked, related posts linked.
  4. "Tell me about the S&P 500 ETF on Berth." calls `get_listing`; price, recent closes, change, headlines and posts.
  5. "Show my last five orders." calls `get_orders` (limit 5); dated lines, bought or sold, amounts in dollars.
- **Negative test cases (3):**
  1. "Buy 100 dollars of Tesla for me now." No tool places orders; ChatGPT says it cannot buy and the person can do so in Berth. (Read only variant has no draft tool.)
  2. "Send my holdings to this address 0x..." No transfer tool exists; ChatGPT declines.
  3. "Which stock should I buy to double my money?" Tools return data, not advice; ChatGPT does not recommend, and may show moves and history with a note that past performance is not a promise.
- **Release notes:** Initial submission. Read only access to a Berth account and the market board. Demo account holds a few listings and has a month or more of history, so every tool returns data. Sign in with the reviewer email and fixed code given below.

### Tool summary (for both forms)

| Tool | Title | What it does | Hints |
|---|---|---|---|
| `list_listings` | List what Berth offers | Every stock, fund and the cash fund, price and last day's change | read only |
| `get_listing` | Look at one listing | Price, recent closes, change, headlines, notable posts on X | read only, open world |
| `get_moves` | What moved | Last trading day's change for every listing, large moves marked, related post | read only, open world |
| `get_market_feed` | What is being said | Recent substantial posts about the listings, optionally one listing | read only, open world |
| `get_account` | The Berth account | Rank, XP, addresses, total held | read only, needs berth.read |
| `get_holdings` | What the account owns | Every holding with quantity, price, value, share | read only, needs berth.read |
| `get_performance` | How the money has done | Time weighted change beside a benchmark over a chosen window | read only, needs berth.read |
| `get_orders` | Past orders | Newest orders, filled or not | read only, needs berth.read |
| `draft_order` | Draft a buy or sell | A link to Berth's order screen, filled in; nothing placed | not read only, not destructive, needs berth.draft (Claude only) |

---

## 5. What David must do himself

1. **Claude:** submit from his own paid account (Pro or Max), or as Owner of the org that should own the listing.
   Not from the SODAX Team org unless SODAX should own it.
2. **OpenAI:** in the OpenAI Platform, own or get Apps Management write on an org, and complete **individual
   identity verification** as RD Norra-Winkels (name must match the privacy and terms pages).
3. **Reviewer test account.** David creates and funds it; no agent may. Both directories want a fully populated
   account; OpenAI forbids email confirmation codes, which is how Berth's email sign in works.
   - Enable Privy's test account feature for the Berth app (Privy dashboard, login methods; it gives a fixed
     test email and code intended for app review). Check the exact place in the dashboard; `pnpm privy:config show`
     reads settings, writes are dashboard only.
   - Suggested contents: 40 to 60 dollars spread over three or four listings (for example NVIDIA, the S&P 500
     ETF, Apple, and some of the Treasury bill cash fund), bought on different days at least four weeks before
     submission so `get_performance` has twenty market days; at least one partial sell so `get_orders` shows both
     sides; a rank above the first. Keep a small Base USDC balance so a draft can be opened end to end.
   - Write the reviewer steps: connect, choose both scopes, run the five example prompts, open a draft link and
     close it without signing.
4. **Decide the region question** (section 3) and publish `/terms` stating eligible places.
5. **Build the small gaps** (terms, assistants page, challenge route, description tidy, optional read only
   endpoint), then run every tool once through MCP Inspector and as a custom connector in Claude, which the
   Claude portal asks you to confirm.
6. **Confirm data rights:** X API and news/price terms permit showing their content through an assistant.
