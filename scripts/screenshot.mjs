/**
 * Repo-standard screenshot harness. Every visual check goes through this —
 * no ad-hoc puppeteer/playwright scripts per session.
 *
 *   pnpm shot                                  # webkit, iPhone viewport, 390x844
 *   pnpm shot --browser chromium --out x.png
 *   pnpm shot --url http://localhost:3000/foo --viewport 1280x800
 *   pnpm shot --scheme dark                    # emulates prefers-color-scheme
 *   pnpm shot --hover "li:has-text('NVIDIA')"  # a hover-revealed control
 *   pnpm shot --click "text=Advanced" --click "text=Export a private key"
 *                                               # click through a multi-step
 *                                               # flow before the shutter,
 *                                               # in order, one repeatable flag
 *   pnpm shot --local-storage '{"key":"value"}' # seeded once, before first load
 *   pnpm shot --reload-out second.png          # reload in the same context, shoot again
 *   pnpm shot --full                           # the whole page, not just the viewport
 *   pnpm shot --reduced-motion                 # emulates prefers-reduced-motion: reduce
 *   pnpm shot --scroll-to "[data-film-phone]" --scroll-offset -200
 *                                               # bring an element to the top of the
 *                                               # viewport, then nudge by px (a still
 *                                               # of scroll-linked motion mid-scroll)
 *   pnpm shot --probe "document.querySelector('video').paused"
 *                                               # print a page expression after the shutter
 *   pnpm shot --cookie "berth-staff=<token>"    # a cookie for the page's origin, before
 *                                               # first load (the staff area's session;
 *                                               # repeatable)
 *
 * The last two exist for state a browser keeps between visits (the posts
 * column's "new to you" mark): seed it, shoot, reload, shoot again.
 *
 * Appearance is light, dark or system (next-themes), so --scheme only flips
 * the app for a visitor left on system, which is the default. A check of the
 * dark palette wants both: one shot per scheme.
 *
 * Webkit is the default on purpose: every iOS browser is WebKit, so a change
 * that only renders correctly in Chromium is not verified. Browser builds come
 * from the shared Playwright cache (~/Library/Caches/ms-playwright); if launch
 * complains the build is missing, run: pnpm exec playwright-core install webkit
 *
 * Waits for the dev server itself, so `pnpm dev & pnpm shot` just works.
 */
import { webkit, chromium } from "playwright-core";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

/** Every occurrence of a repeatable flag, in the order given. */
const argAll = (name) => {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return out;
};

const url = arg("url", "http://localhost:3000");
const out = arg("out", "shot.png");
const browserName = arg("browser", "webkit");
const [width, height] = arg("viewport", "390x844").split("x").map(Number);
const settleMs = Number(arg("settle", "3000"));
const dpr = Number(arg("dpr", "2"));
const colorScheme = arg("scheme", "light");
// A control that only exists under the cursor cannot be reviewed without one.
const hover = arg("hover", null);
// A multi-step flow (open a disclosure, then tap the row it reveals) clicked
// through in order before the shutter.
const clicks = argAll("click");
const storageSeedRaw = arg("local-storage", null);
let storageSeed = null;
if (storageSeedRaw) {
  try {
    storageSeed = JSON.parse(storageSeedRaw);
  } catch (error) {
    console.error(`--local-storage is not valid JSON: ${error.message}`);
    process.exit(1);
  }
  if (!storageSeed || typeof storageSeed !== "object" || Array.isArray(storageSeed)) {
    console.error('--local-storage wants an object of key to value, like \'{"key":"value"}\'');
    process.exit(1);
  }
}
const reloadOut = arg("reload-out", null);
const scrollTo = arg("scroll-to", null);
const scrollOffset = Number(arg("scroll-offset", "0"));
const probe = arg("probe", null);
const fullPage = process.argv.includes("--full");
const reducedMotion = process.argv.includes("--reduced-motion") ? "reduce" : "no-preference";

const engine = browserName === "chromium" ? chromium : webkit;

// Wait for the server rather than making the caller sequence it. Static
// files (og cards and other art in scripts/) have no server to wait for.
const isFile = new URL(url).protocol === "file:";
const origin = isFile ? null : new URL(url).origin;
for (let tries = 0; !isFile; tries++) {
  try {
    await fetch(origin, { signal: AbortSignal.timeout(2000) });
    break;
  } catch {
    if (tries >= 30) {
      console.error(`No server at ${origin} after 60s. Is \`pnpm dev\` running?`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const browser = await engine.launch({ headless: true });
// Never leave a browser behind: close it on any failure or interrupt too.
const closeAndExit = (code) => () => {
  browser.close().catch(() => {}).finally(() => process.exit(code));
};
process.on("uncaughtException", (error) => { console.error(error); closeAndExit(1)(); });
process.on("unhandledRejection", (error) => { console.error(error); closeAndExit(1)(); });
process.on("SIGINT", closeAndExit(130));
process.on("SIGTERM", closeAndExit(143));
const ctx = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: dpr,
  colorScheme,
  reducedMotion,
});
if (storageSeed) {
  // Once per tab, so a reload keeps whatever the page wrote in between.
  await ctx.addInitScript((seed) => {
    try {
      // The page itself only, never an iframe inside it.
      if (window !== window.top) return;
      if (sessionStorage.getItem("__shot_seeded")) return;
      sessionStorage.setItem("__shot_seeded", "1");
      for (const [key, value] of Object.entries(seed)) {
        localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
      }
    } catch {}
  }, storageSeed);
}
const cookies = argAll("cookie");
if (cookies.length && origin) {
  await ctx.addCookies(
    cookies.map((pair) => {
      const at = pair.indexOf("=");
      return { name: pair.slice(0, at), value: pair.slice(at + 1), url: origin, sameSite: "Strict", httpOnly: true };
    }),
  );
}
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
// Font swaps and first queries need a beat after network idle.
await page.waitForTimeout(settleMs);
if (hover) {
  await page.locator(hover).first().hover();
  // Let the reveal finish before the shutter.
  await page.waitForTimeout(400);
}
for (const selector of clicks) {
  await page.locator(selector).first().click();
  // Let each step's transition settle before the next click or the shutter.
  await page.waitForTimeout(400);
}
if (fullPage) {
  // Lazy images (next/image) load only near the viewport: walk the page
  // once so the whole-page shot shows them, then come back to the top.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(400);
}
if (scrollTo) {
  // Step there so scroll-linked motion and in-view observers see a real scroll.
  await page.waitForSelector(scrollTo, { state: "attached", timeout: 60_000 });
  await page.evaluate(
    async ({ selector, offset }) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`--scroll-to found nothing for ${selector}`);
      const target = el.getBoundingClientRect().top + window.scrollY + offset;
      const from = window.scrollY;
      for (let i = 1; i <= 12; i++) {
        window.scrollTo(0, from + ((target - from) * i) / 12);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
    { selector: scrollTo, offset: scrollOffset },
  );
  await page.waitForTimeout(settleMs);
}
await page.screenshot({ path: out, fullPage });
console.log(
  `${out} (${browserName} ${width}x${height} ${colorScheme})`,
);
if (probe) console.log(`probe: ${JSON.stringify(await page.evaluate(probe))}`);
if (reloadOut) {
  await page.reload({ waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(settleMs);
  await page.screenshot({ path: reloadOut, fullPage });
  console.log(`${reloadOut} (after reload, same context)`);
}
await browser.close();
