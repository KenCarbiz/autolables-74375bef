import { canonicalCondition, type CanonicalCondition } from "@/lib/vehicleCondition";
import type { DealerSettings } from "@/contexts/DealerSettingsContext";

export const WEBSITES_FEED_KEYS = [
  "dms_provider", "new_inventory_url", "used_inventory_url",
  "autotrader_url", "cars_com_url", "cargurus_url", "capital_one_url", "carfax_url",
  "vdp_price_labels", "vdp_strip_finance_params", "vehicle_conditions",
] as const;
export type WebsitesFeedKey = (typeof WEBSITES_FEED_KEYS)[number];

export const WEBSITES_FEED_LABELS: Record<WebsitesFeedKey, string> = {
  dms_provider: "DMS provider",
  new_inventory_url: "New inventory page",
  used_inventory_url: "Used inventory page",
  autotrader_url: "Autotrader listing page",
  cars_com_url: "Cars.com listing page",
  cargurus_url: "CarGurus listing page",
  capital_one_url: "Capital One listing page",
  carfax_url: "CARFAX listing page",
  vdp_price_labels: "Price labels, in priority order",
  vdp_strip_finance_params: "Strip finance and lease URL parameters",
  vehicle_conditions: "Condition terms",
};

export interface ProviderSpec {
  key: Extract<WebsitesFeedKey, "autotrader_url" | "cars_com_url" | "cargurus_url" | "capital_one_url" | "carfax_url">;
  id: string;
  name: string;
  hosts: string[];
  /** What AutoLabels does with the saved address, as the crawler reads it today. */
  use: string;
}

export const PROVIDERS: readonly ProviderSpec[] = [
  { key: "autotrader_url", id: "autotrader", name: "Autotrader", hosts: ["autotrader.com"], use: "Your Autotrader listing page, read by the price crawler as a comparison source." },
  { key: "cars_com_url", id: "cars_com", name: "Cars.com", hosts: ["cars.com"], use: "Your Cars.com listing page, read by the price crawler as a comparison source." },
  { key: "cargurus_url", id: "cargurus", name: "CarGurus", hosts: ["cargurus.com"], use: "Your CarGurus listing page, read by the price crawler as a comparison source." },
  { key: "carfax_url", id: "carfax", name: "CARFAX", hosts: ["carfax.com"], use: "Your CARFAX dealer listing page, read by the price crawler as a comparison source." },
  { key: "capital_one_url", id: "capital_one", name: "Capital One", hosts: ["capitalone.com"], use: "Your Capital One Auto Navigator page, read by the price crawler as a comparison source." },
];

export type UrlCheck =
  | { state: "empty" }
  | { state: "invalid"; reason: string }
  | { state: "valid"; href: string; host: string; mismatch: string | null };

const hostMatches = (host: string, expected: string[]) => expected.some((h) => host === h || host.endsWith(`.${h}`));

/** A format check only. AutoLabels has not opened the page, so valid never means reachable or correct. */
export function checkUrl(raw: string | null | undefined, expectHosts?: string[], providerName?: string): UrlCheck {
  const value = String(raw ?? "").trim();
  if (!value) return { state: "empty" };
  if (/\s/.test(value)) return { state: "invalid", reason: "Remove the spaces. A web address has none." };
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value);
  if (scheme && !/^https?$/i.test(scheme[1]) && !/^[a-z0-9.-]+:\d+/i.test(value)) {
    return { state: "invalid", reason: `Use an http or https address. "${scheme[1]}:" links cannot be read.` };
  }
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return { state: "invalid", reason: "This is not a web address. Paste the full page address, for example https://www.example.com/page." };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!host.includes(".") || host.endsWith(".")) return { state: "invalid", reason: "The address needs a domain such as example.com." };
  if (/^(localhost|127\.|10\.|192\.168\.|0\.0\.0\.0)/.test(host)) return { state: "invalid", reason: "Use your public address. Local and private addresses cannot be reached." };
  let mismatch: string | null = null;
  if (expectHosts && !hostMatches(host, expectHosts)) {
    const other = PROVIDERS.find((p) => hostMatches(host, p.hosts));
    mismatch = other
      ? `This is a ${other.name} address, not ${providerName}. Check that it is in the right field.`
      : `This address is not on ${expectHosts[0]}. Save it only if ${providerName} gave you this link.`;
  }
  return { state: "valid", href: withProtocol, host, mismatch };
}

export const parseLabels = (raw: string | null | undefined): string[] =>
  String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export const joinLabels = (labels: readonly string[]): string => labels.join(", ");

export const parseTerms = parseLabels;

export interface ConditionRow {
  term: string;
  canonical: CanonicalCondition | undefined;
  note: string;
}

const CANONICAL_NOTE: Record<string, string> = {
  new: "Stored as New. No Buyers Guide is required.",
  used: "Stored as Used. The FTC Buyers Guide applies.",
  cpo: "Stored as CPO, a grade of Used. The FTC Buyers Guide applies.",
};

export function conditionRows(terms: readonly string[]): ConditionRow[] {
  return terms.map((term) => {
    const canonical = canonicalCondition(term);
    const lower = term.toLowerCase();
    const note = !canonical
      ? "No rule matches this term, so a vehicle labelled this way is not classified. Rename it or remove it."
      : /\b(demo|demonstrator|loaner)\b/.test(lower) && canonical === "new"
        ? "Demo and loaner units are stored as New, so no Buyers Guide is printed. Confirm that matches your state rules."
        : CANONICAL_NOTE[canonical];
    return { term, canonical, note };
  });
}

export function validateWebsiteDraft(d: Pick<DealerSettings, WebsitesFeedKey>): Partial<Record<WebsitesFeedKey, string>> {
  const errors: Partial<Record<WebsitesFeedKey, string>> = {};
  const pairs: Array<[WebsitesFeedKey, string[] | undefined, string | undefined]> = [
    ["new_inventory_url", undefined, undefined],
    ["used_inventory_url", undefined, undefined],
    ...PROVIDERS.map((p): [WebsitesFeedKey, string[], string] => [p.key, p.hosts, p.name]),
  ];
  for (const [key, hosts, name] of pairs) {
    const check = checkUrl(d[key] as string, hosts, name);
    if (check.state === "invalid") errors[key] = check.reason;
  }
  const labels = parseLabels(d.vdp_price_labels);
  const seen = new Set<string>();
  for (const l of labels) {
    if (seen.has(l.toLowerCase())) { errors.vdp_price_labels = `"${l}" is listed twice. Each label can appear once.`; break; }
    seen.add(l.toLowerCase());
  }
  return errors;
}
