/**
 * The browser's half of app/api/account/merge, without React: the wire
 * shapes and the one POST, shared by the wallet flow (hooks/use-account-
 * merge) and the email flow (hooks/use-link-email).
 */

export type MergeTotals = { xp: number; orders: number };
export type MergeOfferWire = {
  offer: string;
  survivor: "this" | "other";
  together: MergeTotals;
  /** The joining account's username comes along (the staying one has none). */
  usernameComes?: boolean;
};
export type MergeAnswer =
  | { state: "merged"; survivor: "this" | "other"; xp: number }
  | { state: "changed" }
  /** The offer or a proof ran past its ten minutes: new proofs are needed. */
  | { state: "expired" }
  | { state: "failed" };
export type MergeStep = "idle" | "confirm" | "working" | "done" | "failed" | "changed" | "expired";

/** POST the offer with these headers; any refusal or network failure reads as "failed". */
export async function postMerge(headers: Record<string, string>, offer: string): Promise<MergeAnswer> {
  try {
    const response = await fetch("/api/account/merge", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ offer }),
    });
    if (response.status === 401) return { state: "expired" };
    const data = (await response.json().catch(() => null)) as MergeAnswer | null;
    if (data && (data.state === "merged" || data.state === "changed")) return data;
    return { state: "failed" };
  } catch {
    return { state: "failed" };
  }
}
