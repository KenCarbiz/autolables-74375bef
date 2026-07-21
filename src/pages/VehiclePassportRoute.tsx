import { lazy, Suspense, useEffect, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { usePublicListing } from "@/hooks/usePublicListing";
import { trackCustomerEngagement } from "@/lib/engagement/customerEngagement";
import { clearPassportExperiment } from "@/lib/experiments/passportExperiment";

// ──────────────────────────────────────────────────────────────
// VehiclePassportRoute — /v/:slug renders the full passport for every vehicle.
//
// This is the complete, approved design (Customer Action Center, Verified
// Vehicle Data, Market Intelligence, module cards, Market Comparison, Vehicle
// Strengths, Fuel Economy, Why-Buy). The stripped-down earlier passport is no
// longer served. The A/B split and `governed_routing_enabled` flag are ignored
// so every vehicle gets the same complete experience.
//
// Rendering is IN-PLACE. No redirect, so query params + attribution
// (?src=qr, utm_*, etc.) are never stripped.
// ──────────────────────────────────────────────────────────────

const VehiclePassport = lazy(() => import("./VehiclePassportGoverned"));

function Loader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function VehiclePassportRoute() {
  const { slug } = useParams<{ slug: string }>();
  const [search] = useSearchParams();
  // Raw slug is passed to the fetch layer; VIN vs descriptive-slug
  // disambiguation happens server-side in public-listing-view.
  const rawSlug = (slug || "").trim();
  const preview = search.get("preview") === "1";
  const { listing } = usePublicListing(rawSlug, { preview });

  // Retire any stale A/B enrollment left in storage so it can no longer tag
  // downstream engagement events with a variant now that V3 always renders.
  useEffect(() => { clearPassportExperiment(); }, []);

  // Lightweight signal that V3 rendered for this vehicle. Reuses the existing
  // engagement pipeline (engagement_ping is already an allowed event type).
  const emittedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!listing) return;
    const l = listing as { id?: string; store_id?: string; tenant_id?: string; vin?: string | null };
    const key = l.id || "";
    if (emittedRef.current === key) return;
    emittedRef.current = key;
    void trackCustomerEngagement({
      tenantId: l.tenant_id || undefined,
      storeId: l.store_id || undefined,
      vehicleId: l.id || undefined,
      vin: l.vin || undefined,
      eventType: "engagement_ping",
      surface: "vehicle_passport",
      source: "passport",
      metadata: { rendered_route: "/v/:slug", rendered_experience: "v3" },
    });
  }, [listing]);

  return (
    <Suspense fallback={<Loader />}>
      <VehiclePassport />
    </Suspense>
  );
}
