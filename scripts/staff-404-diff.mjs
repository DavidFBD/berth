/**
 * Diffs the staff campaigns page, asked without a staff pass, against a
 * path that does not exist, on a running server (`pnpm build && pnpm
 * start`): status, every header but Date, and the body, byte for byte,
 * for GET, POST, HEAD and an RSC request. Exits 1 on any difference.
 *
 *   pnpm staff:404-diff                      # http://localhost:3000
 *   pnpm staff:404-diff --url http://localhost:3218
 */
const at = process.argv.indexOf("--url");
const base = at > 0 ? process.argv[at + 1] : "http://localhost:3000";
const paths = ["/staff/campaigns", "/staff/campaigns/anything"];
const cases = [
  { method: "GET", headers: {} },
  { method: "POST", headers: {} },
  { method: "HEAD", headers: {} },
  { method: "GET", headers: { RSC: "1" } },
];

async function read(path, { method, headers }) {
  const response = await fetch(base + path, { method, headers, redirect: "manual" });
  const head = [...response.headers].filter(([key]) => key !== "date").map(([key, value]) => `${key}: ${value}`).sort();
  return { status: response.status, head, body: Buffer.from(await response.arrayBuffer()) };
}

let failed = false;
for (const path of paths) {
  for (const testCase of cases) {
    const missing = await read(`/no-such-page-${Date.now()}`, testCase);
    const staff = await read(path, testCase);
    const same = missing.status === staff.status && missing.head.join("\n") === staff.head.join("\n") && missing.body.equals(staff.body);
    console.log(`${same ? "same" : "DIFFERENT"}  ${testCase.method}${testCase.headers.RSC ? " RSC" : ""} ${path} (${staff.status}, ${staff.body.length} B)`);
    if (!same) {
      failed = true;
      console.log("  unknown:", missing.status, missing.head);
      console.log("  staff:  ", staff.status, staff.head);
    }
  }
}
process.exit(failed ? 1 : 0);
