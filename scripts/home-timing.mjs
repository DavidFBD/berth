/**
 * Times the signed-in home's loading sequence in a real browser (webkit by
 * default): when the account total, its parts, Funds, Cash and What you own
 * stop being skeletons, and when each first shows a figure. Read only: it
 * signs in nobody; a stand-in wallet (scripts/lib/mock-evm-wallet.js) holds
 * the address and a pocketed wallet session (minted against the dev
 * server's own SESSION_SECRET) does the rest.
 *
 *   node scripts/home-timing.mjs --address 0x… --secret <dev SESSION_SECRET> \
 *     [--url http://localhost:3247/] [--runs 3] [--shots dir] [--browser chromium] [--max 40000]
 *     [--slow "polygon.drpc.org=30000,sonic-rpc.publicnode.com=4000"]   # simulated latency per host
 *     [--fail "rpc.soniclabs.com,sonic.drpc.org"]                      # hosts that answer 503
 *     [--redirect "rpc.soniclabs.com=sonic-rpc.publicnode.com"]        # serve a host's reads from another
 *     [--viewport 390x844]                                            # a phone (default 1280x860)
 *     [--net]                                                         # log every cross-origin read
 */
import { hkdfSync, randomUUID } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { SignJWT } from "jose";
import { webkit, chromium } from "playwright-core";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const address = arg("address").toLowerCase();
const secret = arg("secret");
const url = arg("url", "http://localhost:3247/");
const runs = Number(arg("runs", "1"));
const shots = arg("shots");
const max = Number(arg("max", "40000"));
const engine = arg("browser", "webkit") === "chromium" ? chromium : webkit;

const key = new Uint8Array(hkdfSync("sha256", secret, "lsteatime", "wallet-session-v1", 32));
const token = await new SignJWT({ purpose: "wallet-session", sub: address })
  .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setJti(randomUUID()).setExpirationTime("2d").sign(key);
const now = Date.now();
const seed = {
  __mock_wallet: JSON.stringify({ address }),
  __mock_wallet_authorized: "1",
  "berth.wallet-sessions": JSON.stringify({ [address]: { token, address, expiresAt: now + 2 * 86400000, storedAt: now } }),
  "berth.wallet-restore.v1": JSON.stringify({ address, id: "xyz.hana.mock", name: "Hana" }),
  // The consent card is not what is being timed.
  "berth.analytics-consent": "denied",
};
const mock = readFileSync(new URL("./lib/mock-evm-wallet.js", import.meta.url), "utf8");

// What the page shows, read every 100 ms.
const READ = () => {
  const text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const sk = (el) => (el ? el.querySelectorAll("[data-slot=skeleton]").length : -1);
  const total = Array.from(document.querySelectorAll("section")).find((s) => text(s).startsWith("Your account"));
  const parts = total ? Array.from(total.querySelectorAll("dl > div")).map((d) => ({ label: text(d.querySelector("dt")), sk: sk(d), lk: !!d.querySelector("dd[data-last-known]"), value: text(d.querySelector("dd")) })) : [];
  const row = (title) => {
    const h = Array.from(document.querySelectorAll("h2")).find((h2) => text(h2).startsWith(title));
    const box = h?.closest("[data-ph-mask]");
    return box ? { sk: sk(box), lk: !!box.querySelector("[data-last-known]"), text: text(box).slice(0, 80) } : null;
  };
  const ownedHeading = Array.from(document.querySelectorAll("h2,h3")).find((h) => text(h).startsWith("What you own"));
  const owned = ownedHeading?.closest("section,div[class*=rounded]") ?? null;
  return {
    total: total ? { sk: total.querySelector("p.money") ? 0 : 1, value: text(total.querySelector("p.money")), updating: !!total.querySelector("[data-last-known]") } : null,
    parts,
    funds: row("Funds"),
    cash: row("Cash"),
    owned: owned ? { sk: sk(owned), text: text(owned).slice(0, 60) } : null,
    skeletons: document.querySelectorAll("[data-slot=skeleton]").length,
    lastKnown: document.querySelectorAll("[data-last-known]").length,
  };
};

const results = [];
for (let run = 0; run < runs; run += 1) {
  const browser = await engine.launch({ headless: true });
  try {
    const [width, height] = arg("viewport", "1280x860").split("x").map(Number);
    const context = await browser.newContext({ viewport: { width, height }, ...(width < 768 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    await context.addInitScript((entries) => {
      if (sessionStorage.getItem("__seeded")) return;
      sessionStorage.setItem("__seeded", "1");
      for (const [k, v] of Object.entries(entries)) if (v) localStorage.setItem(k, v);
    }, seed);
    // Simulated conditions: a slow host answers late, a failing one 503s.
    const slow = Object.fromEntries((arg("slow", "") || "").split(",").filter(Boolean).map((pair) => pair.split("=")).map(([h, ms]) => [h, Number(ms)]));
    const failing = new Set((arg("fail", "") || "").split(",").filter(Boolean));
    const redirect = Object.fromEntries((arg("redirect", "") || "").split(",").filter(Boolean).map((pair) => pair.split("=")));
    if (Object.keys(slow).length || failing.size || Object.keys(redirect).length) {
      await context.route(
        (target) => target.host in slow || failing.has(target.host) || target.host in redirect,
        async (route) => {
          const host = new URL(route.request().url()).host;
          if (failing.has(host)) return route.fulfill({ status: 503, body: "No backend available" });
          if (redirect[host]) {
            const target = new URL(route.request().url());
            target.host = redirect[host];
            target.pathname = "/";
            try { await route.continue({ url: target.toString() }); } catch {}
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, slow[host]));
          try { await route.continue(); } catch {}
        },
      );
    }
    // After the seed, so the stand-in wallet reads the address it is given.
    await context.addInitScript(mock);
    const page = await context.newPage();
    const t0 = Date.now();
    // --net: every cross-origin read (RPCs, oracles) with when it started and how long it took.
    const net = [];
    if (process.argv.includes("--net")) {
      const started = new Map();
      page.on("request", (request) => started.set(request, Date.now() - t0));
      const done = (failed) => (request) => {
        const u = new URL(request.url());
        if (u.origin === new URL(url).origin) return;
        const body = request.postData() ?? "";
        const method = (body.match(/"method":"([^"]+)"/) ?? [])[1] ?? request.method();
        const entry = { host: u.host, method, at: started.get(request), ms: Date.now() - t0 - (started.get(request) ?? 0), failed: failed ? request.failure()?.errorText : undefined };
        if (method === "eth_call") {
          const to = (body.match(/"to":"(0x[0-9a-fA-F]{40})"/) ?? [])[1];
          const data = (body.match(/"data":"(0x[0-9a-fA-F]{8})/) ?? [])[1];
          entry.call = `${to?.slice(0, 10)}:${data}`;
          entry.batch = body.startsWith("[") ? (body.match(/"method"/g) ?? []).length : 1;
        }
        net.push(entry);
        if (!failed) request.response().then((response) => { entry.status = response?.status(); }).catch(() => {});
      };
      page.on("requestfinished", done(false));
      page.on("requestfailed", done(true));
    }
    await page.goto(url, { waitUntil: "commit" });
    const firsts = {};
    const mark = (name, cond, t) => { if (cond && firsts[name] === undefined) firsts[name] = t; };
    let last;
    const shotAt = shots ? [1000, 2500, 5000, 8000, 12000, 20000] : [];
    if (shots) mkdirSync(shots, { recursive: true });
    while (Date.now() - t0 < max) {
      const t = Date.now() - t0;
      let s;
      try { s = await page.evaluate(READ); } catch { await page.waitForTimeout(100); continue; }
      last = s;
      mark("accountShown", s.total, t);
      mark("totalFigure", s.total && s.total.sk === 0, t);
      mark("totalLive", s.total && s.total.sk === 0 && !s.total.updating, t);
      for (const p of s.parts) {
        mark(`part:${p.label}`, p.sk === 0, t);
        mark(`live:${p.label}`, p.sk === 0 && !p.lk, t);
      }
      mark("fundsRowLive", s.funds && s.funds.sk === 0 && !s.funds.lk, t);
      mark("fundsRow", s.funds && s.funds.sk === 0, t);
      mark("cashRow", s.cash && s.cash.sk === 0, t);
      mark("owned", s.owned && s.owned.sk === 0, t);
      mark("noSkeletons", s.total && s.skeletons === 0, t);
      mark("allLive", s.total && s.skeletons === 0 && s.lastKnown === 0, t);
      while (shotAt.length && t >= shotAt[0]) {
        const at = shotAt.shift();
        await page.screenshot({ path: `${shots}/run${run + 1}-${String(at).padStart(5, "0")}ms.png` });
      }
      if (firsts.allLive !== undefined && !shotAt.length) break;
      await page.waitForTimeout(100);
    }
    results.push({ run: run + 1, firsts, last, net });
    console.log(JSON.stringify({ run: run + 1, firsts }));
    await context.close();
  } finally {
    await browser.close();
  }
}
console.log(JSON.stringify({ results }, null, 1));
