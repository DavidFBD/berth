import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, Inter, Inter_Tight } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

/* Plain and calm, one column on a phone, two on a desktop. Berth's type
   system: Inter Tight for headings and display, Inter for body and UI, IBM
   Plex Mono for numbers, tickers and addresses. Archivo is the wordmark's
   face and is loaded for that one word, at the one weight it uses. */
const displayFont = Inter_Tight({
  variable: "--font-inter-tight",
  weight: ["400", "500"],
  subsets: ["latin"],
});

const bodyFont = Inter({
  variable: "--font-inter",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

const wordmarkFont = Archivo({
  variable: "--font-archivo",
  weight: ["600"],
  subsets: ["latin"],
});

const moneyFont = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

const TITLE = "Berth · Wall Street, in your wallet";

const DESCRIPTION =
  "Wall Street, in your wallet. Buy US stocks and ETFs with the stablecoins or Bitcoin you already hold, from any of 20 networks, in one signature, in your own custody.";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.berthmarkets.com"),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Berth",
  manifest: "/site.webmanifest",
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://www.berthmarkets.com",
    siteName: "Berth",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Berth. Wall Street, in your wallet.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
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
          <Toaster />
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
