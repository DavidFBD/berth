# Berth brand assets: a brief for Claude Design

You are designing the complete brand asset set for **Berth**, home domain **berthmarkets.com**. Produce every asset in the list under "Deliverables", at the exact sizes given, as downloadable files, plus a short usage sheet. Ask nothing before starting; every decision you need is in this brief. Where the brief leaves you room, choose the plainer option.

## What Berth is

Self custodial software, not a broker, for people whose savings already live onchain and who cannot open a US brokerage account. They hold stablecoins, ETH, SOL or Bitcoin on more than 20 networks. Berth turns that money into US stocks and ETFs in one signature, kept in their own wallet, and tells them exactly what they own before they buy: each is a token that tracks a share, issued by a third party. Idle cash waits in a Treasury bill fund. The product is an order ticket, not a bridge.

One-line positioning, verbatim, use it on the OG image and the pitch cover:

> Wall Street, in your wallet.

Longer line, for the description slots:

> Buy US stocks with the crypto you hold. Keep them in your own wallet. Pay with stablecoins, ETH, SOL or Bitcoin on more than 20 networks, in one signature. You are told exactly what you own before you buy.

Audience: adults in Lagos, Manila, Buenos Aires and Warsaw who are careful with money and fluent with phones. Not crypto traders. Not degens. They are choosing a place to keep savings.

## The name

**Berth.** A berth is the secure place a vessel ties up in harbour. Your berth in the market. Five letters, calm, nautical, pronounceable in every target market. It is a homophone of "birth"; treat that as neutral and never play on it.

The lead line is the one above, "Wall Street, in your wallet." (docs/product/features.md, Tagline). Older tagline candidates such as "A place to tie up." are retired; do not use them.

## Tone, in six words

Plain. Exact. Calm. Adult. Unhurried. Never clever about money.

Everything you make must pass this test: could it hang in the lobby of a serious, modern brokerage that a cautious forty year old would trust with a year of savings? If it reads as a crypto project, a shipping company, a bank from 1990 or a startup that wants to be liked, start over.

## Visual direction

**The mark.** A symbol that reads as a berth or a mooring, never a boat, never an anchor, never a wave, never a coin, never a candlestick. Think of the geometry of a place to tie up: a bollard seen from above, a cleat, a mooring ring, a slip between two piers, a dock edge with a fixed point. It must work as a single colour silhouette at 16 pixels and as a 1024 pixel app icon without changing its structure. Geometric, few strokes, one idea. No gradients inside the mark itself. Show three directions first, then commit to one and produce the full set from it.

**The wordmark.** "Berth" set in Archivo, medium to semibold, tight but not touching. Sentence case only: Berth, never BERTH, never berth. The mark sits to the left of the wordmark with a gap equal to the cap height. Provide a horizontal lockup and a stacked lockup. The wordmark must also stand alone without the mark.

**Colour.** Use these tokens exactly. They are already in use in the pitch deck and the product will adopt them.

Light:

| Token | Hex | Use |
| --- | --- | --- |
| bg | #F4F5F2 | page background |
| surface | #FFFFFF | cards, panels |
| surface-2 | #ECEEEA | secondary panels |
| ink | #151B1A | primary text, the mark on light |
| ink-2 | #4A5553 | secondary text |
| muted | #7F8986 | tertiary text |
| line | #D6DBD8 | borders |
| accent | #1F4ED8 | the one accent, links, primary action |
| accent-soft | #E3E9FB | accent tint |
| good | #1E7A4C | positive status |
| warn | #8F5E00 | caution status |
| bad | #B3261E | negative status |

Dark:

| Token | Hex | Use |
| --- | --- | --- |
| bg | #0F1413 | page background |
| surface | #171D1C | cards, panels |
| surface-2 | #1F2624 | secondary panels |
| ink | #E8ECEA | primary text, the mark on dark |
| ink-2 | #B0BAB6 | secondary text |
| muted | #7D8884 | tertiary text |
| line | #2A3230 | borders |
| accent | #86A3FF | the one accent |
| accent-soft | #1B2540 | accent tint |
| good | #7BD3A0 | positive status |
| warn | #E5B85B | caution status |
| bad | #F09189 | negative status |

Rules: the mark is ink on bg, or bg on ink, or ink on accent. Never accent on bg for the mark alone, since a blue logo on grey is every fintech. The accent is for one thing per composition. No gradients anywhere except a very faint surface to surface-2 wash on the OG image background if you need depth. No glow, no blur, no glassmorphism, no 3D, no photographs of ships or harbours.

**Type.** Archivo for display and the wordmark (weights 500 to 800, width 75 to 100). Public Sans for body text on any asset that carries a sentence (400, 500, 600). IBM Plex Mono for numbers and tickers. All three are on Google Fonts.

**Glyph language.** The product uses Phosphor duotone icons and no emoji, ever. Any icon you draw for the avatar set or the rank set must sit comfortably next to Phosphor duotone: two tone, rounded terminals, 1.5 to 2 pixel stroke at 24 pixels.

## Deliverables

Produce every item. Match sizes exactly. Export SVG where the row says SVG, PNG where it says PNG, at the pixel size given, with transparent backgrounds unless the row names one. Name files exactly as written; these paths are wired into the app.

### 1. Mark and wordmark

| File | Format | Notes |
| --- | --- | --- |
| berth-mark.svg | SVG, viewBox 0 0 64 64 | the symbol alone, single path if possible, currentColor fill so CSS can colour it |
| berth-mark-ink.svg | SVG | mark in ink #151B1A on transparent |
| berth-mark-paper.svg | SVG | mark in bg #F4F5F2 on transparent, for dark surfaces |
| berth-wordmark.svg | SVG | "Berth" as outlined paths, not live text, ink fill |
| berth-lockup-horizontal.svg | SVG | mark plus wordmark, ink |
| berth-lockup-stacked.svg | SVG | mark above wordmark, ink |
| berth-logo.png | PNG 720 by 360 | horizontal lockup on transparent, replaces the current logo slot |
| berth-logo-dark.png | PNG 720 by 360 | horizontal lockup in paper for dark surfaces |

### 2. Favicons and app icons

| File | Format | Notes |
| --- | --- | --- |
| favicon.ico | ICO containing 16, 32, 48 | mark alone, ink on transparent; check the 16 pixel rendering by eye |
| favicon.svg | SVG | mark alone, with a `prefers-color-scheme: dark` media rule that swaps ink for paper |
| favicon-16.png, favicon-32.png, favicon-48.png | PNG | mark alone |
| apple-touch-icon.png | PNG 180 by 180 | mark in paper on a solid ink #151B1A square, no rounded corners, iOS rounds them |
| icon-192.png, icon-512.png | PNG | mark in paper on solid ink, for the web manifest |
| icon-maskable-512.png | PNG 512 by 512 | same, with the mark inside the central 80 percent safe zone |
| app-icon-1024.png | PNG 1024 by 1024 | store quality master, mark in paper on ink |
| site.webmanifest | JSON | name "Berth", short_name "Berth", theme_color #F4F5F2, background_color #F4F5F2, display standalone, icons pointing at the files above |

### 3. Social and link previews

| File | Format | Notes |
| --- | --- | --- |
| og.png | PNG 1200 by 630 | the default link card. Left aligned: small lockup top left, the positioning line as the headline in Archivo, one short supporting line in Public Sans, berthmarkets.com bottom left in Plex Mono. Background bg, headline ink, one word of the headline in accent at most |
| og-invite.png | PNG 1200 by 630 | the referral card a friend sees. Headline: "A seat has been kept for you." Supporting line: "A friend set you up at Berth. Your first trade pays you both a little." Same layout family as og.png so the two read as siblings |
| twitter-card.png | PNG 1200 by 600 | same composition as og.png, re-cropped |
| x-avatar.png | PNG 400 by 400 | mark in paper on ink |
| x-banner.png | PNG 1500 by 500 | lockup left, positioning line right, bg background |
| github-avatar.png | PNG 500 by 500 | mark in paper on ink |
| colosseum-thumbnail.png | PNG 1280 by 720 | the hackathon listing image: lockup, positioning line, and the words "Robinhood Chain track" small in Plex Mono |

### 4. Pitch and video

| File | Format | Notes |
| --- | --- | --- |
| deck-cover.png | PNG 1920 by 1080 | the positioning line, lockup, berthmarkets.com |
| deck-closing.png | PNG 1920 by 1080 | lockup centred, "Wall Street, in your wallet." beneath, domain below that |
| video-poster.png | PNG 1920 by 1080 | still for the demo video, same family as deck-cover |
| video-end-card.png | PNG 1920 by 1080 | lockup, domain, and a line reading "Built on the SODAX System" small in Plex Mono at the bottom |

### 5. In-app art

**Avatars.** Eight profile avatars, SVG, viewBox 0 0 96 96, two tone, drawn to sit beside Phosphor duotone icons. Harbour objects a careful person would recognise, not boats: bollard, cleat, mooring ring, lantern, buoy, rope coil, tide mark, compass rose. File names: `bollard.svg`, `cleat.svg`, `ring.svg`, `lantern.svg`, `buoy.svg`, `rope.svg`, `tidemark.svg`, `compass.svg`. Each must read at 40 pixels. Use ink for the primary tone and accent-soft for the secondary tone; the app will recolour them by theme, so keep each avatar to exactly two fills.

**Rank glyphs.** Ten small glyphs, SVG, viewBox 0 0 24 24, one per rank on a ladder from first arrival to master of the harbour. Draw them as a progression a viewer can feel without reading: from an empty slip to a full harbour master's seal. Name them `rank-01.svg` through `rank-10.svg`. Also propose ten rank names that fit a harbour, one or two words each, plain and adult, in ascending order, delivered as a text list. Moorings, not boats. Examples of the register: "First Line", "Slip", "Harbour Master". Do not use "captain", "admiral", "whale" or any pirate words.

**Empty state illustration.** One SVG, viewBox 0 0 320 200, two tone, a calm empty berth seen from above: the water, the dock edge, one bollard, no vessel. Used when the account holds nothing yet. File name `empty-berth.svg`.

**Loading mark.** An SVG animation of the mark, 48 by 48, under 1.2 seconds per loop, that reads as a line being made fast, not as a spinner. Respect `prefers-reduced-motion` by freezing on the final frame. File name `loading-mark.svg`.

### 6. Usage sheet

One page, `brand-sheet.md`, covering: the mark's clear space (half the mark's width on every side), minimum sizes (16 pixels for the mark, 80 pixels wide for the wordmark), the colour rules above, the three approved lockups, two examples of misuse (a gradient fill and the mark on accent with accent text), and the tagline order.

## Things to avoid

- Boats, ships, sails, anchors, waves, compasses on the mark, lighthouses, ropes as the mark. The harbour is where you keep something safe, not a voyage.
- Coins, charts, arrows going up, candlesticks, chain links, hexagons, cubes, anything that says crypto or trading.
- Gradients, glow, glass, neon, dark mode as the default identity, purple.
- Dashes as punctuation in any text you set. Use commas and periods.
- Emoji anywhere, including the manifest and the file names.
- Any word play on "birth".
- Lower case wordmark, all caps wordmark, or a period after Berth.

## How to hand it back

A single downloadable archive laid out as:

```
berth-brand/
  mark/
  icons/
  social/
  pitch/
  app/avatars/
  app/ranks/
  app/
  brand-sheet.md
  rank-names.md
```

Include a contact sheet PNG at 2400 by 1600 showing every asset at a glance on bg, so the whole set can be judged in one look.
