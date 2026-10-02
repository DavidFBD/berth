import { SEC_CIK_BY_SYMBOL } from "@/lib/listings";
import { EDGAR_USER_AGENT, SHOWN_FORMS, STORED_FORMS } from "@/lib/news-schedule";
import type { ListingEvent } from "@/lib/server/news-store";

/**
 * A listed company's recent SEC filings, from EDGAR's submissions file
 * (data.sec.gov/submissions/CIK##########.json). Public domain, no key, ten
 * requests a second at most and a User-Agent with a contact, both required
 * by the SEC (lib/news-schedule). Each filing becomes a dated event written
 * by code: "Strategy filed a report with the SEC on Tuesday 29 September."
 */

type Submissions = {
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      form?: string[];
      primaryDocument?: string[];
      items?: string[];
    };
  };
};

const pad = (cik: number) => String(cik).padStart(10, "0");

/** The filings in `json` dated on or after `sinceDay` (YYYY-MM-DD), as events. Pure. */
export function filingsFrom(symbol: string, cik: number, json: Submissions, sinceDay: string): ListingEvent[] {
  const recent = json.filings?.recent;
  if (!recent?.accessionNumber || !recent.form || !recent.filingDate) return [];
  const events: ListingEvent[] = [];
  recent.accessionNumber.forEach((accession, index) => {
    const form = recent.form![index];
    const day = recent.filingDate![index];
    if (!form || !day || day < sinceDay) return;
    const shown = form in SHOWN_FORMS;
    if (!shown && !STORED_FORMS.has(form)) return;
    const document = recent.primaryDocument?.[index];
    const folder = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}`;
    events.push({
      symbol,
      kind: "filing",
      day,
      detail: {
        form,
        url: document && !document.includes("/") ? `${folder}/${document}` : `${folder}/`,
        ...(recent.items?.[index] ? { items: recent.items[index] } : {}),
      },
      source: "edgar",
      sourceRef: accession,
      shown,
    });
  });
  return events;
}

/** One company's filings since `sinceDay`. Throws when EDGAR does not answer. */
export async function fetchEdgar(symbol: string, sinceDay: string, fetcher: typeof fetch = fetch): Promise<ListingEvent[]> {
  const cik = SEC_CIK_BY_SYMBOL[symbol];
  if (!cik) return [];
  const response = await fetcher(`https://data.sec.gov/submissions/CIK${pad(cik)}.json`, {
    headers: { "user-agent": EDGAR_USER_AGENT, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`EDGAR answered ${response.status}`);
  return filingsFrom(symbol, cik, (await response.json()) as Submissions, sinceDay);
}
