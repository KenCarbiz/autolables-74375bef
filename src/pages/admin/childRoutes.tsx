import { lazy, type ReactElement, createElement } from "react";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";

// Child detail routes under /admin, registered by the section streams. The
// element is lazy so the Administration bundle stays split per screen.

export interface AdminChildRoute {
  path: string;
  element: ReactElement;
}

const lazyElement = (loader: () => Promise<{ default: React.ComponentType }>): ReactElement => createElement(lazy(loader));

export const PRODUCT_APPLICABILITY_PATH = "/admin/products/:productId/applicability";

export const ADMIN_CHILD_ROUTE_ELEMENTS: AdminChildRoute[] = [
  { path: "/admin/people/:memberId", element: lazyElement(() => import("./children/MemberRolePage")) },
  { path: ADMIN_CHILD_ROUTES.feeReview, element: lazyElement(() => import("./children/FeeReviewPage")) },
  { path: ADMIN_CHILD_ROUTES.pricingIntegrity, element: lazyElement(() => import("./children/PricingIntegrityPage")) },
  { path: ADMIN_CHILD_ROUTES.vehicleFiles, element: lazyElement(() => import("./children/VehicleFilesPage")) },
  { path: ADMIN_CHILD_ROUTES.jobs, element: lazyElement(() => import("./children/JobsPipelinesPage")) },
  { path: ADMIN_CHILD_ROUTES.accessActivity, element: lazyElement(() => import("./children/AccessActivityPage")) },
  { path: ADMIN_CHILD_ROUTES.permissionVerification, element: lazyElement(() => import("./children/PermissionVerificationPage")) },
  { path: ADMIN_CHILD_ROUTES.contactRouting, element: lazyElement(() => import("./children/ContactRoutingPage")) },
  { path: ADMIN_CHILD_ROUTES.legacyAssignments, element: lazyElement(() => import("./children/LegacyAssignmentsPage")) },
  { path: ADMIN_CHILD_ROUTES.connections, element: lazyElement(() => import("./children/ConnectionsBillingPage")) },
  { path: ADMIN_CHILD_ROUTES.workerSetup, element: lazyElement(() => import("./children/WorkerSetupPage")) },
  { path: PRODUCT_APPLICABILITY_PATH, element: lazyElement(() => import("./children/ProductApplicabilityPage")) },
  { path: ADMIN_CHILD_ROUTES.customerPreview, element: lazyElement(() => import("./children/CustomerPreviewPage")) },
  { path: ADMIN_CHILD_ROUTES.printCalibration, element: lazyElement(() => import("./children/PrintCalibrationPage")) },
  { path: ADMIN_CHILD_ROUTES.paymentEstimator, element: lazyElement(() => import("./children/PaymentEstimatorAl97Page")) },
  { path: ADMIN_CHILD_ROUTES.storeIdentity, element: lazyElement(() => import("./children/StoreIdentityPage")) },
  { path: ADMIN_CHILD_ROUTES.paymentAssumptions, element: lazyElement(() => import("./children/PaymentAssumptionsPage")) },
  { path: ADMIN_CHILD_ROUTES.descriptionEngine, element: lazyElement(() => import("./children/DescriptionEnginePage")) },
  { path: ADMIN_CHILD_ROUTES.escalation, element: lazyElement(() => import("./children/EscalationPage")) },
  { path: "/admin/integrations/runs/:runId", element: lazyElement(() => import("./children/SyncRunPage")) },
  { path: "/admin/integrations/providers/:providerId", element: lazyElement(() => import("./children/ProviderDetailPage")) },
  { path: "/admin/integrations/jobs/:jobId", element: lazyElement(() => import("./children/JobDetailPage")) },
  { path: "/admin/integrations/files-com", element: lazyElement(() => import("./children/FilesComFeedPage")) },
  { path: "/admin/integrations/inventory-network", element: lazyElement(() => import("./children/InventoryNetworkPage")) },
];

export { lazyElement };
