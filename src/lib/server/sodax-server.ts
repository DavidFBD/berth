import type { SodaxOptions } from "@sodax/sdk";
import { sodaxConfig } from "@/lib/sodax-config";

/**
 * The shared SODAX config plus the house's API key, for Sodax instances built
 * on the server. The key never lives in lib/sodax-config (that module ships
 * to the browser), and this one refuses to run there: the repo has no
 * `server-only` package, so the guard is a plain runtime check.
 *
 * No key in the environment (a local checkout) leaves the instance unkeyed,
 * which upstream still serves.
 */
export function serverSodaxConfig(): SodaxOptions {
  if (typeof window !== "undefined") {
    throw new Error("serverSodaxConfig is server only: it carries the SODAX API key");
  }
  return { ...sodaxConfig, apiKey: process.env.SODAX_API_KEY || undefined };
}
