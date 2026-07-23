import { useState, useEffect, useCallback } from "react";

// ──────────────────────────────────────────────────────────────
// Tenant Integration Mode Detection
//
// The addon runs in two modes:
//
// 1. EMBEDDED — running inside HarteCash (or another parent app)
//    as an iframe. Parent app posts tenant data via window.postMessage
//    and we pull branding, preferences, logo, and user from there.
//
//    Detection: presence of `?platform=hartecash` URL param OR running
//    inside an iframe.
//
//    Protocol:
//      // Parent sends to child (after child is ready):
//      iframe.contentWindow.postMessage({
//        type: "tenant_sync",
//        payload: { tenant, stores, user, preferences }
//      }, "*");
//
//      // Child announces it's ready:
//      window.parent.postMessage({ type: "addon_ready" }, "*");
//
//      // Parent can update tenant live:
//      postMessage({ type: "tenant_update", payload: {...} }, "*");
//
// 2. STANDALONE — running on its own domain. Onboarding wizard
//    collects tenant info and stores it locally until a user signs up.
//
// ──────────────────────────────────────────────────────────────

export type IntegrationMode = "standalone" | "embedded" | "loading";

export interface ExternalTenantPayload {
  tenant: {
    id: string;
    name: string;
    slug: string;
    logo_url: string;
    primary_color: string;
    secondary_color: string;
    tagline?: string;
  };
  stores?: Array<{
    id: string;
    name: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    phone?: string;
    logo_url?: string;
    tagline?: string;
  }>;
  user?: {
    id: string;
    email: string;
    name?: string;
    role?: string;
  };
  preferences?: {
    language?: string;
    dark_mode?: boolean;
    feature_flags?: Record<string, boolean>;
  };
}

interface IntegrationState {
  mode: IntegrationMode;
  parentOrigin: string | null;
  externalTenant: ExternalTenantPayload | null;
  ready: boolean;
}

const STORAGE_KEY = "tenant_integration_mode";

export const useTenantIntegration = () => {
  const [state, setState] = useState<IntegrationState>({
    mode: "loading",
    parentOrigin: null,
    externalTenant: null,
    ready: false,
  });

  // Detect mode on mount
  useEffect(() => {
    const detect = () => {
      // Check URL param first
      const params = new URLSearchParams(window.location.search);
      const platformParam = params.get("platform");
      const tenantParam = params.get("tenant");

      // Check if running inside an iframe
      const inIframe = (() => {
        try {
          return window.self !== window.top;
        } catch {
          // Cross-origin iframe access throws; we're definitely embedded
          return true;
        }
      })();

      if (platformParam || tenantParam || inIframe) {
        // Embedded mode — wait for parent to send tenant data
        setState(prev => ({ ...prev, mode: "embedded" }));

        // Announce readiness to parent
        try {
          window.parent.postMessage(
            { type: "addon_ready", addon: "autolabels" },
            "*"
          );
        } catch {
          // No parent or cross-origin block — fall back to standalone
          setState(prev => ({ ...prev, mode: "standalone" }));
        }

        // Set a timeout fallback — if parent doesn't respond in 2s, fall back
        setTimeout(() => {
          setState(prev => {
            if (prev.mode === "embedded" && !prev.externalTenant) {
              return { ...prev, mode: "standalone" };
            }
            return prev;
          });
        }, 2000);
      } else {
        // Standalone mode
        setState(prev => ({ ...prev, mode: "standalone" }));
      }
    };

    detect();
  }, []);

  // Listen for postMessage from parent — only while genuinely embedded, and
  // only from an allowlisted parent origin. Without this, any page that opens
  // or embeds the app could inject fake tenant/user branding.
  useEffect(() => {
    if (state.mode !== "embedded") return;

    const ALLOWED_ORIGINS = new Set<string>([
      "https://hartecash.com",
      "https://www.hartecash.com",
      "https://app.hartecash.com",
      "https://autocurb.io",
      "https://www.autocurb.io",
      "https://app.autocurb.io",
    ]);

    const handleMessage = (event: MessageEvent) => {
      if (!ALLOWED_ORIGINS.has(event.origin)) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "tenant_sync" || data.type === "tenant_update") {
        const payload = data.payload as ExternalTenantPayload;
        if (!payload?.tenant) return;

        setState(prev => ({
          ...prev,
          mode: "embedded",
          parentOrigin: event.origin,
          externalTenant: payload,
          ready: true,
        }));

        localStorage.setItem(STORAGE_KEY, "embedded");
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [state.mode]);


  // Send message back to parent
  const sendToParent = useCallback((type: string, payload?: unknown) => {
    if (state.mode !== "embedded") return;
    try {
      window.parent.postMessage({ type, payload }, state.parentOrigin || "*");
    } catch {
      // ignore cross-origin errors
    }
  }, [state.mode, state.parentOrigin]);

  // Mark onboarding complete (standalone only)
  const completeOnboarding = useCallback(() => {
    localStorage.setItem("onboarding_complete", "true");
    setState(prev => ({ ...prev, ready: true }));
  }, []);

  // For standalone mode, check if onboarding is done
  const isOnboardingComplete = (() => {
    if (state.mode === "embedded") return true;
    return localStorage.getItem("onboarding_complete") === "true";
  })();

  return {
    mode: state.mode,
    parentOrigin: state.parentOrigin,
    externalTenant: state.externalTenant,
    ready: state.ready,
    isOnboardingComplete,
    sendToParent,
    completeOnboarding,
  };
};
