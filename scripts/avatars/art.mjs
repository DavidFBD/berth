// Berth's avatar set: harbour creatures (direction A, approved 2026-09-29).
// Every face is a 128x128 viewBox clipped to a circle, flat shapes only.
// Palette: Berth stone neutrals and ink, one warm brown and one ochre for the
// creatures, and Berth blue on exactly one thing per face. The two faces that
// are wholly blue (the Blue Crab, the Blue Lobster) open with rank.
//
// `pnpm avatars:build` writes public/avatars/<file>.svg, the locked
// silhouettes in public/avatars/locked/, and a copy for the brand kit.

export const P = {
  disc: "#ECE9E4", sand: "#E0D9CF", soft: "#E3E9FB",
  faint: "#A8A29E", muted: "#6F6964", ink2: "#44403C", ink: "#1C1917",
  blue: "#1F4ED8", blueDeep: "#1A3FAF",
  // creature tones
  stone: "#8E8781", stoneDark: "#766F69", stoneLight: "#BDB6AE", stonePale: "#D2CBC3",
  brown: "#7B6453", brownDark: "#6A5445", brownLight: "#A58B76", cream: "#E6D9C6",
  ochre: "#E0A63A", ochreDark: "#C98C22", white: "#FFFFFF", feather: "#2B2724",
};

/** The flat colour a locked face is drawn in, on the plain disc. */
export const SILHOUETTE = "#D6D0C9";

const eye = (x, y, r = 4.2) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${P.ink}"/><circle cx="${x + r * 0.36}" cy="${y - r * 0.36}" r="${(r * 0.34).toFixed(2)}" fill="#fff"/>`;

/* ---- open to everyone ---- */

const seal = {
  bg: P.disc,
  body: `
  <path d="M0 106 Q16 102 32 106 T64 106 T96 106 T128 106 V128 H0Z" fill="${P.soft}"/>
  <path d="M28 128 C28 98 42 82 64 82 C86 82 100 98 100 128Z" fill="${P.stone}"/>
  <path d="M46 128 C46 108 53 97 64 97 C75 97 82 108 82 128Z" fill="${P.stoneLight}"/>
  <path d="M38 102 C28 104 20 112 19 120 C28 121 38 116 43 108Z" fill="${P.stoneDark}"/>
  <path d="M90 102 C100 104 108 112 109 120 C100 121 90 116 85 108Z" fill="${P.stoneDark}"/>
  <circle cx="64" cy="62" r="29" fill="${P.stone}"/>
  <ellipse cx="57" cy="72" rx="10" ry="8" fill="${P.stonePale}"/>
  <ellipse cx="71" cy="72" rx="10" ry="8" fill="${P.stonePale}"/>
  <path d="M59 65.5 Q64 62.5 69 65.5 Q69 70 64 71 Q59 70 59 65.5Z" fill="${P.ink}"/>
  <path d="M60 77 Q64 80.5 68 77" fill="none" stroke="${P.ink}" stroke-width="2" stroke-linecap="round"/>
  <circle cx="52.5" cy="72" r="1.2" fill="${P.stone}"/><circle cx="55.5" cy="75.5" r="1.2" fill="${P.stone}"/>
  <circle cx="75.5" cy="72" r="1.2" fill="${P.stone}"/><circle cx="72.5" cy="75.5" r="1.2" fill="${P.stone}"/>
  ${eye(51, 55, 4.4)}${eye(77, 55, 4.4)}
  <circle cx="64" cy="22" r="12" fill="${P.blue}"/>
  <path d="M52.6 18.4 Q64 25 75.4 18.4 L76 22 Q64 29 52 22Z" fill="#fff"/>`,
};

const gull = {
  bg: P.soft,
  body: `
  <path d="M26 128 C26 100 38 82 58 80 C76 80 88 98 90 128Z" fill="#fff"/>
  <path d="M16 128 C18 106 28 90 44 84 C38 100 40 116 50 128Z" fill="${P.faint}"/>
  <path d="M16 128 C17 118 20 110 24 104 C26 114 30 122 34 128Z" fill="${P.ink2}"/>
  <circle cx="56" cy="56" r="25" fill="#fff"/>
  <path d="M76 50 C84 50 94 53 100 57 C94 60 84 63 76 63Z" fill="${P.ochre}"/>
  <path d="M76 57 C84 57 94 57.5 100 57 C94 60 84 63 76 63Z" fill="${P.ochreDark}"/>
  <circle cx="94" cy="59.4" r="2" fill="#B84A2E"/>
  ${eye(64, 47, 4)}
  <path d="M57 40.5 Q63 37.5 70 40" fill="none" stroke="${P.muted}" stroke-width="2.2" stroke-linecap="round"/>
  <g transform="translate(92 60) rotate(62)">
    <path d="M0 0 C6 -5 16 -5 20 0 C16 5 6 5 0 0Z" fill="${P.blue}"/>
    <path d="M19 0 L27 -5 L26 5Z" fill="${P.blue}"/>
    <circle cx="5" cy="-0.6" r="1.3" fill="#fff"/>
  </g>`,
};

const otter = {
  bg: P.disc,
  body: `
  <path d="M0 104 Q16 99 32 104 T64 104 T96 104 T128 104 V128 H0Z" fill="${P.soft}"/>
  <path d="M22 128 C22 104 40 90 64 90 C88 90 106 104 106 128Z" fill="${P.brown}"/>
  <path d="M42 128 C42 112 52 104 64 104 C76 104 86 112 86 128Z" fill="${P.brownLight}"/>
  <circle cx="35" cy="48" r="7" fill="${P.brownDark}"/><circle cx="93" cy="48" r="7" fill="${P.brownDark}"/>
  <ellipse cx="64" cy="62" rx="33" ry="28" fill="${P.brown}"/>
  <path d="M38 66 C38 50 50 42 64 42 C78 42 90 50 90 66 C90 80 78 88 64 88 C50 88 38 80 38 66Z" fill="${P.cream}"/>
  <ellipse cx="57" cy="72" rx="9" ry="7" fill="#F4ECE0"/><ellipse cx="71" cy="72" rx="9" ry="7" fill="#F4ECE0"/>
  <path d="M58 65 Q64 62 70 65 Q69.5 70 64 71.5 Q58.5 70 58 65Z" fill="${P.ink}"/>
  <path d="M64 71.5 V74.5 M58.5 75 Q61.2 78 64 74.5 Q66.8 78 69.5 75" fill="none" stroke="${P.ink}" stroke-width="1.9" stroke-linecap="round"/>
  <g stroke="${P.brownLight}" stroke-width="1.4" stroke-linecap="round"><path d="M47 71 L36 69"/><path d="M47 75 L37 77"/><path d="M81 71 L92 69"/><path d="M81 75 L91 77"/></g>
  ${eye(53, 57, 3.8)}${eye(75, 57, 3.8)}
  <path d="M50 110 Q64 86 78 110 Q64 116 50 110Z" fill="${P.blue}"/>
  <path d="M64 94 V112 M58 98 L57 111 M70 98 L71 111" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".55"/>
  <ellipse cx="49" cy="106" rx="7" ry="6" fill="#5C4838"/><ellipse cx="79" cy="106" rx="7" ry="6" fill="#5C4838"/>`,
};

// Front on, so it reads apart from the gull: dark hood, pale mask, and the
// blue-grey plate at the base of a puffin's beak drawn in Berth blue.
const puffin = {
  bg: P.disc,
  body: `
  <path d="M24 128 C24 100 40 86 64 86 C88 86 104 100 104 128Z" fill="${P.feather}"/>
  <path d="M44 128 C44 108 52 98 64 98 C76 98 84 108 84 128Z" fill="#fff"/>
  <circle cx="64" cy="58" r="31" fill="${P.feather}"/>
  <path d="M39 62 C37 46 49 37 64 43 C79 37 91 46 89 62 C88 77 78 85 64 85 C50 85 40 77 39 62Z" fill="#F4F1EC"/>
  ${eye(51, 58, 4.2)}${eye(77, 58, 4.2)}
  <path d="M54 64 Q64 58 74 64 L68.5 83 Q64 87.5 59.5 83Z" fill="${P.ochre}"/>
  <path d="M64 61.5 V85.5" stroke="${P.ochreDark}" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M61 74 Q64 76 67 74" fill="none" stroke="${P.ochreDark}" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M54 64 Q64 58 74 64 L72.6 69 Q64 64.4 55.4 69Z" fill="${P.blue}"/>`,
};

const starPath = (cx, cy, R, r, n = 5, rot = -90) => {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    const rad = i % 2 === 0 ? R : r;
    pts.push(`${(cx + Math.cos(a) * rad).toFixed(2)} ${(cy + Math.sin(a) * rad).toFixed(2)}`);
  }
  return `M${pts.join(" L")}Z`;
};

// A starfish on the sand with a blue periwinkle beside it.
const starfish = {
  bg: P.disc,
  body: `
  <path d="M0 96 Q32 90 64 94 T128 92 V128 H0Z" fill="${P.sand}"/>
  <path d="${starPath(62, 70, 42, 19)}" fill="#D9955F" stroke="#D9955F" stroke-width="12" stroke-linejoin="round"/>
  <path d="${starPath(62, 70, 30, 14)}" fill="none" stroke="#E7B584" stroke-width="3" stroke-linejoin="round" stroke-dasharray="0.1 7" stroke-linecap="round"/>
  ${eye(54, 66, 4)}${eye(70, 66, 4)}
  <path d="M57 75 Q62 79.5 67 75" fill="none" stroke="${P.ink}" stroke-width="2.2" stroke-linecap="round"/>
  <g transform="translate(102 104)">
    <path d="M-11 5 C-12 -6 -3 -12 5 -8 C11 -5 11 3 5 6 C0 8 -4 4 -1 1 C1 -1 4 0 3 2" fill="${P.blue}" stroke="${P.blue}" stroke-width="1" stroke-linejoin="round"/>
    <path d="M-12 5 H9 Q6 8 0 8 H-10Z" fill="${P.blue}"/>
    <path d="M5 -8 C11 -5 11 3 5 6 C0 8 -4 4 -1 1 C1 -1 4 0 3 2" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>
  </g>`,
};

// A moon jelly: its four rings, which really are blue, are the one blue.
const jelly = {
  bg: P.soft,
  body: `
  <g fill="none" stroke="#C9C3BC" stroke-width="3.2" stroke-linecap="round">
    <path d="M40 72 Q36 86 42 98 T40 124"/><path d="M88 72 Q92 86 86 98 T88 124"/>
  </g>
  <g fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round">
    <path d="M56 74 Q50 88 58 100 T54 126"/><path d="M72 74 Q78 88 70 100 T74 126"/>
  </g>
  <path d="M24 70 C24 40 42 24 64 24 C86 24 104 40 104 70 Q98 77 92 71 Q86 77 80 71 Q74 77 68 71 Q64 76 60 71 Q54 77 48 71 Q42 77 36 71 Q30 77 24 70Z" fill="#fff"/>
  <g fill="none" stroke="${P.blue}" stroke-width="3.4">
    <circle cx="54" cy="38" r="4.6"/><circle cx="74" cy="38" r="4.6"/>
  </g>
  <g fill="none" stroke="${P.blue}" stroke-width="3.4">
    <circle cx="44" cy="46" r="4"/><circle cx="84" cy="46" r="4"/>
  </g>
  ${eye(53, 56, 4.2)}${eye(75, 56, 4.2)}
  <path d="M59 63 Q64 67.5 69 63" fill="none" stroke="${P.ink}" stroke-width="2.2" stroke-linecap="round"/>`,
};

// A grey heron standing in the harbour; the water is its blue.
const heron = {
  bg: P.sand,
  body: `
  <g stroke="${P.ochreDark}" stroke-width="3" stroke-linecap="round"><path d="M70 92 L68 116"/><path d="M79 92 L81 116"/></g>
  <path d="M0 108 Q16 103 32 108 T64 108 T96 108 T128 108 V128 H0Z" fill="${P.blue}"/>
  <path d="M44 70 C50 58 70 54 84 62 C96 70 100 82 98 90 L108 98 L92 96 C76 98 56 92 48 84 C42 78 42 74 44 70Z" fill="${P.faint}"/>
  <path d="M58 70 C70 62 88 68 98 90 C82 94 66 88 58 70Z" fill="${P.stone}"/>
  <path d="M54 76 C40 62 58 52 50 36" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round"/>
  <g fill="${P.ink2}"><circle cx="45" cy="52" r="1.5"/><circle cx="44.5" cy="58" r="1.5"/><circle cx="46" cy="64" r="1.5"/></g>
  <circle cx="51" cy="33" r="13" fill="#fff"/>
  <path d="M50 24 C60 20 74 20 88 26 C78 28 68 30 58 31Z" fill="${P.ink}"/>
  <path d="M41 29 C32 31 20 33 8 36 C20 38 32 39 41 39Z" fill="${P.ochre}"/>
  <path d="M41 34.5 C32 35.5 20 36 8 36 C20 38 32 39 41 39Z" fill="${P.ochreDark}"/>
  ${eye(47, 31, 3.6)}`,
};

// A cormorant on a blue post, drying its wings.
const cormorant = {
  bg: P.disc,
  body: `
  <rect x="52" y="100" width="24" height="30" fill="${P.blue}"/>
  <ellipse cx="64" cy="100" rx="12" ry="4" fill="${P.blueDeep}"/>
  <path d="M52 66 C42 54 24 50 10 58 C16 62 14 68 20 72 C16 76 22 82 28 82 C26 88 34 90 40 88 C46 88 52 82 56 76Z" fill="#3A3530"/>
  <path d="M76 66 C86 54 104 50 118 58 C112 62 114 68 108 72 C112 76 106 82 100 82 C102 88 94 90 88 88 C82 88 76 82 72 76Z" fill="#3A3530"/>
  <ellipse cx="64" cy="78" rx="15" ry="24" fill="${P.feather}"/>
  <g stroke="${P.feather}" stroke-width="3" stroke-linecap="round"><path d="M58 100 V104"/><path d="M70 100 V104"/></g>
  <path d="M60 60 C58 50 60 46 64 44 L72 46 C70 52 70 56 72 62Z" fill="${P.feather}"/>
  <circle cx="66" cy="40" r="13" fill="${P.feather}"/>
  <path d="M76 38 L95 40.5 Q99 41.5 97.5 45.5 L95.5 43.5 L77 45Z" fill="${P.muted}"/>
  <path d="M73 43 L80 45 L78 51 C75 51 72.5 47.5 73 43Z" fill="${P.ochre}"/>
  <circle cx="69" cy="37" r="4.2" fill="#fff"/><circle cx="69.8" cy="37" r="2.4" fill="${P.ink}"/>`,
};

/* ---- opened by rank ---- */

// Pier: the blue crab, wholly blue, as the designer suggested.
const crab = {
  bg: P.disc,
  body: `
  <path d="M0 108 Q32 102 64 106 T128 104 V128 H0Z" fill="${P.sand}"/>
  <g stroke="${P.blueDeep}" stroke-width="5" stroke-linecap="round" fill="none">
    <path d="M36 88 L22 96 L18 106"/><path d="M38 96 L26 106 L24 114"/>
    <path d="M92 88 L106 96 L110 106"/><path d="M90 96 L102 106 L104 114"/>
    <path d="M42 76 Q30 70 28 58"/><path d="M86 76 Q98 70 100 58"/>
  </g>
  <g fill="${P.blue}">
    <path d="M14 46 C12 34 20 26 30 26 C38 26 42 32 40 38 L30 42 L40 46 C40 54 34 60 26 60 C18 60 15 54 14 46Z"/>
    <path d="M114 46 C116 34 108 26 98 26 C90 26 86 32 88 38 L98 42 L88 46 C88 54 94 60 102 60 C110 60 113 54 114 46Z"/>
  </g>
  <ellipse cx="64" cy="84" rx="32" ry="21" fill="${P.blue}"/>
  <path d="M34 90 Q64 108 94 90 Q92 104 64 105 Q36 104 34 90Z" fill="${P.blueDeep}"/>
  <path d="M55 66 L52 50" stroke="${P.ink}" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M73 66 L76 50" stroke="${P.ink}" stroke-width="3.2" stroke-linecap="round"/>
  <circle cx="51" cy="45" r="8" fill="#fff"/><circle cx="77" cy="45" r="8" fill="#fff"/>
  <circle cx="52.5" cy="46" r="3.8" fill="${P.ink}"/><circle cx="75.5" cy="46" r="3.8" fill="${P.ink}"/>
  <path d="M56 84 Q64 91 72 84" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>`,
};

// Quay: a harbour porpoise leaping clear of blue water.
const porpoise = {
  bg: P.disc,
  body: `
  <path d="M24 112 C24 80 46 50 80 40 C96 36 110 42 110 54 C110 64 100 68 90 68 C70 70 52 88 50 112Z" fill="#5E5A57"/>
  <path d="M50 112 C52 88 70 70 90 68 C98 68 106 65 109 58 C106 70 96 74 88 75 C72 77 60 92 58 112Z" fill="${P.stoneLight}"/>
  <path d="M46 70 C46 60 50 52 58 48 C58 56 58 62 62 66Z" fill="#4A4643"/>
  ${eye(92, 50, 4)}
  <path d="M98 60 Q103 60 106 57" fill="none" stroke="${P.ink}" stroke-width="2" stroke-linecap="round"/>
  <path d="M0 104 Q14 98 28 104 Q38 96 48 104 Q56 98 64 104 T96 104 T128 104 V128 H0Z" fill="${P.blue}"/>
  <g fill="${P.blue}"><circle cx="18" cy="92" r="3.4"/><circle cx="28" cy="84" r="2.4"/><circle cx="106" cy="94" r="2.8"/><circle cx="12" cy="80" r="1.8"/></g>`,
};

// Harbour Master: the blue lobster, about one in two million in the wild,
// wholly blue and tall where the crab is wide.
const lobster = {
  bg: P.soft,
  body: `
  <path d="M0 110 Q32 105 64 108 T128 106 V128 H0Z" fill="${P.sand}"/>
  <g transform="translate(64 72) scale(.84) translate(-64 -64)">
  <g fill="none" stroke="${P.blueDeep}" stroke-width="2.2" stroke-linecap="round">
    <path d="M58 38 C48 20 30 10 10 12"/><path d="M70 38 C80 20 98 10 118 12"/>
  </g>
  <g stroke="${P.blueDeep}" stroke-width="3.6" stroke-linecap="round" fill="none">
    <path d="M52 64 L38 70 L34 78"/><path d="M52 72 L40 80 L38 88"/>
    <path d="M76 64 L90 70 L94 78"/><path d="M76 72 L88 80 L90 88"/>
  </g>
  <g stroke="${P.blue}" stroke-width="7" stroke-linecap="round" fill="none">
    <path d="M52 54 Q38 52 34 40"/><path d="M76 54 Q90 52 94 40"/>
  </g>
  <g fill="${P.blue}">
    <path d="M22 36 C14 26 16 12 26 8 C32 6 36 10 34 16 L28 22 L38 22 C42 30 38 40 30 42 C26 42 24 40 22 36Z"/>
    <path d="M106 36 C114 26 112 12 102 8 C96 6 92 10 94 16 L100 22 L90 22 C86 30 90 40 98 42 C102 42 104 40 106 36Z"/>
  </g>
  <path d="M50 112 Q64 104 78 112 L82 122 Q72 118 64 124 Q56 118 46 122Z" fill="${P.blue}"/>
  <g fill="${P.blue}">
    <rect x="53" y="96" width="22" height="10" rx="5"/>
    <rect x="51" y="86" width="26" height="11" rx="5.5"/>
  </g>
  <path d="M53 96.5 H75 M51.5 86.5 H76.5 M54 106 H74" stroke="${P.blueDeep}" stroke-width="2" stroke-linecap="round"/>
  <ellipse cx="64" cy="64" rx="17" ry="24" fill="${P.blue}"/>
  <path d="M47 70 Q64 80 81 70 Q78 86 64 87 Q50 86 47 70Z" fill="${P.blueDeep}"/>
  <path d="M58 44 L56 36 M70 44 L72 36" stroke="${P.blueDeep}" stroke-width="3" stroke-linecap="round"/>
  <circle cx="55" cy="33" r="6.4" fill="#fff"/><circle cx="73" cy="33" r="6.4" fill="#fff"/>
  <circle cx="56" cy="34" r="3.2" fill="${P.ink}"/><circle cx="72" cy="34" r="3.2" fill="${P.ink}"/>
  <path d="M58 60 Q64 65.5 70 60" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
  </g>`,
};

/**
 * The set in picker order. `id` is what users.avatar_id stores and never
 * changes; `file` is the art. Ids keep their pre-creature names so every
 * stored face resolves to the creature in the same place on the shelf.
 */
export const FACES = [
  { id: "bollard", file: "seal", label: "The Seal", art: seal },
  { id: "cleat", file: "gull", label: "The Gull", art: gull },
  { id: "ring", file: "otter", label: "The Otter", art: otter },
  { id: "lantern", file: "puffin", label: "The Puffin", art: puffin },
  { id: "buoy", file: "starfish", label: "The Starfish", art: starfish },
  { id: "rope", file: "moon-jelly", label: "The Moon Jelly", art: jelly },
  { id: "tidemark", file: "heron", label: "The Heron", art: heron },
  { id: "compass", file: "cormorant", label: "The Cormorant", art: cormorant },
  { id: "beacon", file: "blue-crab", label: "The Blue Crab", art: crab, unlockLevel: 7 },
  { id: "bell", file: "porpoise", label: "The Porpoise", art: porpoise, unlockLevel: 8 },
  { id: "capstan", file: "blue-lobster", label: "The Blue Lobster", art: lobster, unlockLevel: 10 },
];

const wrap = (id, bg, inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128"><defs><clipPath id="${id}"><circle cx="64" cy="64" r="64"/></clipPath></defs><g clip-path="url(#${id})"><rect width="128" height="128" fill="${bg}"/>${inner.replace(/\s*\n\s*/g, "")}</g></svg>\n`;

export function faceSvg(face) {
  return wrap(`berth-${face.file}`, face.art.bg, face.art.body);
}

/**
 * The locked face: the creature as one flat silhouette on the plain disc.
 * Every painted colour becomes SILHOUETTE and opacities go, so the shape
 * reads and nothing inside it does.
 */
export function lockedSvg(face) {
  const flat = face.art.body
    .replace(/(fill|stroke)="(?!none)[^"]*"/g, `$1="${SILHOUETTE}"`)
    .replace(/\sopacity="[^"]*"/g, "");
  return wrap(`berth-${face.file}-locked`, P.disc, flat);
}
