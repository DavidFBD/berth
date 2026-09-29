// Writes the avatar set from scripts/avatars/art.mjs:
//   public/avatars/<file>.svg          the faces the app serves
//   public/avatars/locked/<file>.svg   the locked silhouettes
//   public/berth-brand/app/avatars/    the same files, for the brand kit
// Run with `pnpm avatars:build`; pass --sheet <path> to also write a
// contact sheet (every face at 128/64/40/28 px, open and locked).
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FACES, faceSvg, lockedSvg } from "./art.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const targets = [path.join(root, "public/avatars"), path.join(root, "public/berth-brand/app/avatars")];

for (const dir of targets) {
  // Replace the set whole, so a retired file never lingers.
  for (const sub of [dir, path.join(dir, "locked")]) {
    mkdirSync(sub, { recursive: true });
    for (const f of readdirSync(sub)) if (f.endsWith(".svg")) rmSync(path.join(sub, f));
  }
  for (const face of FACES) {
    writeFileSync(path.join(dir, `${face.file}.svg`), faceSvg(face));
    writeFileSync(path.join(dir, "locked", `${face.file}.svg`), lockedSvg(face));
  }
}
console.log(`wrote ${FACES.length} faces and ${FACES.length} silhouettes to ${targets.length} places`);

const sheetAt = process.argv.indexOf("--sheet");
if (sheetAt > 0) {
  const out = process.argv[sheetAt + 1];
  const row = (svg) =>
    [128, 64, 40, 28].map((s) => `<img width="${s}" height="${s}" src="data:image/svg+xml;utf8,${encodeURIComponent(svg)}">`).join("");
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:24px;font:13px Inter,system-ui;background:#F7F6F4;color:#1C1917}
    .dark{background:#0F0E0D;color:#F2F0EE}
    .r{display:flex;align-items:center;gap:14px;margin:6px 0}.n{width:140px}
  </style>${["", "dark"].map((cls) => `<div class="${cls}" style="padding:12px">${FACES.map((f) => `<div class="r"><span class="n">${f.label}</span>${row(faceSvg(f))}${row(lockedSvg(f))}</div>`).join("")}</div>`).join("")}`;
  writeFileSync(out, html);
  console.log(`sheet: ${out}`);
}
