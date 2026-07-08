// vehicle-lookup
// Read-only VIN / stock / slug lookup for sister apps (AutoFilm). Auth is a
// shared secret in the `x-lookup-secret` header; scope is always a tenant id
// (matched against tenant_id OR store_id). Returns up to 5 candidates with a
// canonical passport_url of https://autolabels.io/v/<slug>.

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-lookup-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const PASSPORT_BASE = "https://autolabels.io/v";

interface Row {
  vin: string | null;
  slug: string | null;
  ymm: string | null;
  trim: string | null;
  price: number | null;
  mileage: number | null;
  status: string | null;
  hero_image_url: string | null;
  tenant_id: string | null;
  store_id: string | null;
  mc_attributes: Record<string, unknown> | null;
  key_specs: Record<string, unknown> | null;
}

const pickStock = (r: Row): string | null => {
  const mc = (r.mc_attributes as any)?.stock ?? (r.mc_attributes as any)?.stock_number;
  const ks = (r.key_specs as any)?.stock ?? (r.key_specs as any)?.stock_number;
  return (mc || ks || null) as string | null;
};

const splitYmm = (ymm: string | null): { year?: number; make?: string; model?: string } => {
  if (!ymm) return {};
  const parts = ymm.trim().split(/\s+/);
  const year = /^\d{4}$/.test(parts[0]) ? Number(parts[0]) : undefined;
  const make = year ? parts[1] : parts[0];
  const model = year ? parts.slice(2).join(" ") : parts.slice(1).join(" ");
  return { year, make, model: model || undefined };
};

const shape = (r: Row) => {
  const { year, make, model } = splitYmm(r.ymm);
  const slug = r.slug || r.vin || "";
  return {
    vin: r.vin,
    year,
    make,
    model,
    trim: r.trim,
    ymm: r.ymm,
    price: r.price,
    mileage: r.mileage,
    status: r.status,
    hero_image_url: r.hero_image_url,
    slug: r.slug,
    stock: pickStock(r),
    passport_url: slug ? `${PASSPORT_BASE}/${slug}` : null,
  };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const secret = Deno.env.get("AUTOLABELS_LOOKUP_SECRET");
    const provided = req.headers.get("x-lookup-secret");
    if (!secret || !provided || provided !== secret) {
      return json(401, { matches: [], error: "unauthorized" });
    }

    let tenant = "";
    let q = "";
    if (req.method === "GET") {
      const url = new URL(req.url);
      tenant = url.searchParams.get("tenant") || "";
      q = url.searchParams.get("q") || "";
    } else {
      const body = await req.json().catch(() => ({}));
      tenant = body.tenant || "";
      q = body.q || "";
      if (!tenant || !q) {
        const url = new URL(req.url);
        tenant ||= url.searchParams.get("tenant") || "";
        q ||= url.searchParams.get("q") || "";
      }
    }

    tenant = tenant.trim();
    q = q.trim().toUpperCase();
    if (!tenant || !q) return json(200, { matches: [], error: "missing tenant or q" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const cols =
      "vin, slug, ymm, trim, price, mileage, status, hero_image_url, tenant_id, store_id, mc_attributes, key_specs, published_at";

    const tenantFilter = `tenant_id.eq.${tenant},store_id.eq.${tenant}`;

    const rowsById = new Map<string, Row>();
    const addRows = (rows: Row[] | null) => {
      if (!rows) return;
      for (const r of rows) {
        const k = (r.vin || r.slug || Math.random().toString()) as string;
        if (!rowsById.has(k)) rowsById.set(k, r);
      }
    };

    const isFullVin = q.length === 17;

    const safe = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      try { return await fn(); } catch { return null; }
    };

    // 1) Full VIN exact match
    if (isFullVin) {
      const res = await safe(() => (supabase as any)
        .from("vehicle_listings")
        .select(cols)
        .or(tenantFilter)
        .eq("vin", q)
        .limit(5));
      addRows(res?.data);
    }

    // 2) Partial VIN or slug match
    if (rowsById.size < 5) {
      const like = `%${q}%`;
      const res = await safe(() => (supabase as any)
        .from("vehicle_listings")
        .select(cols)
        .or(tenantFilter)
        .or(`vin.ilike.${like},slug.ilike.${like}`)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(10));
      addRows(res?.data);
    }

    // 3) Stock number in mc_attributes / key_specs (JSON contains)
    if (rowsById.size < 5) {
      for (const key of ["stock", "stock_number"]) {
        const mc = await safe(() => (supabase as any)
          .from("vehicle_listings")
          .select(cols)
          .or(tenantFilter)
          .contains("mc_attributes", { [key]: q })
          .limit(5));
        addRows(mc?.data);
        const ks = await safe(() => (supabase as any)
          .from("vehicle_listings")
          .select(cols)
          .or(tenantFilter)
          .contains("key_specs", { [key]: q })
          .limit(5));
        addRows(ks?.data);
      }
    }

    // 4) Stock lookup via vehicle_files → resolve to vin, then re-query listings
    if (rowsById.size < 5) {
      const filesRes = await safe(() => (supabase as any)
        .from("vehicle_files")
        .select("vin, stock_number, tenant_id, store_id")
        .or(tenantFilter)
        .ilike("stock_number", `%${q}%`)
        .limit(5));
      const vins = ((filesRes?.data as any[]) || []).map((f: any) => f.vin).filter(Boolean);
      if (vins.length) {
        const { data } = await (supabase as any)
          .from("vehicle_listings")
          .select(cols)
          .or(tenantFilter)
          .in("vin", vins)
          .limit(5);
        addRows(data);
      }
    }

    // Prefer published rows first, then most-recent
    const rows = Array.from(rowsById.values()).sort((a: any, b: any) => {
      const ap = a.status === "published" ? 0 : 1;
      const bp = b.status === "published" ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return (b.published_at || "").localeCompare(a.published_at || "");
    });

    return json(200, { matches: rows.slice(0, 5).map(shape) });
  } catch (e) {
    return json(200, { matches: [], error: (e as Error).message });
  }
});
