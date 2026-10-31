import type { AdminFixture } from "@/lib/admin/dataSource";
import { fixture01 } from "./01";
import { FIXTURE_02 } from "./02";
import { FIXTURE_03, FIXTURE_04 } from "./people";
import { SCREEN_05 } from "./05";
import { SCREEN_06 } from "./06";
import { SCREEN_07 } from "./07";
import { FIXTURE_08 } from "./08";
import { FIXTURE_09 } from "./09";
import fixture10 from "./10";
import { FIXTURE_11 } from "./11";
import { FIXTURE_12 } from "./12";
import { FIXTURE_13 } from "./13";
import { PAYMENT_ESTIMATOR_FIXTURES } from "./paymentEstimator";

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
  "01": fixture01,
  "02": FIXTURE_02,
  "03": { tabId: "team", fixture: FIXTURE_03 },
  "04": { childPath: "/admin/people/:memberId", fixture: FIXTURE_04 },
  "05": SCREEN_05,
  "06": SCREEN_06,
  "07": SCREEN_07,
  "08": FIXTURE_08,
  "09": FIXTURE_09,
  "10": fixture10,
  "11": FIXTURE_11,
  "12": FIXTURE_12,
  "13": FIXTURE_13,
  ...PAYMENT_ESTIMATOR_FIXTURES,
};
