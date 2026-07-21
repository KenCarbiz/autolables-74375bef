// ──────────────────────────────────────────────────────────────────────
// oem-owners-manual — find the official OEM owner's-manual link for a
// make/model/year. Mirrors oem-brochure: searches via Firecrawl but only
// accepts results hosted on the manufacturer's own allowlisted domains
// (incl. owner portals + Mopar for Stellantis), then caches the link in the
// global oem_owners_manual_links table. We link to the OEM's hosted document —
// never rehost bytes by default. A copy is stored into a vehicle's passport
// documents only on demand, by save-owners-manual.
//
// Body: { make, model, year?, refresh? }
// Auth: tenant user JWT or service role.
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { adminClient, isServiceOrCron } from "../_shared/supabase.ts";

const FIRECRAWL_KEY = Deno.env.get("FIRECRAWL_API_KEY_1") || Deno.env.get("FIRECRAWL_API_KEY") || "";

// Official US consumer domains per make. hostAllowed accepts subdomains, so an
// owner portal (owners.infinitiusa.com, owner.ford.com, my.chevrolet.com) is
// already covered by the base domain. Stellantis serves manuals from Mopar, so
// mopar.com is added to those makes. A result must land on one of these hosts.
const OEM_DOMAINS: Record<string, string[]> = {
  toyota: ["toyota.com"], lexus: ["lexus.com"],
  honda: ["honda.com", "automobiles.honda.com"], acura: ["acura.com"],
  ford: ["ford.com"], lincoln: ["lincoln.com"],
  chevrolet: ["chevrolet.com"], gmc: ["gmc.com"], buick: ["buick.com"], cadillac: ["cadillac.com"],
  chrysler: ["chrysler.com", "mopar.com"], dodge: ["dodge.com", "mopar.com"], jeep: ["jeep.com", "mopar.com"],
  ram: ["ramtrucks.com", "mopar.com"], fiat: ["fiatusa.com", "mopar.com"],
  nissan: ["nissanusa.com"], infiniti: ["infinitiusa.com"],
  mazda: ["mazdausa.com"], subaru: ["subaru.com"], mitsubishi: ["mitsubishicars.com"],
  volkswagen: ["vw.com"], vw: ["vw.com"], audi: ["audiusa.com"], porsche: ["porsche.com"],
  bmw: ["bmwusa.com"], mini: ["miniusa.com"], "mercedes-benz": ["mbusa.com"], mercedes: ["mbusa.com"],
  hyundai: ["hyundaiusa.com"], kia: ["kia.com"], genesis: ["genesis.com"],
  volvo: ["volvocars.com"], "land rover": ["landroverusa.com"], jaguar: ["jaguarusa.com"],
  tesla: ["tesla.com"], rivian: ["rivian.com"], lucid: ["lucidmotors.com"], polestar: ["polestar.com"],
  "alfa romeo": ["alfaromeousa.com"], maserati: ["maserati.com"],
};

const hostAllowed = (url: string, domains: string[]): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch { return false; }
};

interface Hit { url: string; title?: string; description?: string }

async function firecrawlSearch(query: string): Promise<Hit[]> {
  const res = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${FIRECRAWL_KEY}` },
    body: JSON.stringify({ query, limit: 8 }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) return [];
  const body = await res.json().catch(() => null);
  const data = body?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((d: Record<string, unknown>) => ({
      url: String(d.url || ""),
      title: typeof d.title === "string" ? d.title : undefined,
      description: typeof d.description === "string" ? d.description : undefined,
    }))
    .filter((h: Hit) => h.url);
}

// Prefer a direct PDF, then an owner's-manual page, then the right model year.
// Penalise obvious non-manuals (brochures, accessories, warranty booklets).
const scoreHit = (h: Hit, model: string, year: number | null): number => {
  const u = h.url.toLowerCase();
  const t = `${h.title || ""} ${h.description || ""}`.toLowerCase();
  let s = 0;
  if (u.endsWith(".pdf")) s += 40;
  if (u.includes("owner") || u.includes("manual")) s += 30;
  if (t.includes("owner's manual") || t.includes("owners manual") || t.includes("owner manual")) s += 25;
  else if (t.includes("manual")) s += 10;
  if (u.includes(model.toLowerCase().replace(/\s+/g, "-")) || u.includes(model.toLowerCase().replace(/\s+/g, ""))) s += 10;
  if (year && (u.includes(String(year)) || t.includes(String(year)))) s += 20;
  // Steer away from adjacent OEM docs that aren't the owner's manual.
  if (u.includes("brochure") || t.includes("brochure")) s -= 25;
  if (u.includes("accessor") || u.includes("warranty-booklet") || u.includes("quick-guide")) s -= 10;
  return s;
};

// The model year the manual is for, when the URL/title carries one.
const yearOf = (h: Hit): number | null => {
  const m = `${h.url} ${h.title || ""}`.match(/\b(19|20)\d{2}\b/);
  return m ? Number.parseInt(m[0], 10) : null;
};

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;

  const admin = adminClient();
  if (!isServiceOrCron(req)) {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json(401, { error: "missing bearer token" });
    const { data: ures } = await admin.auth.getUser(jwt);
    if (!ures?.user?.id) return json(401, { error: "unauthorized" });
  }

  const body = await req.json().catch(() => ({}));
  const make = String(body.make || "").trim();
  const model = String(body.model || "").trim();
  const year = Number.parseInt(String(body.year ?? ""), 10) || null;
  const refresh = body.refresh === true;
  if (!make || !model) return json(400, { error: "make and model required" });

  const domains = OEM_DOMAINS[make.toLowerCase()];
  if (!domains) return json(404, { error: "make_not_supported", make });

  if (!refresh) {
    const { data: cached } = await admin
      .from("oem_owners_manual_links")
      .select("url, title, year, source")
      .ilike("make", make).ilike("model", model)
      .order("year", { ascending: false, nullsFirst: false })
      .limit(6);
    const rows = (cached || []) as { url: string; title: string | null; year: number | null; source: string }[];
    const exact = year ? rows.find((r) => r.year === year) : rows[0];
    const near = exact || rows.find((r) => r.year != null && year != null && Math.abs(r.year - year) <= 2) || (!year ? rows[0] : undefined);
    if (near) return json(200, { ok: true, cached: true, url: near.url, title: near.title, year: near.year, source: near.source });
  }

  if (!FIRECRAWL_KEY) return json(200, { error: "not_configured" });

  const siteFilter = domains.map((d) => `site:${d}`).join(" OR ");
  const query = `${year ? `${year} ` : ""}${make} ${model} owner's manual pdf (${siteFilter})`;
  let hits = (await firecrawlSearch(query)).filter((h) => hostAllowed(h.url, domains));
  if (!hits.length) {
    hits = (await firecrawlSearch(`${make} ${model} owners manual (${siteFilter})`)).filter((h) => hostAllowed(h.url, domains));
  }
  if (!hits.length) return json(404, { error: "manual_not_found", query });

  hits.sort((a, b) => scoreHit(b, model, year) - scoreHit(a, model, year));
  const best = hits[0];

  // Confirm the link isn't dead before caching. OEM CDNs often 403 a
  // server-side probe that a real browser sails through — only a hard
  // 404/410/unreachable disqualifies it.
  const probe = (method: string) => fetch(best.url, {
    method,
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", Accept: "*/*" },
    signal: AbortSignal.timeout(12000),
    redirect: "follow",
  });
  let status = 0;
  try {
    let res = await probe("HEAD");
    if (!res.ok && res.status !== 403) res = await probe("GET");
    status = res.status;
  } catch { status = 0; }
  if (status === 404 || status === 410 || status === 0) {
    return json(404, { error: "manual_unreachable", url: best.url, status });
  }
  const manualYear = yearOf(best) ?? year;

  // Expression-based unique index (lower(make), lower(model), year) — upsert
  // can't target it by name, so replace via delete + insert.
  let del = admin.from("oem_owners_manual_links").delete().ilike("make", make).ilike("model", model);
  del = manualYear === null ? del.is("year", null) : del.eq("year", manualYear);
  await del;
  await admin.from("oem_owners_manual_links").insert(
    { make, model, year: manualYear, url: best.url, title: best.title || null, source: "oem_site", verified_at: new Date().toISOString() },
  );

  return json(200, { ok: true, cached: false, url: best.url, title: best.title || null, year: manualYear });
});
