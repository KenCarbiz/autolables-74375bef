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
  { path: PRODUCT_APPLICABILITY_PATH, element: lazyElement(() => import("./children/ProductApplicabilityPage")) },
  { path: ADMIN_CHILD_ROUTES.customerPreview, element: lazyElement(() => import("./children/CustomerPreviewPage")) },
  { path: ADMIN_CHILD_ROUTES.printCalibration, element: lazyElement(() => import("./children/PrintCalibrationPage")) },
  { path: ADMIN_CHILD_ROUTES.escalation, element: lazyElement(() => import("./children/EscalationPage")) },
  { path: "/admin/integrations/runs/:runId", element: lazyElement(() => import("./children/SyncRunPage")) },
  { path: "/admin/integrations/providers/:providerId", element: lazyElement(() => import("./children/ProviderDetailPage")) },
  { path: "/admin/integrations/jobs/:jobId", element: lazyElement(() => import("./children/JobDetailPage")) },
  { path: "/admin/integrations/files-com", element: lazyElement(() => import("./children/FilesComFeedPage")) },
  { path: "/admin/integrations/inventory-network", element: lazyElement(() => import("./children/InventoryNetworkPage")) },
];

export { lazyElement };
