import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { SORENTO_REFERENCE_VIN, sorentoListing, sorentoReferenceMatchData, sorentoRenderData } from "../__fixtures__/sorento";
import { KIA_SORENTO_GAS_ID } from "./kiaSorentoGas";

describeCatalogTemplate({
  title: "Kia Sorento gasoline",
  templateId: KIA_SORENTO_GAS_ID,
  make: "Kia",
  model: "Sorento",
  stressLabel: "2024 Sorento S record",
  listing: sorentoListing,
  renderData: sorentoRenderData,
  referenceMatch: sorentoReferenceMatchData,
  referenceVin: SORENTO_REFERENCE_VIN,
  referenceStrings: ["GLACIAL", "GREENWAY", "ORLANDO", "FL083", "WEST POINT", "32,390", "34,615", "1,495", "KOREA: 30%", "55%", "339 GRAMS", "$1,000", "$1,900", "10 YEAR/100,000", "SMALL SUVS RANGE", "7AC3225"],
  referenceExpect: ["26", "23", "31", "3.8", "$1,000", "$1,900", "$32,390.00", "$33,120.00", "$1,495.00", "$34,615.00", "$495.00", "$235.00", "55%", "KOREA: 30%", "WEST POINT, GA, USA", "GREENWAY KIA WEST", "FL083"],
  ownExpect: [],
  supported: [
    { label: "front-wheel drive", patch: (d) => ({ ...d, mechanical: { engine: null, transmission: null, drivetrain: "FWD" } }) },
    { label: "all-wheel drive", patch: (d) => ({ ...d, mechanical: { engine: null, transmission: null, drivetrain: "AWD" } }) },
    { label: "other trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "SX Prestige" } }) },
  ],
  unsupported: [
    { label: "Sorento Hybrid model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Sorento Hybrid" } }) },
    { label: "Sorento Plug-In Hybrid model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Sorento Plug-In Hybrid" } }) },
    { label: "hybrid powertrain on the Sorento model", patch: (d) => ({ ...d, epa: { ...d.epa!, fuelType: "Hybrid" } }) },
    { label: "plug-in powertrain on the Sorento model", patch: (d) => ({ ...d, epa: { ...d.epa!, fuelType: "Plug-in Hybrid" } }) },
    { label: "2025 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2025" } }) },
    { label: "other model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Telluride" } }) },
    { label: "sedan body", patch: (d) => ({ ...d, bodyClass: "Sedan" }) },
  ],
});
