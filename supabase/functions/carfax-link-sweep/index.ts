// carfax-link-sweep — capture each vehicle's CARFAX report link from the
// dealer's OWN vehicle detail page.
//
// buildFactSnapshot already reads carfax_1_owner from the feed and already
// refuses to say "one owner" unless listing.history_report_url exists: a claim
// the shopper cannot check is a claim we do not make. In production 60 of
// Harte's 130 live vehicles are flagged one-owner and 59 lose the claim purely
// because no URL is stored. This closes that gap without weakening the rule.
//
// It stores the LINK, never scraped report content. Owner counts, accident
// counts and service records are CARFAX's licensed report; the link hands the
// shopper the real thing rather than restating it second-hand.
//
// Dry-run by default. It reports what it found on each page -- including the
// pages where it found nothing and what CARFAX URLs were present instead --
// because the parser was written without sight of these pages and the first
// run is a measurement, not a migration.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { findCarfaxUrls, pickReportUrl } from "../_shared/carfaxLink.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const auth = req.headers.get("authorization") || "";
    const cron = req.headers.get("x-cron-secret") || "";
    if (!auth.includes(SERVICE_KEY) && (!CRON_SECRET || cron !== CRON_SECRET)) {
      return json({ error: "forbidden" }, 403);
    }

    const tenantId = String(body.tenant_id || "");
    if (!tenantId) return json({ error: "tenant_id required" }, 400);
    const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 100);
    // Writing is opt-in. A parser written without sight of the pages gets to
    // prove itself on a dry run first.
    const apply = body.apply === true;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: rows } = await admin
      .from("vehicle_listings")
      .select("id, vin, mc_attributes, history_report_url")
      .eq("tenant_id", tenantId)
      .in("status", ["draft", "published"])
      .is("history_report_url", null)
      .limit(limit);

    const results: Record<string, unknown>[] = [];
    let found = 0, written = 0, noVdp = 0, fetchFailed = 0;

    for (const r of (rows || []) as Array<Record<string, any>>) {
      const vdp = String(r.mc_attributes?.vdp_url || "");
      if (!vdp) { noVdp++; results.push({ vin: r.vin, outcome: "no_vdp_url" }); continue; }

      let html = "";
      try {
        const res = await fetch(vdp, {
          headers: { "User-Agent": "AutoLabels/1.0 (+dealer inventory sync)" },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          fetchFailed++;
          results.push({ vin: r.vin, outcome: "fetch_status", status: res.status });
          continue;
        }
        html = await res.text();
      } catch (e) {
        fetchFailed++;
        results.push({ vin: r.vin, outcome: "fetch_failed", error: (e as Error).message });
        continue;
      }

      const report = pickReportUrl(html, r.vin);
      if (!report) {
        // Report the CARFAX URLs that WERE on the page. Without this the first
        // run says only "nothing found" and gives nothing to correct.
        results.push({
          vin: r.vin, outcome: "no_report_link",
          carfax_urls_seen: findCarfaxUrls(html).slice(0, 5),
          html_bytes: html.length,
        });
        continue;
      }

      found++;
      if (apply) {
        const { error } = await admin.from("vehicle_listings")
          .update({ history_report_url: report }).eq("id", r.id);
        if (!error) written++;
      }
      results.push({ vin: r.vin, outcome: "report_found", url: report, written: apply });
    }

    return json({
      success: true, apply, examined: (rows || []).length,
      found, written, no_vdp_url: noVdp, fetch_failed: fetchFailed, results,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
