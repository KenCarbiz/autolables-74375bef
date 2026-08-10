// ──────────────────────────────────────────────────────────────────────
// VehiclePassportNext — the next-version passport, served at /v-next/:slug.
//
// DRAFT. The live customer passport at /v/:slug is untouched and stays that way
// until this is signed off. This page exists so the new design can be reviewed
// against REAL vehicle data instead of a fixture — a layout that has only ever
// been seen with placeholder numbers has not actually been reviewed.
//
// It shares the live passport's fetch (usePublicListing), its truth model
// (derivePassport / buildPassportSaleCard / deriveVerificationReport) and its
// navigation (buildPassportActionPath). Only the presentation is new.
// ──────────────────────────────────────────────────────────────────────

import { useMemo } from "react";
import { useNavigate, useParams, useSearchParams, useLocation } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { usePublicListing } from "@/hooks/usePublicListing";
import { usePublishedWindowSticker } from "@/hooks/usePublishedWindowSticker";
import { derivePassport } from "@/lib/passportV2Data";
import { listingGallery } from "@/lib/photos";
import { packetVisible } from "@/lib/packetModules";
import { buildPassportActionPath } from "@/lib/passportReturn";
import { buildPassportSaleCard } from "@/lib/passport/saleCard";
import { deriveVerificationReport } from "@/lib/passport/verificationSummary";
import { buildNextPassportData, buildNextPassportDealer } from "@/lib/passport/nextPassportData";
import { trackCustomerEngagement, trackCustomerCtaClicked } from "@/lib/engagement/customerEngagement";
import PassportNextLayout from "@/components/passport/next/PassportNextLayout";
import { MOCK_LISTING, MOCK_NEW_2026, MOCK_SPARSE, MOCK_NEW_MSRP, MOCK_USED_FEE } from "./VehiclePassportV3";
import { MOCK_REVIEW_LISTING } from "./VehiclePassportVerification";
import type { VehicleListing } from "@/hooks/useVehicleListing";

/** The five conversion intents the layout emits, mapped to the surfaces the
 *  live passport already routes to. A CTA that opens nothing is worse than no
 *  CTA, so anything unmapped falls through to Contact rather than dying. */
const INTENT_SECTION: Record<string, string> = {
  test_drive: "test-drive",
  vehicle_hold: "reserve",
  payment: "todays-price",
  trade: "trade",
  contact: "contact",
};

function Loader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-7 h-7 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function Draft({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* This page must never be indexed or shared as the customer passport. */}
      <Helmet><meta name="robots" content="noindex, nofollow" /></Helmet>
      <div className="sticky top-0 z-50 bg-amber-500 text-white text-center py-1.5 px-3" style={{ fontSize: "11px" }}>
        <span className="font-bold uppercase tracking-wide">Draft</span>
        {" — next-version passport preview. The live passport is at /v/."}
      </div>
      {children}
    </>
  );
}

export default function VehiclePassportNext() {
  const { slug } = useParams<{ slug: string }>();
  const rawSlug = (slug || "").trim();
  const navigate = useNavigate();
  const location = useLocation();
  const [search] = useSearchParams();

  // Preview parity with the live passport: the same ?preview=1&scenario=
  // fixtures, so the two designs can be compared on identical input.
  const isPreview = search.get("preview") === "1" || search.has("showcase");
  const scenario = search.get("scenario");
  const previewData = (scenario === "review" ? MOCK_REVIEW_LISTING
    : scenario === "new2026" ? MOCK_NEW_2026
    : scenario === "sparse" ? MOCK_SPARSE
    : scenario === "newmsrp" ? MOCK_NEW_MSRP
    : scenario === "usedfee" ? MOCK_USED_FEE
    : MOCK_LISTING) as unknown as VehicleListing;

  const { listing, loading, notFound } = usePublicListing(rawSlug, { preview: isPreview, previewData });
  const { sticker } = usePublishedWindowSticker(listing?.slug || rawSlug, !isPreview);

  const built = useMemo(() => {
    if (!listing) return null;
    const d = derivePassport(listing);
    const report = deriveVerificationReport(d, listing);
    const saleCard = buildPassportSaleCard(d, String(listing.condition || ""));
    return {
      data: buildNextPassportData({
        d,
        listing: listing as never,
        report,
        saleCard,
        gallery: listingGallery(listing),
        windowSticker: sticker ? { previewImage: sticker.thumbnailUrl, url: sticker.pdfUrl } : null,
        isVisible: (id: string) => packetVisible(listing, id),
      }),
      dealer: buildNextPassportDealer(d, listing as never),
    };
  }, [listing, sticker]);

  if (loading) return <Draft><Loader /></Draft>;
  if (notFound || !listing || !built) {
    return (
      <Draft>
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6 text-center">
          <p className="text-sm text-gray-600">This vehicle is no longer available.</p>
        </div>
      </Draft>
    );
  }

  const go = (section: string) =>
    navigate(buildPassportActionPath(listing.slug || rawSlug, section, location.pathname, isPreview));

  return (
    <Draft>
      <PassportNextLayout
        data={built.data}
        dealer={built.dealer}
        onEvent={(name, payload) => {
          // Reuses the existing engagement pipeline. Tagged passport_version
          // "next" so draft traffic can never be mistaken for live passport
          // traffic in the numbers.
          void trackCustomerEngagement({
            tenantId: listing.tenant_id, storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin,
            source: "passport", surface: "vehicle_passport", eventType: "engagement_ping",
            metadata: { event: name, passport_version: "next", ...payload },
          });
        }}
        onAction={(intent) => {
          trackCustomerCtaClicked({
            storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin,
            source: "passport", surface: "vehicle_passport",
            metadata: { cta: intent, passport_version: "next" },
          });
          go(INTENT_SECTION[intent] || "contact");
        }}
      />
    </Draft>
  );
}
