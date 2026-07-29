// ──────────────────────────────────────────────────────────────────────
// Shared intake auto-provisioning — the one orchestration every ingest path
// runs for a genuinely new VIN (marketcheck-sync, dms-webhook, autocurb-sync):
// mint the permanent Get-Ready hub token, draft the addendum + compliance
// documents (Buyers Guide, K-208, Get-Ready, used-car window sticker), and
// fire-and-forget the render/enrichment calls.
//
// Two invariants (INTAKE_SPEC S1/S4):
//   1. A draft/artifact failure must NEVER fail or block ingestion — every
//      step is isolated and the loop continues.
//   2. Failures are RECORDED, not swallowed: each one lands in
//      vehicle_exceptions as 'artifact_autogen_failed' (upserted per VIN,
//      artifacts accumulated in source_values.artifacts) so the exception
//      queue and the intake summary can surface + retry it.
//
// Every draft RPC is VIN-idempotent, so calling this twice (re-sync, sweep
// overlap) is safe. No Deno globals — unit-testable under vitest.
// ──────────────────────────────────────────────────────────────────────

import { invokeFunction } from "./invoke.ts";
import { OemDocKey, oemDocKeyFromYmm, oemDocKeyString } from "./oemDocKey.ts";
// The negative-cache policy is the packet-backfill sweep's, imported rather
// than restated: ingest and the sweep spend from the same global budget, and
// two copies of "may we ask again" would drift into paying twice.
import {
  AttemptRow, HarvestOutcome, LinkKind,
  classifyHarvest, persistedLinkOutcome, shouldAttemptLink,
} from "./packetBackfill.ts";

// Minimal structural view of the supabase-js client; both the Deno edge
// client and the vitest fake satisfy it.
// deno-lint-ignore no-explicit-any
type Admin = any;

export interface AutoPreloadInput {
  tenantId: string;
  vin: string;
  ymm: string | null;
  listingId: string | null;
  emailTitle?: boolean;
}

const EXCEPTION_TYPE = "artifact_autogen_failed";

// What actually retries a failed artifact. The nightly intake sweep
// (sweep_missing_intake_drafts) re-runs only the draft RPCs and the hub token,
// and recon/description have their own sweeps. factory_sticker is re-fired by
// every nightly resync pass (ensureComplianceDrafts' render path re-posts it
// while the record is missing or retryable). The edge-only artifacts
// (form_pdfs, oem_window_sticker, title_request_email, oem_brochure,
// oem_owners_manual) are fired once at ingest and retried by nothing —
// claiming "the nightly sweep will also retry" for them promised a retry that
// never comes. The two OEM link harvests get one more shot than that in
// practice: they are model-scoped, so the next new vehicle of the same model
// re-attempts once the service lock has been dropped or expired.
const SWEEP_RETRIED = new Set([
  "addendum", "buyers_guide", "k208", "get_ready", "window_sticker",
  "get_ready_token", "ingest_orchestrate", "description", "factory_sticker",
]);

export function recommendedActionFor(artifacts: string[]): string {
  const sweep = artifacts.filter((a) => SWEEP_RETRIED.has(a));
  const edge = artifacts.filter((a) => !SWEEP_RETRIED.has(a));
  if (edge.length === 0) {
    return "Retry from the vehicle intake summary; the nightly intake sweep will also retry.";
  }
  if (sweep.length === 0) {
    return `Retry from the vehicle intake summary. No nightly sweep re-runs ${edge.join(", ")} — it will not retry on its own.`;
  }
  return `Retry from the vehicle intake summary. The nightly intake sweep will retry ${sweep.join(", ")}, but ${edge.join(", ")} will not retry on its own.`;
}

const hex16 = () => {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
};

const errText = (e: unknown): string =>
  String((e as { message?: string } | null)?.message || e || "unknown error").slice(0, 500);

// Record one failed artifact for the VIN. One open exception row per VIN
// (partial unique index on (tenant, vin, exception_type) for open rows), so an
// existing row is refreshed with the new artifact merged into
// source_values.artifacts. Never throws.
export async function recordArtifactFailure(
  admin: Admin, tenantId: string, vin: string, artifact: string, message: string,
): Promise<void> {
  try {
    const { data: existing } = await admin.from("vehicle_exceptions")
      .select("id, source_values")
      .eq("tenant_id", tenantId).eq("vin", vin).eq("exception_type", EXCEPTION_TYPE)
      .in("status", ["open", "in_progress"])
      .maybeSingle();
    if (existing?.id) {
      const prev = ((existing.source_values || {}) as { artifacts?: Record<string, string> }).artifacts || {};
      const merged = { ...prev, [artifact]: message };
      await admin.from("vehicle_exceptions").update({
        severity: "high",
        title: `Intake auto-generation failed: ${artifact}`,
        explanation: `Automatic creation of "${artifact}" failed: ${message}`,
        source_values: { ...(existing.source_values || {}), artifacts: merged },
        // Recomputed over the merged set: a row that gains an edge-only
        // artifact must stop promising the sweep will retry everything.
        recommended_action: recommendedActionFor(Object.keys(merged)),
      }).eq("id", existing.id);
      return;
    }
    await admin.from("vehicle_exceptions").insert({
      tenant_id: tenantId, vin, exception_type: EXCEPTION_TYPE,
      severity: "high",
      title: `Intake auto-generation failed: ${artifact}`,
      explanation: `Automatic creation of "${artifact}" failed: ${message}. Ingestion continued without this artifact.`,
      source_values: { artifacts: { [artifact]: message } },
      recommended_action: recommendedActionFor([artifact]),
      status: "open",
    });
  } catch { /* exception recording is best-effort — never break ingest */ }
}

// supabase-js RPCs report Postgres errors on the return value, not by
// throwing — the old per-caller try/catch never saw them. Check both.
async function draftRpc(
  admin: Admin, tenantId: string, vin: string, fn: string, artifact: string,
): Promise<void> {
  try {
    const { error } = await admin.rpc(fn, { p_tenant_id: tenantId, p_vin: vin });
    if (error) await recordArtifactFailure(admin, tenantId, vin, artifact, errText(error));
  } catch (e) {
    await recordArtifactFailure(admin, tenantId, vin, artifact, errText(e));
  }
}

// Fire-and-forget POST to a sibling edge function. Never awaited by callers by
// design (a render failure must not slow the ingest loop) — but drained
// through ONE serial queue per isolate.
//
// Six of these fired per new vehicle, in the same tick, inside a loop over
// every vehicle in the feed. A fifty-car page issued ~300 invocations in a
// few hundred milliseconds, the platform throttled them, and the throttle was
// recorded as a failed artifact. Three of these artifacts are retried by
// nothing, so a transient rate limit destroyed them permanently. That is the
// whole of the 97 artifact_autogen_failed rows.
//
// The queue is the fix; the retry inside invokeFunction is only the net for
// what still slips through.
let postGapMs = 250;
let postQueue: Promise<unknown> = Promise.resolve();
const pause = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

// Work STARTED from the serial queue but deliberately not drained by it.
// An OEM link harvest runs up to four provider searches plus a link probe and
// can outlast every other artifact put together; holding the serial queue for
// it would park a whole feed's documents behind one model's brochure. Its
// dispatch is still paced by the queue — only the waiting moves out here, so
// waitUntil can still cover it.
let detachedWork: Promise<unknown>[] = [];
function trackDetached(work: Promise<unknown>): void {
  const guarded = work.catch(() => undefined);
  detachedWork.push(guarded);
  void guarded.then(() => { detachedWork = detachedWork.filter((p) => p !== guarded); });
}

/** Test hook: the real 250ms stagger would add seconds to every test. */
export function setArtifactPostGapMs(ms: number): void {
  postGapMs = Math.max(0, ms);
}

/**
 * Resolves once every queued artifact post has settled.
 *
 * Callers should hand this to EdgeRuntime.waitUntil before responding —
 * otherwise the isolate can be torn down with posts still queued, which
 * serialising them makes more likely, not less.
 */
export async function artifactPostsIdle(): Promise<void> {
  // The serial queue can enqueue detached work, and settling detached work
  // can enqueue more posts, so alternate until both are quiet. The bound is
  // there so a pathological producer cannot spin here forever.
  for (let guard = 0; guard < 100; guard++) {
    const drained = postQueue;
    await drained;
    if (drained === postQueue && detachedWork.length === 0) return;
    if (detachedWork.length) await Promise.all([...detachedWork]);
  }
}

// Chain one step onto the serial dispatch queue. Settles either way, then
// spaces the next dispatch: sustained rate stays near four invocations a
// second per isolate, under the platform limit.
function enqueue(step: () => Promise<unknown>): void {
  postQueue = postQueue
    .then(step)
    .then(() => pause(postGapMs), () => pause(postGapMs));
}

function firePost(
  admin: Admin, serviceKey: string, tenantId: string, vin: string,
  url: string, body: Record<string, unknown>, timeoutMs: number, artifact: string,
  opts: { deadlineMs?: number } = {},
): void {
  enqueue(async () => {
    // One retry, not three. The serial queue is what keeps us under the
    // limit; a long retry chain here would stall every artifact behind a
    // vehicle whose render is deterministically broken.
    const res = await invokeFunction(url, serviceKey, {
      body, timeoutMs, maxRetries: 1, maxWaitMs: 3_000,
      ...(opts.deadlineMs ? { deadlineMs: opts.deadlineMs } : {}),
    });
    if (res.ok) return;
    // A throttle is not an artifact failure. Recording it as one buries the
    // real failures under transient noise and tells the operator a document
    // could not be produced when nobody ever asked for it. The nightly
    // sweep re-runs the sweepable artifacts; the rest are surfaced with
    // their own type so they can be found and retried deliberately.
    if (res.rateLimited) {
      await recordArtifactFailure(
        admin, tenantId, vin, artifact,
        `rate_limited: the platform throttled this call${res.retryAfterMs ? ` (asked for ${res.retryAfterMs}ms)` : ""}. Not generated yet.`,
      );
      return;
    }
    await recordArtifactFailure(admin, tenantId, vin, artifact, res.error ?? "unknown error");
  });
}

// ──────────────────────────────────────────────────────────────────────
// OEM brochure + owner's-manual links
//
// Both harvests reach a metered search provider, and both write to a GLOBAL
// cache keyed on (lower(make), lower(model), year) — not per VIN, not per
// tenant. One harvest per MODEL is therefore the entire budget: a dealer
// ingesting 120 of one model must pay for one harvest, not 120.
//
// Ownership, because this is easy to get wrong: the packet-backfill SWEEP owns
// bulk harvesting. It walks DISTINCT triples with its own provider budget and
// dispatch cap, so it is the thing that covers a fleet. What lives here is a
// deliberately small fast-path — a genuinely new model gets its documents on
// the night it arrives instead of waiting for the next sweep pass — and it is
// capped so it can never become the fleet-sized fan-out the sweep already is.
//
// Four guards, cheapest first:
//
//   1. the link table is read before anything is dispatched at all, using the
//      passport's own pick, so a covered model costs zero invocations;
//   2. the shared NEGATIVE cache (oem_packet_backfill_attempts, written by the
//      sweep and by us through the same RPC) answers "we already looked and
//      there is nothing". Without it a model with no brochure writes no row,
//      so every night's ingest would re-run the full paid query set forever —
//      that is what turns a per-model cost into a per-VIN one. If that table
//      cannot be read, nothing is dispatched: no negative cache, no spend;
//   3. a per-isolate attempted-set plus a hard dispatch cap bound what one
//      isolate can queue, whatever the feed contains;
//   4. try_acquire_service_lock makes it one harvest per triple across
//      isolates, tenants and concurrent feed pages.
//
// The paid call itself is started from the serial queue but not drained by it
// (trackDetached): a harvest can run for a minute or two, and the queue also
// carries artifacts that have no retry path at all, so it must not wait here.
// ──────────────────────────────────────────────────────────────────────

interface OemDocSpec { fn: string; table: string; artifact: string; kind: LinkKind }

const OEM_DOCS: readonly OemDocSpec[] = [
  { fn: "oem-brochure", table: "oem_brochure_links", artifact: "oem_brochure", kind: "brochure" },
  { fn: "oem-owners-manual", table: "oem_owners_manual_links", artifact: "oem_owners_manual", kind: "owners_manual" },
];

// Only has to outlive one harvest. The durable "do not ask again" lives in the
// attempt table; this is just the mutex that stops two callers overlapping.
const OEM_HARVEST_LOCK_TTL_SECONDS = 15 * 60;

/**
 * Paid harvests one isolate may dispatch, ever.
 *
 * The serial artifact queue is handed to EdgeRuntime.waitUntil and a large
 * feed already fills it for longer than the isolate will live; work queued
 * past that point is silently lost, and some artifacts have no retry path. So
 * ingest takes the first few models and the sweep takes the rest — a bound
 * that holds whether the feed carries three models or three hundred.
 */
const OEM_HARVEST_DISPATCH_CAP = 6;

const oemHarvestAttempted = new Set<string>();
let oemHarvestDispatched = 0;

/** Test hook: the attempted-set and cap are per isolate and leak across cases. */
export function resetOemHarvestDedupe(): void {
  oemHarvestAttempted.clear();
  oemHarvestDispatched = 0;
}

/**
 * Would the passport already find a link for this key?
 *
 * Same pick as public-listing-view: exact model year, then within two model
 * years, then a year-less row (the manual harvest's portal fallback carries no
 * year). An unreadable cache counts as a HIT — an undecidable read must never
 * become provider spend.
 */
async function hasCachedOemLink(admin: Admin, table: string, key: OemDocKey): Promise<boolean> {
  try {
    const { data, error } = await admin.from(table)
      .select("id, year")
      .ilike("make", key.make).ilike("model", key.model)
      .order("year", { ascending: false, nullsFirst: false })
      .limit(6);
    if (error) return true;
    const rows = ((data || []) as { year: number | null }[]);
    const yr = key.year;
    const pick = (yr ? rows.find((r) => r.year === yr) : rows[0])
      || rows.find((r) => r.year != null && yr != null && Math.abs(r.year - yr) <= 2)
      || rows.find((r) => r.year == null);
    return !!pick;
  } catch {
    return true;
  }
}

/**
 * May we spend a harvest on this triple, according to the shared negative
 * cache? Policy (terminal verdicts, attempt ceiling, cooldowns) is the sweep's
 * `shouldAttemptLink`, imported rather than re-stated so the two callers of
 * the same budget cannot drift apart.
 *
 * An unreadable attempt table means we have no negative cache at all, and a
 * harvest loop with no negative cache is the recurring bill this whole module
 * is arranged to avoid. So it answers "no".
 */
async function negativeCacheAllows(admin: Admin, kind: LinkKind, key: OemDocKey): Promise<boolean> {
  try {
    const { data, error } = await admin.from("oem_packet_backfill_attempts")
      .select("kind, make_key, model_key, year_key, outcome, attempts, last_attempt_at")
      .eq("kind", kind)
      .eq("make_key", key.make.trim().toLowerCase())
      .eq("model_key", key.model.trim().toLowerCase())
      .eq("year_key", key.year ?? 0)
      .maybeSingle();
    if (error) return false;
    return shouldAttemptLink((data ?? undefined) as AttemptRow | undefined);
  } catch {
    return false;
  }
}

// Write the verdict back to the shared negative cache. `persistedLinkOutcome`
// returns null for a throttle or a missing provider key — nothing was learned
// about the triple, and remembering "rate limited" as "this model has no
// brochure" is precisely the mistake the invoke.ts retry doctrine exists for.
async function recordHarvestVerdict(
  admin: Admin, kind: LinkKind, key: OemDocKey, outcome: HarvestOutcome, detail: string | null,
): Promise<void> {
  const persisted = persistedLinkOutcome(outcome);
  if (!persisted) return;
  try {
    await admin.rpc("record_packet_backfill_attempt", {
      _kind: kind, _make: key.make, _model: key.model, _year: key.year,
      _outcome: persisted, _detail: detail ? detail.slice(0, 500) : null,
    });
  } catch { /* the verdict is an optimisation; losing one costs one retry */ }
}

function fireOemHarvest(
  admin: Admin, supabaseUrl: string, serviceKey: string,
  tenantId: string, vin: string, spec: OemDocSpec, key: OemDocKey,
): void {
  const lockKey = `${spec.fn}:${oemDocKeyString(key)}`;
  enqueue(async () => {
    // Re-read at dispatch: the queue is serial, so another vehicle's harvest
    // for this very triple may have landed since this one was enqueued.
    if (await hasCachedOemLink(admin, spec.table, key)) return;

    let acquired = false;
    try {
      const { data } = await admin.rpc("try_acquire_service_lock", {
        _key: lockKey,
        _ttl_seconds: OEM_HARVEST_LOCK_TTL_SECONDS,
        _holder: `intake:${tenantId}`,
      });
      acquired = data === true;
    } catch { acquired = false; }
    // No lock, no spend — in either direction. Somebody else is harvesting
    // this exact model, or the lock itself is unavailable; these are
    // nice-to-have documents and a missed harvest costs a night, not a sale.
    if (!acquired) return;

    trackDetached((async () => {
      const res = await invokeFunction(`${supabaseUrl}/functions/v1/${spec.fn}`, serviceKey, {
        body: { make: key.make, model: key.model, year: key.year },
        // No retries: a retry re-runs the paid search for the same answer.
        timeoutMs: 120_000, maxRetries: 0, deadlineMs: 125_000,
      });
      const outcome = classifyHarvest(res);
      await recordHarvestVerdict(admin, spec.kind, key, outcome, res.error);

      // "found"/"cached" is the job done. "not_found"/"unsupported" is a real,
      // now-remembered answer — not a failure, and opening a high-severity
      // exception on the first vehicle of every model an OEM does not publish
      // would bury the exceptions that matter.
      if (outcome === "found" || outcome === "cached") return;
      if (outcome === "not_found" || outcome === "unsupported") return;
      // Our client budget can expire while the harvest itself finishes and
      // saves the row, so ask the cache before calling this a failure.
      if (await hasCachedOemLink(admin, spec.table, key)) return;
      // A harvest that did not persist has not happened: drop the lock so the
      // next run can try again rather than sitting on a claim to nothing.
      try { await admin.rpc("release_service_lock", { _key: lockKey }); }
      catch { /* the expiry still applies */ }
      // not_configured is an install problem, not a vehicle problem, and it is
      // true of every vehicle at once — reporting it per VIN is noise.
      if (outcome === "not_configured") return;
      await recordArtifactFailure(
        admin, tenantId, vin, spec.artifact,
        outcome === "rate_limited"
          ? `rate_limited: the platform throttled this call${res.retryAfterMs ? ` (asked for ${res.retryAfterMs}ms)` : ""}. Not harvested yet.`
          : res.error ?? "unknown error",
      );
    })());
  });
}

/**
 * Ensure the passport's Documents page has this model's official OEM brochure
 * and owner's manual, without an admin pressing a button.
 *
 * Model-scoped, not vehicle-scoped: everything is keyed on (make, model,
 * year), so the cost of a fleet is the cost of its distinct models, and the
 * common case — a covered model, or one already looked for — costs one indexed
 * read and no invocation at all. Never throws; a missing brochure must not
 * touch ingestion.
 */
export async function ensureOemDocLinks(
  admin: Admin, supabaseUrl: string, serviceKey: string,
  tenantId: string, vin: string, ymm: string | null,
): Promise<void> {
  try {
    const key = oemDocKeyFromYmm(ymm);
    if (!key) return;
    for (const spec of OEM_DOCS) {
      const dedupe = `${spec.fn}:${oemDocKeyString(key)}`;
      if (oemHarvestAttempted.has(dedupe)) continue;
      // Cache-first, and the attempted-set is marked either way: a second
      // vehicle of this model must not repeat even the reads.
      const cached = await hasCachedOemLink(admin, spec.table, key);
      oemHarvestAttempted.add(dedupe);
      if (cached) continue;
      // Past the cap, the sweep is the retry path — deliberately, because it
      // has a budget and a cap of its own and we are inside an isolate that
      // will not live long enough to be trusted with a fleet.
      if (oemHarvestDispatched >= OEM_HARVEST_DISPATCH_CAP) continue;
      if (!(await negativeCacheAllows(admin, spec.kind, key))) continue;
      oemHarvestDispatched++;
      fireOemHarvest(admin, supabaseUrl, serviceKey, tenantId, vin, spec, key);
    }
  } catch { /* link harvesting is never allowed to break ingest */ }
}

// Mint the permanent Get-Ready hub token if this vehicle doesn't already have a
// live one. Cheap + idempotent, so it can run on every sync pass to back-fill
// pre-existing inventory and cars first ingested by other paths.
export async function ensureReadyToken(
  admin: Admin, tenantId: string, vin: string, ymm: string | null, listingId: string | null,
): Promise<void> {
  try {
    // A pending token past its expires_at is dead media — the /ready resolver
    // refuses it — so it counts as missing and a fresh token is minted. A row
    // without expires_at is treated as live (no evidence it expired).
    const { data: toks } = await admin.from("dept_signoff_tokens").select("id, expires_at")
      .eq("tenant_id", tenantId).eq("vin", vin).eq("department", "vehicle").eq("status", "pending");
    const now = Date.now();
    const live = (((toks as { expires_at?: string | null }[] | null) || []))
      .some((t) => !t.expires_at || new Date(t.expires_at).getTime() > now);
    if (!live) {
      const { error } = await admin.from("dept_signoff_tokens").insert({
        tenant_id: tenantId, vehicle_listing_id: listingId, vin, ymm,
        department: "vehicle", purpose: "get_ready", token: hex16(),
        expires_at: new Date(Date.now() + 365 * 864e5).toISOString(),
      });
      if (error) await recordArtifactFailure(admin, tenantId, vin, "get_ready_token", errText(error));
    }
  } catch (e) {
    await recordArtifactFailure(admin, tenantId, vin, "get_ready_token", errText(e));
  }
}

/** How ensureComplianceDrafts reaches generate-vehicle-forms on the resync path. */
export interface RenderTarget { supabaseUrl: string; serviceKey: string }

// Ensure the compliance drafts exist for a used/CPO vehicle on EVERY sync —
// not just first insert. Each RPC is VIN-idempotent and no-ops for new cars,
// so re-syncs safely backfill inventory that predates the autogen flow.
//
// When `render` is passed (the resync/backfill path — autoPreload fires
// generate-vehicle-forms itself and passes nothing), a form draft newly
// created here also gets its render: without it, a backfilled Buyers Guide /
// K-208 draft sat file-less forever, because generate-vehicle-forms only ran
// on first ingest. Fire-and-forget; a failure is recorded as form_pdfs.
export async function ensureComplianceDrafts(
  admin: Admin, tenantId: string, vin: string, render?: RenderTarget,
): Promise<void> {
  // Before the idempotent RPCs run, ask whether the vehicle is missing either
  // form document generate-vehicle-forms fills. Best-effort: an undecidable
  // read skips the render rather than re-rendering every vehicle every night.
  let needsFormRender = false;
  let needsFactorySticker = false;
  let listingId: string | null = null;
  if (render) {
    try {
      const { data: listing } = await admin.from("vehicle_listings")
        .select("id, condition")
        .eq("tenant_id", tenantId).eq("vin", vin).maybeSingle();
      const cond = String(listing?.condition || "used").toLowerCase();
      listingId = (listing?.id as string | undefined) ?? null;
      if (listing?.id && ["used", "cpo", "certified"].includes(cond)) {
        const { data: formDocs, error } = await admin.from("generated_documents")
          .select("id, document_type, online_url, pdf_url")
          .eq("tenant_id", tenantId).eq("vehicle_id", listing.id)
          .in("document_type", ["buyers_guide", "k208"])
          .not("document_status", "in", '("superseded","archived","rejected")');
        if (!error) {
          // A row is only "done" if it actually points at a PDF. Testing row
          // presence alone is what left 123 of 136 Buyers Guide drafts and every
          // window draft file-less and un-retried: create_draft_* mints the row,
          // the render that fills it got rate-limited away, and from then on the
          // resync saw a row and concluded there was nothing to do.
          const filled = new Set(
            (((formDocs || []) as { document_type?: string; online_url?: string | null; pdf_url?: string | null }[]))
              .filter((d) => !!(d.online_url || d.pdf_url))
              .map((d) => String(d.document_type)));
          needsFormRender = !filled.has("buyers_guide") || !filled.has("k208");
        }
      }
      // Factory sticker orchestration (all conditions — new cars get the
      // Monroney-style configuration record too): re-fire only while the
      // record is missing or parked awaiting data / a retry / the renderer
      // (READY_TO_GENERATE is how records wait for the renderer to land —
      // without re-firing it the fleet would never generate once it does),
      // so resyncs and backfills cover the fleet without re-posting settled
      // vehicles every night. Undecidable read → do not fire.
      if (listing?.id) {
        const { data: fsr, error: fsErr } = await admin.from("factory_sticker_records")
          .select("id, generation_status")
          .eq("tenant_id", tenantId).eq("vehicle_id", listing.id).maybeSingle();
        if (!fsErr) {
          const status = String((fsr as { generation_status?: string } | null)?.generation_status || "");
          needsFactorySticker = !fsr || ["PENDING_DATA", "FAILED_RETRYABLE", "READY_TO_GENERATE"].includes(status);
        }
      }
    } catch { /* undecidable — do not render */ }
  }

  await draftRpc(admin, tenantId, vin, "create_draft_buyers_guide", "buyers_guide");
  await draftRpc(admin, tenantId, vin, "create_draft_safety_inspection", "k208");
  await draftRpc(admin, tenantId, vin, "create_draft_get_ready", "get_ready");
  await draftRpc(admin, tenantId, vin, "create_draft_window_sticker", "window_sticker");

  if (render && needsFormRender) {
    firePost(admin, render.serviceKey, tenantId, vin,
      `${render.supabaseUrl}/functions/v1/generate-vehicle-forms`,
      { tenant_id: tenantId, vin }, 25000, "form_pdfs");
  }
  if (render && needsFactorySticker && listingId) {
    firePost(admin, render.serviceKey, tenantId, vin,
      `${render.supabaseUrl}/functions/v1/factory-sticker-orchestrate`,
      { action: "orchestrate", tenant_id: tenantId, vehicle_id: listingId, reason: "resync" },
      20000, "factory_sticker");
  }
}

// Auto-preload a brand-new vehicle the moment it's ingested: hub token, draft
// addendum + compliance docs, then the fire-and-forget render/enrichment calls
// (official PDFs, OEM sticker, title email, recon orchestration, description).
// Never throws back into the ingest loop. Run only on genuinely new listings.
export async function autoPreload(
  admin: Admin, supabaseUrl: string, serviceKey: string, input: AutoPreloadInput,
): Promise<void> {
  const { tenantId, vin, ymm, listingId, emailTitle = false } = input;
  await ensureReadyToken(admin, tenantId, vin, ymm, listingId);
  await draftRpc(admin, tenantId, vin, "create_draft_addendum", "addendum");
  await ensureComplianceDrafts(admin, tenantId, vin);

  // Fill the official FTC Buyers Guide + K-208 PDFs from the drafted data.
  // Runs after the drafts above so the warranty box is set.
  firePost(admin, serviceKey, tenantId, vin,
    `${supabaseUrl}/functions/v1/generate-vehicle-forms`, { tenant_id: tenantId, vin }, 25000, "form_pdfs");
  // No-op if no window-sticker API key is configured.
  firePost(admin, serviceKey, tenantId, vin,
    `${supabaseUrl}/functions/v1/oem-window-sticker`, { vin, tenant_id: tenantId }, 20000, "oem_window_sticker");
  if (emailTitle) {
    firePost(admin, serviceKey, tenantId, vin,
      `${supabaseUrl}/functions/v1/email-title-request`, { tenant_id: tenantId, vin }, 20000, "title_request_email");
  }
  if (listingId) {
    // Decode the VIN's equipment breakout FIRST, because everything below
    // needs it and none of them will fetch it themselves.
    //
    // factory-sticker-orchestrate deliberately never calls a paid provider on
    // an automatic run — a source fetch is an explicit, permissioned, audited
    // operator action (`allowSourceFetch`). So at ingest it found no build
    // sheet, parked the record at PENDING_DATA "awaiting_build_sheet", and the
    // sticker only ever appeared if a human later pressed Generate. Nothing
    // decoded the VIN at ingest at all; the decode arrived hours later in the
    // nightly enrich sweep, by which time the sticker call was long finished.
    //
    // Ordering is what makes this work: the post queue is serial, so this
    // resolves before the sticker call below is dispatched, and the
    // orchestrator finds the build sheet already saved on the listing. The
    // decode is not extra spend — the nightly sweep would decode this VIN
    // anyway; it just happens now instead of tonight.
    firePost(admin, serviceKey, tenantId, vin,
      `${supabaseUrl}/functions/v1/marketcheck-specs`,
      { tenant_id: tenantId, vin, vehicle_id: listingId },
      // NeoVIN is asked strictly first and only then generically, each with a
      // 30s timeout, so this one call can legitimately outlast the default
      // per-attempt and total budgets.
      55_000, "vin_decode", { deadlineMs: 70_000 });
    // Fire-once recon orchestration; idempotent server-side, so a re-sync
    // never double-dispatches.
    firePost(admin, serviceKey, tenantId, vin,
      `${supabaseUrl}/functions/v1/ingest-orchestrate`,
      { tenant_id: tenantId, vin, listing_id: listingId, ymm }, 20000, "ingest_orchestrate");
    // Description Intelligence: idempotent on (tenant, vehicle, versions); the
    // nightly reconcile sweep picks up anything missed here.
    firePost(admin, serviceKey, tenantId, vin,
      `${supabaseUrl}/functions/v1/description-orchestrate`,
      { action: "orchestrate", tenant_id: tenantId, vehicle_id: listingId, reason: "ingest" }, 20000, "description");
    // Factory Window Sticker: fingerprint-idempotent server-side; the nightly
    // resync path (ensureComplianceDrafts) re-fires anything missed here.
    firePost(admin, serviceKey, tenantId, vin,
      `${supabaseUrl}/functions/v1/factory-sticker-orchestrate`,
      { action: "orchestrate", tenant_id: tenantId, vehicle_id: listingId, reason: "ingest" }, 20000, "factory_sticker");
  }

  // Official OEM brochure + owner's manual for the passport's Documents page.
  // Not gated on listingId: the links are model-scoped and globally cached, so
  // harvesting them helps every vehicle of the model, present and future. Last
  // in the order because it is the only step whose cost is a provider bill —
  // everything above it should already be dispatched if this one stalls.
  await ensureOemDocLinks(admin, supabaseUrl, serviceKey, tenantId, vin, ymm);
}
