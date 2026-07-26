import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { ShieldCheck, Settings, ClipboardCheck, ChevronRight } from "lucide-react";
import NextStepBanner from "@/components/workflow/NextStepBanner";
import ServiceQueue from "@/components/service/ServiceQueue";
import { ManagerMessagesRail } from "@/components/service/ServiceMessages";
import { CommandCapabilityProvider } from "@/components/command/CommandPrimitives";
import { cn } from "@/lib/utils";

// /service — the Service Desk landing, split by role:
//   My Work  — the technician's default: their queues, tablet cards, one
//              context-aware action each.
//   Full Desk — the service-writer/manager view: KPIs, the full table, and
//              the Manager Messages rail.
// Manager authorization (additional-work approvals) is a separate downstream
// screen at /service/approvals — the desk only surfaces the pending count.
// Per-vehicle work happens on the ONE shared workspace at
// /service/vehicle/:vin (also the Service QR landing).

type DeskView = "my_work" | "desk";

export default function ServiceDesk() {
  const { tenant } = useTenant();
  const { isAdmin, user } = useAuth();
  const { member } = useEntitlements();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const canManageSettings = isAdmin || hasDealerCapability(member?.role, "can_manage_service_settings", isAdmin);
  // Writers/managers (anyone who can assign work) default to the full desk;
  // technicians default to My Work.
  const canAssign = isAdmin || hasDealerCapability(member?.role, "can_assign_service_work", isAdmin);
  const viewKey = `service_desk_view:${user?.id ?? "anon"}`;
  const [view, setView] = useState<DeskView>(() => {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(viewKey) : null;
    if (stored === "my_work" || stored === "desk") return stored;
    return canAssign ? "desk" : "my_work";
  });
  const pickView = (v: DeskView) => {
    setView(v);
    try { localStorage.setItem(viewKey, v); } catch { /* private mode */ }
  };
  const [railVehicles, setRailVehicles] = useState<{ vin: string; ymm: string }[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);

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
      // deno-lint-ignore no-explicit-any
      const { count } = await (supabase as any).from("service_requests")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .in("status", ["pending", "clarify"]);
      setPendingApprovals(count ?? 0);
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
              <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
                {view === "my_work" ? "My Service Work" : "Service Desk"}
              </h1>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {view === "my_work"
                ? "Your inspections and available vehicles, one action each."
                : "Safety inspections, get-ready work, and K-208 execution."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div role="group" aria-label="Service Desk view" className="flex rounded-xl border border-border p-0.5">
              {([["my_work", "My Work"], ["desk", "Full Desk"]] as [DeskView, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => pickView(key)}
                  aria-pressed={view === key}
                  className={cn("h-10 px-3.5 rounded-[10px] text-xs font-semibold",
                    view === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {label}
                </button>
              ))}
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
        </div>

        {view === "my_work" ? (
          <ServiceQueue mode="my_work" />
        ) : (
          <>
            <NextStepBanner stage="service" />
            {pendingApprovals > 0 && (
              <Link
                to="/service/approvals"
                className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 hover:bg-amber-100/70"
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <ClipboardCheck className="w-4 h-4 text-amber-700 shrink-0" aria-hidden="true" />
                  <span className="text-sm font-semibold text-amber-900 truncate">
                    {pendingApprovals} additional-work {pendingApprovals === 1 ? "request needs" : "requests need"} a manager decision
                  </span>
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-900 shrink-0">
                  Review <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </span>
              </Link>
            )}
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
              <ServiceQueue />
              <div className="xl:sticky xl:top-4">
                <ManagerMessagesRail tenantId={tenantId} vehicles={railVehicles} />
              </div>
            </div>
          </>
        )}
      </div>
    </CommandCapabilityProvider>
  );
}
