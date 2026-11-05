import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { ASTON_REFERENCE_VIN, astonListing, astonReferenceMatchData, astonRenderData } from "../__fixtures__/aston";
import { ASTON_MARTIN_VANTAGE_ROADSTER_GAS_ID } from "./astonMartinVantageRoadsterGas";

describeCatalogTemplate({
  title: "Aston Martin Vantage Roadster gasoline",
  templateId: ASTON_MARTIN_VANTAGE_ROADSTER_GAS_ID,
  make: "Aston Martin",
  model: "Vantage",
  stressLabel: "2022 Toyota 4Runner SR5 record (other make)",
  listing: astonListing,
  renderData: astonRenderData,
  referenceMatch: astonReferenceMatchData,
  referenceVin: ASTON_REFERENCE_VIN,
  referenceStrings: ["LUNAR WHITE", "GAYDON", "205,900", "221,525", "4,925", "UK: 66%", "498 GRAMS", "$8,500", "OXFORD TAN", "BATTERY MAINTAINER", "AML UMBRELLA", "SCFSMGGW0TG", "KERBECK", "656HP"],
  referenceExpect: ["18", "15", "22", "5.6", "$8,500", "$3,450", "$205,900.00", "$221,525.00", "$3,500.00", "$445.00", "UK: 66%", "LUNAR WHITE", "3 years unlimited mileage warranty"],
  referenceGap: 7200,
  ownExpect: [],
  supported: [
    { label: "other trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Roadster Auto" } }) },
    { label: "no drivetrain", patch: (d) => ({ ...d, mechanical: { engine: null, transmission: null, drivetrain: null } }) },
  ],
  unsupported: [
    { label: "coupe body", patch: (d) => ({ ...d, bodyClass: "Coupe" }) },
    { label: "plug-in powertrain", patch: (d) => ({ ...d, epa: { ...d.epa!, fuelType: "Plug-in Hybrid" } }) },
    { label: "2025 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2025" } }) },
    { label: "other model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "DB12" } }) },
    { label: "SUV body", patch: (d) => ({ ...d, bodyClass: "SUV" }) },
  ],
});
