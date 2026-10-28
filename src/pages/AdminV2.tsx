import { Suspense, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  ADMIN_SECTIONS,
  firstVisibleTab,
  resolveAdminLocation,
  visibleSections,
  visibleTabs,
  type AdminChildTab,
  type AdminVisibilityContext,
} from "@/lib/admin/sections";
import { AdminShell, AdminPageContainer } from "@/components/admin/v2/AdminShell";
import { useAdminVisibility } from "@/components/admin/v2/useAdminVisibility";
import { AdminCard, EmptyState, SkeletonBlock } from "@/components/admin/v2/primitives";
import { ADMIN_VIEWS } from "@/pages/admin/views";
import Admin from "@/pages/Admin";
import accessRestricted from "@/assets/admin-v2/artwork/access-restricted.svg";

// The Administration page. Resolves `?tab=` (canonical or legacy) to a section
// and child tab, renders the V2 shell, and shows either the V2 view registered
// for that tab or the legacy body it still owns. No data is written and no
// provider is called by opening this page.

const Skeleton = () => (
  <AdminPageContainer>
    <div className="space-y-4" aria-busy="true" aria-label="Loading Administration">
      <SkeletonBlock className="h-4 w-40" />
      <SkeletonBlock className="h-9 w-64" />
      <SkeletonBlock className="h-5 w-96" />
      <SkeletonBlock className="h-10 w-full" />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-[76px]" />)}
      </div>
      <SkeletonBlock className="h-72 w-full" />
    </div>
  </AdminPageContainer>
);

const Assembling = ({ tab }: { tab: AdminChildTab }) => (
  <AdminCard>
    <EmptyState
      title={`${tab.label} is being assembled`}
      detail="This view is part of the Administration refresh and has no content yet. The controls it will hold remain available in their current editors."
      compact
    />
  </AdminCard>
);

export default function AdminV2() {
  const { user } = useAuth();
  const { ctx, ready } = useAdminVisibility();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const param = searchParams.get("tab");
  const location = useMemo(() => (ready ? resolveAdminLocation(param, ctx) : null), [ready, param, ctx]);

  useEffect(() => {
    if (!ready) return;
    if (!user) { navigate("/login", { replace: true }); return; }
    if (location?.kind === "redirect") navigate(location.to, { replace: true });
  }, [ready, user, location, navigate]);

  if (!ready || !location || location.kind === "redirect") return <Skeleton />;

  if (location.kind === "none") {
    return (
      <AdminPageContainer>
        <AdminCard>
          <EmptyState
            artwork={accessRestricted}
            title="Administration is not available for your role"
            detail="Settings, pricing and publishing policy are managed by your store's administrators. If you need a change, ask a manager."
          />
        </AdminCard>
      </AdminPageContainer>
    );
  }

  const { section, tab } = location.resolved;
  const sections = visibleSections(ctx);
  const tabs = visibleTabs(section, ctx);
  const View = ADMIN_VIEWS[tab.id];

  return (
    <AdminShell
      sections={sections}
      activeSection={section}
      activeTab={tab}
      tabsForSection={tabs}
      firstTabFor={(s) => firstVisibleTab(s, ctx)}
    >
      <Suspense fallback={<SkeletonBlock className="h-64 w-full" />}>
        {View ? <View /> : tab.legacyTab ? <Admin embedded legacyTab={tab.legacyTab} /> : <Assembling tab={tab} />}
      </Suspense>
    </AdminShell>
  );
}

export { ADMIN_SECTIONS };
