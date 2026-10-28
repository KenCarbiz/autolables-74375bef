import { lazy, type ReactElement, createElement } from "react";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";

// Child detail routes under /admin, registered by the section streams. The
// element is lazy so the Administration bundle stays split per screen.

export interface AdminChildRoute {
  path: string;
  element: ReactElement;
}

const lazyElement = (loader: () => Promise<{ default: React.ComponentType }>): ReactElement => createElement(lazy(loader));

export const ADMIN_CHILD_ROUTE_ELEMENTS: AdminChildRoute[] = [
  { path: "/admin/people/:memberId", element: lazyElement(() => import("./children/MemberRolePage")) },
  { path: ADMIN_CHILD_ROUTES.escalation, element: lazyElement(() => import("./children/EscalationPage")) },
];

export { lazyElement };
