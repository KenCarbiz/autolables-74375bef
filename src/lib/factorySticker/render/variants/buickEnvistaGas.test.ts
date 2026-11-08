import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { ENVISTA_REFERENCE_VIN, envistaListing, envistaReferenceMatchData, envistaRenderData } from "../__fixtures__/envista";
import { BUICK_ENVISTA_GAS_ID } from "./buickEnvistaGas";

describeCatalogTemplate({
  title: "Buick Envista gasoline",
  templateId: BUICK_ENVISTA_GAS_ID,
  make: "Buick",
  model: "Envista",
  stressLabel: "synthetic record, no saved Buick row exists",
  stressMatches: true,
  listing: envistaListing,
  renderData: envistaRenderData,
  referenceMatch: envistaReferenceMatchData,
  referenceVin: ENVISTA_REFERENCE_VIN,
  referenceStrings: ["OCEAN BLUE METALLIC", "PEBBLE GRAY W/WHISPER", "CHAMPION BUICK", "BRIGHTON", "BUPYEONG", "29,500", "33,449", "1,795", "2,154", "KOREA: 53%", "CHINA: 20%", "297 GRAMS", "$250", "$1,650", "ECOTEC", "6-SPD", "SMALL STATION WAGONS"],
  referenceExpect: ["30", "28", "32", "3.3", "$250", "$1,650", "$29,500.00", "$33,449.00", "$1,795.00", "$2,154.00", "$795.00", "$299.00", "KOREA: 53%", "CHINA: 20%", "BUPYEONG GU, IN", "CHAMPION BUICK GMC INC", "ENGINE: ECOTEC 1.2L TURBO"],
  ownExpect: ["ENGINE: TEST 9.9L ENGINE", "TRANSMISSION: TEST GEARBOX"],
  supported: [
    { label: "other trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Sport Touring" } }) },
    { label: "all-wheel drive", patch: (d) => ({ ...d, mechanical: { engine: null, transmission: null, drivetrain: "AWD" } }) },
  ],
  unsupported: [
    { label: "hybrid powertrain", patch: (d) => ({ ...d, epa: { ...d.epa!, fuelType: "Hybrid" } }) },
    { label: "2025 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2025" } }) },
    { label: "other model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Encore GX" } }) },
    { label: "sedan body", patch: (d) => ({ ...d, bodyClass: "Sedan" }) },
  ],
});
