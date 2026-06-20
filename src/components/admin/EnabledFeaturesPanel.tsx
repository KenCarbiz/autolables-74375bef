import { useFeatureGate } from "@/lib/entitlements/useFeatureGate";
import { PLAN_FEATURES, FEATURE_LABEL, rankOf, planLabel, type FeatureKey } from "@/lib/entitlements/features";
import { useEntitlements } from "@/hooks/useEntitlements";
import { Check, Lock, BadgeCheck } from "lucide-react";

// Read-only "Enabled features" panel. Shows the dealership's active AutoLabels
// plan and which feature groups are on/off. Dealers cannot self-enable paid
// entitlements here — that's set by Autocurb billing (single-writer).
export default function EnabledFeaturesPanel() {
  const { plan, planName, canUseFeature } = useFeatureGate();
  const { entitlementFor } = useEntitlements();
  const ent = entitlementFor("autolabels");

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="rounded-2xl border border-border bg-card p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-foreground inline-flex items-center gap-2"><BadgeCheck className="w-4 h-4 text-primary" /> AutoLabels plan</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Your active entitlement determines which workflows are available. Plans are managed through Autocurb billing.</p>
        </div>
        <div className="text-right">
          <span className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-blue-50 text-blue-700 text-sm font-bold">{planName}</span>
          {ent?.status && <p className="text-[10px] text-muted-foreground mt-1 capitalize">{ent.status}{ent.trial_ends_at ? ` · trial ends ${new Date(ent.trial_ends_at).toLocaleDateString()}` : ""}</p>}
        </div>
      </div>

      {PLAN_FEATURES.map((group) => {
        const included = rankOf(group.plan) <= rankOf(plan);
        return (
          <div key={group.plan} className={`rounded-2xl border p-4 ${included ? "border-border bg-card" : "border-dashed border-border bg-muted/20"}`}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-foreground">{group.label}</h3>
              <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${included ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                {included ? "Included" : `Requires ${planLabel(group.plan)}`}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {group.features.map((f) => {
                const on = canUseFeature(f as FeatureKey);
                return (
                  <div key={f} className="flex items-center gap-2 text-sm">
                    {on ? <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" /> : <Lock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                    <span className={on ? "text-foreground" : "text-muted-foreground"}>{FEATURE_LABEL[f as FeatureKey] || f}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="rounded-xl border border-border bg-muted/30 p-3 text-center">
        <p className="text-xs text-muted-foreground">Need a higher plan? <a href="mailto:support@autolabels.io" className="font-semibold text-blue-600">Contact support</a> to upgrade your dealership.</p>
      </div>
    </div>
  );
}
