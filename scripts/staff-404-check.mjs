// Compares what the staff area answers a stranger with what any unknown
// address answers, method by method: status, headers and body, with the
// path itself and the parts that differ on every request (date, request
// ids, build hashes in a nonce) taken out. Read only; no cookie is sent.
//
// Usage: pnpm staff:404-check http://localhost:3220
//        (against `pnpm build && pnpm start`, or a preview deploy)
// Exits 1 on any difference.
const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"];
const PAIRS = [
  ["/staff", "/stafq"],
  ["/staff/users", "/stafq/users"],
  ["/staff/campaigns", "/stafq/campaigns"],
  ["/api/staff/actions", "/api/stafq/actions"],
  ["/api/staff/session", "/api/stafq/session"],
  ["/api/staff/reveal", "/api/stafq/reveal"],
];
// --rsc also sends Next's own RSC header. Next strips it before the proxy
// sees a request, so a refused RSC probe gets the HTML 404 where an unknown
// address gives the flight 404: a known difference (docs/adr/0008).
const VARIANTS = [
  {},
  { authorization: "Bearer junk" },
  { cookie: "berth-staff=forged; __Host-berth-staff=forged" },
  { authorization: "Bearer junk", upgrade: "websocket", connection: "upgrade" },
  { authorization: "Bearer junk", "x-forwarded-proto": "https" },
  ...(process.argv.includes("--rsc") ? [{ rsc: "1" }, { rsc: "1", cookie: "berth-staff=forged" }, { rsc: "1", authorization: "Bearer junk" }] : []),
];
const VARYING = new Set(["date", "x-vercel-id", "x-vercel-cache", "age", "x-request-id", "server-timing", "etag", "content-length"]);

async function answer(path, method, headers = {}) {
  // fetch cannot send TRACE or hop-by-hop headers itself: those go over a raw socket.
  if (method === "TRACE" || headers.upgrade) return raw(path, method, headers);
  const response = await fetch(base + path, { method, headers, redirect: "manual" });
  const body = method === "HEAD" ? "" : await response.text();
  const keep = [...response.headers.entries()].filter(([key]) => !VARYING.has(key)).map(([key, value]) => [key, value.split(path).join("<path>")]);
  return { status: response.status, headers: Object.fromEntries(keep.sort()), body: body.split(path).join("<path>").replace(/nonce="[^"]*"/g, "") };
}

import { request as httpRequest } from "node:http";
function raw(path, method, headers) {
  return new Promise((resolve) => {
    const url = new URL(base + path);
    const req = httpRequest({ host: url.hostname, port: url.port, path: url.pathname, method, headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => {
        const keep = Object.entries(response.headers)
          .filter(([key]) => !VARYING.has(key) && key !== "connection" && key !== "keep-alive" && key !== "transfer-encoding")
          .map(([key, value]) => [key, String(value).split(path).join("<path>")]);
        resolve({ status: response.statusCode, headers: Object.fromEntries(keep.sort()), body: body.split(path).join("<path>").replace(/nonce="[^"]*"/g, "") });
      });
    });
    // An upgrade the server holds open is answered by a timeout, on both sides alike.
    req.setTimeout(4000, () => {
      req.destroy();
      resolve({ status: "timeout", headers: {}, body: "" });
    });
    req.on("upgrade", (response, socket) => {
      socket.destroy();
      resolve({ status: response.statusCode, headers: {}, body: "upgraded" });
    });
    req.on("error", (error) => resolve({ status: `error:${error.code ?? error.message}`, headers: {}, body: "" }));
    req.end();
  });
}

let differences = 0;
let traceDifferences = 0;
for (const [staff, unknown] of PAIRS) {
  for (const method of METHODS) {
    for (const extra of VARIANTS) {
      const [a, b] = await Promise.all([answer(staff, method, extra), answer(unknown, method, extra)]);
      const same = a.status === b.status && JSON.stringify(a.headers) === JSON.stringify(b.headers) && a.body === b.body;
      if (!same && method === "TRACE") {
        // Next cannot build a NextRequest for TRACE and answers 500 before the
        // proxy's own code runs, on any path the proxy matches. Not fixable in
        // the proxy; counted apart, and checked on Vercel (docs/adr/0008).
        traceDifferences += 1;
        continue;
      }
      if (!same) {
        differences += 1;
        console.log(`DIFF ${method} ${staff}${Object.keys(extra).length ? ` (${Object.keys(extra).join("+")})` : ""}: ${a.status} vs ${b.status}`);
        for (const key of new Set([...Object.keys(a.headers), ...Object.keys(b.headers)])) {
          if (a.headers[key] !== b.headers[key]) console.log(`  header ${key}: ${a.headers[key]} | ${b.headers[key]}`);
        }
        if (a.body !== b.body) console.log(`  body differs: ${a.body.length} vs ${b.body.length} bytes`);
      }
    }
  }
}
const total = PAIRS.length * METHODS.length * VARIANTS.length;
console.log(differences === 0 ? `Same as an unknown address: ${total - traceDifferences} of ${total} requests.` : `${differences} differences.`);
if (traceDifferences) console.log(`Known: ${traceDifferences} TRACE requests answered 500 by Next before the proxy (an unknown path: 404). Check TRACE on Vercel.`);
process.exit(differences === 0 ? 0 : 1);
