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
import ThemeInjector from "@/components/layout/ThemeInjector";
import ErrorBoundary from "@/components/layout/ErrorBoundary";
import EntitlementGate from "@/components/layout/EntitlementGate";
import AdminGate from "@/components/layout/AdminGate";

const GatedLayout = () => (
  <EntitlementGate app="autolabels">
    <AppShell>
      <Suspense fallback={<BodyLoader />}>
        <Outlet />
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
const SigningLookup = lazy(() => import("./pages/SigningLookup"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const TradeUpSticker = lazy(() => import("./pages/TradeUpSticker"));
const About = lazy(() => import("./pages/About"));
const Trust = lazy(() => import("./pages/Trust"));
const BrandGuide = lazy(() => import("./pages/BrandGuide"));
const ScanPage = lazy(() => import("./pages/ScanPage"));
const ComplianceCenter = lazy(() => import("./pages/ComplianceCenter"));
const ComplianceActionCenter = lazy(() => import("./pages/ComplianceActionCenter"));
const ComplianceInbox = lazy(() => import("./pages/ComplianceInbox"));
// Legacy per-VIN portal is retired — /vehicle/:vin redirects to the single
// canonical Passport at /v/:vin so there is only one shopper page.
const VehicleVinRedirect = () => {
  const { vin } = useParams<{ vin: string }>();
  return <Navigate to={`/v/${(vin || "").toUpperCase()}`} replace />;
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
const QrRedirect = lazy(() => import("./pages/QrRedirect"));
const QrAnalytics = lazy(() => import("./pages/QrAnalytics"));
const Reports = lazy(() => import("./pages/Reports"));
const DocumentReview = lazy(() => import("./pages/DocumentReview"));
const Setup = lazy(() => import("./pages/Setup"));
const NewCarSticker = lazy(() => import("./pages/NewCarSticker"));
const CpoSheet = lazy(() => import("./pages/CpoSheet"));
const DescriptionStudio = lazy(() => import("./pages/DescriptionStudio"));
const SaveCarInventory = lazy(() => import("./pages/SaveCarInventory"));
const DealSigning = lazy(() => import("./pages/DealSigning"));
const PublicListing = lazy(() => import("./pages/PublicListing"));
const VehiclePassportV2 = lazy(() => import("./pages/VehiclePassportV2"));
const VehiclePassportV2Detail = lazy(() => import("./pages/VehiclePassportV2Detail"));
const VehiclePassportV3 = lazy(() => import("./pages/VehiclePassportV3"));
const VehiclePassportVerification = lazy(() => import("./pages/VehiclePassportVerification"));
const VehiclePassportDocuments = lazy(() => import("./pages/VehiclePassportDocuments"));
const VehiclePassportGreatBuy = lazy(() => import("./pages/VehiclePassportGreatBuy"));
const PublicDocuments = lazy(() => import("./pages/PublicDocuments"));
const PrepSignOff = lazy(() => import("./pages/PrepSignOff"));
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
                      <Route path="/lookup" element={<SigningLookup />} />
                      <Route path="/onboarding" element={<Onboarding />} />
                      <Route path="/scan" element={<ScanPage />} />
                      <Route path="/vehicle/:vin" element={<VehicleVinRedirect />} />
                      <Route path="/v/:slug" element={<PublicListing />} />
                      <Route path="/passport-v2/:vehicleSlug" element={<VehiclePassportV2 />} />
                      <Route path="/passport-v2/:vehicleSlug/:section" element={<VehiclePassportV2Detail />} />
                      <Route path="/passport-v3/:vehicleSlug" element={<VehiclePassportV3 />} />
                      <Route path="/passport-v3/:vehicleSlug/verification" element={<VehiclePassportVerification />} />
                      <Route path="/passport-v3/:vehicleSlug/documents" element={<VehiclePassportDocuments />} />
                      <Route path="/passport-v3/:vehicleSlug/great-buy" element={<VehiclePassportGreatBuy />} />
                      <Route path="/passport-v3/:vehicleSlug/:section" element={<VehiclePassportV2Detail />} />
                      <Route path="/v/:slug/documents" element={<PublicDocuments />} />
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
                      <Route path="/q/:token" element={<QrRedirect />} />

                      <Route element={<GatedLayout />}>
                        <Route path="/addendum" element={<Index />} />
                        <Route path="/dashboard" element={<ProcessDashboard />} />
                        <Route path="/dashboard/qr-analytics" element={<QrAnalytics />} />
                        <Route path="/dashboard/reports" element={<Reports />} />
                        <Route path="/dashboard/document-review" element={<DocumentReview />} />
                        <Route path="/setup" element={<Setup />} />
                        <Route path="/queue" element={<LotCaptureQueue />} />
                        <Route path="/inventory" element={<Inventory />} />
                        <Route path="/inventory-v2" element={<InventoryCommandCenterV2 />} />
                        <Route path="/dashboard-legacy" element={<Navigate to="/dashboard" replace />} />
                        <Route path="/vehicle-file/:id" element={<VehicleFile />} />
                        <Route path="/admin" element={<Admin />} />
                        <Route path="/admin/smoke-test" element={<AdminSmokeTest />} />
                        <Route path="/admin/certification-history" element={<AdminCertificationHistory />} />
                        <Route path="/saved" element={<SavedAddendums />} />
                        <Route path="/signed" element={<SavedAddendums stage="signed" />} />
                        <Route path="/delivered" element={<SavedAddendums stage="delivered" />} />
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
                        <Route path="/compliance-inbox" element={<ComplianceInbox />} />
                        <Route path="/description-studio" element={<DescriptionStudio />} />
                        <Route path="/description-writer" element={<DescriptionStudio />} />
                        <Route path="/add-inventory" element={<SaveCarInventory />} />
                        <Route path="/prep" element={<PrepSignOff />} />
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
