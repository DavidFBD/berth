# Newsfeeds and price history for the listings

Date: 2026-09-17. Question from David: the board is static; a visitor needs news about the listed assets and their price performance to form a view. Research free, high quality per-ticker news feeds, and while at it, free price history.

Method: three Sonnet evidence agents (keyed news APIs and their licences; keyless RSS and JSON feeds, each fetched live; price history sources, each fetched live), then re-verification of every load-bearing claim in the main loop with curl from this Mac on the same day. Raw agent reports live outside the repo at `~/Github/_scratch-lsteatime/newsfeeds-2026-09-17/` (research-news-apis.md, research-rss-feeds.md, research-price-history.md). The agents tested from a residential NL address and this Mac, never from a Vercel function, so a datacenter address may be answered differently by Nasdaq, Yahoo and Google.

## Verdict

- Nothing is at once free, high quality and contractually clear for display in a commercial app. Every good headline source carries either a personal, non-commercial clause (Yahoo, Google News, Seeking Alpha, Alpha Vantage, GNews, Mediastack) or a written-permission clause (Nasdaq, MarketWatch, Marketaux, Finnhub), or bans redistribution outright (Alpaca, Polygon/Massive, Tiingo, EODHD). The only tiers with unambiguous rights are SEC EDGAR filings (public domain) and the issuers' own newsrooms.
- The workable path: a keyless aggregator now, behind a provider seam, showing headline, source, time and link only, with Nasdaq's per-symbol RSS as backbone, Google News RSS filling the thin ETFs, issuer feeds and an EDGAR filing badge on top. Before real users, swap the backbone for a licensed wire; Marketaux Basic at $29 a month with a one-line written sign-off is the cheapest, and it brings per-ticker sentiment and images.
- Price performance is the easier half and costs nothing. DefiLlama's keyless coins API, keyed by CoinGecko ids, prices every one of the thirteen listings as Robinhood tokens, returns 24h, 7d and 30d changes for all of them in one call, and gives daily history back to 2026-06-26; the xStock ids extend six of them to a year. The app already depends on the same API for deposit token prices. Pyth, the obvious crypto-native choice, put its price endpoints behind a paid key on 2026-08-26 (401 verified today).
- One correction to the registry found on the way: SpaceX is not private. SEC EDGAR lists Space Exploration Technologies Corp (CIK 1181412) on Nasdaq under SPCX with an 8-K, S-8s, Schedule 13Gs and a Form 4 filed 2026-09-15; Nasdaq's own feed carries "SpaceX Makes History, Raising $85.7 Billion through Nasdaq Listing" dated 2026-07-01. `lib/listings` has `category: "private"` and the board labels it "Private". It should be `equity`; the token's on-chain name ("Class A Common Stock") already said so.

## 1. The listings

Thirteen Robinhood Stock Tokens on Sonic: SPCX, NVDA, GME, MSTR, AAPL, TSLA, MU, SNDK, SPY, QQQ, SGOV (cash), USO, SLV. The SODAX backend marks each `isRwa: true` and gives nothing else; the solver oracle (`/v1/intent/oracle`) gives a spot price and `updatedAt` per token and no change figure. None of the Sonic addresses has a DEX pool (DexScreener `pairs: null` for the five tested), so there is no AMM candle history anywhere; the tokens are priced off-chain by the solver. Everything below is therefore an external source.

## 2. News: keyless feeds, tested live

| Feed | URL shape | Coverage today | Freshness | Payload | Terms |
|---|---|---|---|---|---|
| Nasdaq per-symbol RSS | `nasdaq.com/feed/rssoutbound?symbol=NVDA` | 200 for all 13 | Same day for the large caps; SPCX 3 items (Jul 1); SGOV newest Sep 1 | Title, link (canonical), pubDate, description, source attribution; cleanest structure | Nasdaq frames free RSS as for "your own website"; use "as part of a commercial or value-added service" requires a Global Data Agreement and "shall not redistribute any information ... except in accordance with" it. Ask Nasdaq whether headline plus link crosses that line |
| Google News RSS search | `news.google.com/rss/search?q=SGOV+ETF&hl=en-US&gl=US&ceid=US:en` | 200, fresh items for all 13 including SGOV, USO, SLV | Best of all | Title with " - Source" suffix and a `<source>` tag; link is a `news.google.com/rss/articles/...` redirect token that opens the article in a browser but cannot be resolved server-side | Terms of Use: personal, non-commercial; forbid using results to "sell a product or service" or to "reformat and display" |
| Yahoo Finance per-ticker RSS | `feeds.finance.yahoo.com/rss/2.0/headline?s=NVDA&region=US&lang=en-US` | 200 for all 13 | Good for large caps; filler for SGOV, USO, SLV | Title, canonical link, pubDate; no image, no source tag | robots.txt disallows everything; Yahoo terms are non-commercial |
| Yahoo Finance search JSON | `query1.finance.yahoo.com/v1/finance/search?q=NVDA&newsCount=5` | Agent saw fresh items for all 13 and for "SpaceX" by name, with publisher, thumbnail and related tickers | Minutes | Richest keyless payload | Same terms as above, and it answered 429 Too Many Requests from this Mac minutes after the agent's test run; unofficial, no contract |
| SEC EDGAR | `data.sec.gov/submissions/CIK##########.json`, Atom feeds; CIKs from `sec.gov/files/company_tickers.json` | 11 of 13 (SPCX 1181412, SNDK 2023554, NVDA, GME, MSTR, AAPL, TSLA, MU, SPY, USO, SLV); QQQ and SGOV sit inside umbrella-trust CIKs with no per-ticker isolation | Filing day | Form type and date, not headlines | Public domain. Needs a User-Agent with a contact address; about 10 requests a second |
| Issuer newsrooms | `blogs.nvidia.com/feed/`, `ir.tesla.com/rss.xml`, `apple.com/newsroom/rss-feed.rss`, `investor.sandisk.com/rss/news-releases.xml` | 4 of 13 work; Micron, GameStop and Strategy are behind Cloudflare or Akamai; the five ETF sponsors publish no RSS; spacex.com has none | Sparse, lumpy | Press releases with canonical links | The company's own releases, meant to be linked |

Dead or disqualified: Seeking Alpha (its feed XML states that publishing it "for public or commercial use ... is prohibited"), MarketWatch (automated access "prohibited unless you have express written permission from Dow Jones"), Investing.com (no per-ticker feed, redistribution banned), Motley Fool direct (401, key-gated; its pieces arrive through Nasdaq and Yahoo anyway), CNBC (no per-ticker feed), Benzinga RSS (403), Reddit search JSON (403 and a paid commercial policy), StockTwits symbol stream (403, API registration paused).

## 3. News: keyed APIs

| Provider | Free tier | Per ticker | Free-text (SpaceX) | Sentiment | Licence on the free tier |
|---|---|---|---|---|---|
| Marketaux | 100 requests a day, 3 articles a request; Basic $29 a month gives 2,500 a day and 20 a request | `symbols=` | `search=` full text | Per entity `sentiment_score` and `match_score`; `image_url`, `source`, `published_at` | Site terms: a licence "solely for your personal, non-commercial use" and "may not be used in connection with any commercial endeavors except those that are specifically endorsed or approved by us". Ambiguous template terms beside a pricing page that sells production volume; get the approval in writing |
| Alpha Vantage NEWS_SENTIMENT | 25 requests a day | `tickers=` | No | Per ticker relevance and sentiment; verified live on AAPL with the demo key | "any type of commercial activity that allows individuals or entities other than the user to access information ... requires contacting Alpha Vantage directly" |
| Finnhub company-news | 60 a minute | Yes | No | No | "Personal plan can't be used by any business even internally without a written approval"; redistribution banned |
| Alpaca News (Benzinga) | 200 a minute with a paper account | Yes | No | No | "you cannot redistribute Alpaca API data" |
| Polygon.io / Massive | 5 a minute | Yes | No | No | Free tier "Individual use only"; Benzinga add-on $99 a month, also individual |
| Financial Modeling Prep | 250 a day | Yes | No | No | Display needs a separate Data Display and Licensing Agreement; no working demo key |
| EODHD | 20 calls a day, news costs 5 each | Yes | No | Yes | Personal use only |
| Tiingo | News excluded from free | | | | |
| GNews, NewsAPI.org, Mediastack | 100 a day / localhost only / 100 a month | Query only | Query | No | Non-commercial, or $449 a month for production (NewsAPI) |
| StockNewsAPI, Benzinga direct, Twelve Data, Nasdaq Data Link | Card-first trial / enterprise sales / paid PR wire only / no news dataset | | | | |

Untested because signup needs an inbox: Marketaux's actual coverage of SGOV, USO and SLV. Its `search=` parameter is documented as full-text over title and body, so a company-name query should work; confirm on the first key.

## 4. Prices and performance

| Source | What it gives | Coverage | Terms | Verdict |
|---|---|---|---|---|
| SODAX solver oracle | Spot USD price and timestamp | All 13 | Public read | Keep as the displayed price: it is what the quote fills at |
| DefiLlama `coins.llama.fi` (keyless) | `/percentage/{coins}?period=24h,7d,30d` changes for many coins in one call; `/chart/{coins}?start&span&period=1d` daily history; `/prices/current` already used by `/api/token-prices` | All 13 via `coingecko:<robinhood id>`; history from 2026-06-26 (SGOV from 2026-07-08). xStock ids add a year for NVDA, TSLA, SPY, QQQ, MSTR, AAPL (from 2025-08-13), GME from 2025-10-20, SNDK from 2026-05-04, MU from 2026-06-04, SLV from 2026-08-12; none for SPCX or USO | Docs describe a Free API with a "Standard" rate limit and state no commercial or attribution condition | Primary. Verified today: NVDA +1.81% 24h, SPCX +6.38%, SGOV +0.01%, USO −3.94% |
| CoinGecko Demo API | `/coins/{id}/market_chart`, same ids | Same | Free key, 10,000 credits a month, "Powered by CoinGecko" attribution | Fallback so a DefiLlama outage does not take the feature down |
| Pyth Hermes and Benchmarks | Equity feeds exist for the 12 public names (`Equity.US.NVDA/USD` and so on); metadata search still open | 12 | Price endpoints answer 401 without a key; the pricing page says the $0 tier has no API permissions and paid access starts at about $500 a month, changed 2026-08-26 | Out |
| Chainlink | Robinhood's own stock token feeds, on Robinhood Chain (chain id 4663), on-chain reads only | Not Sonic, no history API | Contact Chainlink Labs | Out |
| Yahoo chart JSON, Stooq, Twelve Data, Massive, EODHD, Tiingo, Marketstack, Alpha Vantage, Finnhub, Alpaca | True equity closes | 12 | Yahoo terms; Stooq now serves a JS challenge; the rest ban commercial display on free tiers (Tiingo: "you may not display or share the data with another person or organization"); Alpha Vantage 25 a day; Finnhub candles paid; Alpaca "cannot redistribute" | Out. IEX Cloud and the Nasdaq WIKI dataset are gone |

The CoinGecko Robinhood ids, one per listing: `spacex-robinhood-tokenized-stock`, `nvidia-robinhood-tokenized-stock`, `gamestop-robinhood-tokenized-stock`, `strategy-inc-robinhood-tokenized-stock`, `apple-robinhood-tokenized-stock`, `tesla-robinhood-tokenized-stock`, `micron-technology-robinhood-tokenized-stock`, `sandisk-corporation-robinhood-tokenized-stock`, `spdr-s-p-500-etf-trust-robinhood-tokenized-stock`, `invesco-qqq-robinhood-tokenized-stock`, `ishares-0-3-month-treasury-bond-etf-robinhood-tokenized-stock`, `united-states-oil-fund-robinhood-tokenized-stock`, `ishares-silver-trust-robinhood-tokenized-stock`. They track the Robinhood Chain deployment of the same token, not the Sonic one, so they are a proxy for the same instrument, not a reading of Berth's asset. The xStock ids are `nvidia-xstock`, `tesla-xstock`, `sp500-xstock`, `nasdaq-xstock`, `microstrategy-xstock`, `apple-xstock`, `gamestop-xstock`, `micron-technology-xstock`, `sandisk-corporation-xstock`, `ishares-silver-trust-xstock`.

Two honest caveats for copy. Tokenised stocks trade around the clock, so a "24 hour" change is not the exchange's close-to-close move; say "over 24 hours", never "today". SGOV's price moves a few basis points a month, so a change badge on it reads as nothing; the yield line from FRED is the number that matters, and iShares publishes the 30-day SEC yield (3.64% today) only in rendered HTML, with no CSV or JSON except holdings.

## 5. Recommendation

News, this round, zero cost:
1. A `lib/news` provider seam (pure parsing and merging, testable) and one server route, `/api/listing-news?symbol=`, revalidated every 15 minutes, so one upstream fetch per feed serves every visitor.
2. Backbone: Nasdaq per-symbol RSS. Fill: Google News RSS query on the listing's name (and ticker), which is the only feed fresh on SGOV, USO and SLV every day. On top: the four issuer feeds, and an EDGAR "new filing" line for the eleven with a CIK.
3. Show headline, source, time and link only. No full text, no images we do not hold rights to. Drop items whose title and description do not mention the name or ticker (that removes Nasdaq's "Most Active" lists). Deduplicate on normalised title.
4. Keep the feeds' names visible ("via Nasdaq", "via Google News"), and keep the seam so the backbone can be swapped in a day.

News, before real users: write to Marketaux (one line asking to display headlines on berthmarkets.com) and take Basic at $29 a month if they say yes; it adds per-ticker sentiment and images. Or open the conversation with Nasdaq. State plainly in the risk register that the keyless tier runs on tolerance, not licence.

Prices, this round, zero cost:
1. `/api/listing-performance`: three DefiLlama percentage calls (24h, 7d, 30d) over all thirteen Robinhood ids, revalidated every 5 minutes, and a `/chart` call per listing for 90 days of daily closes, revalidated hourly. A change badge and a sparkline per board row; a detail view with 1W, 1M, 3M, and 1Y where an xStock series exists.
2. The oracle stays the displayed price. SGOV shows the yield line and no change badge.
3. CoinGecko Demo behind the same seam as fallback.

Registry: change SPCX to `category: "equity"` and retire the "private" category and its "Private" label, or keep the category for a future truly private listing but not for SpaceX.


## 7. What shipped, and where it differs from the above

Built the same day, in two rounds (commits on master).

**Price performance.** As recommended: DefiLlama keyed by the pinned CoinGecko
Robinhood ids, oracle still the displayed price. Two things this research did
not catch, both found by looking at the numbers rather than the docs.

- The series carries marks the share never made, on days the market was shut.
  These tokens trade around the clock on a thin venue: the GameStop token sat
  at $34.44 across a Saturday, a Sunday and Labor Day while the same stock's
  xStock wrapper read $19.20, and the Strategy token printed $266.01 on a
  Sunday against $130 on the Friday. Drawn unfiltered that is a seventy
  percent rally a visitor would have been shown. `lib/market-calendar`
  computes the ten NYSE closures by rule, so the filter cannot go stale.
- Bad marks land inside the week too, on the thinnest names: Sandisk printed
  $6,972.01 on a Thursday against a real $1,494. A despike drops an interior
  close only when it is more than 20% from the median of itself and its two
  neighbours.
- The change figures do NOT come from DefiLlama's `/percentage`, which would
  measure a Monday against a Sunday print. Both numbers come off the one
  filtered series, which also halved the upstream requests.

**News.** Nasdaq per-symbol RSS only, against this document's own four source
recommendation. The issuer newsrooms are the cleanest rights tier and the
worst content: NVIDIA's feed is a marketing blog, Apple's is consumer product
news, both attribute to a staff username, and Tesla's and Sandisk's investor
feeds were 49 and 14 days stale when checked. Google News stayed out on its
terms and its unresolvable links. Both belong beside a single listing rather
than in the river, and `/api/listing-news?symbol=` is ready for that.

**Registry.** SPCX is `equity`; the `private` category is gone.

## 6. Gaps

- No feed was fetched from a Vercel datacenter address; Nasdaq, Yahoo and Google may throttle or block there where they did not from a home connection.
- Keyed providers were assessed from their own pricing and terms pages; none was exercised with a real key beyond Alpha Vantage's demo, so Marketaux's coverage of the thin ETFs and of SpaceX by name is documented, not observed.
- The Pyth paywall date comes from the agent's read of the pricing page; the 401s are verified today.
- CoinGecko Demo's per-minute rate was not verified in the main loop.
