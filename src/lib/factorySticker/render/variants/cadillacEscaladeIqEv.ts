// 17x11 reproduction layout for the 2026 Cadillac Escalade IQL (electric),
// translated from "Cadillac_2026_Escalade_IQL_Premium_Sport" (Figma file
// yd9IzgDohOuwez6hPc60WK, master 1:824). It shares the General Motors layout
// (gmTruckCommon.ts): standard equipment in four columns, the option and
// totals stack in the fifth and sixth, and the California Air Resources Board
// panel with its electric-vehicle tag. The Cadillac crest and wordmark artwork
// is not packaged, so a neutral wordmark prints in its place
// (missing_source_artwork).

import { buildGmTruckLayout } from "./gmTruckCommon.ts";

export const CADILLAC_ESCALADE_IQL_EV_ID = "cadillac_2026_escalade_iql_premium_sport";

export const buildCadillacEscaladeIqEvLayout = buildGmTruckLayout({
  logo: null, wordmark: "Cadillac", logoX: 78, logoW: 405, site: "www.cadillac.com", siteX: 1121,
});
