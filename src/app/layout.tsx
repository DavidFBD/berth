import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, Public_Sans } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

/* Plain and calm, one column, phone first, the same layout on desktop.
   Berth's type system: Archivo for display and the wordmark, Public Sans
   for body and UI, IBM Plex Mono for numbers, tickers, and addresses. */
const displayFont = Archivo({
  variable: "--font-archivo",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
});

const bodyFont = Public_Sans({
  variable: "--font-public-sans",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

const moneyFont = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

const DESCRIPTION =
  "Stocks for the money that already lives onchain. Buy US stocks and ETFs with the stablecoins or Bitcoin you already hold, from any of 20 networks, in one signature, in your own custody.";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.berthmarkets.com"),
  title: "Berth",
  description: DESCRIPTION,
  applicationName: "Berth",
  manifest: "/site.webmanifest",
  openGraph: {
    title: "Berth",
    description: DESCRIPTION,
    url: "https://www.berthmarkets.com",
    siteName: "Berth",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Berth. Stocks for the money that already lives onchain.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Berth",
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5f2" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1413" },
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
      className={`${displayFont.variable} ${bodyFont.variable} ${moneyFont.variable} h-full antialiased`}
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
