#!/usr/bin/env node
/**
 * Does the staff door's reload carry a SameSite=Strict cookie after a visit
 * that began with a link from another site? (docs/adr/0008-staff-area.md,
 * lib/staff/door, components/staff/fresh StaffDoor; review M1.)
 *
 * One tiny server on 127.0.0.1:<port>, answering two sites by Host:
 * http://127.0.0.1:<port> (the other site, with a link) and
 * http://localhost:<port> (Berth's stand in, which sets the cookies).
 * Different hosts are different sites (no registrable domain), so the
 * click is a cross-site top-level navigation.
 *
 * Per browser: set the cookies on localhost; open 127.0.0.1 and click the
 * link; then, from the landed page, (a) location.replace(location.href) as
 * the door does, (b) a same-origin fetch, (c) a same-origin POST form
 * navigation. The server records which cookies each request carried.
 *
 * Cookies: `strict` (SameSite=Strict, Path=/) and `__Host-strict` (also
 * Secure). A browser may refuse a Secure cookie over http://localhost; the
 * report says whether it was stored. SameSite is judged on the request's
 * site, independent of Secure and of the `__Host-` prefix (which only
 * limits how a cookie may be set), so the plain Strict cookie answers the
 * question for production's `__Host-berth-staff` either way.
 *
 * Usage: node scripts/staff-door-cookie-check.mjs [webkit] [chromium]
 * Headless; every browser is closed in finally. No Next server needed.
 */
import http from "node:http";
import { chromium, webkit } from "playwright-core";

const engines = { webkit, chromium };
const wanted = process.argv.slice(2).filter((name) => name in engines);
const names = wanted.length ? wanted : ["webkit", "chromium"];

const log = [];
const server = http.createServer((req, res) => {
  const host = (req.headers.host ?? "").split(":")[0];
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const cookie = req.headers.cookie ?? "";
  if (host === "localhost") log.push({ step: url.searchParams.get("step") ?? url.pathname, method: req.method, cookie });
  const port = server.address().port;
  if (host === "127.0.0.1" && url.pathname === "/start") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><a id="go" href="http://localhost:${port}/land?step=arrive">Berth</a>`);
    return;
  }
  if (host === "localhost" && url.pathname === "/set") {
    res.writeHead(200, {
      "content-type": "text/html",
      "set-cookie": ["strict=1; Path=/; SameSite=Strict; HttpOnly", "__Host-strict=1; Path=/; SameSite=Strict; Secure; HttpOnly"],
    });
    res.end("<!doctype html>set");
    return;
  }
  if (host === "localhost") {
    res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    res.end(`<!doctype html><p>${url.searchParams.get("step") ?? ""}</p>`);
    return;
  }
  res.writeHead(404);
  res.end();
});

const has = (cookie, name) => cookie.split(";").some((part) => part.trim().startsWith(`${name}=`));
const last = (step) => [...log].reverse().find((entry) => entry.step === step);

async function check(name, port) {
  log.length = 0;
  const browser = await engines[name].launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`http://localhost:${port}/set`);
    const stored = (await context.cookies(`http://localhost:${port}`)).map((c) => c.name);

    await page.goto(`http://127.0.0.1:${port}/start`);
    await Promise.all([page.waitForURL(/localhost.*step=arrive/), page.click("#go")]);

    // (a) The door: location.replace from the page itself.
    await Promise.all([
      page.waitForURL(/step=replace/),
      page.evaluate(() => window.location.replace(window.location.href.replace("step=arrive", "step=replace"))),
    ]);
    // (b) A same-origin fetch from the landed page (the knock itself).
    await page.evaluate(() => fetch("/knock?step=fetch", { method: "POST" }).then((r) => r.status));
    // (c) A same-origin POST form navigation (the fallback).
    await Promise.all([
      page.waitForURL(/step=form/),
      page.evaluate(() => {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = "/land?step=form";
        document.body.appendChild(form);
        form.submit();
      }),
    ]);

    const row = (step) => {
      const entry = last(step);
      return entry ? { strict: has(entry.cookie, "strict"), hostStrict: has(entry.cookie, "__Host-strict") } : null;
    };
    return { name, stored, arrive: row("arrive"), replace: row("replace"), fetch: row("fetch"), form: row("form") };
  } finally {
    await browser.close();
  }
}

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
let failed = false;
try {
  for (const name of names) {
    try {
      const r = await check(name, port);
      console.log(`\n${name}: stored cookies on localhost: ${r.stored.join(", ") || "none"}`);
      for (const step of ["arrive", "replace", "fetch", "form"]) {
        const s = r[step];
        console.log(`  ${step.padEnd(8)} strict=${s ? s.strict : "no request"}  __Host-strict=${s ? s.hostStrict : "no request"}`);
      }
      const ok = r.arrive && !r.arrive.strict && r.replace?.strict;
      console.log(`  verdict: ${ok ? "the door's location.replace carries the Strict cookie" : "location.replace does NOT carry the Strict cookie"}`);
      if (!ok) failed = true;
    } catch (error) {
      failed = true;
      console.log(`\n${name}: could not run (${error instanceof Error ? error.message.split("\n")[0] : error})`);
    }
  }
} finally {
  server.close();
}
process.exitCode = failed ? 1 : 0;
