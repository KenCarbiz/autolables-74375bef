import { ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements, type AppSlug } from "@/hooks/useEntitlements";
import ActivatePaywall from "@/components/layout/ActivatePaywall";
import NoTenantScreen from "@/components/layout/NoTenantScreen";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

// ──────────────────────────────────────────────────────────────
// EntitlementGate — wrap any protected route. Outcomes, in order:
//
//   1. Not signed in.
//      → redirect to /login.
//
//   2. Signed in but has no local tenant_members row.
//      → first attempt a one-shot cold pull from Autocurb (in case
//        the user signed up there with the same email and Autocurb
//        runs in a separate Supabase project). If the pull seeds a
//        local tenant, we proceed; otherwise we send them to
//        /onboarding to do the standalone signup wizard.
//
//   3. Signed in, has tenant, no entitlement for this app.
//      → If the tenant came from Autocurb (source==='autocurb' OR
//        has an active autocurb entitlement), the dealer's plan
//        already bundles the AutoLabels Essential tier. We
//        auto-provision it once and skip the paywall entirely so
//        Autocurb-sourced users get a seamless one-link sign-in.
//      → Otherwise show <ActivatePaywall /> for standalone signup
//        or upgrade.
//
//   4. Entitlement ok.
//      → render children.
// ──────────────────────────────────────────────────────────────

interface Props {
  app: AppSlug;
  children: ReactNode;
}

const EntitlementGate = ({ app, children }: Props) => {
  const navigate = useNavigate();
  const { user, isAdmin, loading: authLoading } = useAuth();
  const { loading, tenant, hasApp, needsOnboarding, entitlementFor, activateApp, reload } =
    useEntitlements();

  const [pulling, setPulling] = useState(false);
  const [activating, setActivating] = useState(false);
  const pulledRef = useRef(false);
  const activatedRef = useRef(false);

  // Cold pull from Autocurb when the user has no local tenant.
  // Admins skip this entirely — they are platform operators, not
  // dealership members. The pull is bounded by a 5s timeout so a
  // missing edge function never blocks the gate, but a merely-slow
  // Autocurb response still lands (the old 2s cap turned a slow-but-
  // successful pull into a spurious bounce to NoTenantScreen). reload()
  // is bounded by a second 5s timeout so a hung Supabase query can't
  // freeze the gate forever.
  useEffect(() => {
    if (authLoading || loading || !user || isAdmin) return;
    if (tenant) return;
    if (pulledRef.current) return;
    pulledRef.current = true;
    let cancelled = false;
    const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
      ]);
    (async () => {
      setPulling(true);
      try {
        const result = await withTimeout(
          supabase.functions.invoke("autocurb-pull", { body: { app_slug: app } }),
          5000,
          { data: null, error: new Error("autocurb-pull timeout") } as unknown as Awaited<
            ReturnType<typeof supabase.functions.invoke>
          >,
        );
        if (cancelled) return;
        if (!(result as { error?: unknown }).error) {
          await withTimeout(reload(), 5000, undefined);
        }
      } catch {
        // best-effort — fall through to NoTenantScreen
      } finally {
        if (!cancelled) setPulling(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, loading, user, tenant, app, reload, isAdmin]);

  // Standalone watchdog: if pulling stays true for more than 12s for
  // any reason (hung supabase client, network stall, previous effect
  // didn't fire setPulling(false) before deps changed), unconditionally
  // clear it. Must exceed the pull (5s) + reload (5s) budget so it only
  // fires as a true stall guard, never cutting a slow-but-live pull short.
  // Depends ONLY on `pulling` so it survives re-renders driven by
  // identity changes in reload/tenant etc.
  useEffect(() => {
    if (!pulling) return;
    const cap = setTimeout(() => setPulling(false), 12000);
    return () => clearTimeout(cap);
  }, [pulling]);

  // Auto-provision the bundled AutoLabels essential tier when the
  // tenant is Autocurb-sourced and no entitlement exists yet.
  useEffect(() => {
    if (!tenant || hasApp(app) || activatedRef.current) return;
    const isAutocurbSourced =
      tenant.source === "autocurb" || hasApp("autocurb");
    if (!isAutocurbSourced) return;
    activatedRef.current = true;
    (async () => {
      setActivating(true);
      await activateApp(app, "essential");
      setActivating(false);
    })();
  }, [tenant, app, hasApp, activateApp]);

  if (authLoading || loading || pulling || activating) {
    return <GateSpinner label={
      activating ? "Activating your AutoLabels bundle…" :
      pulling    ? "Checking your Autocurb profile…" :
                   "Checking your subscription…"
    } />;
  }

  if (!user) {
    setTimeout(() => navigate("/login"), 0);
    return null;
  }

  // Platform admins see everything without needing a tenant or
  // entitlement. They're managing the whole fleet, not a dealership.
  if (isAdmin) {
    return <>{children}</>;
  }

  // Invite-only: users without a tenant are NOT auto-routed into an
  // onboarding wizard. They see the "not linked to a dealership" page
  // with a request-access CTA. Admins provision tenants from /admin.
  if (needsOnboarding || !tenant) {
    return <NoTenantScreen />;
  }

  if (!hasApp(app)) {
    return <ActivatePaywall app={app} tenant={tenant} entitlement={entitlementFor(app)} />;
  }

  return <>{children}</>;
};

const GateSpinner = ({ label }: { label: string }) => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const stalled = elapsed >= 5;
  const long = elapsed >= 10;
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="text-center space-y-3 max-w-sm">
        <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {!stalled && (
          <p className="text-[11px] text-muted-foreground">This usually takes under a second.</p>
        )}
        {stalled && !long && (
          <p className="text-[11px] text-amber-700">
            Taking a moment longer than usual. Hang tight — we're asking the server twice.
          </p>
        )}
        {long && (
          <div className="text-[11px] text-muted-foreground space-y-2">
            <p className="text-red-600 font-semibold">Still loading after 10 seconds.</p>
            <p>
              If this keeps happening, check your connection or try a hard refresh
              (Ctrl+Shift+R / Cmd+Shift+R). You can also sign out and back in.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-xs font-semibold"
            >
              Reload now
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default EntitlementGate;
