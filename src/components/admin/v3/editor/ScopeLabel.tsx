import { cn } from "@/lib/utils";
import { AdminIcon } from "./AdminIcon";

export type ScopeKind = "all_rooftops" | "rooftop";
export type ScopeSource = "inherited" | "custom";

/** Names where a setting applies and whether the value is inherited from the group or custom to the rooftop. */
export const ScopeLabel = ({ scope, rooftopName, source, className }: { scope: ScopeKind; rooftopName?: string; source?: ScopeSource; className?: string }) => {
  const where = scope === "all_rooftops" ? "All rooftops" : rooftopName?.trim() || "This rooftop";
  const how = source === "inherited" ? "Inherited from group" : source === "custom" ? "Custom for this rooftop" : null;
  return (
    <span data-scope={scope} className={cn("inline-flex items-center gap-1.5 flex-wrap text-[13px] leading-[18px] text-adm-muted", className)}>
      <AdminIcon name={scope === "all_rooftops" ? "grid" : "building"} size="compact" />
      <span className="font-medium text-adm-ink">{where}</span>
      {how && (<><span aria-hidden="true">.</span><span>{how}</span></>)}
    </span>
  );
};
