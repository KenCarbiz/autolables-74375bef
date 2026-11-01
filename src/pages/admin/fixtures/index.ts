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
import { al97Fixture01 } from "./al97-01";
import { AL97_02, AL97_03, AL97_04, AL97_10, AL97_20, AL97_22, AL97_23 } from "./al97-batch2";
import { AL97_11, AL97_12, AL97_15, AL97_16, AL97_18, AL97_19 } from "./al97-batch4";
import { AL97_07, AL97_08, AL97_09, AL97_21, AL97_24 } from "./al97-batch3";
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
  "al97-01": al97Fixture01,
  "al97-02": AL97_02,
  "al97-03": AL97_03,
  "al97-23": AL97_23,
  "al97-04": AL97_04,
  "al97-22": AL97_22,
  "al97-07": AL97_07,
  "al97-21": AL97_21,
  "al97-08": AL97_08,
  "al97-24": AL97_24,
  "al97-09": AL97_09,
  "al97-10": AL97_10,
  "al97-11": AL97_11,
  "al97-19": AL97_19,
  "al97-12": AL97_12,
  "al97-15": AL97_15,
  "al97-16": AL97_16,
  "al97-18": AL97_18,
  "al97-20": AL97_20,
  ...PAYMENT_ESTIMATOR_FIXTURES,
};
