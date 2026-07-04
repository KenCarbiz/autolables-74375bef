// ──────────────────────────────────────────────────────────────────────
// oem-brochure — find the official OEM brochure link for a make/model/year.
// Searches via Firecrawl but only accepts results hosted on the
// manufacturer's own allowlisted domains, then caches the link in the
// global oem_brochure_links table. We link to the OEM's hosted document —
// never rehost bytes, never fall back to unofficial brochure archives.
//
// Body: { make, model, year?, refresh? }
// Auth: tenant user JWT or service role.
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { adminClient, isServiceOrCron } from "../_shared/supabase.ts";

const FIRECRAWL_KEY = Deno.env.get("FIRECRAWL_API_KEY_1") || Deno.env.get("FIRECRAWL_API_KEY") || "";

// Official US consumer domains per make. A result must land on one of these
// (or a subdomain) to be accepted — everything else is discarded.
const OEM_DOMAINS: Record<string, string[]> = {
  toyota: ["toyota.com"], lexus: ["lexus.com"],
  honda: ["honda.com", "automobiles.honda.com"], acura: ["acura.com"],
  ford: ["ford.com"], lincoln: ["lincoln.com"],
  chevrolet: ["chevrolet.com"], gmc: ["gmc.com"], buick: ["buick.com"], cadillac: ["cadillac.com"],
  chrysler: ["chrysler.com"], dodge: ["dodge.com"], jeep: ["jeep.com"], ram: ["ramtrucks.com"], fiat: ["fiatusa.com"],
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

// Prefer direct PDFs, then brochure-ish landing pages, then the right year.
const scoreHit = (h: Hit, model: string, year: number | null): number => {
  const u = h.url.toLowerCase();
  const t = `${h.title || ""} ${h.description || ""}`.toLowerCase();
  let s = 0;
  if (u.endsWith(".pdf")) s += 40;
  if (u.includes("brochure") || u.includes("ebrochure")) s += 30;
  if (t.includes("brochure")) s += 15;
  if (u.includes(model.toLowerCase().replace(/\s+/g, "-")) || u.includes(model.toLowerCase().replace(/\s+/g, ""))) s += 10;
  if (year && (u.includes(String(year)) || t.includes(String(year)))) s += 20;
  return s;
};

// The model year the brochure itself is for, when the URL/title carries one.
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
      .from("oem_brochure_links")
      .select("url, title, year, source")
      .ilike("make", make).ilike("model", model)
      .order("year", { ascending: false, nullsFirst: false })
      .limit(6);
    const rows = (cached || []) as { url: string; title: string | null; year: number | null; source: string }[];
    // Exact year first, then the nearest year within 2 model years.
    const exact = year ? rows.find((r) => r.year === year) : rows[0];
    const near = exact || rows.find((r) => r.year != null && year != null && Math.abs(r.year - year) <= 2) || (!year ? rows[0] : undefined);
    if (near) return json(200, { ok: true, cached: true, url: near.url, title: near.title, year: near.year, source: near.source });
  }

  if (!FIRECRAWL_KEY) return json(200, { error: "not_configured" });

  const siteFilter = domains.map((d) => `site:${d}`).join(" OR ");
  const query = `${year ? `${year} ` : ""}${make} ${model} brochure (${siteFilter})`;
  let hits = (await firecrawlSearch(query)).filter((h) => hostAllowed(h.url, domains));
  if (!hits.length) {
    hits = (await firecrawlSearch(`${make} ${model} ebrochure pdf (${siteFilter})`)).filter((h) => hostAllowed(h.url, domains));
  }
  if (!hits.length) return json(404, { error: "brochure_not_found", query });

  hits.sort((a, b) => scoreHit(b, model, year) - scoreHit(a, model, year));
  const best = hits[0];

  // Confirm the link is not dead before caching it. OEM CDNs often bot-block
  // server-side probes (403), which a real browser sails through — only a
  // hard 404/410 disqualifies the link.
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
    return json(404, { error: "brochure_unreachable", url: best.url, status });
  }
  const brochureYear = yearOf(best) ?? year;

  // The unique index is expression-based (lower(make), lower(model), year),
  // which upsert can't target by name — replace via delete + insert instead.
  let del = admin.from("oem_brochure_links").delete().ilike("make", make).ilike("model", model);
  del = brochureYear === null ? del.is("year", null) : del.eq("year", brochureYear);
  await del;
  await admin.from("oem_brochure_links").insert(
    { make, model, year: brochureYear, url: best.url, title: best.title || null, source: "oem_site", verified_at: new Date().toISOString() },
  );

  return json(200, { ok: true, cached: false, url: best.url, title: best.title || null, year: brochureYear });
});
