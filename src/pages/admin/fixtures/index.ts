import type { AdminFixture } from "@/lib/admin/dataSource";

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

export const ADMIN_FIXTURES: Record<string, AdminScreenFixture> = {};
