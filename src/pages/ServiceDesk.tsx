import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { LocalTabs, PageBody, PageHeader, LinkButton } from "@/components/product";
import ServiceQueue from "@/components/service/ServiceQueue";
import { ManagerMessagesRail } from "@/components/service/ServiceMessages";
import { CommandCapabilityProvider } from "@/components/command/CommandPrimitives";

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
  const [searchParams] = useSearchParams();
  const urlView = searchParams.get("view");
  const [storedView] = useState<DeskView>(() => {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(viewKey) : null;
    if (stored === "my_work" || stored === "desk") return stored;
    return "my_work";
  });
  // A URL view wins (reload, back and shared links); otherwise the remembered
  // per-person default applies.
  const view: DeskView = urlView === "my_work" || urlView === "desk" ? urlView : storedView;
  const rememberView = (v: DeskView) => {
    try { localStorage.setItem(viewKey, v); } catch { /* private mode */ }
  };
  const [railVehicles, setRailVehicles] = useState<{ vin: string; ymm: string }[]>([]);
  const [counts, setCounts] = useState<{ mine: number; desk: number } | null>(null);

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

  const today = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

  return (
    <CommandCapabilityProvider role={member?.role} isAdmin={isAdmin}>
      <PageBody width="wide">
        <PageHeader
          title="Service Desk"
          meta={today}
          actions={canManageSettings ? <LinkButton to="/service/settings" aria-label="Service Desk settings, K-208 Policy">Settings</LinkButton> : undefined}
        />

        <div onClick={(e) => { const a = (e.target as HTMLElement).closest("a[href*='view=']"); const m = a?.getAttribute("href")?.match(/view=(my_work|desk)/); if (m) rememberView(m[1] as DeskView); }}>
          <LocalTabs
            label="Service Desk views"
            tabs={[
              { key: "my_work", label: "My work", to: "/service?view=my_work", active: view === "my_work", count: counts?.mine ?? null },
              { key: "desk", label: "Full desk", to: "/service?view=desk", active: view === "desk", count: counts?.desk ?? null },
            ]}
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
          <ServiceQueue key={view} mode={view} onCounts={setCounts} />
          <div className="xl:sticky xl:top-4">
            <ManagerMessagesRail tenantId={tenantId} vehicles={railVehicles} />
          </div>
        </div>
      </PageBody>
    </CommandCapabilityProvider>
  );
}
