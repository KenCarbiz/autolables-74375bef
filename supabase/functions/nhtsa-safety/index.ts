import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SafetyBody {
  make: string;
  model: string;
  year: string;
}

interface SafetyRatings {
  vehicleDescription: string;
  overall: number | null;
  frontal: number | null;
  side: number | null;
  rollover: number | null;
  complaintsCount: number | null;
  recallsCount: number | null;
  investigationCount: number | null;
}

interface ComplaintSummary {
  count: number;
  crashes: number;
  fires: number;
  topComponents: { component: string; count: number }[];
  recent: { components: string; dateFiled: string; summary: string }[];
}

interface SafetyResponse {
  ratings: SafetyRatings | null;
  complaints: ComplaintSummary | null;
  lastChecked: string;
}

// NHTSA's two hosts disagree on envelope casing: SafetyRatings is PascalCase
// (Count/Results), complaints is lowercase (count/results). Normalize both.
const toStars = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
};

async function fetchRatings(make: string, model: string, year: string): Promise<SafetyRatings | null> {
  try {
    const listUrl = `https://api.nhtsa.gov/SafetyRatings/modelyear/${encodeURIComponent(year)}/make/${encodeURIComponent(make)}/model/${encodeURIComponent(model)}`;
    const listRes = await fetch(listUrl, { signal: AbortSignal.timeout(10000) });
    if (!listRes.ok) return null;
    const listData = await listRes.json() as { Results?: Array<{ VehicleDescription?: string; VehicleId?: number }> };
    const variants = (listData.Results || []).filter((v) => v.VehicleId);
    if (variants.length === 0) return null;

    // Variants are body/drive configurations; take the first one that carries a
    // real overall rating so an unrated trim doesn't hide a rated one.
    let fallback: SafetyRatings | null = null;
    for (const variant of variants.slice(0, 4)) {
      const detailUrl = `https://api.nhtsa.gov/SafetyRatings/VehicleId/${variant.VehicleId}`;
      const detailRes = await fetch(detailUrl, { signal: AbortSignal.timeout(10000) });
      if (!detailRes.ok) continue;
      const detailData = await detailRes.json() as { Results?: Array<Record<string, unknown>> };
      const r = detailData.Results?.[0];
      if (!r) continue;
      const overall = toStars(r.OverallRating);
      const ratings: SafetyRatings = {
        vehicleDescription: String(r.VehicleDescription || variant.VehicleDescription || ""),
        overall,
        frontal: toStars(r.OverallFrontCrashRating),
        side: toStars(r.OverallSideCrashRating),
        rollover: toStars(r.RolloverRating),
        complaintsCount: Number.isFinite(Number(r.ComplaintsCount)) ? Number(r.ComplaintsCount) : null,
        recallsCount: Number.isFinite(Number(r.RecallsCount)) ? Number(r.RecallsCount) : null,
        investigationCount: Number.isFinite(Number(r.InvestigationCount)) ? Number(r.InvestigationCount) : null,
      };
      if (overall != null) return ratings;
      if (!fallback) fallback = ratings;
    }
    return fallback;
  } catch {
    return null;
  }
}

async function fetchComplaints(make: string, model: string, year: string): Promise<ComplaintSummary | null> {
  try {
    const url = `https://api.nhtsa.gov/complaints/complaintsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (res.status === 404) return { count: 0, crashes: 0, fires: 0, topComponents: [], recent: [] };
    if (!res.ok) return null;
    const data = await res.json() as {
      count?: number;
      results?: Array<{
        crash?: boolean; fire?: boolean; components?: string;
        dateComplaintFiled?: string; summary?: string;
      }>;
    };
    const items = data.results || [];
    const tally = new Map<string, number>();
    let crashes = 0, fires = 0;
    for (const c of items) {
      if (c.crash) crashes++;
      if (c.fire) fires++;
      for (const part of String(c.components || "").split(",")) {
        const p = part.trim();
        if (p) tally.set(p, (tally.get(p) || 0) + 1);
      }
    }
    const topComponents = Array.from(tally.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([component, count]) => ({ component, count }));
    const recent = items
      .filter((c) => c.summary)
      .sort((a, b) => {
        const parse = (s?: string) => { const [m, d, y] = String(s || "").split("/").map(Number); return y ? y * 10000 + m * 100 + d : 0; };
        return parse(b.dateComplaintFiled) - parse(a.dateComplaintFiled);
      })
      .slice(0, 3)
      .map((c) => ({
        components: String(c.components || ""),
        dateFiled: String(c.dateComplaintFiled || ""),
        summary: String(c.summary || "").slice(0, 280),
      }));
    return { count: data.count ?? items.length, crashes, fires, topComponents, recent };
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = (await req.json()) as SafetyBody;
    const { make, model, year } = body;
    if (!make || !model || !year) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: make, model, year" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [ratings, complaints] = await Promise.all([
      fetchRatings(make, model, year),
      fetchComplaints(make, model, year),
    ]);

    const response: SafetyResponse = {
      ratings,
      complaints,
      lastChecked: new Date().toISOString(),
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
