import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { matchPath, Navigate, useSearchParams } from "react-router-dom";
import { ConsolePathProvider, useConsolePath } from "@/lib/platformConsole/dataSource";
import { CONSOLE_BASE, LEGACY_TAB_ALIASES } from "@/lib/platformConsole/sections";
import { ViewState } from "@/components/platformConsole/ui";

// Route table for the console. Patterns are matched against the console path
// (the URL in production, the fixture's path on the development fixture route),
// so views read params through useConsoleParams rather than useParams.

type View = LazyExoticComponent<ComponentType>;

export const CONSOLE_ROUTES: { pattern: string; view: View }[] = [
  { pattern: CONSOLE_BASE, view: lazy(() => import("./views/OverviewView")) },
  // builder B
  { pattern: `${CONSOLE_BASE}/incidents/:incidentId`, view: lazy(() => import("./views/IncidentView")) },
  { pattern: `${CONSOLE_BASE}/usage`, view: lazy(() => import("./views/UsageView")) },
  { pattern: `${CONSOLE_BASE}/usage/billing`, view: lazy(() => import("./views/BillingView")) },
  { pattern: `${CONSOLE_BASE}/access`, view: lazy(() => import("./views/AccessView")) },
  { pattern: `${CONSOLE_BASE}/templates`, view: lazy(() => import("./views/TemplatesView")) },
  // end builder B
];

export function matchConsoleRoute(path: string) {
  for (const r of CONSOLE_ROUTES) {
    const m = matchPath({ path: r.pattern, end: true }, path);
    if (m) return { route: r, params: m.params as Record<string, string> };
  }
  return null;
}

export function useConsoleParams(): Record<string, string> {
  const path = useConsolePath();
  return matchConsoleRoute(path)?.params ?? {};
}

export function ConsoleScreen({ path }: { path: string }) {
  const hit = matchConsoleRoute(path);
  const View = hit?.route.view;
  return (
    <ConsolePathProvider path={path}>
      <Suspense fallback={<div className="p-8"><ViewState status="loading" what="console" /></div>}>
        {View ? <View /> : <div className="p-8"><ViewState status="error" error="This console page does not exist." what="page" /></div>}
      </Suspense>
    </ConsolePathProvider>
  );
}

/** /platform-console/* in the app shell. Old ?tab= values redirect to their new section. */
export default function PlatformConsole() {
  const path = useConsolePath();
  const [params] = useSearchParams();
  const legacy = params.get("tab");
  if (legacy && path === CONSOLE_BASE && LEGACY_TAB_ALIASES[legacy]) {
    return <Navigate to={LEGACY_TAB_ALIASES[legacy]} replace />;
  }
  return <ConsoleScreen path={path.replace(/\/+$/, "") || CONSOLE_BASE} />;
}
