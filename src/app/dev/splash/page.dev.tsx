"use client";

import { notFound } from "next/navigation";
import { Splash } from "@/components/welcome-screen";

/**
 * Dev-only: the loading splash, held, so the breathing orb in the mark's
 * dot can be looked at and shot. Not linked anywhere; 404 in prod.
 */
export default function SplashGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <>
      <style>{`[data-wallet-diagnostics], nextjs-portal { display: none !important; }`}</style>
      <Splash />
    </>
  );
}
