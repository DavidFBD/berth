import Image from "next/image";
import { notFound } from "next/navigation";
import { AVATARS, type AvatarId } from "@/lib/avatars";
import { COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";

/**
 * Dev-only: the art for Berth's X profile (x.com/berthmarkets), drawn with
 * the app's own fonts, tokens and faces so it cannot drift from the product.
 * Not linked anywhere; 404 in prod. Each asset sits alone at the top left at
 * its exact pixel size, so the repo harness shoots it at dpr 1:
 *
 *   pnpm shot --url "http://localhost:3000/dev/x-assets?asset=avatar-ink" --viewport 400x400 --dpr 1
 *   pnpm shot --url "http://localhost:3000/dev/x-assets?asset=avatar-inverse" --viewport 400x400 --dpr 1
 *   pnpm shot --url "http://localhost:3000/dev/x-assets?asset=banner" --viewport 1500x500 --dpr 1
 *   pnpm shot --url "http://localhost:3000/dev/x-assets?asset=banner&theme=dark" --viewport 1500x500 --dpr 1 --scheme dark
 *
 * With no asset it lays all of them out, with X's crop guides, for looking.
 */

/** The mark's own bounds inside its 64 viewBox (components/berth-mark), so it can be centred by its ink, not its box. */
const MARK_PATH =
  "M10 8H20V40C20 42.21 21.79 44 24 44H40C42.21 44 44 42.21 44 40V8H54V44C54 49.52 49.52 54 44 54H20C14.48 54 10 49.52 10 44Z M32 24A6 6 0 1 1 32 36A6 6 0 1 1 32 24Z";
const MARK_VIEWBOX = "10 8 44 46";

/** The welcome film's end card order: the Seal in the middle, the rest either side. */
const ROW: AvatarId[] = [
  "cleat",
  "ring",
  "lantern",
  "beacon",
  "rope",
  "bollard",
  "compass",
  "bell",
  "buoy",
  "tidemark",
  "capstan",
];

type Asset = "avatar-ink" | "avatar-inverse" | "banner";

export default async function XAssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ asset?: string; theme?: string; guides?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { asset, theme, guides } = await searchParams;
  const dark = theme === "dark";

  const hide = <style>{`[data-wallet-diagnostics], [data-consent-card], nextjs-portal { display: none !important; } html, body { margin: 0; overflow: hidden; }`}</style>;

  if (asset === "avatar-ink" || asset === "avatar-inverse" || asset === "banner") {
    return (
      <div className={cn("fixed inset-0", asset === "banner" && dark && "dark")}>
        {hide}
        <AssetView asset={asset as Asset} guides={guides === "1"} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10 p-10">
      <style>{`[data-wallet-diagnostics], [data-consent-card], nextjs-portal { display: none !important; }`}</style>
      <div className="flex gap-10">
        <div className="overflow-hidden rounded-full"><AvatarArt inverse={false} /></div>
        <div className="overflow-hidden rounded-full"><AvatarArt inverse /></div>
      </div>
      <BannerArt guides />
      <div className="dark"><BannerArt guides /></div>
    </div>
  );
}

function AssetView({ asset, guides }: { asset: Asset; guides: boolean }) {
  if (asset === "banner") return <BannerArt guides={guides} />;
  return <AvatarArt inverse={asset === "avatar-inverse"} />;
}

/**
 * 400 by 400. X crops it to a circle, so the mark sits at a little under half
 * the width, which keeps its corners well inside the circle and gives it the
 * brand sheet's clear space. The ink option is the mark as the brand sheet
 * draws it first, ink on canvas; the inverse is canvas on ink.
 */
function AvatarArt({ inverse }: { inverse: boolean }) {
  const ground = inverse ? "#1C1917" : "#F7F6F4";
  const ink = inverse ? "#F7F6F4" : "#1C1917";
  return (
    <div style={{ width: 400, height: 400, background: ground }} className="flex items-center justify-center">
      <svg viewBox={MARK_VIEWBOX} width={176} height={184} aria-hidden>
        <path fill={ink} d={MARK_PATH} />
      </svg>
    </div>
  );
}

/**
 * 1500 by 500, in the app's tokens so the dark one is the app's dark. X lays
 * the profile picture over the lower left (about the left 400 px of the bottom
 * 200 px on a desktop) and crops a little off the top and bottom on phones, so
 * everything sits right of centre and inside the middle band.
 */
function BannerArt({ guides }: { guides: boolean }) {
  return (
    <div
      style={{ width: 1500, height: 500 }}
      className="relative flex shrink-0 flex-col items-center overflow-hidden bg-background text-foreground"
    >
      {/* Centred on x 900: the middle of what the profile picture leaves free. */}
      <div className="absolute top-0 flex w-max flex-col items-center" style={{ left: 900, transform: "translateX(-50%)" }}>
        <h1
          className="whitespace-nowrap font-display font-normal text-foreground"
          style={{ marginTop: 100, fontSize: 92, lineHeight: 1, letterSpacing: "-0.03em" }}
        >
          {COPY.og.home.title}
        </h1>
        <p className="font-mono text-primary" style={{ marginTop: 30, fontSize: 32, lineHeight: 1 }}>
          {COPY.og.domain}
        </p>
        <AvatarRow />
      </div>
      {guides && (
        <>
          {/* Desktop: the profile picture, 133 of 600 px wide at 16 px in, centred on the banner's bottom edge. */}
          <div
            className="absolute rounded-full border-2 border-dashed border-red-500"
            style={{ left: 40, top: 500 - 166, width: 333, height: 333 }}
          />
          <div className="absolute inset-x-0 border-t border-dashed border-red-500" style={{ top: 40 }} />
          <div className="absolute inset-x-0 border-t border-dashed border-red-500" style={{ top: 460 }} />
        </>
      )}
    </div>
  );
}

/** The faces in a row, overlapping a little, each ringed in the canvas, the Seal raised in the middle. */
function AvatarRow() {
  return (
    <div className="flex items-center" style={{ marginTop: 52 }}>
      {ROW.map((id, i) => {
        const face = AVATARS.find((a) => a.id === id)!;
        const centre = id === "bollard";
        const size = centre ? 104 : 80;
        return (
          <span
            key={id}
            className="relative block shrink-0 rounded-full bg-background"
            style={{ width: size + 8, height: size + 8, padding: 4, marginLeft: i === 0 ? 0 : -14, zIndex: centre ? 2 : 1 }}
          >
            <Image
              src={face.src}
              alt=""
              width={size}
              height={size}
              className="block size-full rounded-full bg-avatar-disc"
              priority
            />
          </span>
        );
      })}
    </div>
  );
}
