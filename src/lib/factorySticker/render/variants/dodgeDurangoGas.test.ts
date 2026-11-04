import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { DURANGO_REFERENCE_VIN, durangoListing, durangoReferenceMatchData, durangoRenderData } from "../__fixtures__/durango";
import { DODGE_DURANGO_GAS_ID } from "./dodgeDurangoGas";

describeCatalogTemplate({
  title: "Dodge Durango gasoline",
  templateId: DODGE_DURANGO_GAS_ID,
  make: "Dodge",
  model: "Durango",
  stressLabel: "2008 Grand Caravan record",
  listing: durangoListing,
  renderData: durangoRenderData,
  referenceMatch: durangoReferenceMatchData,
  referenceVin: DURANGO_REFERENCE_VIN,
  referenceStrings: ["WHITE KNUCKLE", "DETROIT", "38,995", "43,930", "1,995", "2,245", "MEXICO: 21%", "73%", "434 GRAMS", "$4,000", "$2,500", "BLACKTOP", "PENTASTAR", "850RE", "FCA US", "STANDARD SUV 2WD"],
  referenceExpect: ["20", "18", "25", "5.0", "$4,000", "$2,500", "$38,995.00", "$43,930.00", "$1,995.00", "$2,245.00", "$695.00", "73%", "MEXICO: 21%", "DETROIT, MICHIGAN, U.S.A.", "WHITE KNUCKLE CLEAR-COAT EXTERIOR PAINT"],
  ownExpect: ["TEST 9.9L ENGINE", "TEST GEARBOX"],
  supported: [
    { label: "SRT Hellcat is still gasoline", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "SRT Hellcat" } }) },
    { label: "all-wheel drive", patch: (d) => ({ ...d, mechanical: { engine: null, transmission: null, drivetrain: "AWD" } }) },
  ],
  unsupported: [
    { label: "plug-in powertrain", patch: (d) => ({ ...d, epa: { ...d.epa!, fuelType: "Plug-in Hybrid" } }) },
    { label: "2025 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2025" } }) },
    { label: "other model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Hornet" } }) },
    { label: "minivan body", patch: (d) => ({ ...d, bodyClass: "Minivan" }) },
  ],
});
