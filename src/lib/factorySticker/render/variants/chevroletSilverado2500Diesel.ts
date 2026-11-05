// 17x11 reproduction layout for the 2026 Chevrolet Silverado 2500 (diesel),
// translated from "Chevrolet_2026_Silverado_2500_High_Country" (Figma file
// 6lFZHEOempaeguzjr0sSOb, master 1:824). It shares the GM heavy-duty pickup
// layout (gmTruckCommon.ts) with the GMC Sierra and the Buick label family
// (gmCommon.ts); only the logo, contact line and logo geometry differ.

import { buildGmTruckLayout } from "./gmTruckCommon.ts";

export const CHEVROLET_SILVERADO_2500_DIESEL_ID = "chevrolet_2026_silverado_2500_high_country";

export const buildChevroletSilverado2500DieselLayout = buildGmTruckLayout({
  logo: "chevrolet", logoX: 78, logoW: 405, site: "www.chevy.com", siteX: 1121,
});
