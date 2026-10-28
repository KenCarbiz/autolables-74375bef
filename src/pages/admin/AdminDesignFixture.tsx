import { Suspense } from "react";
import { useParams } from "react-router-dom";
import { AdminFixtureProvider } from "@/lib/admin/dataSource";
import { ADMIN_SECTIONS, resolveAdminTab } from "@/lib/admin/sections";
import { AdminShell } from "@/components/admin/v2/AdminShell";
import { ADMIN_VIEWS } from "@/pages/admin/views";
import { ADMIN_FIXTURES } from "@/pages/admin/fixtures";
import { ADMIN_CHILD_ROUTE_ELEMENTS } from "@/pages/admin/childRoutes";

// Development-only. Renders one reference screen from a fixture so the parity
// harness can capture it deterministically. The route is registered only when
// import.meta.env.DEV is true; a production bundle never includes it.

export default function AdminDesignFixture() {
  const { screen } = useParams<{ screen: string }>();
  const entry = screen ? ADMIN_FIXTURES[screen] : undefined;
  if (!entry) {
    return (
      <div className="p-8 text-sm">
        <p className="font-semibold">Unknown fixture.</p>
        <p className="text-muted-foreground">Known screens: {Object.keys(ADMIN_FIXTURES).join(", ") || "none registered yet"}.</p>
      </div>
    );
  }

  const content = (() => {
    if (entry.childPath) {
      const route = ADMIN_CHILD_ROUTE_ELEMENTS.find((r) => r.path === entry.childPath);
      return route ? route.element : <p className="p-8 text-sm">No child route registered for {entry.childPath}.</p>;
    }
    const resolved = resolveAdminTab(entry.tabId);
    if (!resolved) return <p className="p-8 text-sm">Unknown tab {entry.tabId}.</p>;
    const View = ADMIN_VIEWS[resolved.tab.id];
    return (
      <AdminShell
        sections={[...ADMIN_SECTIONS]}
        activeSection={resolved.section}
        activeTab={resolved.tab}
        tabsForSection={resolved.section.tabs.filter((t) => !t.unpictured)}
        firstTabFor={(s) => s.tabs[0]}
      >
        {View ? <View /> : <p className="text-sm text-adm-muted">No V2 view registered for {resolved.tab.id}.</p>}
      </AdminShell>
    );
  })();

  return (
    <AdminFixtureProvider fixture={entry.fixture}>
      <div data-admin-fixture={screen} className="min-h-screen bg-adm-workspace flex">
        <div className="w-[224px] flex-shrink-0 bg-adm-sidebar" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="h-16 border-b border-adm-border bg-adm-surface" aria-hidden="true" />
          <Suspense fallback={<div className="p-8 text-sm text-adm-muted">Loading fixture…</div>}>{content}</Suspense>
        </div>
      </div>
    </AdminFixtureProvider>
  );
}
