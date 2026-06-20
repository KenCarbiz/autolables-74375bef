import { type ReactNode } from "react";
import { useFeatureGate } from "@/lib/entitlements/useFeatureGate";
import { planLabel, type FeatureKey } from "@/lib/entitlements/features";
import { Lock } from "lucide-react";

const MSG: Record<string, string> = {
  pro: "This feature is available on AutoLabels Pro.",
  compliance: "Contact support to activate Compliance workflows.",
  platform: "Ask an admin to enable this for your dealership.",
};

// Gate a premium surface. When entitled, renders children. When not:
//   variant="block"  -> an upgrade card (default)
//   variant="inline" -> a small inline lock pill
//   variant="hide"   -> renders nothing
// Degrades open while entitlements load (useFeatureGate handles that).
export function FeatureGate({
  feature, children, variant = "block", fallback,
}: {
  feature: FeatureKey;
  children: ReactNode;
  variant?: "block" | "inline" | "hide";
  fallback?: ReactNode;
}) {
  const { canUseFeature, requiredTier } = useFeatureGate();
  if (canUseFeature(feature)) return <>{children}</>;
  if (fallback !== undefined) return <>{fallback}</>;
  if (variant === "hide") return null;

  const req = requiredTier(feature);
  const msg = MSG[req] || "This feature isn't enabled for your plan.";
  if (variant === "inline") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground" title={msg}>
        <Lock className="w-3 h-3" /> {planLabel(req)}
      </span>
    );
  }
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-8 text-center">
      <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-2">
        <Lock className="w-5 h-5" />
      </div>
      <p className="text-sm font-semibold text-foreground">Available on AutoLabels {planLabel(req)}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">{msg}</p>
    </div>
  );
}

export default FeatureGate;
