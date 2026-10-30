import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  FILESCOM_ORIGIN, INBOUND_FOLDER, MAX_CSV_BYTES, assertConnectorWrite, authorizePlatformAdmin, canonicalInboundPath,
  approvalDecision, checkDownloadedContent, downloadFileContents, encodeApiPath, intakeStatus, remoteMeta, sha256Hex, type BindingStatus, type RemoteMeta,
} from "../_shared/filescom/policy.ts";
import { parseCsv } from "../_shared/filescom/csv.ts";
import { compareIdentity, runDryRun, type TenantProfile } from "../_shared/filescom/dryRun.ts";

// Platform-admin console for the Files.com inventory connector (phase 1).
// Reads Files.com with a read-only key, records connector state, and runs
// dry-run validation. It never writes vehicle_listings or calls MarketCheck.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

class FcError extends Error {
  constructor(public code: string, public http?: number) { super(code); }
}

async function fcApi(key: string, path: string): Promise<unknown> {
  const res = await fetch(`${FILESCOM_ORIGIN}/api/rest/v1/${path}`, { headers: { "X-FilesAPI-Key": key, Accept: "application/json" }, redirect: "error" });
  if (!res.ok) {
    await res.body?.cancel();
    throw new FcError(res.status === 401 || res.status === 403 ? "filescom_auth_failed" : res.status === 404 ? "filescom_not_found" : "filescom_http_error", res.status);
  }
  return await res.json();
}

const fileMeta = async (key: string, path: string): Promise<RemoteMeta> => remoteMeta(await fcApi(key, `file_actions/metadata/${encodeApiPath(path)}`));

async function download(key: string, path: string): Promise<Uint8Array> {
  try { return await downloadFileContents(fetch, key, path); }
  catch (e) { throw new FcError(e instanceof Error ? e.message : "download_failed"); }
}

const must = (r: { error: unknown }) => { if (r.error) throw new FcError("ledger_write_failed"); };

const write = (db: SupabaseClient, table: string) => { assertConnectorWrite(table); return db.from(table); };

async function bindingFor(db: SupabaseClient, path: string) {
  const { data } = await db.from("inventory_feed_bindings").select("*").eq("provider", "filescom").eq("path", path).maybeSingle();
  return data as { id: string; status: BindingStatus; tenant_id: string | null; proposed_at: string | null } | null;
}

async function tenantProfile(db: SupabaseClient, tenantId: string): Promise<TenantProfile | null> {
  const { data: t } = await db.from("tenants").select("id,name").eq("id", tenantId).maybeSingle();
  if (!t) return null;
  const { data: mc } = await db.from("marketcheck_sync_config").select("rooftop_name,rooftop_street,rooftop_zip").eq("tenant_id", tenantId).maybeSingle();
  return { name: t.name ?? null, rooftopName: mc?.rooftop_name ?? null, street: mc?.rooftop_street ?? null, postal: mc?.rooftop_zip ?? null, city: null, region: null };
}

async function syncFileStatus(db: SupabaseClient, path: string) {
  const b = await bindingFor(db, path);
  const s = intakeStatus(b?.status ?? null);
  must(await write(db, "inventory_feed_files").update({ status: s.status, quarantine_reason: s.reason, updated_at: new Date().toISOString() }).eq("provider", "filescom").eq("path", path).in("status", ["pending", "quarantined"]));
}

async function overview(db: SupabaseClient) {
  const [files, bindings, runs, events] = await Promise.all([
    db.from("inventory_feed_files").select("*").order("path"),
    db.from("inventory_feed_bindings").select("*").order("path"),
    db.from("inventory_feed_runs").select("id,path,status,failure_reason,binding_status,tenant_id,started_at,finished_at,content_sha256,remote_size,remote_mtime,report").order("started_at", { ascending: false }).limit(50),
    db.from("inventory_feed_events").select("id,action,path,event_at,size,applied_as_latest,received_at").order("received_at", { ascending: false }).limit(25),
  ]);
  const err = files.error ?? bindings.error ?? runs.error ?? events.error;
  if (err) throw new FcError("read_failed");
  const tenantIds = [...new Set([...(bindings.data ?? []).map((b) => b.tenant_id), ...(runs.data ?? []).map((r) => r.tenant_id)].filter(Boolean))] as string[];
  const { data: tenants } = tenantIds.length ? await db.from("tenants").select("id,name").in("id", tenantIds) : { data: [] };
  return {
    config: {
      origin: FILESCOM_ORIGIN,
      folder: INBOUND_FOLDER,
      secrets: { FILESCOM_API_KEY: !!Deno.env.get("FILESCOM_API_KEY"), FILESCOM_WEBHOOK_SECRET: !!Deno.env.get("FILESCOM_WEBHOOK_SECRET") },
      callbackPath: "/functions/v1/files-inventory-notify",
    },
    files: files.data, bindings: bindings.data, runs: runs.data, events: events.data, tenants,
  };
}

async function discover(db: SupabaseClient, key: string) {
  const list = (await fcApi(key, `folders/${encodeApiPath(INBOUND_FOLDER)}?per_page=1000`)) as unknown[];
  if (!Array.isArray(list)) throw new FcError("filescom_unexpected_response");
  const now = new Date().toISOString();
  let found = 0;
  const skipped: string[] = [];
  for (const item of list) {
    const o = item as { path?: unknown; type?: unknown };
    if (o.type !== "file") continue;
    const p = canonicalInboundPath(o.path);
    if (!p.ok) { if (typeof o.path === "string") skipped.push(o.path.split("/").pop() ?? ""); continue; }
    const m = remoteMeta(item);
    const b = await bindingFor(db, p.path);
    const s = intakeStatus(b?.status ?? null);
    const { data: existing, error: rerr } = await db.from("inventory_feed_files").select("id,status").eq("provider", "filescom").eq("path", p.path).maybeSingle();
    if (rerr) throw new FcError("read_failed");
    if (existing) {
      const keep = existing.status === "validating" || existing.status === "validated" || existing.status === "rejected" || existing.status === "failed";
      must(await write(db, "inventory_feed_files").update({ remote_size: m.size, remote_mtime: m.mtime, remote_checksum: m.checksum, discovered_at: now, updated_at: now, ...(keep ? {} : { status: s.status, quarantine_reason: s.reason }) }).eq("id", existing.id));
    } else {
      must(await write(db, "inventory_feed_files").insert({ path: p.path, remote_size: m.size, remote_mtime: m.mtime, remote_checksum: m.checksum, discovered_at: now, status: s.status, quarantine_reason: s.reason }));
    }
    found++;
  }
  return { found, skipped: skipped.slice(0, 20) };
}

async function validate(db: SupabaseClient, key: string, path: string, uid: string) {
  const binding = await bindingFor(db, path);
  const { data: file } = await db.from("inventory_feed_files").select("id,status,updated_at").eq("provider", "filescom").eq("path", path).maybeSingle();
  if (!file) throw new FcError("file_not_discovered");
  if (file.status === "validating" && Date.now() - Date.parse(file.updated_at) < 10 * 60_000) throw new FcError("already_validating");
  const { data: run, error } = await write(db, "inventory_feed_runs").insert({
    file_id: file.id, path, binding_id: binding?.id ?? null, binding_status: binding?.status ?? "unmapped", tenant_id: binding?.tenant_id ?? null, triggered_by: uid,
  }).select("id").single();
  if (error || !run) throw new FcError("run_create_failed");
  must(await write(db, "inventory_feed_files").update({ status: "validating", updated_at: new Date().toISOString() }).eq("id", file.id));

  const finish = async (status: "passed" | "rejected" | "failed", patch: Record<string, unknown>) => {
    const now = new Date().toISOString();
    must(await write(db, "inventory_feed_runs").update({ status, finished_at: now, ...patch }).eq("id", run.id));
    const fileStatus = status === "passed" ? "validated" : status === "rejected" ? "rejected" : "failed";
    const version = patch.content_sha256 ? { last_content_sha256: patch.content_sha256, remote_size: patch.remote_size ?? null, remote_mtime: patch.remote_mtime ?? null } : {};
    must(await write(db, "inventory_feed_files").update({ status: fileStatus, last_run_id: run.id, updated_at: now, ...version }).eq("id", file.id));
    return { runId: run.id, status };
  };

  try {
    const before = await fileMeta(key, path);
    const bytes = await download(key, path);
    const after = await fileMeta(key, path);
    const sha = await sha256Hex(bytes);
    const chk = checkDownloadedContent(before, after, bytes.byteLength, sha);
    if (!chk.ok) return await finish("failed", { failure_reason: chk.reason });
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { return await finish("rejected", { failure_reason: "not_utf8", content_sha256: sha, remote_size: after.size, remote_mtime: after.mtime }); }
    const csv = parseCsv(text);
    if (!csv.ok) return await finish("rejected", { failure_reason: `csv_${csv.reason}`, content_sha256: sha, remote_size: after.size, remote_mtime: after.mtime, report: { parseLine: csv.line ?? null } });

    let existing: Array<{ vin: string; price: number | null }> | null = null;
    let profile: TenantProfile | null = null;
    if (binding?.tenant_id && binding.status !== "disabled") {
      const { data: rows, error: lerr } = await db.from("vehicle_listings").select("vin,price").eq("tenant_id", binding.tenant_id).is("archived_at", null).limit(5000);
      if (lerr) return await finish("failed", { failure_reason: "inventory_read_failed" });
      existing = (rows ?? []).filter((r) => r.vin).map((r) => ({ vin: r.vin as string, price: r.price === null ? null : Number(r.price) }));
      profile = await tenantProfile(db, binding.tenant_id);
      if (!profile) return await finish("failed", { failure_reason: "tenant_profile_unavailable" });
    }
    const report = runDryRun(csv.headers, csv.rows, existing);
    const identityReview = profile ? compareIdentity(report.identity, profile) : null;
    return await finish(report.outcome, {
      content_sha256: sha, remote_size: after.size, remote_mtime: after.mtime,
      failure_reason: report.outcome === "rejected" ? report.rejectReasons.join(",") : null,
      report: { ...report, identityReview, bindingProposedAt: binding?.proposed_at ?? null, tenantProfile: profile, inventoryWrites: 0, providerCalls: 0 },
    });
  } catch (e) {
    const code = e instanceof FcError ? e.code : "validation_error";
    if (code === "ledger_write_failed") throw e;
    return await finish("failed", { failure_reason: code });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const auth = req.headers.get("Authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let userId: string | null = null;
  if (auth.startsWith("Bearer ")) {
    const { data } = await db.auth.getUser(auth.slice(7));
    userId = data?.user?.id ?? null;
  }
  let hasRole: boolean | null = null;
  if (userId) {
    const { data, error } = await db.rpc("has_role", { _user_id: userId, _role: "admin" });
    hasRole = error ? null : data === true;
  }
  const gate = authorizePlatformAdmin({ userId, hasPlatformRole: hasRole });
  if (!gate.ok) return json(gate.status, { error: gate.status === 401 ? "unauthorized" : "platform_admin_required" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json" }); }
  const action = body.action;
  const key = Deno.env.get("FILESCOM_API_KEY");
  const needPath = () => {
    const p = canonicalInboundPath(body.path);
    if (!p.ok) throw new FcError(p.reason, 400);
    return p.path;
  };

  try {
    switch (action) {
      case "overview":
        return json(200, await overview(db));
      case "discover":
        if (!key) return json(409, { error: "FILESCOM_API_KEY_missing" });
        return json(200, await discover(db, key));
      case "validate":
        if (!key) return json(409, { error: "FILESCOM_API_KEY_missing" });
        return json(200, await validate(db, key, needPath(), userId!));
      case "search_tenants": {
        const q = typeof body.q === "string" ? body.q.trim().slice(0, 80) : "";
        if (q.length < 2) return json(200, { tenants: [] });
        const { data, error } = await db.from("tenants").select("id,name,is_active").ilike("name", `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`).order("name").limit(20);
        if (error) throw new FcError("read_failed");
        return json(200, { tenants: data });
      }
      case "tenant_profile": {
        if (typeof body.tenant_id !== "string") return json(400, { error: "tenant_id_required" });
        return json(200, { profile: await tenantProfile(db, body.tenant_id) });
      }
      case "propose_binding": {
        const path = needPath();
        if (typeof body.tenant_id !== "string") return json(400, { error: "tenant_id_required" });
        const profile = await tenantProfile(db, body.tenant_id);
        if (!profile) return json(404, { error: "tenant_not_found" });
        const existing = await bindingFor(db, path);
        if (existing?.status === "approved") return json(409, { error: "binding_already_approved_disable_first" });
        const now = new Date().toISOString();
        const { error } = await write(db, "inventory_feed_bindings").upsert({ provider: "filescom", path, tenant_id: body.tenant_id, status: "pending", proposed_by: userId, proposed_at: now, approved_by: null, approved_at: null, identity_acknowledged: null, updated_at: now }, { onConflict: "provider,path" });
        if (error) throw new FcError("ledger_write_failed");
        await syncFileStatus(db, path);
        return json(200, { ok: true });
      }
      case "approve_binding": {
        const path = needPath();
        const b = await bindingFor(db, path);
        const { data: last, error: lerr } = await db.from("inventory_feed_runs").select("id,status,report,binding_id,tenant_id,content_sha256,remote_size,remote_mtime").eq("provider", "filescom").eq("path", path).order("started_at", { ascending: false }).limit(1).maybeSingle();
        const { data: file, error: ferr } = await db.from("inventory_feed_files").select("last_run_id,last_content_sha256,remote_size,remote_mtime").eq("provider", "filescom").eq("path", path).maybeSingle();
        if (lerr || ferr) throw new FcError("read_failed");
        const d = approvalDecision(b, last, file, body.acknowledge_identity);
        if (!d.ok) return json(409, { error: d.error });
        const now = new Date().toISOString();
        const { data: upd, error } = await write(db, "inventory_feed_bindings").update({ status: "approved", approved_by: userId, approved_at: now, identity_acknowledged: { run_id: last!.id, review: d.review, acknowledged: d.acknowledged }, updated_at: now })
          .eq("id", b!.id).eq("status", "pending").eq("tenant_id", b!.tenant_id!).eq("proposed_at", b!.proposed_at!).select("id");
        if (error) throw new FcError("ledger_write_failed");
        if (!upd || upd.length !== 1) return json(409, { error: "proposal_changed_concurrently" });
        await syncFileStatus(db, path);
        return json(200, { ok: true });
      }
      case "disable_binding": {
        const path = needPath();
        const now = new Date().toISOString();
        const { error } = await write(db, "inventory_feed_bindings").update({ status: "disabled", disabled_by: userId, disabled_at: now, updated_at: now }).eq("provider", "filescom").eq("path", path);
        if (error) throw new FcError("ledger_write_failed");
        await syncFileStatus(db, path);
        return json(200, { ok: true });
      }
      default:
        return json(400, { error: "unknown_action" });
    }
  } catch (e) {
    if (e instanceof FcError) return json(e.http === 400 ? 400 : e.code === "already_validating" || e.code === "file_not_discovered" ? 409 : 502, { error: e.code, status: e.http === 400 ? null : e.http ?? null });
    console.error("files-inventory-admin error");
    return json(500, { error: "internal_error" });
  }
});
