/**
 * Repo-standard screenshot harness. Every visual check goes through this —
 * no ad-hoc puppeteer/playwright scripts per session.
 *
 *   pnpm shot                                  # webkit, iPhone viewport, 390x844
 *   pnpm shot --browser chromium --out x.png
 *   pnpm shot --url http://localhost:3000/foo --viewport 1280x800
 *   pnpm shot --scheme dark                    # emulates prefers-color-scheme
 *   pnpm shot --hover "li:has-text('NVIDIA')"  # a hover-revealed control
 *   pnpm shot --local-storage '{"key":"value"}' # seeded once, before first load
 *   pnpm shot --reload-out second.png          # reload in the same context, shoot again
 *   pnpm shot --full                           # the whole page, not just the viewport
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

const url = arg("url", "http://localhost:3000");
const out = arg("out", "shot.png");
const browserName = arg("browser", "webkit");
const [width, height] = arg("viewport", "390x844").split("x").map(Number);
const settleMs = Number(arg("settle", "3000"));
const dpr = Number(arg("dpr", "2"));
const colorScheme = arg("scheme", "light");
// A control that only exists under the cursor cannot be reviewed without one.
const hover = arg("hover", null);
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
const fullPage = process.argv.includes("--full");

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

const browser = await engine.launch();
const ctx = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: dpr,
  colorScheme,
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
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
// Font swaps and first queries need a beat after network idle.
await page.waitForTimeout(settleMs);
if (hover) {
  await page.locator(hover).first().hover();
  // Let the reveal finish before the shutter.
  await page.waitForTimeout(400);
}
await page.screenshot({ path: out, fullPage });
console.log(
  `${out} (${browserName} ${width}x${height} ${colorScheme})`,
);
if (reloadOut) {
  await page.reload({ waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(settleMs);
  await page.screenshot({ path: reloadOut, fullPage });
  console.log(`${reloadOut} (after reload, same context)`);
}
await browser.close();
