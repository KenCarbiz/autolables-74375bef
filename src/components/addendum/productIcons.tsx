import {
  Shield, SunDim, Sparkles, ShieldCheck, Lock, Gauge, Armchair, Umbrella,
  Car, DoorOpen, Brush, KeyRound, Siren, MapPin, Video, Footprints, Package,
  Container, PanelBottom, Link2, Truck, PanelTop, FileCheck, Wrench, FileText,
  TriangleAlert, Hammer, Key, CarFront, Tag, type LucideIcon,
} from "lucide-react";
import { getAddendumIconComponent } from "@/components/addendum-icons/iconRegistry";
import { PlaceholderGlyph } from "@/components/addendum-icons/customIcons";

// Product icons for addendum/window-sticker line items. Resolution order:
//   1. The addendum icon library (registry ID per product type) — single
//      source of artwork shared with the passport and design-system page.
//   2. The legacy Lucide mark when the library entry is still a dashed
//      placeholder — a customer-facing document never prints "not final".
// Keys are the stored icon_type values; default covers anything unmapped.

// icon_type → library icon ID. Only mapped where the library artwork is
// real; placeholder-backed IDs fall through to LEGACY automatically.
const PRODUCT_ICON_IDS: Record<string, string> = {
  paint_protection: "C001",
  window_tint: "A001",
  ceramic_coating: "A003",
  theft_deterrent: "C002",
  wheel_locks: "A018",
  nitrogen_tires: "A025",
  interior_protection: "A026",
  rust_proofing: "A005",
  clear_bra: "A002",
  door_edge_guards: "A023",
  pinstripe: "A004",
  remote_start: "A019",
  alarm: "A020",
  gps_tracking: "V019",
  dash_cam: "A021",
  all_weather_mats: "A006",
  cargo_liner: "A007",
  roof_rack: "A010",
  running_boards: "A016",
  trailer_hitch: "A011",
  bed_liner: "A015",
  tonneau_cover: "A017",
  extended_warranty: "C010",
  maintenance_plan: "M003",
  gap_insurance: "D001",
  road_hazard: "W004",
  key_replacement: "V016",
  windshield_protection: "V002",
  default: "U017",
};

const LEGACY: Record<string, LucideIcon> = {
  paint_protection: Shield,
  window_tint: SunDim,
  ceramic_coating: Sparkles,
  theft_deterrent: ShieldCheck,
  wheel_locks: Lock,
  nitrogen_tires: Gauge,
  interior_protection: Armchair,
  rust_proofing: Umbrella,
  clear_bra: Car,
  door_edge_guards: DoorOpen,
  pinstripe: Brush,
  remote_start: KeyRound,
  alarm: Siren,
  gps_tracking: MapPin,
  dash_cam: Video,
  all_weather_mats: Footprints,
  cargo_liner: Package,
  roof_rack: Container,
  running_boards: PanelBottom,
  trailer_hitch: Link2,
  bed_liner: Truck,
  tonneau_cover: PanelTop,
  extended_warranty: FileCheck,
  maintenance_plan: Wrench,
  gap_insurance: FileText,
  road_hazard: TriangleAlert,
  dent_repair: Hammer,
  key_replacement: Key,
  windshield_protection: CarFront,
  default: Tag,
};

type ProductIconComponent = React.ComponentType<{ className?: string; strokeWidth?: number | string; "aria-hidden"?: boolean }>;

export const resolveProductIcon = (type?: string): ProductIconComponent => {
  const id = type ? PRODUCT_ICON_IDS[type] : undefined;
  if (id) {
    const fromLibrary = getAddendumIconComponent(id);
    if (fromLibrary !== PlaceholderGlyph) return fromLibrary as ProductIconComponent;
  }
  return ((type && LEGACY[type]) || LEGACY.default) as ProductIconComponent;
};

// Back-compat map (admin previews iterate it); values resolve through the
// library the same way ProductIcon does.
export const PRODUCT_ICONS: Record<string, ProductIconComponent> = Object.fromEntries(
  Object.keys(LEGACY).map((key) => [key, resolveProductIcon(key)]),
);

export const PRODUCT_ICON_KEYS = Object.keys(PRODUCT_ICONS).filter((k) => k !== "default");

// Render a product icon by its stored type. Falls back to the default mark.
// Color and size come from className (currentColor), matching print styling.
export const ProductIcon = ({ type, className }: { type?: string; className?: string }) => {
  const Icon = resolveProductIcon(type);
  return <Icon className={className} strokeWidth={1.75} aria-hidden />;
};
