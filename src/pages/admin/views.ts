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
  "effective-policy": lazy(() => import("./views/publishing/EffectivePolicyView")),
  approvals: lazy(() => import("./views/publishing/ApprovalsView")),
  "change-history": lazy(() => import("./views/publishing/ChangeHistoryView")),
};
