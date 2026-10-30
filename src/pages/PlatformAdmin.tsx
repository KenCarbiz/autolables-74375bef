import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { LocalTabs, PageBody, PageHeader } from "@/components/product";
import { useAuth } from "@/contexts/AuthContext";
import PlatformTenants from "@/components/admin/PlatformTenants";
import PlatformMembers from "@/components/admin/PlatformMembers";
import PlatformEntitlements from "@/components/admin/PlatformEntitlements";
import PlatformAudit from "@/components/admin/PlatformAudit";
import RecallRefreshTool from "@/components/admin/RecallRefreshTool";
import BillingHandshakeDiagnostic from "@/components/admin/BillingHandshakeDiagnostic";
import StripeConfigPanel from "@/components/admin/StripeConfigPanel";
import StickerTemplatesAdminPanel from "@/components/admin/StickerTemplatesAdminPanel";
import PassportEngagementDashboard from "@/components/admin/PassportEngagementDashboard";
import MarketcheckApiUsagePanel from "@/components/admin/MarketcheckApiUsagePanel";
import ProviderBudgetsPanel from "@/components/admin/ProviderBudgetsPanel";
import { Store, Users, Award, ShieldCheck, RefreshCw, CreditCard, KeyRound, LayoutTemplate, Activity, DollarSign, Wallet } from "lucide-react";

// ──────────────────────────────────────────────────────────────
// PlatformAdmin — cross-tenant surfaces (Tenants, Members,
// Entitlements, Platform Audit). Separate route from /admin so
// dealer settings stay focused and the platform-admin bundle
// doesn't ship with every dealer page load.
//
// Wrapped upstream in AdminOnly (src/App.tsx), which gates the
// whole route on isAdmin = true.
// ──────────────────────────────────────────────────────────────

type PlatformTab = "tenants" | "members" | "entitlements" | "audit" | "recalls" | "billing" | "stripe" | "templates" | "passport-engagement" | "api-usage" | "budgets";
const VALID: PlatformTab[] = ["tenants", "members", "entitlements", "audit", "recalls", "billing", "stripe", "templates", "passport-engagement", "api-usage", "budgets"];

const TABS: { id: PlatformTab; label: string; icon: typeof Store }[] = [
  { id: "tenants",      label: "Tenants",      icon: Store },
  { id: "members",      label: "Members",      icon: Users },
  { id: "entitlements", label: "Entitlements", icon: Award },
  { id: "audit",        label: "Platform audit", icon: ShieldCheck },
  { id: "recalls",      label: "Recall refresh", icon: RefreshCw },
  { id: "billing",      label: "Billing handshake", icon: CreditCard },
  { id: "stripe",       label: "Stripe config", icon: KeyRound },
  { id: "templates",    label: "Sticker templates", icon: LayoutTemplate },
  { id: "passport-engagement", label: "Passport engagement", icon: Activity },
  { id: "api-usage",    label: "API usage & cost", icon: DollarSign },
  { id: "budgets",      label: "Budgets & alerts", icon: Wallet },
];

const PRIMARY: PlatformTab[] = ["tenants", "members", "entitlements", "templates", "audit"];

const PlatformAdmin = () => {
  const { user, isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const urlTab = searchParams.get("tab") as PlatformTab | null;
  const tab: PlatformTab = urlTab && VALID.includes(urlTab) ? urlTab : "tenants";

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) navigate("/login");
  }, [user, isAdmin, loading, navigate]);

  if (loading) return null;
  if (!isAdmin) return null;
  const primaryTabs = PRIMARY.map((id) => TABS.find((t) => t.id === id)!);

  return (
    <div data-product-surface="platform">
      <PageBody>
        <PageHeader
          title="Platform Console"
          description="Dealers, seats, app entitlements, provider cost, template libraries and the platform audit log."
        />
        <LocalTabs
          label="Platform sections"
          defaultKey="tenants"
          tabs={primaryTabs.map((t) => ({ key: t.id, label: t.label, to: `/platform-admin?tab=${t.id}`, active: t.id === tab }))}
        />
        <details className="group" open={!PRIMARY.includes(tab)}>
          <summary className="cursor-pointer list-none text-[14px] font-semibold text-adm-primary hover:underline">More platform tools</summary>
          <nav aria-label="Platform tools" className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
            {TABS.filter((t) => !PRIMARY.includes(t.id)).map((t) => (
              <Link key={t.id} to={`/platform-admin?tab=${t.id}`} aria-current={t.id === tab ? "page" : undefined} className={t.id === tab ? "text-[14px] font-semibold text-adm-primary" : "text-[14px] text-adm-muted hover:text-adm-ink"}>{t.label}</Link>
            ))}
          </nav>
        </details>

        <section aria-label={TABS.find((t) => t.id === tab)?.label} className="flex flex-col gap-4">
          {tab === "tenants"      && <PlatformTenants />}
          {tab === "members"      && <PlatformMembers />}
          {tab === "entitlements" && <PlatformEntitlements />}
          {tab === "audit"        && <PlatformAudit />}
          {tab === "recalls"      && <RecallRefreshTool />}
          {tab === "billing"      && <BillingHandshakeDiagnostic />}
          {tab === "stripe"       && <StripeConfigPanel />}
          {tab === "templates"    && <StickerTemplatesAdminPanel />}
          {tab === "passport-engagement" && <PassportEngagementDashboard />}
          {tab === "api-usage"    && <MarketcheckApiUsagePanel />}
          {tab === "budgets"      && <ProviderBudgetsPanel />}
        </section>
      </PageBody>
    </div>
  );
};

export default PlatformAdmin;
