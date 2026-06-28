import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ──────────────────────────────────────────────────────────────────────
// price-drop-reengage — re-engages shoppers who asked to be notified when a
// vehicle's price drops. For each watcher, compares the listing's current
// advertised price to the price captured at opt-in (last_price). On a real
// drop it emails the shopper the new price + packet link, then advances
// last_price so each drop notifies at most once. Runs daily via cron.
// Service-role / cron-secret only. Honors the dealer's price_drop_emails_enabled.
// ──────────────────────────────────────────────────────────────────────

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const MIN_DROP = 100;        // ignore sub-$100 noise / rounding
const PER_RUN_CAP = 500;     // safety cap on emails per sweep

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = Deno.env.get("MARKETCHECK_CRON_SECRET") || "";
  const hasCron = !!cronSecret && (req.headers.get("x-cron-secret") || "") === cronSecret;
  if (auth !== SERVICE_KEY && !hasCron) return json(401, { error: "unauthorized" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // Per-tenant kill switch.
  const { data: profiles } = await admin.from("dealer_profiles").select("tenant_id, settings");
  const disabled = new Set<string>();
  for (const p of (profiles || []) as { tenant_id: string; settings: Record<string, unknown> }[]) {
    if (String(p.settings?.price_drop_emails_enabled) === "false") disabled.add(p.tenant_id);
  }

  const { data: watchers } = await admin
    .from("price_watchers")
    .select("id, tenant_id, vin, slug, email, name, last_price")
    .limit(5000);
  if (!watchers?.length) return json(200, { ok: true, scanned: 0, emailed: 0 });

  // One listing lookup per distinct VIN.
  const vins = [...new Set((watchers as { vin: string }[]).map((w) => (w.vin || "").toUpperCase()).filter(Boolean))];
  const listingByVin = new Map<string, { year?: number; make?: string; model?: string; trim?: string; price?: number; slug?: string }>();
  for (let i = 0; i < vins.length; i += 200) {
    const chunk = vins.slice(i, i + 200);
    const { data } = await admin.from("vehicle_listings")
      .select("vin, year, make, model, trim, price, slug, status").in("vin", chunk);
    for (const r of (data || []) as Record<string, unknown>[]) {
      const vin = String(r.vin || "").toUpperCase();
      if (!vin) continue;
      // Don't re-engage on sold/archived listings.
      if (["sold", "archived", "removed"].includes(String(r.status || "").toLowerCase())) continue;
      if (!listingByVin.has(vin)) listingByVin.set(vin, r as never);
    }
  }

  let emailed = 0, scanned = 0;
  for (const w of watchers as { id: string; tenant_id: string; vin: string; slug: string; email: string; name: string | null; last_price: number | null }[]) {
    if (emailed >= PER_RUN_CAP) break;
    scanned++;
    if (disabled.has(w.tenant_id)) continue;
    const listing = listingByVin.get((w.vin || "").toUpperCase());
    if (!listing) continue;
    const now = typeof listing.price === "number" ? listing.price : Number(listing.price);
    const base = typeof w.last_price === "number" ? w.last_price : Number(w.last_price);
    if (!Number.isFinite(now) || now <= 0) continue;
    // No baseline yet: stamp it so the next drop is measurable.
    if (!Number.isFinite(base) || base <= 0) {
      await admin.from("price_watchers").update({ last_price: now }).eq("id", w.id);
      continue;
    }
    const drop = base - now;
    if (drop < MIN_DROP) {
      // Price rose or held — keep baseline at the latest so future drops measure
      // from the higher price, never from a stale lower one.
      if (now > base) await admin.from("price_watchers").update({ last_price: now }).eq("id", w.id);
      continue;
    }

    const title = [listing.year, listing.make, listing.model, listing.trim].filter(Boolean).join(" ").trim() || "the vehicle you viewed";
    const slug = listing.slug || w.slug || w.vin;
    const origin = (req.headers.get("origin") || "").replace(/\/$/, "");
    const packetUrl = `${origin || "https://autolabels.io"}/v/${encodeURIComponent(slug)}`;
    const greeting = w.name ? `Hi ${w.name.split(" ")[0]},` : "Hi,";
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#0F172A">
        <p style="font-size:15px;margin:0 0 12px">${greeting}</p>
        <p style="font-size:15px;margin:0 0 4px">Good news — the price just dropped on a vehicle you were watching:</p>
        <h2 style="font-size:20px;margin:10px 0 4px">${title}</h2>
        <p style="font-size:15px;margin:0 0 2px">
          <span style="color:#94A3B8;text-decoration:line-through">${money(base)}</span>
          &nbsp;<span style="color:#16A34A;font-weight:700;font-size:18px">${money(now)}</span>
          &nbsp;<span style="color:#16A34A;font-weight:600">(${money(drop)} off)</span>
        </p>
        <p style="font-size:13px;color:#475569;margin:14px 0 16px">It may not last — pricing on in-demand vehicles moves quickly.</p>
        <a href="${packetUrl}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;padding:11px 18px;border-radius:12px;font-weight:600;font-size:14px">See the new price</a>
        <p style="font-size:12px;color:#94A3B8;margin:20px 0 0">You're getting this because you asked us to watch the price on this vehicle.</p>
      </div>`;

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ to: w.email, subject: `Price drop: ${title} now ${money(now)}`, html }),
      });
      if (res.ok) {
        await admin.from("price_watchers").update({ last_price: now, last_notified_at: new Date().toISOString() }).eq("id", w.id);
        emailed++;
      }
    } catch { /* skip this watcher; retried next sweep */ }
  }

  return json(200, { ok: true, scanned, emailed });
});
