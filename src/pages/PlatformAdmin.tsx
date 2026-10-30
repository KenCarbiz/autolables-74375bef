import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { LinkButton, LocalTabs, PageBody, PageHeader, Panel } from "@/components/product";
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

type PlatformTab = "health" | "tenants" | "members" | "entitlements" | "audit" | "recalls" | "billing" | "stripe" | "templates" | "passport-engagement" | "api-usage" | "budgets";
const VALID: PlatformTab[] = ["health", "tenants", "members", "entitlements", "audit", "recalls", "billing", "stripe", "templates", "passport-engagement", "api-usage", "budgets"];

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
const HEALTH_TOOLS = TABS.filter((t) => !PRIMARY.includes(t.id));

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
  const inHealth = tab === "health" || !PRIMARY.includes(tab);
  const navTabs = [
    ...primaryTabs.filter((t) => t.id !== "audit").map((t) => ({ key: t.id, label: t.label, to: `/platform-admin?tab=${t.id}`, active: !inHealth && t.id === tab })),
    { key: "health", label: "Health", to: "/platform-admin?tab=health", active: inHealth },
    { key: "audit", label: "Platform audit", to: "/platform-admin?tab=audit", active: tab === "audit" },
  ];

  return (
    <div data-product-surface="platform">
      <PageBody>
        <PageHeader
          title="Platform Console"
          actions={tab === "tenants" ? <LinkButton variant="primary" to="/platform-admin?tab=tenants&new=1">Add tenant</LinkButton> : undefined}
        />
        <LocalTabs
          label="Platform sections"
          defaultKey="tenants"
          tabs={navTabs}
        />
        <section aria-label={TABS.find((t) => t.id === tab)?.label ?? "Health"} className="flex flex-col gap-4">
          {inHealth && tab !== "health" && <Link to="/platform-admin?tab=health" className="text-[14px] font-semibold text-adm-primary hover:underline">All platform tools</Link>}
          {tab === "health" && (
            <Panel title="Platform health and diagnostics" titleSize="md" inset="sm">
              <nav aria-label="Platform tools" className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
                {HEALTH_TOOLS.map((t) => (
                  <Link key={t.id} to={`/platform-admin?tab=${t.id}`} className="flex h-11 items-center justify-between border-b border-adm-border text-[14px] font-semibold text-adm-primary hover:underline">{t.label}</Link>
                ))}
              </nav>
            </Panel>
          )}
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
