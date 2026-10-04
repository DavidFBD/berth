import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/providers";
import { ToastStack } from "@/components/toast-stack";
import "./globals.css";

/* Plain and calm, one column on a phone, two on a desktop. Berth's type
   system: Inter Tight for headings and display, Inter for body and UI, IBM
   Plex Mono for numbers, tickers and addresses. Archivo is the wordmark's
   face and is loaded for that one word, at the one weight it uses.

   Self-hosted (next/font/local) from the official @fontsource packages
   (latin subset, matching what Google served) instead of next/font/google:
   Vercel builds were intermittently failing on the build-time fetch to
   Google Fonts. Weights, variable names, display and the computed fallback
   stay the same so layout doesn't shift. Files and OFL license text live
   under src/app/fonts/. */
const displayFont = localFont({
  variable: "--font-inter-tight",
  display: "swap",
  src: [
    { path: "./fonts/inter-tight/inter-tight-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/inter-tight/inter-tight-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
});

const bodyFont = localFont({
  variable: "--font-inter",
  display: "swap",
  src: [
    { path: "./fonts/inter/inter-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/inter/inter-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/inter/inter-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
});

const wordmarkFont = localFont({
  variable: "--font-archivo",
  display: "swap",
  src: [
    { path: "./fonts/archivo/archivo-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
});

const moneyFont = localFont({
  variable: "--font-plex-mono",
  display: "swap",
  src: [
    { path: "./fonts/ibm-plex-mono/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono/ibm-plex-mono-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
});

const TITLE = "Berth · Wall Street, in your wallet.";

const DESCRIPTION =
  "Wall Street, in your wallet. Real US stocks, bought from your crypto wallet. Pay with stablecoins, ETH, SOL or Bitcoin on more than 20 networks, sign once, and keep what you buy in your own wallet.";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.berthmarkets.com"),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Berth",
  manifest: "/site.webmanifest",
  // The picture is app/opengraph-image.tsx and app/twitter-image.tsx
  // (lib/og/card), the default for every page that has none of its own.
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "Berth",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0e0d" },
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
      // next-themes stamps light/dark on <html> before hydration (attribute
      //="class"); the server can't know it, so React must not treat the
      // mismatch as a bug.
      suppressHydrationWarning
      className={`${displayFont.variable} ${bodyFont.variable} ${wordmarkFont.variable} ${moneyFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans bg-background text-foreground">
        <Providers>
          {children}
          <ToastStack />
        </Providers>
      </body>
    </html>
  );
}
