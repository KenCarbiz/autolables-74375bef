import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useAudit } from "@/contexts/AuditContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useGetReady } from "@/hooks/useGetReady";
import { useWorkEvents, type WorkEventInput } from "@/hooks/useWorkEvents";
import PrepMobileFlow, { type PrepVehicle } from "@/components/prep/PrepMobileFlow";
import { supabase } from "@/integrations/supabase/client";
import { listingHero } from "@/lib/photos";

interface ListingLite {
  id: string;
  ymm: string | null;
  trim: string | null;
  photos: unknown;
  hero_image_url: string | null;
  sticker_snapshot: { products_snapshot?: Array<{ name: string; badge_type: string }> } | null;
}

// QR-launched mobile prep flow. The sticker QR points at /prep/<VIN>; staff
// and vendors sign in as tenant members, confirm the vehicle, and record a
// locked work event in under a minute.
const PrepMobile = () => {
  const { vin: vinParam } = useParams<{ vin: string }>();
  const [searchParams] = useSearchParams();
  const vin = (vinParam || searchParams.get("vin") || "").trim().toUpperCase();
  const { user } = useAuth();
  const { currentStore, tenant } = useTenant();
  const { settings } = useDealerSettings();
  const { log } = useAudit();
  const navigate = useNavigate();

  const storeId = currentStore?.id || "";
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;

  const { events, available, createEvent, correctionTargets } = useWorkEvents(tenantId, vin);
  const { records: getReadyRecords } = useGetReady(storeId);
  const getReady = useMemo(() => getReadyRecords.find((r) => r.vin.toUpperCase() === vin) || null, [getReadyRecords, vin]);

  const [listing, setListing] = useState<ListingLite | null>(null);
  const [resolving, setResolving] = useState(true);

  useEffect(() => {
    if (!user) navigate("/login");
  }, [user, navigate]);

  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      if (!vin) { setResolving(false); return; }
      setResolving(true);
      try {
        const { data } = await (supabase as any)
          .from("vehicle_listings")
          .select("id, ymm, trim, photos, hero_image_url, sticker_snapshot")
          .eq("vin", vin)
          .order("updated_at", { ascending: false })
          .limit(1);
        if (!cancelled) setListing((data?.[0] as ListingLite) || null);
      } catch {
        if (!cancelled) setListing(null);
      }
      if (!cancelled) setResolving(false);
    };
    resolve();
    return () => { cancelled = true; };
  }, [vin]);

  const vehicle: PrepVehicle = useMemo(() => ({
    found: !!(listing || getReady),
    ymm: [listing?.ymm || getReady?.ymm || "", listing?.trim || ""].filter(Boolean).join(" "),
    stockNumber: getReady?.stockNumber || "",
    photoUrl: listing ? listingHero(listing) : "",
    listingId: listing?.id || null,
  }), [listing, getReady]);

  const requiredProducts = useMemo(() => {
    if (getReady?.accessoriesToInstall?.length) {
      return getReady.accessoriesToInstall.map((a) => ({ name: a.productName }));
    }
    const snapshot = listing?.sticker_snapshot?.products_snapshot || [];
    return snapshot.filter((p) => p.badge_type === "installed").map((p) => ({ name: p.name }));
  }, [getReady, listing]);

  const servicePhotoTasks = useMemo(
    () => (settings.prep_service_photo_tasks || "").split(",").map((s) => s.trim()).filter(Boolean),
    [settings.prep_service_photo_tasks]
  );

  // Manager approval satisfies the existing prep_sign_offs listing gate so
  // publish unlocks from the same tap. Best-effort: a missing table or RLS
  // denial never blocks the work-event record itself.
  const unlockListingGate = useCallback(async (managerName: string, signatureData: string) => {
    if (!storeId) return;
    const now = new Date().toISOString();
    try {
      const { data } = await (supabase as any)
        .from("prep_sign_offs")
        .select("id, listing_unlocked")
        .eq("store_id", storeId)
        .eq("vin", vin)
        .order("updated_at", { ascending: false })
        .limit(1);
      const row = data?.[0];
      if (row) {
        if (!row.listing_unlocked) {
          await (supabase as any)
            .from("prep_sign_offs")
            .update({
              status: "signed",
              listing_unlocked: true,
              foreman_name: managerName,
              foreman_signature_data: signatureData,
              signed_at: now,
            })
            .eq("id", row.id);
        }
      } else {
        await (supabase as any).from("prep_sign_offs").insert({
          store_id: storeId,
          vin,
          ymm: vehicle.ymm || null,
          stock_number: vehicle.stockNumber || null,
          get_ready_record_id: getReady?.id || null,
          accessories_installed: [],
          install_photos: [],
          foreman_name: managerName,
          foreman_signature_data: signatureData,
          signed_at: now,
          status: "signed",
          listing_unlocked: true,
          notes: "Approved via mobile prep flow (manager final review)",
          created_by: user?.id || null,
        });
      }
    } catch { /* gate table unavailable; the work event still stands */ }
  }, [storeId, vin, vehicle.ymm, vehicle.stockNumber, getReady?.id, user?.id]);

  const handleSubmit = useCallback(async (input: WorkEventInput) => {
    const result = await createEvent(input);
    if (result.event) {
      log({
        action: input.event_type === "manager_review" ? "prep_vehicle_approved" : "work_event_submitted",
        entity_type: "vehicle_work_event",
        entity_id: result.event.id,
        store_id: storeId,
        user_id: user?.id || "",
        details: { vin, event_type: input.event_type, signer: input.signer_name },
      });
      if (input.event_type === "manager_review" && (input.status || "submitted") === "approved") {
        await unlockListingGate(input.signer_name, input.signature_data);
      }
    }
    return result;
  }, [createEvent, log, storeId, user?.id, vin, unlockListingGate]);

  if (!vin) return <Navigate to="/prep" replace />;

  if (resolving) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-muted-foreground">Looking up vehicle…</p>
        </div>
      </div>
    );
  }

  return (
    <PrepMobileFlow
      vin={vin}
      vehicle={vehicle}
      events={events}
      correctionTargets={correctionTargets}
      available={available}
      requiredProducts={requiredProducts}
      requireRo={settings.prep_require_ro}
      detailPhotosRequired={settings.prep_detail_photos_required}
      servicePhotoTasks={servicePhotoTasks}
      uploadOpts={{ tenantId, storeId, vin }}
      defaultName={user?.email?.split("@")[0] ?? ""}
      managerView
      onSubmitEvent={handleSubmit}
      onExit={() => navigate("/prep")}
    />
  );
};

export default PrepMobile;
