import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { ShieldCheck, Settings } from "lucide-react";
import NextStepBanner from "@/components/workflow/NextStepBanner";
import ServiceQueue from "@/components/service/ServiceQueue";
import { ServiceApprovalsPanel } from "@/components/service/AdditionalWork";
import { ManagerMessagesRail } from "@/components/service/ServiceMessages";
import { CommandCapabilityProvider } from "@/components/command/CommandPrimitives";

// /service — the Service Desk landing: the operational queue, additional-work
// approvals, and the Manager Messages rail. Per-vehicle work happens on the
// ONE shared workspace at /service/vehicle/:vin (also the Service QR landing).
// Policy lives at /service/settings, not here.

export default function ServiceDesk() {
  const { tenant } = useTenant();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const canManageSettings = isAdmin || hasDealerCapability(member?.role, "can_manage_service_settings", isAdmin);
  const [railVehicles, setRailVehicles] = useState<{ vin: string; ymm: string }[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      // deno-lint-ignore no-explicit-any
      const { data } = await (supabase as any).from("vehicle_listings")
        .select("vin, ymm")
        .eq("tenant_id", tenantId)
        .in("condition", ["used", "cpo", "certified"])
        .order("created_at", { ascending: false })
        .limit(100);
      setRailVehicles(((data as { vin: string | null; ymm: string | null }[]) || [])
        .filter((v) => v.vin)
        .map((v) => ({ vin: String(v.vin).toUpperCase(), ymm: v.ymm || "Vehicle" })));
    })();
  }, [tenantId]);

  if (!tenantId) return null;

  return (
    <CommandCapabilityProvider role={member?.role} isAdmin={isAdmin}>
      <div className="max-w-[1500px] mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" aria-hidden="true" />
              <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Service Desk</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">Safety inspections, get-ready work, and K-208 execution.</p>
          </div>
          {canManageSettings && (
            <Link
              to="/service/settings"
              aria-label="Service Desk settings — K-208 Policy"
              className="w-11 h-11 grid place-items-center rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <Settings className="w-5 h-5" aria-hidden="true" />
            </Link>
          )}
        </div>

        <NextStepBanner stage="service" />
        <ServiceApprovalsPanel tenantId={tenantId} />

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
          <ServiceQueue />
          <div className="xl:sticky xl:top-4">
            <ManagerMessagesRail tenantId={tenantId} vehicles={railVehicles} />
          </div>
        </div>
      </div>
    </CommandCapabilityProvider>
  );
}
