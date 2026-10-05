/**
 * Mail providers anyone can sign up at, one list for every reader: the
 * staff masks show these domains whole (lib/staff/mask), since they name
 * nobody, and the campaign queue's same_email_domain signal ignores them
 * (lib/server/campaigns/queue), since many people share them. Any other
 * domain can name a person or their employer. example.com is here because
 * it is reserved and names nobody.
 */
export const WEBMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.de",
  "outlook.nl",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.nl",
  "live.com",
  "live.nl",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "privaterelay.appleid.com",
  "proton.me",
  "protonmail.com",
  "protonmail.ch",
  "pm.me",
  "tuta.io",
  "duck.com",
  "aol.com",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "mail.com",
  "mail.ru",
  "yandex.com",
  "yandex.ru",
  "qq.com",
  "163.com",
  "zoho.com",
  "fastmail.com",
  "hey.com",
  "ziggo.nl",
  "kpnmail.nl",
  "example.com",
]);
