import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { SILVERADO_REFERENCE_VIN, silveradoListing, silveradoReferenceMatchData, silveradoRenderData } from "../__fixtures__/silverado2500";
import { CHEVROLET_SILVERADO_2500_DIESEL_ID } from "./chevroletSilverado2500Diesel";

const gasoline = (d: Parameters<typeof describeCatalogTemplate>[0]["supported"][number]["patch"] extends (x: infer T) => unknown ? T : never) =>
  ({ ...d, epa: null, neovin: { ratingMetadata: [], madeIn: null, fuelType: "Unleaded" } });

describeCatalogTemplate({
  title: "Chevrolet Silverado 2500 diesel",
  templateId: CHEVROLET_SILVERADO_2500_DIESEL_ID,
  make: "Chevrolet",
  model: "Silverado 2500",
  stressLabel: "2023 Tahoe record",
  carb: { safetyPanel: true },
  listing: silveradoListing,
  renderData: silveradoRenderData,
  referenceMatch: silveradoReferenceMatchData,
  referenceVin: SILVERADO_REFERENCE_VIN,
  referenceStrings: ["POLAR WHITE","JET BLACK / UMBER","COVERT CHEVROLET","BASTROP","FLINT","73,600","92,954","16,559","2,795","DURAMAX","ALLISON"],
  referenceExpect: ["$73,600.00", "$92,954.00", "$2,795.00", "POLAR WHITE TRICOAT", "COVERT CHEVROLET BUICK GMC"],
  ownExpect: ["TEST 9.9L ENGINE", "TEST GEARBOX"],
  supported: [
    { label: "other trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Zeta" } }) },
    { label: "two-wheel drive", patch: (d) => ({ ...d, mechanical: { engine: null, transmission: null, drivetrain: "2WD" } }) },
    { label: "diesel from the verified EPA match", patch: (d) => ({ ...d, neovin: undefined, epa: { ...(d.epa ?? { combined: null, city: null, highway: null }), fuelType: "Diesel" } as typeof d.epa }) },
  ],
  unsupported: [
    { label: "gasoline powertrain", patch: gasoline },
    { label: "no fuel evidence", patch: (d) => ({ ...d, epa: null, neovin: { ratingMetadata: [], madeIn: null } }) },
    { label: "2025 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2025" } }) },
    { label: "Silverado 1500", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Silverado 1500" } }) },
    { label: "Silverado 3500", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Silverado 3500" } }) },
    { label: "sedan body", patch: (d) => ({ ...d, bodyClass: "Sedan" }) },
  ],
});
