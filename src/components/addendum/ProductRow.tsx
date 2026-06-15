import { useDealerSettings } from "@/contexts/DealerSettingsContext";

interface ProductRowProps {
  num: number;
  name: string;
  subtitle: string;
  warranty: string;
  badgeType: "installed" | "optional";
  price: string;
  priceLabel: string;
  disclosure: React.ReactNode;
  isOptional?: boolean;
  inkSaving?: boolean;
  iconType?: string;
  controls?: React.ReactNode;
}

const PRODUCT_ICONS: Record<string, string> = {
  paint_protection: "🛡️",
  window_tint: "🪟",
  ceramic_coating: "✨",
  theft_deterrent: "🔒",
  wheel_locks: "🔩",
  nitrogen_tires: "💨",
  interior_protection: "🛋️",
  rust_proofing: "🧱",
  clear_bra: "🎯",
  door_edge_guards: "🚪",
  pinstripe: "🎨",
  remote_start: "🔑",
  alarm: "🚨",
  gps_tracking: "📍",
  dash_cam: "📷",
  all_weather_mats: "🏔️",
  cargo_liner: "📦",
  roof_rack: "🏗️",
  running_boards: "🪜",
  trailer_hitch: "🪝",
  bed_liner: "🛻",
  tonneau_cover: "📐",
  extended_warranty: "📋",
  maintenance_plan: "🔧",
  gap_insurance: "📄",
  road_hazard: "🛣️",
  dent_repair: "🔨",
  key_replacement: "🗝️",
  windshield_protection: "🪛",
  default: "⚙️",
};

const ProductRow = ({ num, name, subtitle, warranty, badgeType, price, priceLabel, disclosure, isOptional, inkSaving, iconType, controls }: ProductRowProps) => {
  const { settings } = useDealerSettings();
  const icon = settings.feature_product_icons && iconType ? (PRODUCT_ICONS[iconType] || PRODUCT_ICONS.default) : null;

  return (
    <div className={`border-b border-border-custom py-2 px-2 border-l-4 transition-colors ${isOptional ? "bg-gold/5 border-l-gold" : "bg-blue/5 border-l-blue"}`}>
      <div className="flex gap-2">
        <span className="text-[10px] font-bold text-muted-foreground w-5 shrink-0 pt-0.5">{num}</span>
        {icon && (
          <span className="text-base shrink-0 pt-0.5" title={iconType?.replace(/_/g, " ")}>
            {icon}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold text-foreground leading-tight">{name}</p>
          <p className="text-[8px] text-muted-foreground leading-tight mt-0.5">{subtitle}</p>
          <p className="text-[8px] text-muted-foreground">{warranty}</p>
          {badgeType === "installed" ? (
            <span className="inline-block mt-0.5 text-[7px] font-bold bg-blue text-primary-foreground px-1.5 py-0.5 rounded-sm">⚙ Pre-Installed · Non-Removable</span>
          ) : (
            <span className="inline-block mt-0.5 text-[7px] font-bold bg-gold text-navy px-1.5 py-0.5 rounded-sm">✦ Optional — Consumer May Accept or Decline</span>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-[12px] font-bold text-foreground">{price}</p>
          <p className="text-[7px] text-muted-foreground">{priceLabel}</p>
        </div>
      </div>
      <p className="text-[7px] text-muted-foreground mt-1 pl-7 leading-tight">{disclosure}</p>
      {controls && (
        <div className="no-print mt-1.5 pl-7 flex items-center gap-3 border-t border-border-custom/40 pt-1.5">{controls}</div>
      )}
    </div>
  );
};

export default ProductRow;
export { PRODUCT_ICONS };
