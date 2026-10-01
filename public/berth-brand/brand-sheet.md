# Berth, usage sheet

## The mark
A slip between two piers with one fixed point. Read as a place to tie up. Single path, no gradients, no strokes. Structure never changes between 16 px and 1024 px.

Clear space: half the mark's width on every side.
Minimum size: 16 px for the mark, 80 px wide for the wordmark.

## Colour rules
The mark is ink (#1C1917) on the canvas (#F7F6F4), or canvas on ink, or ink on accent (#1F4ED8). Never accent on bg for the mark alone.
The accent is for one thing per composition: a link, a primary action, or one word of a headline. Never two.
No gradients, except a faint surface to surface-2 wash on the OG background. No glow, 3D, or photographs of our own.

One exception to photographs, added 2026-09-21: an avatar that belongs to somebody else's post. A post shown on X's terms must carry its author's face beside their name and handle, so the posts column carries avatars at 44px, circular, and nowhere else. They are attribution, not decoration: we never choose them, never crop them for effect, and never use one to illustrate anything. The rest of the app still has no photographs.

No grain and no glass, since 2026-09-29. Both were tried from 2026-09-17 and came out in the Seline pass: the page is a warm stone canvas, cards are flat white with one hairline, and every surface a person reads money on is opaque. The bar the page scrolls under is the canvas itself with a hairline under it; a drawer's scrim is a plain tint. One soft shadow is allowed, on what truly floats above the page: a menu, a popover, the product preview on the welcome screen.

Light: canvas #F7F6F4, card #FFFFFF, card-2 #F2F1EE, ink #1C1917, ink-2 #44403C, muted #6F6964, faint #A8A29E (icons and rules only, never text), line #E8E6E5, line-2 #D6D3D1, accent #1F4ED8, accent-soft #E3E9FB, good #1E7A4C, warn #8F5E00, bad #B3261E.
Dark: canvas #0F0E0D, card #1A1817, card-2 #232120, ink #F2F0EE, ink-2 #D6D3D1, muted #A39D98, faint #78716C, line #2B2826, line-2 #3A3633, accent #86A3FF, accent-soft #1B2540, good #7BD3A0, warn #E5B85B, bad #F09189.


## Surfaces and controls
Cards are white on the canvas, 12 px radius, one 1 px hairline in line, no shadow, 18 px padding on a phone and 24 px on a desktop. Buttons and chips are pills. A primary pill is the accent with accent-ink text; a ghost pill is card with a line-2 hairline. A segmented control (ranges, Posts and Headlines) is a pill group whose active chip is ink with canvas text, so the accent is never spent on a filter. A headline may carry one highlighted phrase on the welcome screen: the phrase stays ink on the accent-soft wash, so the accent itself stays with the one primary action.

## Avatars
Since 2026-09-29 the faces are harbour creatures, eleven of them, drawn from one source (scripts/avatars/art.mjs, `pnpm avatars:build`) into app/avatars/ and the app's public/avatars/. Each is a 128 px circle of flat shapes, no strokes around shapes, no gradients: stone neutrals and ink, one warm brown and one ochre for the creatures, and Berth blue on exactly one thing per face (the seal's ball, the gull's fish, the otter's shell, the puffin's beak plate, the starfish's periwinkle, the moon jelly's four rings, the heron's water, the cormorant's post). Friendly faces, dark eyes with one white catchlight, a small smile. Each must read at 28 px.

Open to everyone: the Seal, the Gull, the Otter, the Puffin, the Starfish, the Moon Jelly, the Heron, the Cormorant. Opened by rank, and the only faces that are wholly blue or wholly in motion: the Blue Crab at Pier, the Porpoise at Quay, the Blue Lobster at Harbour Master, the rarest creature for the highest rung.

A face not yet earned is shown as its own silhouette, one flat #D6D0C9 on the plain disc #ECE9E4, in app/avatars/locked/. No padlock over it; the line beneath says the rank that opens it. The disc stays light in dark mode too.

Stored ids never change. The creatures took the places of the harbour objects, one for one, so bollard is the Seal, cleat the Gull, ring the Otter, lantern the Puffin, buoy the Starfish, rope the Moon Jelly, tidemark the Heron, compass the Cormorant, beacon the Blue Crab, bell the Porpoise, capstan the Blue Lobster.

## Approved lockups
1. Horizontal: mark left, wordmark right, gap equal to the cap height, baselines aligned. mark/berth-lockup-horizontal.svg
2. Stacked: mark centred above the wordmark, gap equal to the cap height. mark/berth-lockup-stacked.svg
3. Wordmark alone. mark/berth-wordmark.svg

The wordmark is Archivo SemiBold, tracked -1.2%, sentence case only: Berth. Never BERTH, never berth, never a period after it.

## Type
Inter Tight 400 for headings and display, tracked tight (-2% at section size, -3% at hero size). Inter 400 to 600 for any sentence and every control. IBM Plex Mono for numbers, tickers and domains. Archivo SemiBold for the wordmark and nothing else. Headings are never bold: size and tracking carry them.

## Misuse
1. A gradient fill inside the mark or wordmark. The mark is one flat colour, always.
2. The mark on accent with accent-coloured text beside it. On accent the mark is ink or bg, and text beside it is ink or bg too.
Also avoid: the mark in accent on bg, the mark rotated, the mark with a stroke outline, the wordmark in any other face.

## Lines
Lead line, verbatim, comma and one full stop: Wall Street, in your wallet.
Plain descriptor, paired with it: Real US stocks, bought from your crypto wallet.
Value proposition: Buy US stocks with the crypto you hold. Keep them in your own wallet.
The canon, with the lines rejected and why, is the Tagline section of docs/product/features.md.
Retired: "A place to tie up.", "Stocks for the money that already lives onchain.".

## Punctuation
Commas and periods. No dashes, no emoji, no play on "birth".
