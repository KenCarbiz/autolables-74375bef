import { lazy, Suspense, useLayoutEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { DealerSettingsProvider } from "@/contexts/DealerSettingsContext";
import { TenantProvider } from "@/contexts/TenantContext";
import { AuditProvider } from "@/contexts/AuditContext";
import AppShell from "@/components/layout/AppShell";
import RouteCapabilityGuard from "@/components/layout/RouteCapabilityGuard";
import ThemeInjector from "@/components/layout/ThemeInjector";
import ErrorBoundary from "@/components/layout/ErrorBoundary";
import EntitlementGate from "@/components/layout/EntitlementGate";
import AdminGate from "@/components/layout/AdminGate";

const GatedLayout = () => (
  <EntitlementGate app="autolabels">
    <AppShell>
      <Suspense fallback={<BodyLoader />}>
        <RouteCapabilityGuard>
          <Outlet />
        </RouteCapabilityGuard>
      </Suspense>
    </AppShell>
  </EntitlementGate>
);

const AdminLayout = () => (
  <AdminGate>
    <AppShell>
      <Suspense fallback={<BodyLoader />}>
        <Outlet />
      </Suspense>
    </AppShell>
  </AdminGate>
);

const Dashboard = lazy(() => import("./pages/Dashboard"));
const ProcessDashboard = lazy(() => import("./pages/ProcessDashboard"));
const LotCaptureQueue = lazy(() => import("./pages/LotCaptureQueue"));
const Index = lazy(() => import("./pages/Index"));
const Landing = lazy(() => import("./pages/Landing"));
const Waitlist = lazy(() => import("./pages/Waitlist"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));
const Login = lazy(() => import("./pages/Login"));
const Admin = lazy(() => import("./pages/Admin"));
const AdminSmokeTest = lazy(() => import("./pages/AdminSmokeTest"));
const AddendumIconLibrary = lazy(() => import("./pages/AddendumIconLibrary"));
const AddendumLabelPrint = lazy(() => import("./pages/AddendumLabelPrint"));
const AdminCertificationHistory = lazy(() => import("./pages/AdminCertificationHistory"));
const PlatformAdmin = lazy(() => import("./pages/PlatformAdmin"));
const Inventory = lazy(() => import("./pages/Inventory"));
const InventoryCommandCenterV2 = lazy(() => import("./pages/InventoryCommandCenterV2"));
const VehicleFile = lazy(() => import("./pages/VehicleFile"));
const SavedAddendums = lazy(() => import("./pages/SavedAddendums"));
const SignatureQueue = lazy(() => import("./pages/SignatureQueue"));
const BuyersGuide = lazy(() => import("./pages/BuyersGuide"));
const MobileSigning = lazy(() => import("./pages/MobileSigning"));
const CustomerReview = lazy(() => import("./pages/CustomerReview"));
const InstallerProof = lazy(() => import("./pages/InstallerProof"));
const ServiceSignoff = lazy(() => import("./pages/ServiceSignoff"));
const TitleUpload = lazy(() => import("./pages/TitleUpload"));
const GetReady = lazy(() => import("./pages/GetReady"));
const ReconApproval = lazy(() => import("./pages/ReconApproval"));
const ServiceDesk = lazy(() => import("./pages/ServiceDesk"));
const ReadyBoard = lazy(() => import("./pages/ReadyBoard"));
const K208Document = lazy(() => import("./pages/K208Document"));
const CreateHub = lazy(() => import("./pages/CreateHub"));
const SigningLookup = lazy(() => import("./pages/SigningLookup"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const TradeUpSticker = lazy(() => import("./pages/TradeUpSticker"));
const About = lazy(() => import("./pages/About"));
const Trust = lazy(() => import("./pages/Trust"));
const BrandGuide = lazy(() => import("./pages/BrandGuide"));
const ScanPage = lazy(() => import("./pages/ScanPage"));
const ComplianceCenter = lazy(() => import("./pages/ComplianceCenter"));
const ComplianceActionCenter = lazy(() => import("./pages/ComplianceActionCenter"));
// Legacy per-VIN portal is retired — /vehicle/:vin redirects to the single
// canonical Passport at /v/:vin so there is only one shopper page.
const VehicleVinRedirect = () => {
  const { vin } = useParams<{ vin: string }>();
  return <Navigate to={`/v/${(vin || "").toUpperCase()}`} replace />;
};
// The Passport V3 experience is now served at the canonical /v/:slug. Old
// /passport-v2 and /passport-v3 root links redirect there so there is one
// shopper page; the search string is preserved to keep the ?preview flag.
const PassportRootRedirect = () => {
  const { vehicleSlug } = useParams<{ vehicleSlug: string }>();
  const { search } = useLocation();
  return <Navigate to={`/v/${vehicleSlug || ""}${search}`} replace />;
};
const PassportSectionRedirect = () => {
  const { vehicleSlug, section } = useParams<{ vehicleSlug: string; section: string }>();
  const { search } = useLocation();
  return <Navigate to={`/v/${vehicleSlug || ""}/${section || ""}${search}`} replace />;
};
const UsedCarSticker = lazy(() => import("./pages/UsedCarSticker"));
const UsedVehicleDocuments = lazy(() => import("./pages/UsedVehicleDocuments"));
const UsedVehicleDocumentsPrint = lazy(() => import("./pages/UsedVehicleDocumentsPrint"));
const StickerStudio = lazy(() => import("./pages/StickerStudio"));
const StickerStudioGenerator = lazy(() => import("./pages/StickerStudioGenerator"));
const StickerStudioCustomize = lazy(() => import("./pages/StickerStudioCustomize"));
const StickerPrint = lazy(() => import("./pages/StickerPrint"));
const StickerTestLabel = lazy(() => import("./pages/StickerTestLabel"));
const DevHeroPreview = lazy(() => import("./pages/DevHeroPreview"));
const DevSaturdayPreview = lazy(() => import("./pages/DevSaturdayPreview"));
const DevConnecticutSmokeTest = lazy(() => import("./pages/DevConnecticutSmokeTest"));
const DevPrepMobilePreview = lazy(() => import("./pages/DevPrepMobilePreview"));
const QrRedirect = lazy(() => import("./pages/QrRedirect"));
const QrAnalytics = lazy(() => import("./pages/QrAnalytics"));
const Reports = lazy(() => import("./pages/Reports"));
const Leads = lazy(() => import("./pages/Leads"));
const Titles = lazy(() => import("./pages/Titles"));
const DocumentReview = lazy(() => import("./pages/DocumentReview"));
const NewCarSticker = lazy(() => import("./pages/NewCarSticker"));
const CpoSheet = lazy(() => import("./pages/CpoSheet"));
const DescriptionStudio = lazy(() => import("./pages/DescriptionStudio"));
const SaveCarInventory = lazy(() => import("./pages/SaveCarInventory"));
const DealSigning = lazy(() => import("./pages/DealSigning"));
const PublicListing = lazy(() => import("./pages/PublicListing"));
const VehiclePassportV2Detail = lazy(() => import("./pages/VehiclePassportV2Detail"));
const VehiclePassportV3 = lazy(() => import("./pages/VehiclePassportV3"));
const VehiclePassportVerification = lazy(() => import("./pages/VehiclePassportVerification"));
const VehiclePassportDocuments = lazy(() => import("./pages/VehiclePassportDocuments"));
const VehiclePassportGreatBuy = lazy(() => import("./pages/VehiclePassportGreatBuy"));
const VehiclePassportHistory = lazy(() => import("./pages/VehiclePassportHistory"));
const VehiclePassportDealer = lazy(() => import("./pages/VehiclePassportDealer"));
const PublicDocuments = lazy(() => import("./pages/PublicDocuments"));
const PrepSignOff = lazy(() => import("./pages/PrepSignOff"));
const PrepMobile = lazy(() => import("./pages/PrepMobile"));
const ReconBoard = lazy(() => import("./pages/ReconBoard"));
const ServiceInspection = lazy(() => import("./pages/ServiceInspection"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <p className="text-xs text-muted-foreground">Loading...</p>
    </div>
  </div>
);

const BodyLoader = () => (
  <div className="flex items-center justify-center py-24">
    <div className="flex flex-col items-center gap-3">
      <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <p className="text-xs text-muted-foreground">Loading...</p>
    </div>
  </div>
);

const ScrollToTop = () => {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    document.getElementById("app-scroll")?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

const App = () => (
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <MotionConfig
      reducedMotion="user"
      transition={{
        duration: 0.32,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <TenantProvider>
          <DealerSettingsProvider>
            <AuditProvider>
              <BrowserRouter>
                <ThemeInjector />
                <ScrollToTop />
                <Suspense fallback={<PageLoader />}>
                  <Routes>
                      <Route path="/" element={<Landing />} />
                      <Route path="/waitlist" element={<Waitlist />} />
                      <Route path="/privacy" element={<Privacy />} />
                      <Route path="/terms" element={<Terms />} />
                      <Route path="/login" element={<Login />} />
                      <Route path="/sign/:token" element={<MobileSigning />} />
                      <Route path="/review/:token" element={<CustomerReview />} />
                      <Route path="/install/:token" element={<InstallerProof />} />
                      <Route path="/inspect/:token" element={<ServiceSignoff />} />
                      <Route path="/title/:token" element={<TitleUpload />} />
                      <Route path="/ready/:token" element={<GetReady />} />
                      <Route path="/approve/:token" element={<ReconApproval />} />
                      <Route path="/lookup" element={<SigningLookup />} />
                      <Route path="/onboarding" element={<Onboarding />} />
                      <Route path="/scan" element={<ScanPage />} />
                      <Route path="/vehicle/:vin" element={<VehicleVinRedirect />} />
                      {/* Canonical V3 Passport experience, all under /v/:slug */}
                      <Route path="/v/:slug" element={<VehiclePassportV3 />} />
                      <Route path="/v/:slug/verification" element={<VehiclePassportVerification />} />
                      <Route path="/v/:slug/documents" element={<VehiclePassportDocuments />} />
                      <Route path="/v/:slug/great-buy" element={<VehiclePassportGreatBuy />} />
                      <Route path="/v/:slug/vehicle-history" element={<VehiclePassportHistory />} />
                      <Route path="/v/:slug/dealer" element={<VehiclePassportDealer />} />
                      <Route path="/v/:slug/:section" element={<VehiclePassportV2Detail />} />
                      {/* Classic page kept for rollback/comparison */}
                      <Route path="/v-classic/:slug" element={<PublicListing />} />
                      <Route path="/v-classic/:slug/documents" element={<PublicDocuments />} />
                      {/* Legacy passport URLs fold into the canonical /v/ tree */}
                      <Route path="/passport-v2/:vehicleSlug" element={<PassportRootRedirect />} />
                      <Route path="/passport-v2/:vehicleSlug/:section" element={<PassportSectionRedirect />} />
                      <Route path="/passport-v3/:vehicleSlug" element={<PassportRootRedirect />} />
                      <Route path="/passport-v3/:vehicleSlug/:section" element={<PassportSectionRedirect />} />
                      <Route path="/deal/:token" element={<DealSigning />} />
                      <Route path="/about" element={<About />} />
                      <Route path="/trust" element={<Trust />} />
                      <Route path="/brand" element={<BrandGuide />} />
                      <Route path="/print/sticker/:templateId" element={<StickerPrint />} />
                      <Route path="/print/test-label" element={<StickerTestLabel />} />
                      <Route path="/print/used-vehicle-documents" element={<UsedVehicleDocumentsPrint />} />
                      <Route path="/dev/hero-preview" element={<DevHeroPreview />} />
                      <Route path="/dev/saturday-preview" element={<DevSaturdayPreview />} />
                      <Route path="/dev/connecticut-smoke-test" element={<DevConnecticutSmokeTest />} />
                      <Route path="/dev/prep-mobile-preview" element={<DevPrepMobilePreview />} />
                      <Route path="/q/:token" element={<QrRedirect />} />

                      <Route element={<GatedLayout />}>
                        <Route path="/addendum" element={<Index />} />
                        <Route path="/create" element={<CreateHub />} />
                        <Route path="/dashboard" element={<ProcessDashboard />} />
                        <Route path="/dashboard/qr-analytics" element={<QrAnalytics />} />
                        <Route path="/dashboard/reports" element={<Reports />} />
                        <Route path="/dashboard/document-review" element={<DocumentReview />} />
                        {/* Setup folded into Admin Home; the route stays so old links don't 404. */}
                        <Route path="/setup" element={<Navigate to="/admin?tab=home" replace />} />
                        <Route path="/queue" element={<LotCaptureQueue />} />
                        <Route path="/leads" element={<Leads />} />
                        <Route path="/titles" element={<Titles />} />
                        <Route path="/inventory" element={<Inventory />} />
                        <Route path="/inventory-v2" element={<InventoryCommandCenterV2 />} />
                        <Route path="/dashboard-legacy" element={<Navigate to="/dashboard" replace />} />
                        <Route path="/vehicle-file/:id" element={<VehicleFile />} />
                        <Route path="/admin" element={<Admin />} />
                        <Route path="/admin/smoke-test" element={<AdminSmokeTest />} />
                        <Route path="/admin/design-system/addendum-icons" element={<AddendumIconLibrary />} />
                        <Route path="/addendum-label/:id" element={<AddendumLabelPrint />} />
                        <Route path="/admin/certification-history" element={<AdminCertificationHistory />} />
                        <Route path="/admin/inventory-sync" element={<InventorySyncCenter />} />
                        <Route path="/saved" element={<SavedAddendums />} />
                        <Route path="/signed" element={<SavedAddendums stage="signed" />} />
                        <Route path="/delivered" element={<SavedAddendums stage="delivered" />} />
                        <Route path="/returns" element={<SavedAddendums stage="returns" />} />
                        <Route path="/signatures" element={<SignatureQueue /> } />
                        <Route path="/buyers-guide" element={<BuyersGuide />} />
                        <Route path="/used-vehicle-documents" element={<UsedVehicleDocuments />} />
                        <Route path="/trade-up" element={<TradeUpSticker />} />
                        <Route path="/used-car-sticker" element={<UsedCarSticker />} />
                        <Route path="/sticker-studio" element={<StickerStudio />} />
                        <Route path="/sticker-studio/customize/:templateId" element={<StickerStudioCustomize />} />
                        <Route path="/sticker-studio/:templateId" element={<StickerStudioGenerator />} />
                        <Route path="/new-car-sticker" element={<NewCarSticker />} />
                        <Route path="/cpo-sheet" element={<CpoSheet />} />
                        <Route path="/compliance" element={<ComplianceCenter />} />
                        <Route path="/compliance-center" element={<ComplianceActionCenter />} />
                        <Route path="/description-studio" element={<DescriptionStudio />} />
                        <Route path="/description-writer" element={<DescriptionStudio />} />
                        <Route path="/add-inventory" element={<SaveCarInventory />} />
                        <Route path="/prep" element={<PrepSignOff />} />
                        <Route path="/prep/:vin" element={<PrepMobile />} />
                        <Route path="/recon" element={<ReconBoard />} />
                        <Route path="/service" element={<ServiceDesk />} />
                        <Route path="/ready-board" element={<ReadyBoard />} />
                        <Route path="/k208/:vin" element={<K208Document />} />
                        <Route path="/service-inspection" element={<ServiceInspection />} />
                        <Route path="/service-inspection/:qrToken" element={<ServiceInspection />} />
                      </Route>

                      <Route element={<AdminLayout />}>
                        <Route path="/platform-admin" element={<PlatformAdmin />} />
                      </Route>

                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
              </BrowserRouter>
            </AuditProvider>
          </DealerSettingsProvider>
        </TenantProvider>
      </AuthProvider>
    </TooltipProvider>
    </MotionConfig>
  </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
