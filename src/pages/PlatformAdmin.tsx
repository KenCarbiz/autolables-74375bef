import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import PlatformTenants from "@/components/admin/PlatformTenants";
import PlatformMembers from "@/components/admin/PlatformMembers";
import PlatformEntitlements from "@/components/admin/PlatformEntitlements";
import PlatformAudit from "@/components/admin/PlatformAudit";
import RecallRefreshTool from "@/components/admin/RecallRefreshTool";
import BillingHandshakeDiagnostic from "@/components/admin/BillingHandshakeDiagnostic";
import StripeConfigPanel from "@/components/admin/StripeConfigPanel";
import StickerTemplatesAdminPanel from "@/components/admin/StickerTemplatesAdminPanel";
import { Store, Users, Award, ShieldCheck, RefreshCw, CreditCard, KeyRound, LayoutTemplate } from "lucide-react";

// ──────────────────────────────────────────────────────────────
// PlatformAdmin — cross-tenant surfaces (Tenants, Members,
// Entitlements, Platform Audit). Separate route from /admin so
// dealer settings stay focused and the platform-admin bundle
// doesn't ship with every dealer page load.
//
// Wrapped upstream in AdminOnly (src/App.tsx), which gates the
// whole route on isAdmin = true.
// ──────────────────────────────────────────────────────────────

type PlatformTab = "tenants" | "members" | "entitlements" | "audit" | "recalls" | "billing" | "stripe" | "templates";
const VALID: PlatformTab[] = ["tenants", "members", "entitlements", "audit", "recalls", "billing", "stripe", "templates"];

const TABS: { id: PlatformTab; label: string; icon: typeof Store }[] = [
  { id: "tenants",      label: "Tenants",      icon: Store },
  { id: "members",      label: "Members",      icon: Users },
  { id: "entitlements", label: "Entitlements", icon: Award },
  { id: "audit",        label: "Platform Audit", icon: ShieldCheck },
  { id: "recalls",      label: "Recall refresh", icon: RefreshCw },
  { id: "billing",      label: "Billing handshake", icon: CreditCard },
  { id: "stripe",       label: "Stripe config", icon: KeyRound },
  { id: "templates",    label: "Sticker templates", icon: LayoutTemplate },
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
      <div className="px-4 lg:px-6 pt-6">
        <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Platform Admin
        </div>
        <h1 className="mt-1 text-2xl font-display font-semibold tracking-tight text-foreground">
          Platform Control
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-xl">
          Cross-tenant surfaces: dealers, seat assignments, app entitlements, and the tamper-evident platform audit log.
        </p>
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
        {tab === "stripe"       && <StripeConfigPanel />}
        {tab === "templates"    && <StickerTemplatesAdminPanel />}
      </div>
    </div>
  );
};

export default PlatformAdmin;
