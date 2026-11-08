import type { AdminScreenFixture } from "./index";
import { WAVE_E_FIXTURES } from "./WaveEFixtures";

// Screen 01, Administration Overview. The parity harness id now renders the Wave E overview data.
export const fixture01: AdminScreenFixture = {
  tabId: "overview",
  fixture: { ...WAVE_E_FIXTURES["v3-overview"].fixture, label: "01 Admin Overview" },
};
