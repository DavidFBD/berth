# Claude Design — Master Prompts for LSTeaTime

Feed the prompt below verbatim into Claude Design to generate the complete LSTeaTime design system. It contains everything the designer needs: concept, tone, every screen and state in the current app, and the full asset shopping list.

---

## Master Prompt: LSTeaTime Design System

You are designing the complete design system for **LSTeaTime** — a mobile-first web app that turns DeFi leveraged staked-yield vaults into a calming, satisfying little game of filling up tea cups.

### The concept

LSTeaTime is a **calming English tea ritual** with a knowing **wink to LSD** — the double entendre is intentional: LSD as *Liquid Staking Derivatives*, delivered with the gentle psychedelia of a very good tea trip. Think: a proper English tea room that's ever so slightly melting at the edges. Porcelain, doilies, and warm steam — but the wallpaper patterns swirl a little if you stare, the steam drifts into faint paisley, and the color grading has that soft late-afternoon glow of Alice about to fall down the rabbit hole. Never garish, never neon-cyberpunk, never "crypto". Serenity first; the trip is a whisper, not a shout.

**The core metaphor system (this is the product, not decoration):**

- **Vaults are tea mugs/cups.** Each of the three vaults is a distinct cup of tea. Depositing = pouring into your cup. Your position = how full your cup is.
- **Idle wallet funds sit in a teapot.** Assets in the connected account that aren't deposited yet live in a teapot; funding your account fills the teapot; deposits pour from the teapot into a cup.
- **Yield is heat.** Steam rises off each cup, and the steam's visibility/density/height scales with the value in the cup — more value = more yield being generated = visibly hotter tea. A near-empty cup barely wisps; a full cup billows gently. This is the app's signature visual.
- **Flavours are exposures.** Each cup is "flavoured" by its underlying asset. Two cups are ETH-flavoured and one is SOL-flavoured. Suggested naming (feel free to refine, keep it English-tea canonical):
  - **Earl Grey** — the weETH cup (EtherFi weETH, ETH flavour, distinguished, bergamot-blue accents)
  - **English Breakfast** — the wstETH cup (Lido wstETH, ETH flavour, robust, classic amber accents)
  - **Green Tea / Sencha** — the JitoSOL cup (Jito staked SOL, SOL flavour, fresh green accents)
  - The two ETH flavours must read as *siblings* (same tea family, different blends) while the SOL cup reads as a different tea tradition entirely.
- **No crypto language anywhere.** "Deposit" → "Pour a cup" / "Top up". "Withdraw" → "Pour back" / "Empty your cup". "APR" → "Brew strength" or simply "earning X%/year". "Vault" → "cup"/"blend". "Wallet" → "your pantry" or keep it invisible behind email login. Slippage, intents, solvers, hub wallets: fully hidden or translated ("your tea is steeping…" while a cross-chain fill completes). Keep one small "the details, for the curious" affordance that reveals the real numbers for power users.

### What the app does (so you design the right things)

A user signs in with email, funds their account by sending any of ~200 supported assets from any of 20 blockchain networks, picks a cup, and pours. The tea then earns leveraged staking yield (typically 5–15% APR — displayed per cup with live numbers). They watch their cups steam, see the dollar value of yield earned so far, and a projection of what one year of steeping would earn if they leave principal + yield in place. They can pour back to any asset on any network at any time.

### Screens & components to design (current build, mobile-first, one screen)

1. **Home / tea table** — header (logo + account button), the teapot (idle funds with total value), three tea cups in a column (each: flavour name + blend badge, brew strength (APR) as the hero number, amount steeping, YOUR yield earned in $, 1-year projection, steam animation scaled to value, "Pour" CTA). An expandable "how strong is this brew?" breakdown per cup (staking yield + lending spread − borrow cost, leverage multiplier, honest note when a number is an estimate).
2. **Pour flow (bottom sheet)** — pick source (network + asset with balances, search), amount entry with Max, live "you'll steep ≈ X" preview with minimum after slippage, then a brewing progress ritual: Build → Approve → Sign steps, then "steeping…" tracking until the fill completes, ending in a satisfying "your cup is poured" moment (this is the retention loop — make completion delightful: gentle chime-feeling visual, steam bloom, cup fills).
3. **Pour back flow (bottom sheet)** — mirror of the above: choose destination network + asset, amount in shares with Max, same steeping/tracking ritual.
4. **Account/pantry sheet** — email login state, funding addresses per network (QR + copy), connected external wallets (desktop only), sign out.
5. **Info modal ("how this was made")** — a playful flex: this app was vibed together with the SODAX Builders MCP and a small army of Claude agents/subagents; keep it charming, one screen, with a link out.
6. **States**: loading (skeletons styled as e.g. faint tea-ring stains, not gray boxes), empty (cups empty, inviting first pour), error ("the kettle's acting up — try again"), cancelled ("no worries, the tea's still warm"), in-flight cross-chain ("steeping, usually under a minute").
7. **Desktop presentation** — the mobile app renders inside an iPhone held by a hand, over a calm looping background video (tea room / pouring tea in soft focus). Design the desktop frame: video treatment (color grade, blur/vignette so the phone pops), phone placement, and what if anything lives outside the phone (logo, one-line tagline, info button).

### Deliverables (the complete design system)

1. **Brand**: logo (wordmark + a mark that works as favicon — a teacup with steam that subtly forms an upward yield arrow or a very subtle paisley curl), tagline options, voice & tone guide with a translation table (crypto term → LSTeaTime term) covering at least: deposit, withdraw, APR, vault, wallet, network, token, slippage, transaction pending/failed.
2. **Color system**: calming tea palette — creams, porcelain whites, warm earl-grey lavenders, tea-amber, sencha green, with ONE gently psychedelic accent treatment (e.g. an iridescent gradient used only on steam and celebratory moments). Full light AND dark mode ("morning tea" / "evening tea") with semantic tokens mapped to shadcn/Tailwind CSS variables (background, foreground, card, muted, primary, secondary, accent, destructive, border, ring) — provide exact OKLCH or hex values. Per-cup accent sub-palettes for the three flavours (two ETH siblings + one SOL).
3. **Typography**: font pairing (display + body + tabular numerals for money; Google Fonts or open licenses only) that says "English tea house, slightly dreamy" — not Web3, not fintech-sterile.
4. **Iconography**: Phosphor Duotone is the app's icon set — specify duotone color pairs per theme and per cup accent, and list the specific Phosphor icons to use for: pour/deposit, pour back/withdraw, teapot/balance, steam/yield, account, info, back, close, search, copy, QR, external link, success, warning, settings.
5. **Signature assets** (specify as SVG/Lottie-able where animated): the three tea cups (empty → full states, front-ish view that works at card size), the teapot, the steam system (3–4 intensity levels, loopable, subtle paisley/iridescence at highest level), a pour animation for deposit confirmation, tea-ring stain textures for backgrounds/skeletons, doily/lace border motifs used sparingly.
6. **Component specs**: the cup card (all states: empty, steeping, loading, error), the teapot header module, bottom sheets, the CTA button system (labels double as validation messages — design disabled/validation states that stay charming), the brewing stepper, the steeping tracker, toasts.
7. **Motion language**: timing/easing guidance — everything unhurried (tea, not espresso); steam always moving but never distracting; one celebratory "poured" moment; reduced-motion fallbacks.
8. **OG & social**: og:image (1200×630) for the app, per-cup share cards ("My Earl Grey is steeping at 10.2%"), favicon set (16/32/180/512 + maskable), PWA icon.
9. **Desktop stage**: the video-background + hand-held iPhone composition spec — including what to brief a stock-footage search with (3–5 concrete search queries and art direction for grading the footage to the palette).
10. **Accessibility**: contrast-checked palette (AA minimum on all text tokens in both themes), steam/motion never carrying sole meaning, touch targets ≥44px.

### Hard constraints

- Mobile-first (390px design width), works to desktop.
- Implementation target: Tailwind v4 + shadcn/ui + Phosphor Duotone icons + Next.js — deliver tokens as CSS variables ready to paste into globals.css.
- Real money is involved: numbers (balances, yield, projections) must always be legible, tabular, and honest — the playfulness lives around the numbers, never instead of them.
- The LSD wink stays subtle enough that a user's grandmother would just see a lovely tea app.
- No lorem ipsum: use the real vault data shapes above in every mock (e.g. "Earl Grey · 10.03%/yr · $412.88 steeping · earned $3.41 · ≈ $41.70 in a year").

Produce: the full design system document, the token sheet (CSS variables, both themes), and mockups of screens 1, 2 (all steps), 4, 5, and the desktop stage.
