import { lazy, Suspense } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { usePublicListing } from "@/hooks/usePublicListing";
import { trackCustomerEngagement, getEngagementVisitorId } from "@/lib/engagement/customerEngagement";
import { enrollPassportVariant, clearPassportExperiment } from "@/lib/experiments/passportExperiment";
import { useEffect, useMemo, useRef } from "react";

// ──────────────────────────────────────────────────────────────
// VehiclePassportRoute — thin selection wrapper for /v/:slug.
//
// Default behavior is BYTE-FOR-BYTE UNCHANGED from Build #1: the
// existing VehiclePassportV3 renders. Only when the tenant flips
// `governed_routing_enabled === true` in dealer_profiles.settings
// does this wrapper consult `effective_passport_version` (resolved
// server-side in public-listing-view via the shared resolver) to
// decide between the existing passport and the new governed one.
//
// The emergency kill switch always wins because the resolver forces
// `effective = 'current'` before this wrapper ever sees the payload.
//
// Rendering is IN-PLACE. No redirect between /v and /v3, so query
// params + attribution (?src=qr, utm_*, etc.) never get stripped.
// ──────────────────────────────────────────────────────────────

const VehiclePassportV3 = lazy(() => import("./VehiclePassportV3"));
const VehiclePassportGoverned = lazy(() => import("./VehiclePassportGoverned"));

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

  const effective = (listing as { effective_passport_version?: string } | null)?.effective_passport_version;
  const reason = (listing as { passport_resolution_reason?: string } | null)?.passport_resolution_reason;
  const governedEnabled = (listing as { governed_routing_enabled?: boolean } | null)?.governed_routing_enabled === true;

  // Controlled experiment: when the resolver says this vehicle is in the A/B
  // ('experiment_assignment') and governed routing is enabled, split the visitor
  // deterministically between v3 and current. Enrollment is stamped on all
  // downstream events (ambiently, in trackCustomerEngagement) so conversions
  // attribute to the variant. Outside the experiment nothing is enrolled and the
  // clean per-vehicle/tenant resolution below applies.
  const inExperiment = reason === "experiment_assignment" && governedEnabled;
  const experiment = useMemo(
    () => (inExperiment ? enrollPassportVariant(getEngagementVisitorId()) : null),
    [inExperiment],
  );
  // Leaving the experiment (vehicle switched to a fixed version) clears the
  // stale enrollment so its variant no longer tags unrelated events.
  useEffect(() => {
    if (listing && !inExperiment) clearPassportExperiment();
  }, [listing, inExperiment]);

  // Route selection: default (flag absent or false) always renders the
  // existing passport, unchanged. Kill switch is already applied in the
  // resolver, so `effective === 'v3'` here always means "safe to switch".
  const renderGoverned = inExperiment
    ? experiment?.variant === "v3"
    : governedEnabled && effective === "v3";
  const chosen: "governed" | "existing" = renderGoverned ? "governed" : "existing";

  // Lightweight signal: which version actually rendered and why. Reuses
  // the existing engagement pipeline (engagement_ping is already in the
  // allowed event_type enum) — no new event system in this build.
  const emittedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!listing) return;
    const l = listing as { id?: string; store_id?: string; tenant_id?: string; vin?: string | null };
    const key = `${l.id || ""}:${chosen}`;
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
      metadata: {
        rendered_route: "/v/:slug",
        rendered_experience: chosen,
        // Under the experiment the actual rendered variant is the assigned arm,
        // not the tenant default the resolver returned.
        passport_version: inExperiment ? (experiment?.variant ?? "current") : (effective || "current"),
        passport_resolution_reason: reason || "safety_fallback",
        governed_routing_enabled: governedEnabled,
        ...(inExperiment && experiment ? { experiment_id: experiment.experimentId, experiment_variant: experiment.variant } : {}),
      },
    });
  }, [listing, chosen, effective, reason, governedEnabled]);

  return (
    <Suspense fallback={<Loader />}>
      {renderGoverned ? <VehiclePassportGoverned /> : <VehiclePassportV3 />}
    </Suspense>
  );
}
