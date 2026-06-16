import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { ProductIcon, PRODUCT_ICONS } from "@/components/addendum/productIcons";

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

const ProductRow = ({ num, name, subtitle, warranty, badgeType, price, priceLabel, disclosure, isOptional, inkSaving, iconType, controls }: ProductRowProps) => {
  const { settings } = useDealerSettings();
  const showIcon = settings.feature_product_icons && !!iconType;

  return (
    <div className={`border-b border-border-custom py-2 px-2 border-l-4 transition-colors ${isOptional ? "bg-gold/5 border-l-gold" : "bg-blue/5 border-l-blue"}`}>
      <div className="flex gap-2">
        <span className="text-[10px] font-bold text-muted-foreground w-5 shrink-0 pt-0.5">{num}</span>
        {showIcon && (
          <span className="shrink-0 pt-0.5 text-muted-foreground" title={iconType?.replace(/_/g, " ")}>
            <ProductIcon type={iconType} className="w-4 h-4" />
          </span>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold text-foreground leading-tight">{name}</p>
          <p className="text-[8px] text-muted-foreground leading-tight mt-0.5">{subtitle}</p>
          <p className="text-[8px] text-muted-foreground">{warranty}</p>
          {badgeType === "installed" ? (
            <span className="inline-block mt-0.5 text-[8px] font-bold bg-blue text-primary-foreground px-1.5 py-0.5 rounded-sm">Pre-Installed · Non-Removable</span>
          ) : (
            <span className="inline-block mt-0.5 text-[8px] font-bold bg-gold text-navy px-1.5 py-0.5 rounded-sm">Optional — Consumer May Accept or Decline</span>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-[12px] font-bold text-foreground">{price}</p>
          <p className="text-[8px] text-muted-foreground">{priceLabel}</p>
        </div>
      </div>
      <p className="text-[8px] text-muted-foreground mt-1 pl-7 leading-tight">{disclosure}</p>
      {controls && (
        <div className="no-print mt-1.5 pl-7 flex items-center gap-3 border-t border-border-custom/40 pt-1.5">{controls}</div>
      )}
    </div>
  );
};

export default ProductRow;
export { PRODUCT_ICONS };
// PRODUCT_ICONS is re-exported above for back-compat; new consumers should
// import from "@/components/addendum/productIcons".
