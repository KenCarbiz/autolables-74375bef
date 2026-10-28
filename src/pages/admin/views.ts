import { lazy, type ComponentType, type LazyExoticComponent } from "react";

// V2 views keyed by child-tab id. A tab without an entry renders its legacy
// body (sections.ts `legacyTab`) or, for a brand-new tab, the assembling
// notice. Each section stream registers its views here.

export const ADMIN_VIEWS: Readonly<Record<string, LazyExoticComponent<ComponentType<Record<string, never>>>>> = {
  overview: lazy(() => import("./views/OverviewView")),
  team: lazy(() => import("./views/people/TeamView")),
  roles: lazy(() => import("./views/people/RolesView")),
  invitations: lazy(() => import("./views/people/InvitationsView")),
  "access-activity": lazy(() => import("./views/people/AccessActivityView")),
  "price-rules": lazy(() => import("./views/pricing/PriceRulesView")),
  products: lazy(() => import("./views/pricing/ProductsView")),
  applicability: lazy(() => import("./views/pricing/ApplicabilityView")),
  benefits: lazy(() => import("./views/pricing/BenefitsView")),
  "warranty-programs": lazy(() => import("./views/pricing/WarrantyProgramsView")),
  "incentive-programs": lazy(() => import("./views/pricing/IncentivesView")),
  "passport-modules": lazy(() => import("./views/customer/PassportModulesView")),
  routing: lazy(() => import("./views/customer/RoutingView")),
  "calls-to-action": lazy(() => import("./views/customer/CallsToActionView")),
  "customer-previews": lazy(() => import("./views/customer/CustomerPreviewsView")),
  "effective-policy": lazy(() => import("./views/publishing/EffectivePolicyView")),
  "inventory-feed": lazy(() => import("./views/integrations/InventoryFeedView")),
  providers: lazy(() => import("./views/integrations/ProvidersView")),
  "data-quality": lazy(() => import("./views/integrations/DataQualityView")),
  jobs: lazy(() => import("./views/integrations/JobsView")),
  activity: lazy(() => import("./views/integrations/ActivityView")),
  approvals: lazy(() => import("./views/publishing/ApprovalsView")),
  "change-history": lazy(() => import("./views/publishing/ChangeHistoryView")),
  templates: lazy(() => import("./views/documents/TemplatesView")),
  "approval-rules": lazy(() => import("./views/documents/ApprovalRulesView")),
  "print-calibration": lazy(() => import("./views/documents/PrintCalibrationView")),
  "service-policy": lazy(() => import("./views/documents/ServicePolicyView")),
};
