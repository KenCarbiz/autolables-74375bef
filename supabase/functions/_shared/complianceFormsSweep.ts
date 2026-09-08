// Which published vehicles still lack an openable compliance form.
//
// Extracted from generate-vehicle-forms so the selection rule can be tested
// directly — index.ts calls Deno.serve at import time and cannot be loaded by
// the unit runner.
//
// The rule that matters: a document counts only when it points at a file. The
// bug this sweep exists to undo was testing row PRESENCE, which let a draft
// whose render was throttled away read as finished forever.

// deno-lint-ignore no-explicit-any
type Admin = any;

// The window sticker is in here with the two government forms because the
// question the sweep asks is identical for all three: does this used vehicle
// have a document row that actually points at a file. It was the third
// file-less lane and had no sweep of its own — create_draft_window_sticker
// minted the row at ingest and nothing ever rendered it, so 64 vehicles held
// a `window` draft with no PDF and no retry.
export const FORM_KINDS = ["buyers_guide", "k208", "window"] as const;
// "pre-owned" is what several feeds write for a used car. It fell out of every
// used-vehicle document path, so those vehicles silently got none of them.
export const FORM_CONDITIONS = [
  "used", "cpo", "certified", "certified pre-owned", "pre-owned", "preowned",
];
const RETIRED_STATUSES = '("superseded","archived","rejected")';
const CHUNK = 200;

// A window sticker filed with NO equipment lines is very likely a sheet that
// was rendered before the VIN decode landed: at ingest, autoPreload fires this
// function BEFORE marketcheck-specs saves the build sheet, so the first render
// sees an empty record. Pointing at a file would otherwise retire the vehicle
// from this sweep forever, holding an equipment-less sticker for the life of
// the car — the same "the row exists so nothing is outstanding" failure this
// sweep was written to undo, in a new shape.
//
// Bounded, so a VIN the provider genuinely cannot decode does not re-render
// every night forever. Mirrors MAX_SPEC_ATTEMPTS.
export const WINDOW_MAX_EMPTY_RENDERS = 3;

interface DocRow {
  vehicle_id: string;
  document_type: string;
  online_url: string | null;
  pdf_url: string | null;
  data_snapshot?: { equipment_count?: unknown; render_attempts?: unknown } | null;
}

/** Is this filed document finished, or is there still work outstanding on it? */
export function documentIsSettled(d: DocRow, listing?: ListingFacts): boolean {
  // The whole point of the original sweep: an empty url is not a filed document.
  if (!d.online_url && !d.pdf_url) return false;
  if (d.document_type !== "window") return true;
  const snap = d.data_snapshot || {};
  // A printed sticker states a price and an odometer reading. The drafted
  // snapshot froze both at first draft and then short-circuited forever, so a
  // re-priced car kept advertising the old number on paper and on the passport.
  if (listing && driftsFromRecord(snap, listing)) return false;
  const equipment = Number(snap.equipment_count) || 0;
  if (equipment > 0) return true;
  return (Number(snap.render_attempts) || 0) >= WINDOW_MAX_EMPTY_RENDERS;
}

export interface ListingFacts {
  price: number | null;
  mileage: number | null;
}

/** The snapshot stores what was PRINTED, as the formatted strings on the sheet. */
const printedMoney = (n: number | null): string | null =>
  n !== null && Number.isFinite(n) && n > 0 ? `$${Math.round(n).toLocaleString("en-US")}` : null;
const printedMiles = (n: number | null): string | null =>
  n !== null && Number.isFinite(n) && n >= 0 ? `${Math.round(n).toLocaleString("en-US")} miles` : null;

function driftsFromRecord(
  snap: { price?: unknown; mileage?: unknown }, listing: ListingFacts,
): boolean {
  // A snapshot predating the price/mileage fields carries neither; it is the
  // ingest stub or an older render, and the equipment rule already covers it.
  if (snap.price === undefined && snap.mileage === undefined) return false;
  const price = typeof snap.price === "string" || snap.price === null ? (snap.price as string | null) : undefined;
  const miles = typeof snap.mileage === "string" || snap.mileage === null ? (snap.mileage as string | null) : undefined;
  if (price !== undefined && price !== printedMoney(listing.price)) return true;
  if (miles !== undefined && miles !== printedMiles(listing.mileage)) return true;
  return false;
}

export interface FormsSweepTarget {
  tenant_id: string;
  vin: string;
}

export async function findVehiclesNeedingForms(
  admin: Admin, tenantId: string | null, limit: number,
): Promise<FormsSweepTarget[]> {
  // NOT `status = 'published'`. A listing held back by the recall gate, by the
  // prep sign-off, or simply not published yet still needs its Buyers Guide,
  // its K-208 and its window sticker — those are what the dealership works
  // from before the car goes live, and filtering on published made every one
  // of those vehicles permanently invisible to this repair.
  let q = admin.from("vehicle_listings")
    .select("id, tenant_id, vin, condition, price, mileage")
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data } = await q;

  const rows = ((data || []) as Array<{
    id: string; tenant_id: string | null; vin: string | null; condition: string | null;
    price: number | null; mileage: number | null;
  }>).filter((r) =>
    !!r.tenant_id && !!r.vin
    && FORM_CONDITIONS.includes(String(r.condition || "used").toLowerCase()));
  if (!rows.length) return [];

  // Chunked: a single `in` over a whole inventory builds a URL long enough to
  // be rejected by PostgREST.
  const filled = new Map<string, Set<string>>();
  const facts = new Map(rows.map((r) => [r.id, { price: r.price ?? null, mileage: r.mileage ?? null }]));
  for (let i = 0; i < rows.length; i += CHUNK) {
    const ids = rows.slice(i, i + CHUNK).map((r) => r.id);
    let dq = admin.from("generated_documents")
      .select("vehicle_id, document_type, online_url, pdf_url, data_snapshot")
      .in("vehicle_id", ids)
      .in("document_type", FORM_KINDS as unknown as string[])
      .not("document_status", "in", RETIRED_STATUSES);
    if (tenantId) dq = dq.eq("tenant_id", tenantId);
    const { data: docs } = await dq;
    for (const d of (docs || []) as DocRow[]) {
      if (!documentIsSettled(d, facts.get(d.vehicle_id))) continue;
      if (!filled.has(d.vehicle_id)) filled.set(d.vehicle_id, new Set());
      filled.get(d.vehicle_id)!.add(String(d.document_type));
    }
  }

  return rows
    .filter((r) => {
      const have = filled.get(r.id);
      return !have || !FORM_KINDS.every((k) => have.has(k));
    })
    .map((r) => ({ tenant_id: String(r.tenant_id), vin: String(r.vin) }));
}
