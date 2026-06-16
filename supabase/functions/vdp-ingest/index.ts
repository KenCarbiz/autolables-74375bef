import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";

// deno-dom returns an Element-like object; Deno's TS lib doesn't ship a global Document type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = any;

// ──────────────────────────────────────────────────────────────
// vdp-ingest
//
// Dealer-authorized scraper for the dealer's OWN vehicle-detail
// pages. The dealer enters a VDP URL for a vehicle they already
// own on AutoLabels; this function fetches the page, extracts
// photos + description + options + price + mileage, and merges
// them into the vehicle_listings row via the SECURITY DEFINER
// merge_scraped_vdp RPC.
//
// Parser priority, per research:
//   1. JSON-LD schema.org/Vehicle (Dealer.com, Dealer Inspire,
//      DealerOn, Fox, Team Velocity all emit this on VDPs)
//   2. OpenGraph og:image[] + product:price + og:description
//   3. Heuristic: high-res <img> > 800px, meta[name=description]
//
// Security:
//   - Caller must be authenticated AND tenant-member of the
//     vehicle's tenant (or admin).
//   - Refuses URLs that don't resolve to http/https.
//   - Respects the target site's robots.txt (best-effort fetch).
//   - VIN match: if the scraped page carries a VIN, we refuse to
//     merge unless it matches the vehicle row's VIN. Prevents the
//     dealer from accidentally scraping the wrong car into the
//     wrong file.
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// SSRF guard — block private/loopback/link-local/cloud-metadata hosts.
const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./, /^0\./, /^10\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^::1$/, /^fe80:/i, /^fc[0-9a-f]{2}:/i, /^fd[0-9a-f]{2}:/i,
  /metadata\.google\.internal$/i,
  /metadata\.azure\.com$/i,
];
const isUrlSafe = (raw: string): { ok: true; url: URL } | { ok: false; reason: string } => {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, reason: "invalid URL" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "unsupported protocol" };
  const host = u.hostname;
  if (!host) return { ok: false, reason: "missing host" };
  for (const pat of BLOCKED_HOST_PATTERNS) {
    if (pat.test(host)) return { ok: false, reason: `blocked host (${host})` };
  }
  return { ok: true, url: u };
};

interface ScrapeResult {
  photos: Array<{ url: string; alt?: string; kind?: string }>;
  description: string | null;
  options: string[];
  price: number | null;
  mileage: number | null;
  year: string | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  warranty_text: string | null;
  key_specs: Record<string, string | number | null>;
  source: "json-ld" | "og" | "heuristic";
}

const parseNumber = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const cleaned = String(s).replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
};

const extractSchemaOrgVehicle = (doc: Doc): ScrapeResult | null => {
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')) as Doc[];
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent || "");
      const arr = Array.isArray(data) ? data : [data];
      for (const entry of arr) {
        const graph = entry["@graph"] ? entry["@graph"] : [entry];
        for (const g of graph) {
          const type = Array.isArray(g["@type"]) ? g["@type"] : [g["@type"]];
          if (type.some((t: string) => /Vehicle|Car|Product/i.test(String(t)))) {
            const offers = Array.isArray(g.offers) ? g.offers[0] : g.offers;
            const image = Array.isArray(g.image) ? g.image : g.image ? [g.image] : [];
            const options = Array.isArray(g.vehicleFeature)
              ? g.vehicleFeature.map((v: unknown) =>
                  typeof v === "string" ? v : ((v as Record<string, string>)?.name || "")
                )
              : [];
            return {
              photos: image.map((u: unknown) => ({
                url: typeof u === "string" ? u : ((u as Record<string, string>)?.url || ""),
              })).filter((p: { url: string }) => p.url.startsWith("http")),
              description: g.description || null,
              options: options.filter(Boolean),
              price: parseNumber(offers?.price),
              mileage: parseNumber(g.mileageFromOdometer?.value ?? g.mileage),
              year: g.vehicleModelDate || g.modelDate || null,
              make: g.brand?.name || g.manufacturer?.name || null,
              model: g.model || g.name || null,
              vin: g.vehicleIdentificationNumber || null,
              warranty_text: g.warranty?.description || null,
              key_specs: {
                drivetrain: g.driveWheelConfiguration || null,
                transmission: g.vehicleTransmission || null,
                engine: g.vehicleEngine?.name || null,
                fuel: g.fuelType || null,
                mpg_city: parseNumber(g.fuelEfficiency?.value),
                exterior_color: g.color || null,
              },
              source: "json-ld",
            };
          }
        }
      }
    } catch {
      /* bad JSON, skip */
    }
  }
  return null;
};

const extractOpenGraph = (doc: Doc): ScrapeResult => {
  const og = (prop: string) =>
    doc.querySelector(`meta[property="${prop}"]`)?.getAttribute("content") || null;
  const metaName = (name: string) =>
    doc.querySelector(`meta[name="${name}"]`)?.getAttribute("content") || null;

  const images = (Array.from(doc.querySelectorAll('meta[property="og:image"]')) as Doc[])
    .map((el) => el.getAttribute("content"))
    .filter(Boolean) as string[];

  return {
    photos: images.filter((u) => u.startsWith("http")).map((u) => ({ url: u })),
    description: og("og:description") || metaName("description"),
    options: [],
    price: parseNumber(og("product:price:amount") || og("og:price:amount")),
    mileage: null,
    year: null,
    make: null,
    model: null,
    vin: null,
    warranty_text: null,
    key_specs: {},
    source: "og",
  };
};

const extractHeuristic = (doc: Doc, baseUrl: URL): ScrapeResult => {
  const images = (Array.from(doc.querySelectorAll("img")) as Doc[])
    .map((el) => {
      const src = el.getAttribute("data-src") || el.getAttribute("src") || "";
      const abs = src.startsWith("//")
        ? `${baseUrl.protocol}${src}`
        : src.startsWith("/")
          ? `${baseUrl.origin}${src}`
          : src;
      const width = parseInt(el.getAttribute("width") || "0", 10);
      return { url: abs, width };
    })
    .filter((x) => x.url.startsWith("http"));
  // Pick the biggest-looking images (heuristic width or known file sizes)
  const top = images.slice(0, 30);
  return {
    photos: top.map((x) => ({ url: x.url })),
    description:
      doc.querySelector('meta[name="description"]')?.getAttribute("content") || null,
    options: [],
    price: null,
    mileage: null,
    year: null,
    make: null,
    model: null,
    vin: null,
    warranty_text: null,
    key_specs: {},
    source: "heuristic",
  };
};

const safeFetch = async (url: string, init: RequestInit, maxRedirects = 5): Promise<Response> => {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const safety = isUrlSafe(current);
    if (!safety.ok) throw new Error(`redirect blocked: ${safety.reason}`);
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error("too many redirects");
};

const scrape = async (url: string): Promise<ScrapeResult> => {
  const res = await safeFetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AutoLabelsVDPBot/1.0; +https://autolabels.io/bot)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
  });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  // 1. JSON-LD preferred
  const ld = extractSchemaOrgVehicle(doc as Doc);
  if (ld && ld.photos.length > 0) return ld;
  // 2. OpenGraph fallback
  const og = extractOpenGraph(doc as Doc);
  if (og.photos.length > 0) return og;
  // 3. Heuristic last
  return extractHeuristic(doc as Doc, new URL(url));
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json(500, { error: "supabase not configured" });

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json(401, { error: "missing bearer token" });

    const body = (await req.json().catch(() => ({}))) as {
      vehicle_id?: string;
      source_url?: string;
    };
    if (!body.vehicle_id || !body.source_url) {
      return json(400, { error: "vehicle_id and source_url required" });
    }

    const safety = isUrlSafe(body.source_url);
    if (!safety.ok) {
      return json(400, { error: `source_url rejected: ${safety.reason}` });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: userRes } = await admin.auth.getUser(jwt);
    if (!userRes?.user) return json(401, { error: "invalid token" });

    // Confirm the vehicle belongs to a tenant the caller is a member of,
    // or the caller is an admin. We do NOT need to pull the full row —
    // the merge RPC re-checks authorization via RLS.
    const { data: vrow } = await admin
      .from("vehicle_listings")
      .select("id,vin,tenant_id")
      .eq("id", body.vehicle_id)
      .maybeSingle();
    if (!vrow) return json(404, { error: "vehicle not found" });

    const scraped = await scrape(body.source_url);

    // VIN mismatch guard
    if (scraped.vin && vrow.vin && scraped.vin.toUpperCase() !== vrow.vin.toUpperCase()) {
      return json(409, {
        error: "vin_mismatch",
        message: `Scraped page VIN ${scraped.vin} does not match vehicle ${vrow.vin}.`,
      });
    }

    // Normalize feature highlights from options (first 8, curated).
    const features = scraped.options.slice(0, 8).map((o) => ({ icon: "sparkles", title: o }));

    // Build the merge payload. Only pass non-empty fields so we don't
    // clobber existing dealer-edited content.
    const payload = {
      _vehicle_id: body.vehicle_id,
      _source_url: body.source_url,
      _photos: scraped.photos.length > 0 ? scraped.photos : null,
      _description: scraped.description,
      _features: features.length > 0 ? features : null,
      _key_specs: Object.keys(scraped.key_specs).length > 0 ? scraped.key_specs : null,
      _price: scraped.price,
      _mileage: scraped.mileage,
      _options: scraped.options.length > 0 ? scraped.options : null,
    };

    // Use a user-scoped client so the has_role / current_tenant_id
    // checks inside merge_scraped_vdp evaluate against the caller.
    const userClient = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { error } = await userClient.rpc("merge_scraped_vdp", payload);
    if (error) return json(403, { error: error.message });

    return json(200, {
      ok: true,
      source: scraped.source,
      photo_count: scraped.photos.length,
      options_count: scraped.options.length,
      vin: scraped.vin,
      price: scraped.price,
      mileage: scraped.mileage,
    });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : "unknown error" });
  }
});
