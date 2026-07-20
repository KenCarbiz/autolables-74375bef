import { ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { consumeSessionExpired } from "@/lib/auth/sessionExpiry";
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
  const { user, isAdmin, loading: authLoading, signOut } = useAuth();
  const { loading, tenant, hasApp, needsOnboarding, entitlementFor, activateApp, reload } =
    useEntitlements();

  const [pulling, setPulling] = useState(false);
  const [activating, setActivating] = useState(false);
  const [deadlineReached, setDeadlineReached] = useState(false);
  const pulledRef = useRef(false);
  const activatedRef = useRef(false);

  // Whether we're still resolving access (auth, entitlement load, the
  // Autocurb pull, or the bundle auto-provision).
  const stillResolving = authLoading || loading || pulling || activating;

  // Absolute escape hatch: if resolving hasn't finished within 14s (past
  // the pull 5s + reload 5s + watchdog 12s budget), stop spinning and show
  // a clear Retry / Sign-out screen instead of an endless loader. Resets
  // the moment resolving completes.
  useEffect(() => {
    if (!stillResolving) {
      setDeadlineReached(false);
      return;
    }
    const t = setTimeout(() => setDeadlineReached(true), 14000);
    return () => clearTimeout(t);
  }, [stillResolving]);

  const handleRetry = () => {
    pulledRef.current = false;
    setDeadlineReached(false);
    setPulling(false);
    void reload();
  };
  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      navigate("/login");
    }
  };

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

  if (stillResolving) {
    if (deadlineReached) {
      return <AccessUnconfirmed onRetry={handleRetry} onSignOut={handleSignOut} />;
    }
    return <GateSpinner label={
      activating ? "Activating your AutoLabels bundle…" :
      pulling    ? "Checking your Autocurb profile…" :
                   "Checking your subscription…"
    } />;
  }

  if (!user) {
    // A lapsed (vs never-signed-in) session surfaces the "session expired" banner.
    const expired = consumeSessionExpired() ? "?expired=1" : "";
    setTimeout(() => navigate(`/login${expired}`), 0);
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

// Terminal escape when access can't be confirmed in time. Never leave the
// user on an endless spinner — give them an explicit Retry and a Sign-out.
const AccessUnconfirmed = ({
  onRetry,
  onSignOut,
}: {
  onRetry: () => void;
  onSignOut: () => void;
}) => (
  <div className="min-h-screen flex items-center justify-center bg-background px-6">
    <div className="text-center space-y-4 max-w-sm">
      <h1 className="text-xl font-bold text-foreground">We couldn't confirm your access</h1>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Your sign-in worked, but we couldn't verify your account in time. This is usually a
        slow connection or a session that needs refreshing — not a problem with your account.
      </p>
      <div className="flex flex-col gap-2 pt-1">
        <button
          onClick={onRetry}
          className="h-11 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90"
        >
          Try again
        </button>
        <button
          onClick={() => window.location.reload()}
          className="h-11 rounded-xl border border-border text-foreground text-sm font-semibold hover:bg-muted"
        >
          Hard refresh
        </button>
        <button
          onClick={onSignOut}
          className="h-9 text-xs text-muted-foreground hover:text-foreground"
        >
          Sign out and back in
        </button>
      </div>
    </div>
  </div>
);

export default EntitlementGate;
