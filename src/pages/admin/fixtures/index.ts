import type { AdminFixture } from "@/lib/admin/dataSource";
import { FIXTURE_03, FIXTURE_04 } from "./people";

// Design fixtures for the parity harness. Each entry renders one reference
// screen with synthetic data under /admin/design-fixture/:screen, a route that
// exists only in development builds. Nothing here is production data and
// nothing here ships to a customer.

export interface AdminScreenFixture {
  /** Which child tab (or child route) the screen shows. */
  tabId?: string;
  childPath?: string;
  fixture: AdminFixture;
}

export const ADMIN_FIXTURES: Record<string, AdminScreenFixture> = {
  "03": { tabId: "team", fixture: FIXTURE_03 },
  "04": { childPath: "/admin/people/:memberId", fixture: FIXTURE_04 },
};
