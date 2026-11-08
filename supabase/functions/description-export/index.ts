// description-export: the authoritative vAuto export path. NOT DEPLOYED; it
// needs the proposed 20261109000100_vauto_export_gate migration first.
//
//   check    run decideVautoExport on the stored text, price, fee settings,
//            store disclosure and evidence, then record the decision. SQL
//            re-proves the hard rules and fingerprints the state.
//   approve  a signed-in approver approves one passed check. Runs as the
//            caller, so the database sees who approves; no service call can.
//   export   returns the text only under a still-valid approval.
//
// The admin screen calls this function; nothing in the browser can approve.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { json, preflight } from "../_shared/http.ts";
import { applyStoreOverrides, loadStoreSettings } from "../_shared/description-store-settings.ts";
import {
  decideVautoExport, resolveFeeBasis, rulesFor, VAUTO_CHANNEL,
  type EvidenceState, type StoreDisclosure, type StoredPriceRow,
} from "../_shared/vauto-export-gate.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) return json(503, { error: "export gate not configured" });

  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { error: "missing bearer token" });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const asCaller = createClient(url, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userRes?.user) return json(401, { error: "invalid token" });
  const uid = userRes.user.id;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "");

  if (action === "approve") {
    const checkId = String(body.check_id ?? "");
    if (!UUID.test(checkId)) return json(400, { error: "check_id required" });
    const { data, error } = await asCaller.rpc("approve_vauto_export", { _check_id: checkId, _note: body.note == null ? null : String(body.note).slice(0, 500) });
    if (error) return json(error.code === "42501" ? 403 : 409, { error: error.message });
    return json(200, data);
  }

  const cvId = String(body.channel_version_id ?? "");
  if (!UUID.test(cvId)) return json(400, { error: "channel_version_id required" });

  if (action === "export") {
    const { data, error } = await asCaller.rpc("export_vauto_description", { _channel_version_id: cvId });
    if (error) return json(error.code === "42501" ? 403 : 409, { error: error.message });
    return json(200, data);
  }

  if (action !== "check") return json(400, { error: "unknown action" });

  const { data: cv } = await admin.from("description_channel_versions")
    .select("id, tenant_id, description_case_id, master_version_id, channel, content, potentially_stale").eq("id", cvId).maybeSingle();
  if (!cv) return json(404, { error: "channel version not found" });
  if (cv.channel !== VAUTO_CHANNEL) return json(400, { error: "not a vAuto channel version" });

  const { data: member } = await admin.from("tenant_members").select("role")
    .eq("tenant_id", cv.tenant_id).eq("user_id", uid).not("accepted_at", "is", null).maybeSingle();
  if (!member) return json(403, { error: "not a member of this dealership" });
  const { data: authorized } = await asCaller.rpc("has_description_authority", { p_tenant_id: cv.tenant_id, p_level: "approve" });

  const { data: dcase } = await admin.from("description_cases").select("id, vehicle_id, potentially_stale").eq("id", cv.description_case_id).maybeSingle();
  const { data: listing } = await admin.from("vehicle_listings")
    .select("id, price, doc_fee, advertised_price_before_doc, website_sale_price, owning_store_id").eq("id", dcase?.vehicle_id ?? "").maybeSingle();
  const { data: profile } = await admin.from("dealer_profiles").select("settings").eq("tenant_id", cv.tenant_id).maybeSingle();
  const settings = (profile?.settings ?? {}) as Record<string, unknown>;
  const { data: descSettings } = await admin.from("description_settings").select("*").eq("tenant_id", cv.tenant_id).maybeSingle();
  const storeId = (listing?.owning_store_id as string | null) ?? null;
  const merged = applyStoreOverrides((descSettings ?? {}) as Record<string, unknown>, await loadStoreSettings(admin, cv.tenant_id, storeId));
  const { data: store } = storeId ? await admin.from("dealer_stores").select("state").eq("id", storeId).maybeSingle() : { data: null };
  const state = String(merged.state ?? store?.state ?? settings.dealer_state ?? settings.doc_fee_state ?? "") || null;

  const { basis } = resolveFeeBasis(settings);
  const basisKey = basis === "includes_fee" || basis === "before_fee" ? basis : null;
  let disclosure: StoreDisclosure | null = null;
  if (basisKey) {
    const { data: rows } = await admin.from("description_store_disclosures")
      .select("id, store_id, basis, template, version, status, legal_reviewed_by, legal_reviewed_at, legal_reference, plain_text_format_accepted, approved_by, approved_at")
      .eq("tenant_id", cv.tenant_id).eq("basis", basisKey).eq("status", "approved");
    const pick = (rows ?? []).find((r) => r.store_id === storeId) ?? (rows ?? []).find((r) => r.store_id == null) ?? null;
    if (pick) {
      disclosure = {
        storeId: pick.store_id, basis: pick.basis, template: pick.template, version: String(pick.version), status: pick.status,
        legalReviewedBy: pick.legal_reviewed_by, legalReviewedAt: pick.legal_reviewed_at, legalReference: pick.legal_reference,
        plainTextFormatAccepted: !!pick.plain_text_format_accepted, approvedBy: pick.approved_by, approvedAt: pick.approved_at,
      };
    }
  }

  const row: StoredPriceRow | null = listing
    ? { price: num(listing.price), advertisedBeforeDoc: num(listing.advertised_price_before_doc), websiteSalePrice: num(listing.website_sale_price), docFee: num(listing.doc_fee) }
    : null;
  const { count: exc } = await admin.from("description_exceptions").select("id", { count: "exact", head: true })
    .eq("description_case_id", cv.description_case_id).eq("blocking", true).in("status", ["open", "in_progress"]).or(`channel.is.null,channel.eq.${VAUTO_CHANNEL}`);
  const { count: find } = await admin.from("description_validation_results").select("id", { count: "exact", head: true })
    .eq("description_case_id", cv.description_case_id).eq("blocking", true).eq("status", "open")
    .or(`channel_version_id.eq.${cv.id},and(channel_version_id.is.null,version_id.eq.${cv.master_version_id})`);
  const { data: master } = await admin.from("description_versions").select("fact_snapshot_id").eq("id", cv.master_version_id).maybeSingle();
  const evidence: EvidenceState = {
    factSnapshot: !!master?.fact_snapshot_id,
    openBlockingExceptions: exc ?? 0,
    openBlockingFindings: find ?? 0,
    potentiallyStale: !!cv.potentially_stale || !!dcase?.potentially_stale,
  };

  const decision = decideVautoExport({
    content: String(cv.content ?? ""), cta: (merged.cta_template as string | null) ?? null, settings, row, observed: null,
    disclosure, rules: rulesFor(state), evidence, authorized: authorized === true,
  });

  const { data: recorded, error: recErr } = await admin.rpc("record_vauto_export_check", {
    _channel_version_id: cv.id, _ok: decision.ok, _reasons: decision.reasons, _counts: decision.counts,
    _gate_version: decision.gateVersion, _requested_by: uid,
  });
  if (recErr) return json(500, { error: "check could not be recorded" });

  return json(200, {
    check_id: recorded?.check_id ?? null,
    ok: recorded?.ok === true,
    reasons: decision.reasons,
    sql_blockers: recorded?.sql_blockers ?? [],
    counts: decision.counts,
    breakdown: decision.breakdown,
    rendered_disclosure: decision.renderedDisclosure,
    disclosure_version: decision.disclosureVersion,
    state,
  });
});
