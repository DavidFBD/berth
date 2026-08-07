/**
 * Repo-standard screenshot harness. Every visual check goes through this —
 * no ad-hoc puppeteer/playwright scripts per session.
 *
 *   pnpm shot                                  # webkit, original mode, 390x844
 *   pnpm shot --mode aurora                    # any mode id from lib/modes
 *   pnpm shot --browser chromium --out x.png
 *   pnpm shot --url http://localhost:3000/foo --viewport 1280x800
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
const mode = arg("mode", null);
const out = arg("out", `shot${mode ? `-${mode}` : ""}.png`);
const browserName = arg("browser", "webkit");
const [width, height] = arg("viewport", "390x844").split("x").map(Number);
const settleMs = Number(arg("settle", "3000"));

const engine = browserName === "chromium" ? chromium : webkit;

// Wait for the server rather than making the caller sequence it.
const origin = new URL(url).origin;
for (let tries = 0; ; tries++) {
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
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
if (mode) {
  await page.addInitScript((m) => {
    try {
      localStorage.setItem("lsteatime.mode", m);
    } catch {}
  }, mode);
}
await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
// The silk shader and font swaps need a beat after network idle.
await page.waitForTimeout(settleMs);
await page.screenshot({ path: out });
console.log(
  `${out} (${browserName} ${width}x${height}${mode ? `, mode=${mode}` : ""})`,
);
await browser.close();
