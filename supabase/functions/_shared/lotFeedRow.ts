// ──────────────────────────────────────────────────────────────────────
// One row shape for every "here is the whole lot" answer.
//
// autofilm-feed named its fields one by one. It therefore shipped 140
// vehicles with no `make`, because nothing named `make` — and AutoFilm's
// inventory screens filter on `make IS NOT NULL`, so every one of those cars
// synced successfully and was then invisible and uncounted on every screen.
// The sync reported 140 written and every log looked clean. That is the exact
// failure mode a hand-picked projection produces: a field the feed forgot is
// indistinguishable from a vehicle that has no value for it.
//
// So the shape is allow-by-default. The row goes out as it is, minus a
// denylist that has to be written deliberately. A column added to
// vehicle_listings reaches the consumer on its own.
// ──────────────────────────────────────────────────────────────────────

// deno-lint-ignore-file no-explicit-any

/** Never leaves the building. Everything else does. */
export const LOT_FEED_DENY = new Set([
  // Credential.
  "install_token",
  // Internal actors and operational notes — not a sister app's business and
  // never a customer's.
  "created_by", "assigned_agent_id",
  "recall_override_by", "recall_override_at", "recall_override_notes",
  "price_parse_notes",
  // Licensed or bulky provider payloads. Black Book is paid valuation data;
  // redistributing it to another product is a licensing question, and nothing
  // downstream renders any of these.
  //
  // recall_payload and history_payload are deliberately NOT here. They were,
  // and that was too strict: "no open recalls" and "one owner, no accidents
  // reported" are the most load-bearing things a salesperson says about a used
  // car, and the summary columns alone cannot support the claim. history_payload
  // is scrubbed rather than withheld — see scrubHistory.
  "blackbook", "mc_raw", "market_payload", "comparables",
]);

/**
 * Listing history, minus other dealers' addresses.
 *
 * The payload is this VIN's own listing history, which for a used car includes
 * the stores that listed it before. The price and mileage timeline is exactly
 * what a talking point is made of; a live link to a competitor's VDP is not,
 * and putting one on a customer-facing page is an own goal. The dealer name
 * stays — it is provenance, and the timeline is meaningless without knowing a
 * change of hands happened.
 */
export function scrubHistory(payload: any, cap = 40): any {
  if (!payload || typeof payload !== "object") return null;
  const entries = Array.isArray(payload.entries) ? payload.entries : null;
  if (!entries) return payload;
  return {
    ...payload,
    entries: entries.slice(0, cap).map((e: any) => {
      if (!e || typeof e !== "object") return e;
      const { vdp_url: _dropped, ...rest } = e as Record<string, unknown>;
      return rest;
    }),
    entries_truncated: entries.length > cap ? entries.length - cap : 0,
  };
}

export const PASSPORT_BASE = "https://autolabels.io/v";

/** A page renders in a browser, so an http URL is a mixed-content block.
 *  Dropped rather than upgraded — guessing that a host serves TLS trades a
 *  blocked image for a broken one. */
export const httpsOnly = (u: unknown): string | null =>
  typeof u === "string" && /^https:\/\//i.test(u.trim()) ? u.trim() : null;

/** The row on vehicle_files that carries the discrete identity and the DMS
 *  stock number. vehicle_listings has neither as columns. */
export interface LotFeedFile {
  year?: string | number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  stock_number?: string | null;
}

const str = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
};

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/**
 * Discrete year / make / model — read, never parsed.
 *
 * marketcheck-sync composes `ymm` as [b.year, b.make, b.model].join(" ") from
 * the provider's build object, and writes those same three discretely to
 * vehicle_files and into mc_attributes. Both sources are real; the display
 * string is not one.
 *
 * Splitting `ymm` back apart is explicitly NOT done here. "2019 Acura TLX"
 * happens to split cleanly and "2026 Land Rover Range Rover Sport" does not,
 * and a make of "Land" is worse than a make of null: null is a gap a consumer
 * can see and count, while "Land" is a wrong answer it will act on.
 */
export function lotIdentity(row: any, file?: LotFeedFile | null) {
  const mc = (row?.mc_attributes || {}) as Record<string, unknown>;
  return {
    year: num(mc.year) ?? num(file?.year) ?? null,
    make: str(mc.make) ?? str(file?.make) ?? null,
    model: str(mc.model) ?? str(file?.model) ?? null,
  };
}

/** True when no source carries a discrete make. Counted in the response rather
 *  than left to be discovered as an empty screen. */
export const identityIncomplete = (row: any, file?: LotFeedFile | null): boolean =>
  !lotIdentity(row, file).make;

/**
 * A stable address for this vehicle's filed factory sticker.
 *
 * NOT the signed URL itself. The PDF lives in a private bucket and every
 * signature expires; storing one is what made published vehicles serve dead
 * links once it aged out. This address is permanent and resolves to a freshly
 * signed object on each visit, and public-document-asset re-checks on every
 * call that the document is still published.
 */
export const stickerResolverUrl = (supabaseUrl: string, slug: unknown): string | null => {
  if (!supabaseUrl || typeof slug !== "string" || !slug) return null;
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/public-document-asset`
    + `?slug=${encodeURIComponent(slug)}&document_type=factory_sticker&asset_type=pdf&redirect=1`;
};

/** What the window sticker actually IS. A regenerated build record is not an
 *  original OEM-issued Monroney label and must never be labelled as one, so the
 *  kind travels with the URL rather than leaving the consumer to guess. */
export type WindowStickerKind = "oem" | "reproduction";

/**
 * The window sticker a consumer may link, and what it is.
 *
 * The OEM document wins when there is one: it is the genuine Monroney and its
 * URL is signed for five years. Otherwise, when this vehicle has a published
 * factory build record on file, the stable resolver above — 102 of Harte's 140
 * live vehicles have one filed, while the oem_sticker_url column is empty on
 * every single row, so reading that column alone reported "no window sticker"
 * for three quarters of the lot that has one.
 */
export function windowSticker(
  row: any,
  opts?: { supabaseUrl?: string; hasFactorySticker?: boolean },
): { url: string | null; kind: WindowStickerKind | null } {
  const oem = httpsOnly(row?.oem_sticker_url);
  if (oem) return { url: oem, kind: "oem" };
  if (opts?.hasFactorySticker) {
    const url = stickerResolverUrl(opts.supabaseUrl ?? "", row?.slug);
    if (url) return { url, kind: "reproduction" };
  }
  return { url: null, kind: null };
}

export const documentsUrl = (slug: unknown): string | null =>
  typeof slug === "string" && slug ? `${PASSPORT_BASE}/${slug}/documents` : null;

export const passportUrl = (slug: unknown): string | null =>
  typeof slug === "string" && slug ? `${PASSPORT_BASE}/${slug}` : null;

/** Photos are stored either as bare URL strings or as { url } objects. */
export const normalizePhotos = (photos: unknown): string[] =>
  Array.isArray(photos)
    ? photos
      .map((p: any) => (typeof p === "string" ? p : p?.url))
      .filter((u: unknown): u is string => typeof u === "string" && u.length > 0)
    : [];

/**
 * The listing row as it goes out: everything it has, minus the denylist, plus
 * the fields that are derived from a real source rather than invented.
 */
const SPEC_FIELDS = [
  "body_type", "vehicle_type", "doors", "std_seating",
  "engine", "engine_block", "engine_size", "cylinders", "powertrain_type",
  "fuel_type", "transmission", "drivetrain",
  "city_mpg", "highway_mpg",
  "overall_length", "overall_width", "overall_height",
  "made_in", "version",
] as const;

/** The provider's normalized manufacturing spec, lifted out of the withheld
 *  raw payload. Absent fields are omitted rather than sent as null, so a
 *  consumer can tell "not decoded" from "decoded as empty". */
export function specifications(row: any): Record<string, unknown> | null {
  const build = ((row?.mc_raw as Record<string, unknown> | undefined)?.build
    ?? null) as Record<string, unknown> | null;
  if (!build) return null;
  const out: Record<string, unknown> = {};
  for (const f of SPEC_FIELDS) {
    const v = build[f];
    if (v === null || v === undefined || v === "") continue;
    out[f] = v;
  }
  return Object.keys(out).length ? out : null;
}

export function shapeLotRow(
  row: any,
  file?: LotFeedFile | null,
  opts?: { supabaseUrl?: string; hasFactorySticker?: boolean },
): Record<string, unknown> {
  const mc = (row?.mc_attributes || {}) as Record<string, unknown>;
  const { year, make, model } = lotIdentity(row, file);

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (LOT_FEED_DENY.has(k)) continue;
    out[k] = v;
  }

  // Identity, discrete. `ymm` stays exactly as it is — it is the display title.
  out.year = year;
  out.make = make;
  out.model = model;
  out.trim = str(row?.trim) ?? str(file?.trim) ?? null;

  // Same derivation the Vehicle File header uses: the number lands in several
  // places depending on which path wrote it, and a reader that checks one of
  // them reports "no stock number" for a car another reader finds by it.
  out.stock_number = str(mc.stock_no) ?? str(mc.stock) ?? str(mc.stock_number)
    ?? str(file?.stock_number) ?? null;
  out.stock = out.stock_number;

  out.body_style = str(mc.body_type) ?? str(mc.body_style) ?? null;
  // The new-car reference price. There is no msrp column; the passport reads it
  // off mc_attributes and so does this, from the same place, so the two cannot
  // disagree about what a car stickered for.
  out.msrp = num(mc.msrp);
  out.market_value = num(row?.market_value);
  // Stated, never computed. A savings figure derived from msrp - price would be
  // our arithmetic presented as the dealership's claim.
  out.savings = num(row?.dealer_discount);

  out.photos = normalizePhotos(row?.photos);
  out.passport_url = passportUrl(row?.slug);
  out.documents_url = documentsUrl(row?.slug);
  if (row?.history_payload) out.history_payload = scrubHistory(row.history_payload);

  // Manufacturing specification.
  //
  // The NeoVIN decode already reaches AutoFilm inside mc_attributes.build_sheet
  // — colours, packages, factory options, standard equipment. What did not was
  // the provider's normalized spec block, because it lives inside mc_raw and
  // mc_raw is withheld wholesale.
  //
  // That block is where fuel economy, cylinders, doors, seating, dimensions and
  // country of manufacture live: ordinary vehicle detail a walkaround needs and
  // nothing a licence covers. mc_raw itself stays denied — the rest of it is
  // listing and marketplace metadata, including the dealer VDP URL that
  // scrubHistory deliberately strips elsewhere, and the contract is normalized
  // resolved facts rather than raw provider payloads.
  out.specifications = specifications(row);

  const sticker = windowSticker(row, opts);
  out.window_sticker_url = sticker.url;
  out.window_sticker_kind = sticker.kind;

  return out;
}


// ── detail_version ────────────────────────────────────────────────────
//
// A token that changes when a vehicle's DEEP record changes and not otherwise,
// so a consumer can cache each detail response and re-fetch only when this
// moves. Without one there are two options and both are wrong: re-fetch every
// deep record on every sync, or serve equipment that quietly went stale — which
// puts a salesperson at a car describing a feature it does not have.
//
// It is a content hash, deliberately not vehicle_listings.updated_at. That
// column is touched by the nightly inventory sync whether or not anything about
// the build changed, so a version derived from it would move every night for
// every car and cache nothing.
//
// What is IN the hash: equipment and specs (mc_attributes, which carries the
// NeoVIN build sheet), photos, EPA, warranty, recalls, history, accessories,
// the OEM sticker address, condition, slug, and the truth snapshot's own
// checksum and version — so a change in the fact ledger moves it too.
//
// What is deliberately OUT: price, mileage, market value, status. Those move
// often, are carried fresh in the LIST response on every sync, and a consumer
// re-reading a whole build sheet because a price dropped $200 is exactly the
// churn this exists to prevent.
const DETAIL_VERSION_FIELDS = [
  "mc_attributes", "photos", "epa_economy", "warranty_info",
  "recall_payload", "history_payload", "key_specs", "features",
  "available_accessories", "oem_sticker_url", "slug", "condition",
] as const;

export interface DetailVersionSnapshot {
  content_checksum?: string | null;
  snapshot_version?: number | null;
}

const hex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");

export async function detailVersion(
  row: any,
  snapshot?: DetailVersionSnapshot | null,
): Promise<string> {
  // jsonb comes back with normalised key order, so stringify is stable for a
  // given stored value.
  const material = JSON.stringify([
    ...DETAIL_VERSION_FIELDS.map((k) => row?.[k] ?? null),
    // Hashed through its derived form, not by adding mc_raw to the list above:
    // mc_raw also carries scraped_at, dom and last_seen_at, which move nightly
    // for every car and would make the version cache nothing.
    JSON.stringify(specifications(row)),
    snapshot?.content_checksum ?? null,
    snapshot?.snapshot_version ?? null,
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return hex(digest).slice(0, 32);
}
