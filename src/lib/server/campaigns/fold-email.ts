/**
 * The address an email alias folds to: a plus tag dropped, and for Gmail
 * the dots too. The campaigns compare people by it (eligibility's
 * FOLD_EMAIL_SQL is the same rule in SQL). Pure.
 */
export function foldEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.trim().toLowerCase().split("@");
  if (!local || !domain) return null;
  const host = domain === "googlemail.com" ? "gmail.com" : domain;
  let name = local.split("+")[0];
  if (host === "gmail.com") name = name.replace(/\./g, "");
  return `${name}@${host}`;
}
