// 17x11 reproduction layout for the 2026 GMC Sierra 3500 (diesel), translated
// from "GMC_2026_Sierra_3500_Denali_Ultimate" (Figma file 1KkxbDPYNy2r10UcZTBPlB,
// master 1:824). It shares the GM heavy-duty pickup layout (gmTruckCommon.ts)
// with the Chevrolet Silverado; only the logo, contact line and logo geometry
// differ.

import { buildGmTruckLayout } from "./gmTruckCommon.ts";

export const GMC_SIERRA_3500_DIESEL_ID = "gmc_2026_sierra_3500_denali_ultimate";

export const buildGmcSierra3500DieselLayout = buildGmTruckLayout({
  logo: "gmc", logoX: 55, logoW: 295, site: "www.gmc.com", siteX: 1121,
});
