import {
  Shield, SunDim, Sparkles, ShieldCheck, Lock, Gauge, Armchair, Umbrella,
  Car, DoorOpen, Brush, KeyRound, Siren, MapPin, Video, Footprints, Package,
  Container, PanelBottom, Link2, Truck, PanelTop, FileCheck, Wrench, FileText,
  TriangleAlert, Hammer, Key, CarFront, Tag, type LucideIcon,
} from "lucide-react";

// Product icons. Line-style lucide marks (not emoji) so the sticker and
// product list read as a premium dealer document rather than a chat message.
// Keys are the stored icon_type values; default covers anything unmapped.
export const PRODUCT_ICONS: Record<string, LucideIcon> = {
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

export const PRODUCT_ICON_KEYS = Object.keys(PRODUCT_ICONS).filter((k) => k !== "default");

// Render a product icon by its stored type. Falls back to the default mark.
export const ProductIcon = ({ type, className }: { type?: string; className?: string }) => {
  const Icon = (type && PRODUCT_ICONS[type]) || PRODUCT_ICONS.default;
  return <Icon className={className} strokeWidth={1.75} aria-hidden />;
};
