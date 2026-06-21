import { lazy, Suspense, useLayoutEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
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

// Layout routes — AppShell mounts ONCE when entering the gated
// section and stays mounted across navigation between gated
// routes. Only the <Outlet /> body swaps, so the sidebar,
// topbar, store selector, breadcrumb, and command palette never
// remount. Lazy-loaded child chunks are caught by a local
// Suspense so the loader appears in the body, not full-screen.
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

// Lazy-loaded pages — each becomes its own chunk
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
const PlatformAdmin = lazy(() => import("./pages/PlatformAdmin"));
const Inventory = lazy(() => import("./pages/Inventory"));
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
const VehiclePortal = lazy(() => import("./pages/VehiclePortal"));
const UsedCarSticker = lazy(() => import("./pages/UsedCarSticker"));
const StickerStudio = lazy(() => import("./pages/StickerStudio"));
const StickerStudioGenerator = lazy(() => import("./pages/StickerStudioGenerator"));
const StickerStudioCustomize = lazy(() => import("./pages/StickerStudioCustomize"));
const StickerPrint = lazy(() => import("./pages/StickerPrint"));
const StickerTestLabel = lazy(() => import("./pages/StickerTestLabel"));
const DevHeroPreview = lazy(() => import("./pages/DevHeroPreview"));
const QrRedirect = lazy(() => import("./pages/QrRedirect"));
const QrAnalytics = lazy(() => import("./pages/QrAnalytics"));
const Reports = lazy(() => import("./pages/Reports"));
const DocumentReview = lazy(() => import("./pages/DocumentReview"));
const Setup = lazy(() => import("./pages/Setup"));
const NewCarSticker = lazy(() => import("./pages/NewCarSticker"));
const CpoSheet = lazy(() => import("./pages/CpoSheet"));
const DescriptionWriter = lazy(() => import("./pages/DescriptionWriter"));
const SaveCarInventory = lazy(() => import("./pages/SaveCarInventory"));
const DealSigning = lazy(() => import("./pages/DealSigning"));
const PublicListing = lazy(() => import("./pages/PublicListing"));
const PrepSignOff = lazy(() => import("./pages/PrepSignOff"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

// Full-screen loader — used only on the very first chunk load
// before any layout has mounted.
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <p className="text-xs text-muted-foreground">Loading...</p>
    </div>
  </div>
);

// Body-only loader — lands inside AppShell's main slot so the
// chrome stays visible while the next page's chunk streams in.
const BodyLoader = () => (
  <div className="flex items-center justify-center py-24">
    <div className="flex flex-col items-center gap-3">
      <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <p className="text-xs text-muted-foreground">Loading...</p>
    </div>
  </div>
);

// Snap to the top of the page on every route change. The app scrolls the
// <main> element (id="app-scroll"), not the window, so reset both — and use a
// layout effect so the new page never paints mid-scroll.
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
    {/* MotionConfig: Wave 2 motion ladder. All framer-motion
        components inherit the out-expo easing + 320ms duration.
        reducedMotion="user" honors prefers-reduced-motion so
        accessibility users get instant state changes. */}
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
                      {/* Public routes — no shell */}
                      <Route path="/" element={<Landing />} />
                      <Route path="/waitlist" element={<Waitlist />} />
                      <Route path="/privacy" element={<Privacy />} />
                      <Route path="/terms" element={<Terms />} />
                      <Route path="/login" element={<Login />} />
                      {/* Two interchangeable customer signing experiences on
                          the same token: /sign = full single-page document
                          (default), /review = guided step-by-step wizard. Each
                          links to the other so the customer can sign either way. */}
                      <Route path="/sign/:token" element={<MobileSigning />} />
                      <Route path="/review/:token" element={<CustomerReview />} />
                      <Route path="/install/:token" element={<InstallerProof />} />
                      {/* Buyer recovery path: VIN + contact -> email a fresh signing link */}
                      <Route path="/lookup" element={<SigningLookup />} />
                      <Route path="/onboarding" element={<Onboarding />} />
                      <Route path="/scan" element={<ScanPage />} />
                      <Route path="/vehicle/:vin" element={<VehiclePortal />} />
                      <Route path="/v/:slug" element={<PublicListing />} />
                      <Route path="/deal/:token" element={<DealSigning />} />
                      <Route path="/about" element={<About />} />
                      <Route path="/trust" element={<Trust />} />
                      <Route path="/brand" element={<BrandGuide />} />
                      {/* Chrome-free print surface — opened in a new tab by the
                          Sticker Studio generator for vector print-to-PDF. */}
                      <Route path="/print/sticker/:templateId" element={<StickerPrint />} />
                      <Route path="/print/test-label" element={<StickerTestLabel />} />
                      <Route path="/q/:token" element={<QrRedirect />} />

                      {/* Gated layout — one AppShell shared across every
                          dealer route. Only <Outlet /> swaps on navigation,
                          so the sidebar, topbar, store selector, and command
                          palette stay mounted and visually still. */}
                      <Route element={<GatedLayout />}>
                        <Route path="/addendum" element={<Index />} />
                        {/* /dashboard and /inventory both land on the
                            inventory-first view so the sidebar Dashboard
                            link and the Inventory link converge. */}
                        {/* Wave 18 — /dashboard is the post-login
                            Process Dashboard: live counts for the
                            5-stage flow + compliance defense tiles +
                            recent signings. /inventory still renders
                            the inventory list directly. */}
                        <Route path="/dashboard" element={<ProcessDashboard />} />
                        <Route path="/dashboard/qr-analytics" element={<QrAnalytics />} />
                        <Route path="/dashboard/reports" element={<Reports />} />
                        <Route path="/dashboard/document-review" element={<DocumentReview />} />
                        <Route path="/setup" element={<Setup />} />
                        {/* Wave 21 — Lot Capture Queue: the
                            polished V2 surface for FlowTile #1.
                            /scan still opens the mobile scanner
                            directly; /queue is the triage view. */}
                        <Route path="/queue" element={<LotCaptureQueue />} />
                        <Route path="/inventory" element={<Inventory />} />
                        <Route path="/dashboard-legacy" element={<Navigate to="/dashboard" replace />} />
                        <Route path="/vehicle-file/:id" element={<VehicleFile />} />
                        {/* /admin hosts dealer settings (products, rules,
                            branding, leads, queue, files, audit). Tenant
                            members reach their own settings here. */}
                        <Route path="/admin" element={<Admin />} />
                        <Route path="/saved" element={<SavedAddendums />} />
                        <Route path="/signed" element={<SavedAddendums stage="signed" />} />
                        <Route path="/delivered" element={<SavedAddendums stage="delivered" />} />
                        <Route path="/signatures" element={<SignatureQueue /> } />
                        <Route path="/buyers-guide" element={<BuyersGuide />} />
                        <Route path="/trade-up" element={<TradeUpSticker />} />
                        <Route path="/used-car-sticker" element={<UsedCarSticker />} />
                        <Route path="/sticker-studio" element={<StickerStudio />} />
                        <Route path="/sticker-studio/customize/:templateId" element={<StickerStudioCustomize />} />
                        <Route path="/sticker-studio/:templateId" element={<StickerStudioGenerator />} />
                        <Route path="/new-car-sticker" element={<NewCarSticker />} />
                        <Route path="/cpo-sheet" element={<CpoSheet />} />
                        <Route path="/compliance" element={<ComplianceCenter />} />
                        <Route path="/description-writer" element={<DescriptionWriter />} />
                        <Route path="/add-inventory" element={<SaveCarInventory />} />
                        <Route path="/prep" element={<PrepSignOff />} />
                      </Route>

                      {/* Platform-admin layout — gated on isAdmin role, not
                          on an app entitlement. Same shared-AppShell pattern. */}
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
