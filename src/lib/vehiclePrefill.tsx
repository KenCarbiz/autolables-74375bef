import { useEffect, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { FileText, ArrowLeft, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// ──────────────────────────────────────────────────────────────────────
// Vehicle prefill — connects the Vehicle Command Center's Labels tab to
// every label generator. The Labels cards link to a generator with
// `?vehicleId=<id>`; the generator calls useVehiclePrefill() to fetch the
// vehicle_listings row and seed its form once, so the dealer never re-keys
// VIN / YMM / mileage / price / equipment that already lives on the file.
// ──────────────────────────────────────────────────────────────────────

export interface PrefillVehicle {
  id: string;
  vin: string;
  stock: string;
  year: string;
  make: string;
  model: string;
  trim: string;
  ymm: string;
  condition: "new" | "used" | "cpo" | "";
  isCpo: boolean;
  mileage: string;
  price: string;
  msrp: string;
  exteriorColor: string;
  interiorColor: string;
  engine: string;
  engineSize: string;
  cylinders: string;
  transmission: string;
  drivetrain: string;
  fuelType: string;
  bodyStyle: string;
  doors: string;
  mpgCity: string;
  mpgHwy: string;
  mpgCombined: string;
  horsepower: string;
  torque: string;
  // OEM equipment / options & packages from the feed (when present).
  features: string[];
  options: string[];
  // Market & history signals.
  daysOnMarket: string;
  priceChangePercent: string;
  carfax1Owner: boolean;
  carfaxCleanTitle: boolean;
  sellerType: string;
  photos: string[];
  heroImage: string;
  recallStatus: string;
  openRecallCount: number;
  slug: string;
  warrantyInfo: Record<string, unknown> | null;
  // Full raw row + the MarketCheck attribute blob, so any future field we
  // need is already on hand without another round-trip.
  mcAttributes: Record<string, unknown>;
  raw: Record<string, unknown>;
}

const s = (v: unknown): string => (v == null ? "" : String(v));
const sNum = (v: unknown): string => (v == null || v === "" ? "" : String(v));
// Feed equipment/options arrive as plain strings or {name|label|description}
// objects depending on the feed generation — flatten to a clean string list.
const toStrArr = (v: unknown): string[] =>
  Array.isArray(v)
    ? v
        .map((x) =>
          typeof x === "string"
            ? x
            : x && typeof x === "object"
              ? String((x as Record<string, unknown>).name ?? (x as Record<string, unknown>).label ?? (x as Record<string, unknown>).description ?? "")
              : String(x ?? "")
        )
        .filter(Boolean)
    : [];

// "2022 Toyota Tundra SR5" → year/make/model. The trim is stored
// separately, so model is everything after make.
const splitYmm = (ymm: string): { year: string; make: string; model: string } => {
  const parts = ymm.trim().split(/\s+/).filter(Boolean);
  let year = "";
  if (/^\d{4}$/.test(parts[0] || "")) year = parts.shift() as string;
  const make = parts.shift() || "";
  const model = parts.join(" ");
  return { year, make, model };
};

// Pull the first present key from a bag — MarketCheck's field names drift
// across feed generations (mpg_city vs city_mpg), so we accept either.
const pick = (bag: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) {
    if (bag[k] != null && bag[k] !== "") return bag[k];
  }
  return undefined;
};

// deno-lint-ignore no-explicit-any
function normalizeRow(row: Record<string, any>): PrefillVehicle {
  const mc = (row.mc_attributes || {}) as Record<string, unknown>;
  const ymm = s(row.ymm);
  const { year, make, model } = splitYmm(ymm);
  const condition = (s(row.condition) as PrefillVehicle["condition"]) || "";
  return {
    id: s(row.id),
    vin: s(row.vin).toUpperCase(),
    stock: s(row.stock_number),
    year,
    make,
    model,
    trim: s(row.trim),
    ymm,
    condition,
    isCpo: condition === "cpo",
    mileage: row.mileage != null ? String(row.mileage) : "",
    price: row.price != null ? String(row.price) : "",
    msrp: sNum(pick(mc, "msrp")),
    exteriorColor: s(pick(mc, "exterior_color", "ext_color")),
    interiorColor: s(pick(mc, "interior_color", "int_color")),
    engine: s(pick(mc, "engine", "engine_description")),
    engineSize: sNum(pick(mc, "engine_size", "displacement")),
    cylinders: sNum(pick(mc, "cylinders")),
    transmission: s(pick(mc, "transmission")),
    drivetrain: s(pick(mc, "drivetrain", "drive_type")),
    fuelType: s(pick(mc, "fuel_type")),
    bodyStyle: s(pick(mc, "body_type", "body_style")),
    doors: sNum(pick(mc, "doors")),
    mpgCity: sNum(pick(mc, "city_mpg", "mpg_city")),
    mpgHwy: sNum(pick(mc, "highway_mpg", "mpg_highway", "mpg_hwy")),
    mpgCombined: sNum(pick(mc, "combined_mpg", "mpg_combined")),
    horsepower: sNum(pick(mc, "horsepower", "hp", "engine_hp")),
    torque: sNum(pick(mc, "torque")),
    features: toStrArr(pick(mc, "features", "std_equipment")),
    options: toStrArr(pick(mc, "options", "installed_options")),
    daysOnMarket: sNum(pick(mc, "dom_active", "dom")),
    priceChangePercent: sNum(pick(mc, "price_change_percent")),
    carfax1Owner: pick(mc, "carfax_1_owner") === true,
    carfaxCleanTitle: pick(mc, "carfax_clean_title") === true,
    sellerType: s(pick(mc, "seller_type")),
    photos: Array.isArray(row.photos) ? row.photos.map(s).filter(Boolean) : [],
    heroImage: s(row.hero_image_url),
    recallStatus: s(row.recall_status),
    openRecallCount: typeof row.open_recall_count === "number" ? row.open_recall_count : 0,
    slug: s(row.slug),
    warrantyInfo: (row.warranty_info as Record<string, unknown>) || null,
    mcAttributes: mc,
    raw: row,
  };
}

export interface PrefillState {
  active: boolean; // a vehicleId/vin was present in the URL
  loading: boolean;
  error: string | null;
  vehicle: PrefillVehicle | null;
}

export function useVehiclePrefill(onLoad?: (v: PrefillVehicle) => void): PrefillState {
  const [params] = useSearchParams();
  const vehicleId = params.get("vehicleId") || params.get("vehicle_id") || "";
  const vinParam = (params.get("vin") || "").toUpperCase();
  const active = !!(vehicleId || vinParam);
  const [state, setState] = useState<PrefillState>({ active, loading: active, error: null, vehicle: null });
  // Keep the latest callback without re-running the fetch effect.
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  const done = useRef(false);

  useEffect(() => {
    if (!active || done.current) return;
    let cancelled = false;
    (async () => {
      // Mirror VehicleFile's loader exactly (select("*")) so we read the full
      // row — every column the scraper wrote — and never trip on a column that
      // isn't present on a given project.
      // deno-lint-ignore no-explicit-any
      let q = (supabase as any).from("vehicle_listings").select("*");
      q = vehicleId ? q.eq("id", vehicleId) : q.eq("vin", vinParam);
      const { data: row, error: err } = await q.maybeSingle();
      if (cancelled) return;
      if (err) {
        setState({ active, loading: false, error: "Couldn't load this vehicle. Please try again.", vehicle: null });
        return;
      }
      if (!row) {
        setState({ active, loading: false, error: "Vehicle not found. It may have been removed.", vehicle: null });
        return;
      }
      const v = normalizeRow(row);
      done.current = true;
      setState({ active, loading: false, error: null, vehicle: v });
      onLoadRef.current?.(v);
    })();
    return () => {
      cancelled = true;
    };
  }, [active, vehicleId, vinParam]);

  return state;
}

export function missingVehicleFields(v: PrefillVehicle): string[] {
  const m: string[] = [];
  if (!v.mileage) m.push("Mileage missing");
  if (!v.price) m.push("Price missing");
  if (!v.exteriorColor) m.push("Exterior color missing");
  return m;
}

// Small context banner shown at the top of every generator launched from a
// vehicle file. Renders nothing on a blank (from-scratch) form.
export function VehicleContextHeader({ state, missing }: { state: PrefillState; missing?: string[] }) {
  if (!state.active) return null;

  if (state.loading) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground animate-pulse print:hidden">
        Loading vehicle from file…
      </div>
    );
  }

  if (state.error || !state.vehicle) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 inline-flex items-center gap-2 print:hidden">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        {state.error || "Vehicle not found."}
      </div>
    );
  }

  const v = state.vehicle;
  const miss = missing ?? missingVehicleFields(v);
  const priceStr = v.price ? `$${Number(v.price).toLocaleString()}` : "—";

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3 print:hidden">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-blue-700 inline-flex items-center gap-1.5">
            <FileText className="w-3 h-3" /> Vehicle loaded from file
          </p>
          <p className="text-sm font-bold text-foreground mt-1 truncate">
            {v.ymm}
            {v.trim ? ` ${v.trim}` : ""}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-[11px] text-muted-foreground">
            {v.stock && (
              <span>
                Stock # <span className="font-medium text-foreground">{v.stock}</span>
              </span>
            )}
            {v.vin && (
              <span>
                VIN <span className="font-mono text-foreground">{v.vin}</span>
              </span>
            )}
            <span>
              Price <span className="font-medium text-foreground">{priceStr}</span>
            </span>
          </div>
        </div>
        <Link
          to={`/vehicle-file/${v.id}?tab=labels`}
          className="text-[11px] font-semibold text-blue-700 hover:text-blue-900 inline-flex items-center gap-1 shrink-0"
        >
          <ArrowLeft className="w-3 h-3" /> Back to Vehicle File
        </Link>
      </div>
      {miss.length > 0 && (
        <div className="mt-2 pt-2 border-t border-blue-200/70">
          <p className="text-[11px] font-semibold text-amber-700">Missing vehicle data</p>
          <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {miss.map((x) => (
              <li key={x} className="text-[11px] text-amber-700">
                · {x}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
