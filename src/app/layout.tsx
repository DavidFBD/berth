import type { Metadata, Viewport } from "next";
import {
  Corben,
  IBM_Plex_Mono,
  Karla,
  Monoton,
  Poiret_One,
  Shippori_Mincho,
  Shrikhand,
  UnifrakturCook,
  VT323,
  Young_Serif,
} from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { Providers } from "@/components/providers";
import { DesktopStage } from "@/components/desktop-stage";
import "./globals.css";

/* "English tea house, slightly dreamy" — per the LSTeaTime design system:
   Young Serif for display, Karla for body/UI, IBM Plex Mono for money.

   Each font binds to its OWN variable (--font-display-original, not
   --font-display); :root in globals.css maps the generic slot onto it and a
   mode class remaps the slot to that mode's font. Browsers only download a
   @font-face when something actually renders in it, so dormant mode fonts
   cost a declaration, not a fetch. */
const displayFont = Young_Serif({
  variable: "--font-display-original",
  weight: "400",
  subsets: ["latin"],
});

const bodyFont = Karla({
  variable: "--font-body-original",
  subsets: ["latin"],
});

const moneyFont = IBM_Plex_Mono({
  variable: "--font-money-original",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

/* Gangster mode: gothic blackletter for display type. */
const gangsterDisplayFont = UnifrakturCook({
  variable: "--font-display-gangster",
  weight: "700",
  subsets: ["latin"],
});

/* Nan's Parlour: a rounded, doily-soft serif. */
const nanDisplayFont = Corben({
  variable: "--font-display-nan",
  weight: ["400", "700"],
  subsets: ["latin"],
});

/* Degen Terminal: CRT phosphor. */
const terminalDisplayFont = VT323({
  variable: "--font-display-terminal",
  weight: "400",
  subsets: ["latin"],
});

/* Vaporwave: neon-tube chrome lettering. */
const vaporwaveDisplayFont = Monoton({
  variable: "--font-display-vaporwave",
  weight: "400",
  subsets: ["latin"],
});

/* Sumi-e: a mincho serif with brush bones. */
const sumieDisplayFont = Shippori_Mincho({
  variable: "--font-display-sumie",
  weight: ["400", "600"],
  subsets: ["latin"],
});

/* Aurora: thin luminous curves, ribbons of light on a dark sky. */
const auroraDisplayFont = Poiret_One({
  variable: "--font-display-aurora",
  weight: "400",
  subsets: ["latin"],
});

/* LSD: fat groovy letters, straight off a seventies gig poster. */
const lsdDisplayFont = Shrikhand({
  variable: "--font-display-lsd",
  weight: "400",
  subsets: ["latin"],
});

const DESCRIPTION =
  "A calming little game of filling tea cups. The cups earn while they steep. Any asset, any network, it all becomes tea.";

export const metadata: Metadata = {
  metadataBase: new URL("https://lsteatime.com"),
  title: "LSTeaTime · Tea is the way",
  description: DESCRIPTION,
  icons: { icon: "/lsteatime-mark.svg" },
  openGraph: {
    title: "LSTeaTime",
    description: DESCRIPTION,
    url: "https://lsteatime.com",
    siteName: "LSTeaTime",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "A steaming cup of marbled tea beside the words: LSTeaTime, a calming little game of filling teacups. The cups earn while they steep.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "LSTeaTime",
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4efe4" },
    { media: "(prefers-color-scheme: dark)", color: "#2b241d" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // next-themes stamps the mode class on <html> before hydration; the
      // server can't know it, so React must not treat the mismatch as a bug.
      suppressHydrationWarning
      className={`${displayFont.variable} ${bodyFont.variable} ${moneyFont.variable} ${gangsterDisplayFont.variable} ${nanDisplayFont.variable} ${terminalDisplayFont.variable} ${vaporwaveDisplayFont.variable} ${sumieDisplayFont.variable} ${auroraDisplayFont.variable} ${lsdDisplayFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <Providers>
          <DesktopStage>{children}</DesktopStage>
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
