import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Karla, Young_Serif } from "next/font/google";
import { Providers } from "@/components/providers";
import { DesktopStage } from "@/components/desktop-stage";
import "./globals.css";

/* "English tea house, slightly dreamy" — per the LSTeaTime design system:
   Young Serif for display, Karla for body/UI, IBM Plex Mono for money. */
const displayFont = Young_Serif({
  variable: "--font-display",
  weight: "400",
  subsets: ["latin"],
});

const bodyFont = Karla({
  variable: "--font-body",
  subsets: ["latin"],
});

const moneyFont = IBM_Plex_Mono({
  variable: "--font-money",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LSTeaTime",
  description:
    "A calming little game of filling up tea cups. Leveraged staked yield on Sonic, poured from any asset on any network. Tea is the way.",
  icons: { icon: "/lsteatime-mark.svg" },
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
      className={`${displayFont.variable} ${bodyFont.variable} ${moneyFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <Providers>
          <DesktopStage>{children}</DesktopStage>
        </Providers>
      </body>
    </html>
  );
}
