import { notFound } from "next/navigation";
import { defaultWords } from "@/lib/new-listings-draft";
import { liveStocks } from "@/lib/server/new-listings";
import { previewOf } from "@/lib/server/staff/emails";
import { Gallery } from "./gallery";

/**
 * Dev-only gallery of the staff emails page (404 in production), from
 * invented data: no request leaves the page and the buttons do nothing.
 * The preview is the real email: the real template rendered on the server
 * with the demo draft's default words and four stocks from the registry.
 *
 *   /dev/staff-emails?state=nothing         no new stocks since the last email
 *   /dev/staff-emails?state=draft           a draft with its recipients (default)
 *   /dev/staff-emails?state=sending         an email being sent, with progress
 *   /dev/staff-emails?state=no-baseline     the baseline is not recorded yet
 *   /dev/staff-emails?state=not-production  not the live site
 */

const DEMO_SYMBOLS = ["AAPL", "MSFT", "AMZN", "GOOGL"];

export default async function StaffEmailsGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const stocks = liveStocks().filter((stock) => DEMO_SYMBOLS.includes(stock.symbol));
  const preview = await previewOf(defaultWords(stocks.length), stocks.map((stock) => stock.symbol));
  return <Gallery stocks={stocks} preview={preview} />;
}
