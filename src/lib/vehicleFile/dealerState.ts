// Dealer state: the seven answers a desk needs about a car it owns.
//
// Every field here is one the dealership controls and the feed relays, which
// is why the section is dominated by columns whose writer is not who the
// column name suggests. What the Gate 1 maps established, and what this
// module refuses to repeat:
//
//   - `vehicle_listings` has no stock column at all. The only populated home
//     of a stock number is `vehicle_files.stock_number` (130/130 pilot);
//     `mc_attributes.stock_no` and `sticker_snapshot.stock_number` are null
//     on 100% of pilot rows, and the served documents page prints
//     `vin.slice(-6)` under a "Stock #" label, which is a VIN fragment and is
//     never a candidate here (SOURCE_TO_FACT_MATRIX §5 row 6, §8(k)).
//   - `marketcheck-sync` writes `vehicle_listings.mileage` only when the feed
//     figure is truthy (`marketcheck-sync/index.ts:1054`), so 43 of 130 pilot
//     cars have no listing mileage, while `vehicle_files.mileage` holds a 0
//     placeholder on 45. A 0 that the feed's own writer treats as "not
//     reported" is not an odometer reading, so it is never presented as one.
//   - `mc_attributes.ref_miles` is the mileage of the comparable set, not of
//     this car. It is not a candidate for anything in this section.
//   - the dealer's own VDP CPO badge and the feed's inventory classification
//     disagree on 35 of 130 pilot cars. Both are emitted, so the shopper-
//     facing claim and the feed's answer can be seen to differ.

import type { Confidence, SourceKind } from "../vehicleTruth/precedence.ts";
import type { DealerStateSection, FieldCandidate, LicenseClass } from "./readModelTypes.ts";
import { emptyField, resolveField } from "./resolveField.ts";
import { iso, latestStamp, num, obj, str, type Row, type VehicleFileSources } from "./sources.ts";

const DAY_MS = 86_400_000;

/** Dealer-owned facts about the dealer's own car (CUSTOMER_DISPLAY_LICENSE_MATRIX §2a). */
const DEALER_OWNED: LicenseClass = "CUSTOMER_DISPLAY_CLEARED";
/** Firecrawl-derived page content and our own workflow state (matrix rows 30, 31). */
const INTERNAL: LicenseClass = "INTERNAL_USE_CLEARED";
/** MarketCheck lifecycle and transit signals (matrix rows 4 and 5). */
const REVIEW: LicenseClass = "UNKNOWN_REVIEW_REQUIRED";

interface CandidateInput<T> {
  value: T | null;
  source: SourceKind;
  origin: string;
  provider: string;
  observedAt: string | null;
  confidence: Confidence;
  license: LicenseClass;
  note?: string;
}

/**
 * `FieldCandidate.value` is typed `T`, but `resolveField` deliberately accepts
 * a null-valued candidate: it drops it from the ranking and still reports its
 * origin in `candidates` and in the reason. That is the only way an empty
 * source stays named instead of vanishing — "no source supplies mileage" and
 * "three sources hold a placeholder zero" are different answers. This cast is
 * the single place the two shapes are reconciled.
 */
const candidate = <T>(input: CandidateInput<T>): FieldCandidate<T> =>
  ({ ...input, value: input.value as T });

/**
 * MarketCheck stamps its syndication rows in UNIX seconds
 * (`first_seen_at: 1788506033`), which `Date.parse` cannot read, so `iso()`
 * returns null for every one of them and each feed candidate would report
 * UNKNOWN freshness. The epoch form is checked before the ISO form so the
 * result does not depend on how a runtime guesses at a bare digit string.
 */
const feedStamp = (value: unknown): string | null => {
  const epoch = typeof value === "number"
    ? value
    : (typeof value === "string" && /^\d{9,13}$/.test(value.trim()) ? Number(value.trim()) : null);
  if (epoch != null && Number.isFinite(epoch) && epoch > 0) {
    return new Date(epoch > 1e11 ? epoch : epoch * 1000).toISOString();
  }
  return iso(value);
};

/**
 * Syndication feeds emit 1/0, "Y"/"N" and "true"/"false" for one flag:
 * `mc_raw.is_certified` is the NUMBER 1 on all 18 pilot CPO rows and absent on
 * the other 112, so `bool()` alone reads every certified car as unknown. This
 * mirrors `supabase/functions/_shared/vehicleCondition.ts:24-31` and must keep
 * agreeing with it, or a car is CPO in the feed and used in the read model.
 */
const truthyFlag = (value: unknown): boolean | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (!s) return null;
    return s === "true" || s === "1" || s === "y" || s === "yes" || s === "t";
  }
  return null;
};

/** New wins over certified, as `classifyCondition` decides it for every feed. */
const conditionFromFeed = (inventoryType: unknown, certified: unknown): string | null => {
  const type = str(inventoryType);
  if (!type) return null;
  if (type.toLowerCase() === "new") return "new";
  return truthyFlag(certified) === true ? "cpo" : "used";
};

const CERT_SOURCE_KIND: Record<string, SourceKind> = {
  dealer_vdp: "dealer_vdp",
  marketcheck: "marketcheck",
  dealer: "dealer_confirmed",
};

export function buildDealerState(
  sources: VehicleFileSources,
  opts: { now?: number; configuredOrder?: SourceKind[] | null } = {},
): DealerStateSection {
  const now = opts.now ?? Date.now();
  const order = opts.configuredOrder ?? null;
  const listing = sources.listing;
  const file = sources.file;

  if (!listing) {
    const why = "No vehicle_listings row was read for this vehicle.";
    return {
      stock: emptyField<string>("stock", why),
      mileage: emptyField<number>("mileage", why),
      condition: emptyField<string>("condition", why),
      certified: emptyField<boolean>("certified", why),
      inTransit: emptyField<boolean>("in_transit", why),
      listingStatus: emptyField<string>("listing_status", why),
      daysInInventory: emptyField<number>("days_in_inventory", why),
    };
  }

  const mcRaw = obj(listing.mc_raw);
  const mcAttrs = obj(listing.mc_attributes);
  const listingStamp = iso(listing.updated_at);
  const fileStamp = file ? iso(file.updated_at) : null;

  // `mc_raw` is the feed payload stored verbatim; `mc_attributes` is the
  // sync's rebuilt copy of the same answer. Reading both as separate
  // candidates would manufacture corroboration out of one statement, so the
  // verbatim payload is preferred and the rebuilt copy only fills its gap.
  const fromFeed = <T>(read: (row: Row) => T | null, key: string): { value: T | null; origin: string } => {
    const verbatim = read(mcRaw);
    if (verbatim !== null && verbatim !== undefined) {
      return { value: verbatim, origin: `vehicle_listings.mc_raw->${key}` };
    }
    const rebuilt = read(mcAttrs);
    if (rebuilt !== null && rebuilt !== undefined) {
      return { value: rebuilt, origin: `vehicle_listings.mc_attributes->${key}` };
    }
    return { value: null, origin: `vehicle_listings.mc_raw->${key}` };
  };

  // When the feed last saw this listing, from the feed's own stamps. Never
  // `vehicle_facts.observed_at`, which records when the orchestrator ran.
  const feedObservedAt = latestStamp(
    feedStamp(mcRaw.last_seen_at_date),
    feedStamp(mcRaw.last_seen_at),
    feedStamp(mcRaw.scraped_at_date),
    feedStamp(mcRaw.scraped_at),
    feedStamp(mcAttrs.last_seen_at),
    feedStamp(mcAttrs.scraped_at),
  );
  const feedPresent = Object.keys(mcRaw).length > 0 || Object.keys(mcAttrs).length > 0;

  // ── stock ────────────────────────────────────────────────────────
  const stockCandidates: Array<FieldCandidate<string>> = [];
  if (file) {
    stockCandidates.push(candidate<string>({
      value: str(file.stock_number),
      source: "dealer_confirmed",
      origin: "vehicle_files.stock_number",
      provider: "Dealer inventory file (writer untagged)",
      observedAt: fileStamp,
      confidence: "HIGH",
      license: DEALER_OWNED,
      note: "The only populated home of a stock number (130/130 pilot). Three writers share the "
        + "column with no marker between them -- the nightly feed sync, the VDP crawl gap-fill and "
        + "manual entry -- so it is not raised to VERIFIED; `updated_at` is a row stamp, bumped by "
        + "any edit to the file, not by this column alone.",
    }));
  }
  const feedStock = fromFeed((row) => str(row.stock_no), "stock_no");
  stockCandidates.push(candidate<string>({
    value: feedStock.value,
    source: "marketcheck",
    origin: feedStock.origin,
    provider: "MarketCheck syndication feed",
    observedAt: feedObservedAt,
    confidence: "HIGH",
    license: DEALER_OWNED,
    note: "The feed's own answer, present on 128 of 130 pilot rows. `mc_attributes.stock_no` is "
      + "null on 100% of them because the sync never copies the key across.",
  }));
  // `get_ready_records.stock_number` is deliberately absent: it is a frozen
  // copy taken once by `create_draft_get_ready` and never refreshed, blank on
  // 24 of 130 pilot cars whose file holds a number. Reading it would let a
  // stale operational copy answer a §51 field that must be 100% explained.
  const stock = stockCandidates.some((c) => c.value)
    ? resolveField<string>("stock", stockCandidates, { now, configuredOrder: order })
    : emptyField<string>(
      "stock",
      file
        ? `No source supplies a stock number for this vehicle (${stockCandidates.map((c) => c.origin).join(", ")}); `
          + "vehicle_listings has no stock column."
        : "No vehicle_files row was read, which is the only populated home of a stock number; "
          + "vehicle_listings has no stock column.",
    );

  // ── mileage ──────────────────────────────────────────────────────
  // A zero is emitted as a null candidate rather than as the number 0. The
  // feed's own writer refuses to store a zero (`marketcheck-sync:1054`
  // `if (miles)`), so a zero here means "not reported", and the placeholder
  // that reaches `vehicle_files.mileage` on 45 of 130 pilot cars is the same
  // absence wearing a number. The origin still appears in the resolved
  // field's reason, so the gap is named rather than filled with 0.
  const ZERO_NOTE = "Zero is not an odometer reading here: the feed writer stores 0 for "
    + "\"not reported\" and refuses to copy it into vehicle_listings.mileage.";
  const listingMiles = num(listing.mileage);
  const fileMiles = file ? num(file.mileage) : null;
  const feedMiles = fromFeed((row) => num(row.miles), "miles");
  const mileageCandidates: Array<FieldCandidate<number>> = [];
  mileageCandidates.push(candidate<number>({
    value: listingMiles && listingMiles > 0 ? listingMiles : null,
    source: "dealer_confirmed",
    origin: "vehicle_listings.mileage",
    provider: "Dealer listing record (written by marketcheck-sync from the feed)",
    observedAt: listingStamp,
    confidence: "HIGH",
    license: DEALER_OWNED,
    note: listingMiles == null
      ? "Null on 43 of 130 pilot cars: marketcheck-sync:1054 writes this column only when the "
        + "feed figure is truthy, so a new car with a feed reading of 0 leaves it unset."
      : undefined,
  }));
  if (file) {
    mileageCandidates.push(candidate<number>({
      value: fileMiles && fileMiles > 0 ? fileMiles : null,
      source: "dealer_confirmed",
      origin: "vehicle_files.mileage",
      provider: "Dealer inventory file (writer untagged)",
      observedAt: fileStamp,
      confidence: "HIGH",
      license: DEALER_OWNED,
      note: fileMiles === 0 ? ZERO_NOTE : undefined,
    }));
  }
  mileageCandidates.push(candidate<number>({
    value: feedMiles.value && feedMiles.value > 0 ? feedMiles.value : null,
    source: "marketcheck",
    origin: feedMiles.origin,
    provider: "MarketCheck syndication feed",
    observedAt: feedObservedAt,
    confidence: "HIGH",
    license: DEALER_OWNED,
    note: feedMiles.value === 0 ? ZERO_NOTE : undefined,
  }));
  // `mc_attributes.ref_miles` is the mileage of the comparable set the
  // provider priced this car against. It is never this car's odometer.
  const mileage = resolveField<number>("mileage", mileageCandidates, { now, configuredOrder: order });

  // ── condition ────────────────────────────────────────────────────
  const feedType = fromFeed((row) => str(row.inventory_type), "inventory_type");
  const feedCertified = fromFeed((row) => truthyFlag(row.is_certified), "is_certified");
  const conditionCandidates: Array<FieldCandidate<string>> = [
    candidate<string>({
      value: conditionFromFeed(feedType.value, feedCertified.value),
      source: "marketcheck",
      origin: `${feedType.origin} + ${feedCertified.origin}`,
      provider: "MarketCheck syndication feed",
      observedAt: feedObservedAt,
      confidence: "HIGH",
      license: DEALER_OWNED,
      note: "Derived the way every ingester derives it: new before certified, so a new unit "
        + "carrying a certification flag is not buried in the CPO bucket.",
    }),
    candidate<string>({
      value: str(listing.condition),
      source: "dealer_confirmed",
      origin: "vehicle_listings.condition",
      provider: "Dealer listing record (feed derivation stored by marketcheck-sync; a DMS or "
        + "manual edit would replace it untagged)",
      observedAt: listingStamp,
      confidence: "HIGH",
      license: DEALER_OWNED,
    }),
  ];
  if (file) {
    conditionCandidates.push(candidate<string>({
      value: str(file.condition),
      source: "dealer_confirmed",
      origin: "vehicle_files.condition",
      provider: "Dealer inventory file (writer untagged)",
      observedAt: fileStamp,
      confidence: "HIGH",
      license: DEALER_OWNED,
    }));
  }
  // `get_ready_records.condition` is not a candidate: the table holds only
  // `new` and `used` across 275 pilot rows, so every CPO car is recorded there
  // as used. Admitting it would drag 18 of 130 pilot cars out of CPO.
  const condition = resolveField<string>("condition", conditionCandidates, { now, configuredOrder: order });

  // ── certified ────────────────────────────────────────────────────
  const cert = obj(listing.certification);
  const certSource = str(cert.source);
  const storedCondition = str(listing.condition);
  const certifiedCandidates: Array<FieldCandidate<boolean>> = [
    candidate<boolean>({
      value: feedCertified.value,
      source: "marketcheck",
      origin: feedCertified.origin,
      provider: "MarketCheck syndication feed",
      observedAt: feedObservedAt,
      confidence: "HIGH",
      license: DEALER_OWNED,
      note: "Absent on 112 of 130 pilot rows. Absence is not a denial: the feed did not answer.",
    }),
    candidate<boolean>({
      value: storedCondition ? storedCondition.toLowerCase() === "cpo" : null,
      source: "dealer_confirmed",
      origin: "vehicle_listings.condition",
      provider: "Dealer listing record (condition = cpo)",
      observedAt: listingStamp,
      confidence: "HIGH",
      license: DEALER_OWNED,
    }),
  ];
  if (cert.certified !== undefined) {
    certifiedCandidates.push(candidate<boolean>({
      value: truthyFlag(cert.certified),
      source: certSource ? (CERT_SOURCE_KIND[certSource] ?? "other_structured") : "other_structured",
      origin: "vehicle_listings.certification->certified",
      provider: certSource === "dealer_vdp"
        ? "Dealer VDP observation (CPO badge read by crawl-advertised-prices)"
        : `Certification record, source ${certSource ?? "untagged"}`,
      observedAt: iso(cert.verified_at),
      confidence: "MEDIUM",
      license: certSource === "dealer_vdp" ? INTERNAL : REVIEW,
      note: "A badge read off the dealer's own page, not the certifying program's record. It "
        + "stands on 21 of 130 pilot cars against 18 the feed calls CPO, and the two sets "
        + "disagree on 35 -- including 10 cars the feed calls new.",
    }));
  }
  const certified = resolveField<boolean>("certified", certifiedCandidates, { now, configuredOrder: order });

  // ── in transit ───────────────────────────────────────────────────
  // Reported as the feed states it, including false, rather than asserting
  // readiness by omission (directive §20). False on 128 of 128 pilot rows
  // that carry the key today, which is an answer, not a default.
  const feedTransit = fromFeed((row) => truthyFlag(row.in_transit), "in_transit");
  const inTransit = feedTransit.value === null && !feedPresent
    ? emptyField<boolean>(
      "in_transit",
      "No MarketCheck feed payload is stored for this vehicle, and nothing else states whether "
        + "it is in transit.",
    )
    : resolveField<boolean>("in_transit", [
      candidate<boolean>({
        value: feedTransit.value,
        source: "marketcheck",
        origin: feedTransit.origin,
        provider: "MarketCheck syndication feed",
        observedAt: feedObservedAt,
        confidence: "HIGH",
        license: REVIEW,
        note: "Redistribution standing is UNKNOWN-REVIEW REQUIRED "
          + "(CUSTOMER_DISPLAY_LICENSE_MATRIX row 5); no surface displays it today.",
      }),
    ], { now, configuredOrder: order });

  // ── listing status ───────────────────────────────────────────────
  const archiveReason = str(listing.archive_reason);
  const listingStatus = resolveField<string>("listing_status", [
    candidate<string>({
      value: str(listing.status),
      source: "dealer_confirmed",
      origin: "vehicle_listings.status",
      provider: "AutoLabels listing record (staff publish, feed prune or recall guard)",
      observedAt: latestStamp(listing.updated_at, listing.published_at, listing.archived_at),
      confidence: "HIGH",
      license: INTERNAL,
      note: archiveReason ? `Archived: ${archiveReason}.` : undefined,
    }),
  ], {
    now,
    configuredOrder: order,
    // This is our own record's state, not an observation of the world, so it
    // does not age: the row says what the listing IS. FRESHNESS_DAYS has no
    // entry for it, which would otherwise report the app's own status as
    // UNKNOWN on every vehicle.
    freshnessDays: null,
  });

  // ── days in inventory ────────────────────────────────────────────
  const firstSeen = fromFeed(
    (row) => feedStamp(row.first_seen_at_date) ?? feedStamp(row.first_seen_at),
    "first_seen_at",
  );
  const feedFirstSeen = firstSeen.value;
  const createdAt = iso(listing.created_at);
  const daysSince = (stamp: string | null): number | null => {
    if (!stamp) return null;
    const days = Math.floor((now - Date.parse(stamp)) / DAY_MS);
    return Number.isFinite(days) && days >= 0 ? days : null;
  };
  const feedDays = daysSince(feedFirstSeen);
  const feedFirstSeenIsLate = feedFirstSeen != null && createdAt != null && feedFirstSeen > createdAt;
  const daysInInventory = resolveField<number>("days_in_inventory", [
    candidate<number>({
      value: feedDays,
      source: "marketcheck",
      origin: firstSeen.origin,
      provider: "MarketCheck syndication feed (first_seen_at)",
      observedAt: feedObservedAt,
      confidence: "HIGH",
      license: REVIEW,
      note: feedFirstSeenIsLate
        ? `The feed first saw this listing at ${feedFirstSeen}, later than our own listing record `
          + `(${createdAt}), so it dates the current feed record and not the car's arrival -- true `
          + "of 100 of the 128 pilot cars that carry the stamp."
        : "Redistribution standing is UNKNOWN-REVIEW REQUIRED "
          + "(CUSTOMER_DISPLAY_LICENSE_MATRIX row 4).",
    }),
    candidate<number>({
      value: daysSince(createdAt),
      source: "other_structured",
      origin: "vehicle_listings.created_at",
      provider: "AutoLabels listing record (first sync into this tenant)",
      observedAt: createdAt,
      confidence: "MEDIUM",
      license: INTERNAL,
      note: "A floor, not an arrival date: the car may have stood on the lot before the first "
        + "sync created this row.",
    }),
  ], { now, configuredOrder: order });

  return { stock, mileage, condition, certified, inTransit, listingStatus, daysInInventory };
}
