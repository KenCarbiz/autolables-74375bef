// AutoLabels authoritative source reader (server only, inactive). Reads the PR #46 custody
// tables through the proposed rtgip_src readers (supabase/proposed/rtgip_source_readers.proposed.sql)
// as the rtgip_source_reader role, validates every field, and only then calls a producer.
// The producers' record arguments are therefore always database rows for the scope the
// server authenticated, never objects supplied by a caller.
//
// Authority: every read is keyed by (tenant, rooftop, episode). The database re-derives the
// binding tenant -> rooftop -> store -> episode -> listing -> VIN from rows and refuses a
// missing, mismatched or ambiguous link; this module then checks the returned authority
// block against the scope again. The scope's boolean is a type tag, not proof.
//
// Revisions, aggregate ids, origin ids and occurrence times come from the rows. The caller
// supplies only routing context: correlation, causation, emit time and the per-route
// previous revision the delivery ledger already knows.
//
// Pricing: the advertised price is the Passport's own computation applied to the stored
// listing values (resolvePassportSellingPrice + buildPassportSaleCard), never a new one and
// never a market estimate or acquisition figure.

import type { AppId } from "../rtgip2/protocol.ts";
import { resolvePassportSellingPrice, sellingPriceContextFromSettings } from "../../passport/sellingPrice.ts";
import { buildPassportSaleCard } from "../../passport/saleCard.ts";
import type { PassportData } from "../../passportV2Data.ts";
import {
  episodeClosed,
  episodeOpened,
  identityRegistered,
  inventoryStatusChanged,
  LabelsProducerError,
  listingAvailabilityChanged,
  pricePublished,
  saleMilestone,
  type CustodyMilestoneRecord,
  type EpisodeHistory,
  type EpisodeRecord,
  type FactMeta,
  type LabelsInstance,
  type LabelsServerScope,
  type ReappearanceReviewRecord,
} from "./producer.ts";

export type ReaderFn = "labels_episode_history" | "labels_episode_milestones" | "labels_listing_state";

/** The server's SQL handle, bound to the rtgip_source_reader role. */
export interface SourceDb {
  /** SELECT rtgip_src.<fn>(tenant, rooftop, episode) returning one jsonb value (or null). */
  call(fn: ReaderFn, args: [tenant: string, rooftop: string, episode: string]): Promise<unknown>;
}

export type LabelsReaderScope = LabelsServerScope;

/** Routing context only; everything that describes the fact itself comes from the rows. */
export interface RouteMeta {
  correlation_id: string;
  causation_id?: string | null;
  emitted_at: string;
  prev_revision: FactMeta["prev_revision"];
}

export class SourceReadError extends Error {
  constructor(code: string) {
    super(code);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ROOFTOP = /^[A-Za-z0-9._-]{1,64}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

function str(o: Obj, k: string, re?: RegExp): string {
  const v = o[k];
  if (typeof v !== "string" || (re && !re.test(v))) throw new SourceReadError(`bad_field:${k}`);
  return v;
}
function strOrNull(o: Obj, k: string, re?: RegExp): string | null {
  return o[k] === null || o[k] === undefined ? null : str(o, k, re);
}
function oneOf<T extends string>(o: Obj, k: string, allowed: readonly T[]): T {
  const v = str(o, k);
  if (!(allowed as readonly string[]).includes(v)) throw new SourceReadError(`bad_field:${k}`);
  return v as T;
}
function oneOfOrNull<T extends string>(o: Obj, k: string, allowed: readonly T[]): T | null {
  return o[k] === null ? null : oneOf(o, k, allowed);
}
function int(o: Obj, k: string): number {
  const v = o[k];
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new SourceReadError(`bad_field:${k}`);
  return v;
}
function money(o: Obj, k: string): number | null {
  const v = o[k];
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new SourceReadError(`bad_field:${k}`);
  return n;
}
const toIso = (v: string): string => {
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new SourceReadError("bad_timestamp");
  return new Date(Math.floor(t / 1000) * 1000).toISOString().replace(".000Z", "Z");
};

const CUSTODY = ["in_stock", "sold", "awaiting_delivery", "delivered", "transferred_out", "archived"] as const;
const MILESTONES = [
  "sold", "awaiting_delivery", "delivered", "sale_voided", "delivery_corrected", "post_delivery_unwind",
  "transferred_out", "archived", "restored",
] as const;

function episode(v: unknown, tenant: string): EpisodeRecord {
  if (!isObj(v)) throw new SourceReadError("bad_episode");
  const r: EpisodeRecord = {
    episode_id: str(v, "episode_id", UUID),
    tenant_id: str(v, "tenant_id", UUID),
    vin: str(v, "vin", VIN),
    instance_id: str(v, "instance_id", UUID),
    opened_reason: oneOf(v, "opened_reason", ["initial", "reacquisition", "restore", "transfer_in", "backfill"] as const),
    previous_episode_id: strOrNull(v, "previous_episode_id", UUID),
    custody_state: oneOf(v, "custody_state", CUSTODY),
    status: oneOf(v, "status", ["active", "disposed"] as const),
  };
  if (r.tenant_id !== tenant) throw new SourceReadError("row_outside_tenant");
  return r;
}

type Milestone = CustodyMilestoneRecord & { seq: number };

function milestone(v: unknown, tenant: string): Milestone {
  if (!isObj(v)) throw new SourceReadError("bad_milestone");
  const r: Milestone = {
    id: str(v, "id", UUID),
    tenant_id: str(v, "tenant_id", UUID),
    episode_id: str(v, "episode_id", UUID),
    vin: str(v, "vin", VIN),
    milestone: oneOf(v, "milestone", MILESTONES),
    to_state: str(v, "to_state"),
    occurred_at: str(v, "occurred_at", ISO),
    source: oneOf(v, "source", ["staff", "dms", "autocurb", "feed_review", "integration", "backfill"] as const),
    confirmed_by: strOrNull(v, "confirmed_by", UUID),
    corrects_id: strOrNull(v, "corrects_id", UUID),
    seq: int(v, "seq"),
  };
  if (r.tenant_id !== tenant) throw new SourceReadError("row_outside_tenant");
  return r;
}

function review(v: unknown, tenant: string): ReappearanceReviewRecord | null {
  if (v === null || v === undefined) return null;
  if (!isObj(v)) throw new SourceReadError("bad_review");
  const r: ReappearanceReviewRecord = {
    id: str(v, "id", UUID),
    tenant_id: str(v, "tenant_id", UUID),
    vin: str(v, "vin", VIN),
    prior_episode_id: strOrNull(v, "prior_episode_id", UUID),
    status: oneOf(v, "status", ["open", "resolved"] as const),
    decision: oneOfOrNull(v, "decision", ["restore_episode", "new_episode", "wrong_store_mapping", "reject_source", "keep_quarantined"] as const),
    decided_by: strOrNull(v, "decided_by", UUID),
    resulting_episode_id: strOrNull(v, "resulting_episode_id", UUID),
  };
  if (r.tenant_id !== tenant) throw new SourceReadError("row_outside_tenant");
  return r;
}

const arr = (v: unknown, k: string): unknown[] => {
  if (!Array.isArray(v)) throw new SourceReadError(`bad_field:${k}`);
  return v;
};

interface Authority {
  tenant_id: string;
  rooftop_id: string;
  store_id: string;
  episode_id: string;
  vin: string;
  listing_id: string | null;
  custody_revision: number;
}

async function read(db: SourceDb, scope: LabelsReaderScope, fn: ReaderFn, episodeId: string): Promise<{ raw: Obj; auth: Authority }> {
  if (scope.scope_verified_server_side !== true) throw new SourceReadError("scope_not_server_verified");
  if (!UUID.test(scope.tenant_id) || !ROOFTOP.test(scope.rooftop_id) || !UUID.test(episodeId))
    throw new SourceReadError("bad_reference");
  const raw = await db.call(fn, [scope.tenant_id, scope.rooftop_id, episodeId]);
  if (raw === null || raw === undefined) throw new SourceReadError("episode_not_found_for_tenant");
  if (!isObj(raw)) throw new SourceReadError("bad_read");
  if (typeof raw.refused === "string") throw new SourceReadError(raw.refused);
  if (!isObj(raw.authority)) throw new SourceReadError("authority_missing");
  const a = raw.authority;
  const auth: Authority = {
    tenant_id: str(a, "tenant_id", UUID),
    rooftop_id: str(a, "rooftop_id", ROOFTOP),
    store_id: str(a, "store_id", UUID),
    episode_id: str(a, "episode_id", UUID),
    vin: str(a, "vin", VIN),
    listing_id: strOrNull(a, "listing_id", UUID),
    custody_revision: int(a, "custody_revision"),
  };
  if (auth.tenant_id !== scope.tenant_id || auth.rooftop_id !== scope.rooftop_id || auth.episode_id !== episodeId)
    throw new SourceReadError("authority_mismatch");
  return { raw, auth };
}

const meta = (route: RouteMeta, aggregate_id: string, kind: string, revision: number, occurred_at: string): FactMeta => {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new SourceReadError("revision_unavailable");
  return {
    origin_event_id: `autolabels:${kind}:${aggregate_id}:${revision}`,
    aggregate_id,
    revision,
    prev_revision: route.prev_revision,
    correlation_id: route.correlation_id,
    causation_id: route.causation_id ?? null,
    occurred_at,
    emitted_at: route.emitted_at,
  };
};

export async function readEpisodeHistory(
  db: SourceDb,
  scope: LabelsReaderScope,
  episodeId: string,
): Promise<{ inst: LabelsInstance; history: EpisodeHistory; auth: Authority; opened_at: string }> {
  const { raw, auth } = await read(db, scope, "labels_episode_history", episodeId);
  if (!isObj(raw.instance)) throw new SourceReadError("bad_history");
  const t = scope.tenant_id;
  const ep = episode(raw.episode, t);
  const i = raw.instance;
  const stock = i.stock_number;
  if (stock !== null && (typeof stock !== "string" || !stock)) throw new SourceReadError("bad_field:stock_number");
  const inst: LabelsInstance = {
    vin: str(i, "vin", VIN),
    instance_id: str(i, "instance_id", UUID),
    episode_id: str(i, "episode_id", UUID),
    episode_state: oneOf(i, "episode_state", ["open", "closed"] as const),
    stock_number: stock,
  };
  if (inst.episode_id !== ep.episode_id || inst.instance_id !== ep.instance_id || inst.vin !== ep.vin || inst.vin !== auth.vin)
    throw new SourceReadError("instance_does_not_match_episode");
  return {
    inst,
    auth,
    opened_at: str(raw, "opened_at", ISO),
    history: {
      episode: ep,
      vin_episodes: arr(raw.vin_episodes, "vin_episodes").map((x) => episode(x, t)),
      predecessor_milestones: arr(raw.predecessor_milestones, "predecessor_milestones").map((x) => milestone(x, t)),
      review: review(raw.review, t),
    },
  };
}

export async function readEpisodeMilestones(db: SourceDb, scope: LabelsReaderScope, episodeId: string): Promise<Milestone[]> {
  const { raw, auth } = await read(db, scope, "labels_episode_milestones", episodeId);
  const rows = arr(raw.milestones, "milestones").map((x) => milestone(x, scope.tenant_id));
  if (rows.some((m) => m.episode_id !== episodeId || m.vin !== auth.vin)) throw new SourceReadError("milestone_outside_episode");
  return rows;
}

interface ListingState {
  auth: Authority;
  listing: {
    listing_id: string;
    status: "draft" | "published" | "archived";
    slug: string | null;
    condition: string | null;
    published_at: string | null;
    updated_at: string;
    revision: number;
    price: number | null;
    advertised_price_before_doc: number | null;
    doc_fee: number | null;
    website_sale_price: number | null;
  };
  identity: { year: number; make: string; model: string; trim: string | null; registered_at: string } | null;
  price_settings: { price_display_mode?: unknown; advertised_includes_doc_fee?: unknown };
}

export async function readListingState(db: SourceDb, scope: LabelsReaderScope, episodeId: string): Promise<ListingState> {
  const { raw, auth } = await read(db, scope, "labels_listing_state", episodeId);
  if (!isObj(raw.listing)) throw new SourceReadError("bad_listing");
  const l = raw.listing;
  const listing = {
    listing_id: str(l, "listing_id", UUID),
    status: oneOf(l, "status", ["draft", "published", "archived"] as const),
    slug: strOrNull(l, "slug"),
    condition: strOrNull(l, "condition"),
    published_at: strOrNull(l, "published_at"),
    updated_at: str(l, "updated_at"),
    revision: int(l, "revision"),
    price: money(l, "price"),
    advertised_price_before_doc: money(l, "advertised_price_before_doc"),
    doc_fee: money(l, "doc_fee"),
    website_sale_price: money(l, "website_sale_price"),
  };
  if (listing.listing_id !== auth.listing_id) throw new SourceReadError("listing_mismatch");
  let identity: ListingState["identity"] = null;
  if (isObj(raw.identity)) {
    const d = raw.identity;
    const year = Number(strOrNull(d, "year"));
    const make = strOrNull(d, "make");
    const model = strOrNull(d, "model");
    if (str(d, "vin", VIN) !== auth.vin) throw new SourceReadError("identity_vin_mismatch");
    if (Number.isSafeInteger(year) && year >= 1900 && make && model)
      identity = { year, make, model, trim: strOrNull(d, "trim"), registered_at: str(d, "registered_at", ISO) };
  }
  const ps = isObj(raw.price_settings) ? raw.price_settings : {};
  return { auth, listing, identity, price_settings: ps };
}

/** custody.episode_opened, decided from the database rows alone. */
export async function publishEpisodeOpened(
  db: SourceDb,
  scope: LabelsReaderScope,
  episodeId: string,
  /** opened_at, when given, is only checked against the row; the row's time is what is sent. */
  opened: { acquisition_kind?: "acquisition" | "trade_in"; opened_at?: string },
  route: RouteMeta,
  targets: readonly AppId[],
) {
  const { inst, history, opened_at } = await readEpisodeHistory(db, scope, episodeId);
  if (opened.opened_at !== undefined && toIso(opened.opened_at) !== opened_at) throw new SourceReadError("opened_at_mismatch");
  return episodeOpened(scope, inst, history, { opened_at, acquisition_kind: opened.acquisition_kind },
    meta(route, `episode:${episodeId}`, "episode_opened", 1, opened_at), targets);
}

const SALE_KINDS = new Set(["sold", "delivered", "sale_voided"]);

export async function publishSaleMilestone(
  db: SourceDb,
  scope: LabelsReaderScope,
  episodeId: string,
  milestoneId: string,
  route: RouteMeta,
  targets: readonly AppId[],
) {
  const { inst } = await readEpisodeHistory(db, scope, episodeId);
  const rows = await readEpisodeMilestones(db, scope, episodeId);
  const row = rows.find((m) => m.id === milestoneId);
  if (!row) throw new LabelsProducerError("milestone_not_found");
  const revision = rows.filter((m) => SALE_KINDS.has(m.milestone) && m.seq <= row.seq).length;
  return saleMilestone(scope, inst, row, rows, meta(route, `episode:${episodeId}:sale`, "sale_milestone", revision, row.occurred_at), targets);
}

const CLOSING: Record<string, "sold_delivered" | "transferred_out" | "archived"> = {
  delivered: "sold_delivered",
  transferred_out: "transferred_out",
  archived: "archived",
};

/** custody.episode_closed from the episode's own terminal milestone; never a supplied reason. */
export async function publishEpisodeClosed(db: SourceDb, scope: LabelsReaderScope, episodeId: string, route: RouteMeta, targets: readonly AppId[]) {
  const { inst, history } = await readEpisodeHistory(db, scope, episodeId);
  const rows = await readEpisodeMilestones(db, scope, episodeId);
  const state = history.episode.custody_state;
  const reason = CLOSING[state];
  if (!reason || inst.episode_state !== "closed") throw new LabelsProducerError("episode_not_closed");
  const closing = rows.filter((m) => m.to_state === state && m.milestone !== "post_delivery_unwind");
  const last = closing[closing.length - 1];
  if (!last) throw new LabelsProducerError("closure_milestone_missing");
  return episodeClosed(scope, inst, { closed_reason: reason, closed_at: last.occurred_at },
    meta(route, `episode:${episodeId}:custody`, "episode_closed", last.seq, last.occurred_at), targets);
}

export async function publishIdentityRegistered(db: SourceDb, scope: LabelsReaderScope, episodeId: string, route: RouteMeta, targets: readonly AppId[]) {
  const { inst } = await readEpisodeHistory(db, scope, episodeId);
  const st = await readListingState(db, scope, episodeId);
  if (!st.identity) throw new LabelsProducerError("identity_not_decoded");
  return identityRegistered(scope, inst, st.identity,
    meta(route, `vehicle:${inst.instance_id}`, "identity_registered", 1, st.identity.registered_at), targets);
}

/** Inventory status, mapped from custody state and listing status only. */
export function inventoryStatusFrom(custody: EpisodeRecord["custody_state"], listingStatus: string): string {
  switch (custody) {
    case "in_stock":
      return listingStatus === "published" ? "frontline" : "in_stock";
    case "sold":
    case "awaiting_delivery":
      return "sold";
    case "delivered":
      return "delivered";
    case "archived":
      return "archived";
    default:
      throw new LabelsProducerError("status_not_publishable");
  }
}

const latest = (...isos: (string | null | undefined)[]): string => {
  const ts = isos.filter((x): x is string => !!x).map((x) => Date.parse(x)).filter((x) => !Number.isNaN(x));
  if (!ts.length) throw new SourceReadError("bad_timestamp");
  return toIso(new Date(Math.max(...ts)).toISOString());
};

export async function publishInventoryStatus(db: SourceDb, scope: LabelsReaderScope, episodeId: string, route: RouteMeta, targets: readonly AppId[]) {
  const { inst, history } = await readEpisodeHistory(db, scope, episodeId);
  const rows = await readEpisodeMilestones(db, scope, episodeId);
  const st = await readListingState(db, scope, episodeId);
  const status = inventoryStatusFrom(history.episode.custody_state, st.listing.status);
  const changed_at = latest(st.listing.updated_at, rows[rows.length - 1]?.occurred_at);
  return inventoryStatusChanged(scope, inst, status, changed_at,
    meta(route, `episode:${episodeId}:inventory`, "inventory_status", Date.parse(changed_at) / 1000, changed_at), targets);
}

export async function publishListingAvailability(db: SourceDb, scope: LabelsReaderScope, episodeId: string, route: RouteMeta, targets: readonly AppId[]) {
  const { inst } = await readEpisodeHistory(db, scope, episodeId);
  const st = await readListingState(db, scope, episodeId);
  const available = st.listing.status === "published" && inst.episode_state === "open";
  const passport_ref = st.listing.slug && REF.test(st.listing.slug) ? st.listing.slug : null;
  const changed_at = toIso(st.listing.updated_at);
  return listingAvailabilityChanged(scope, inst, available, passport_ref, changed_at,
    meta(route, `listing:${st.listing.listing_id}`, "listing_availability", st.listing.revision, changed_at), targets);
}

/** The Passport's own price card for the stored listing values; null when it shows no price. */
export function passportCardFor(st: ListingState) {
  const selling = resolvePassportSellingPrice(
    {
      price: st.listing.price,
      advertised_price_before_doc: st.listing.advertised_price_before_doc,
      doc_fee: st.listing.doc_fee,
      website_sale_price: st.listing.website_sale_price,
    },
    sellingPriceContextFromSettings(st.price_settings),
  );
  const d = { price: selling.price, priceIncludesDoc: selling.includesDocFee, docFee: selling.docFee,
    msrp: null, marketAvg: null, retailCash: null, dealerDiscount: null } as unknown as PassportData;
  return buildPassportSaleCard(d, st.listing.condition);
}

const cents = (n: number): number => Math.round(n * 100);

export async function publishPrice(db: SourceDb, scope: LabelsReaderScope, episodeId: string, route: RouteMeta, targets: readonly AppId[]) {
  const { inst } = await readEpisodeHistory(db, scope, episodeId);
  const st = await readListingState(db, scope, episodeId);
  if (st.listing.status !== "published" || !st.listing.published_at) throw new LabelsProducerError("listing_not_published");
  const card = passportCardFor(st);
  if (!card) throw new LabelsProducerError("passport_shows_no_price");
  const published_at = latest(st.listing.published_at, st.listing.updated_at);
  return pricePublished(scope, inst, {
    vehicle_selling_price_cents: cents(card.vehicleSellingPrice),
    doc_fee_cents: cents(card.feeAmount ?? 0),
    total_advertised_price_cents: cents(card.totalAdvertisedPrice),
    published_at,
  }, meta(route, `listing:${st.listing.listing_id}:price`, "price_published", st.listing.revision, published_at), targets);
}
