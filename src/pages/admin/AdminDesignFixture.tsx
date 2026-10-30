import { Suspense, useState, type ReactElement, type ReactNode } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { AdminFixtureProvider } from "@/lib/admin/dataSource";
import { ADMIN_SECTIONS, resolveAdminTab } from "@/lib/admin/sections";
import { AdminShell } from "@/components/admin/v2/AdminShell";
import { ADMIN_VIEWS } from "@/pages/admin/views";
import { ADMIN_FIXTURES } from "@/pages/admin/fixtures";
import { ADMIN_CHILD_ROUTE_ELEMENTS } from "@/pages/admin/childRoutes";
import { AppRail } from "@/components/layout/AppRail";
import { AppHeader } from "@/components/layout/AppHeader";
import { navSectionsForViewer } from "@/components/layout/adminNav";
import { useNavDrawer } from "@/components/layout/useNavDrawer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

// Development-only. Renders one reference screen from a fixture so the parity
// harness can capture it deterministically. The route is registered only when
// import.meta.env.DEV is true; a production bundle never includes it.

const ZERO_BADGES = { workQueue: 0, leads: 0, reconApprovals: 0, priceChangeReview: 0, complianceTasks: 0, returns: 0 };

// ?chrome=1 swaps the two stand-ins for the real global frame, drawn with the
// mock's own labels (development fixture data, never a production label). The
// rail, the header and the drawer are the product components; only the menus
// are stand-ins, and each says so when opened. Without ?chrome=1 the page
// renders exactly as the accepted parity captures were taken.

const FixtureNote = ({ trigger, what }: { trigger: ReactElement; what: string }) => (
  <Popover>
    <PopoverTrigger asChild>{trigger}</PopoverTrigger>
    <PopoverContent align="end" className="w-64 text-[13px] leading-5 text-adm-ink">
      <p className="font-semibold">Design fixture</p>
      <p className="mt-1 text-adm-muted">In the product this opens {what}. The fixture has no account behind it.</p>
    </PopoverContent>
  </Popover>
);

function FixtureChrome({ railWidth, children }: { railWidth: number; children: ReactNode }) {
  const location = useLocation();
  const drawer = useNavDrawer(location.pathname);
  const [searchNote, setSearchNote] = useState(false);
  const sections = navSectionsForViewer({ role: "admin", isAdmin: true, badges: ZERO_BADGES, hasFeature: () => true });
  return (
    <>
      {drawer.open && <div className="fixed inset-0 z-[45] bg-black/50 lg:hidden" onClick={drawer.closeDrawer} aria-hidden="true" />}
      <AppRail
        id="fixture-rail"
        sections={sections}
        pathname="/admin"
        onNavigate={drawer.closeDrawer}
        onClose={drawer.closeDrawer}
        modal={drawer.modal}
        closeButtonRef={drawer.closeRef}
        width={railWidth}
        className={drawer.railClassName}
      />
      <div ref={drawer.backgroundRef} className="flex-1 min-w-0">
        <AppHeader
          groupName="Harte Auto Group"
          storeLocation="Hartford, CT"
          storeName="Harte Honda"
          renderRooftopMenu={(trigger) => <FixtureNote trigger={trigger} what="the rooftop switcher" />}
          onOpenSearch={() => setSearchNote(true)}
          isMac
          notificationCount={7}
          renderNotifications={(trigger) => <FixtureNote trigger={trigger} what="your notifications" />}
          userName="Ken Admin"
          userInitials="KA"
          renderUserMenu={(trigger) => <FixtureNote trigger={trigger} what="the account menu" />}
          onOpenMenu={drawer.openDrawer}
          menuOpen={drawer.open}
          menuControls="fixture-rail"
          menuButtonRef={drawer.triggerRef}
        />
        {children}
      </div>
      <Dialog open={searchNote} onOpenChange={setSearchNote}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Design fixture</DialogTitle>
          <DialogDescription>In the product the search box opens the command palette.</DialogDescription>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function AdminDesignFixture() {
  const { screen } = useParams<{ screen: string }>();
  const [search] = useSearchParams();
  // The mocks draw their rail between 217 and 264px wide; the harness passes each
  // mock's width so the content origin lines up. Default: the Overview mock.
  // With ?chrome=1 the same width is applied to the real rail, for evidence only.
  const withDialogBackdrop = screen === "06";
  const railWidth = Math.min(320, Math.max(160, Number(search.get("rail")) || (withDialogBackdrop ? 243 : 229)));
  // The fee-review mock shows the rail and header dimmed behind its dialog, so
  // that screen draws the real frame unless ?chrome=0 asks for the stand-ins.
  const chrome = search.get("chrome") === "1" || (withDialogBackdrop && search.get("chrome") !== "0");
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

  const body = <Suspense fallback={<div className="p-8 text-sm text-adm-muted">Loading fixture…</div>}>{content}</Suspense>;

  return (
    <AdminFixtureProvider fixture={entry.fixture}>
      <div data-admin-fixture={screen} data-product-surface="dealer" className="min-h-screen bg-adm-workspace flex">
        {chrome ? (
          <FixtureChrome railWidth={railWidth}>{body}</FixtureChrome>
        ) : (
          <>
            <div className="hidden lg:block flex-shrink-0 bg-adm-sidebar" style={{ width: railWidth }} aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <div className="h-16 border-b border-adm-border bg-adm-surface" aria-hidden="true" />
              {body}
            </div>
          </>
        )}
      </div>
    </AdminFixtureProvider>
  );
}
