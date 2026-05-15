import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import PlatformTenants from "@/components/admin/PlatformTenants";
import PlatformMembers from "@/components/admin/PlatformMembers";
import PlatformEntitlements from "@/components/admin/PlatformEntitlements";
import PlatformAudit from "@/components/admin/PlatformAudit";
import RecallRefreshTool from "@/components/admin/RecallRefreshTool";
import BillingHandshakeDiagnostic from "@/components/admin/BillingHandshakeDiagnostic";
import { Store, Users, Award, ShieldCheck, RefreshCw, CreditCard } from "lucide-react";

// ──────────────────────────────────────────────────────────────
// PlatformAdmin — cross-tenant surfaces (Tenants, Members,
// Entitlements, Platform Audit). Separate route from /admin so
// dealer settings stay focused and the platform-admin bundle
// doesn't ship with every dealer page load.
//
// Wrapped upstream in AdminOnly (src/App.tsx), which gates the
// whole route on isAdmin = true.
// ──────────────────────────────────────────────────────────────

type PlatformTab = "tenants" | "members" | "entitlements" | "audit" | "recalls" | "billing";
const VALID: PlatformTab[] = ["tenants", "members", "entitlements", "audit", "recalls", "billing"];

const TABS: { id: PlatformTab; label: string; icon: typeof Store }[] = [
  { id: "tenants",      label: "Tenants",      icon: Store },
  { id: "members",      label: "Members",      icon: Users },
  { id: "entitlements", label: "Entitlements", icon: Award },
  { id: "audit",        label: "Platform Audit", icon: ShieldCheck },
  { id: "recalls",      label: "Recall refresh", icon: RefreshCw },
  { id: "billing",      label: "Billing handshake", icon: CreditCard },
];

const PlatformAdmin = () => {
  const { user, isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const urlTab = searchParams.get("tab") as PlatformTab | null;
  const tab: PlatformTab = urlTab && VALID.includes(urlTab) ? urlTab : "tenants";

  const setTab = (t: PlatformTab) => setSearchParams({ tab: t }, { replace: true });

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) navigate("/login");
  }, [user, isAdmin, loading, navigate]);

  if (loading) return null;
  if (!isAdmin) return null;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="shimmer-hero relative overflow-hidden rounded-b-3xl px-6 lg:px-10 pt-8 pb-10 text-white">
        <div className="relative z-10">
          <div className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-label">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Platform Admin
          </div>
          <h1 className="mt-2 text-2xl lg:text-3xl font-black tracking-tight font-display leading-tight">
            Platform Control
          </h1>
          <p className="text-xs lg:text-sm text-white/70 mt-1 max-w-xl">
            Cross-tenant surfaces: dealers, seat assignments, app entitlements, and the tamper-evident platform audit log.
          </p>
        </div>
      </div>

      <div className="p-4 lg:p-6 space-y-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-muted font-semibold text-foreground">
            {TABS.find(t => t.id === tab)?.label || "Section"}
          </span>
          <span className="hidden sm:inline">— pick any platform section from the left sidebar to switch.</span>
        </div>

        {tab === "tenants"      && <PlatformTenants />}
        {tab === "members"      && <PlatformMembers />}
        {tab === "entitlements" && <PlatformEntitlements />}
        {tab === "audit"        && <PlatformAudit />}
        {tab === "recalls"      && <RecallRefreshTool />}
        {tab === "billing"      && <BillingHandshakeDiagnostic />}
      </div>
    </div>
  );
};

export default PlatformAdmin;
