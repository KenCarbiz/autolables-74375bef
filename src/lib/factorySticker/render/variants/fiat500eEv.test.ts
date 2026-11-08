import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { FIAT_REFERENCE_VIN, fiatListing, fiatReferenceMatchData, fiatRenderData } from "../__fixtures__/fiat";
import { FIAT_500E_EV_ID } from "./fiat500eEv";

type Data = Parameters<Parameters<typeof describeCatalogTemplate>[0]["referenceMatch"]>[0];
const withFuel = (fuelType: string) => (d: Data): Data =>
  ({ ...d, epa: { city: null, highway: null, combined: null, annualFuelCost: null, ghgScore: null, rangeMiles: null, ...(d.epa ?? {}), fuelType } });

describeCatalogTemplate({
  title: "Fiat 500e electric",
  templateId: FIAT_500E_EV_ID,
  make: "Fiat",
  model: "500e",
  stressLabel: "2024 Tesla Model Y record",
  stressOtherMake: true,
  ev: "ev",
  offYear: "2026",
  listing: fiatListing,
  renderData: fiatRenderData,
  referenceMatch: fiatReferenceMatchData,
  referenceVin: FIAT_REFERENCE_VIN,
  referenceStrings: ["GREEN METALLIC","ECO GREEN","GKN097","BALTIMORE","30,500","37,495","5,000","1,995","21G","ARMANI","HUNGARY","ITALY"],
  referenceExpect: ["$30,500.00", "$37,495.00", "$1,995.00", "GREEN METALLIC EXTERIOR PAINT", "149", "116", "$6,000", "$700"],
  ownExpect: ["TEST 9.9L ENGINE", "TEST GEARBOX"],
  supported: [
    { label: "other trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Zeta" } }) },
    { label: "electric from the verified EPA match", patch: withFuel("Electricity") },
  ],
  unsupported: [
    { label: "gasoline powertrain", patch: withFuel("Regular Gasoline") },
    { label: "plug-in hybrid", patch: withFuel("Regular Gas or Electricity") },
    { label: "no fuel evidence", patch: (d) => ({ ...d, epa: null, neovin: { ratingMetadata: [], madeIn: null } }) },
    { label: "2026 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2026" } }) },
    { label: "gasoline 500", patch: (d) => ({ ...d, identity: { ...d.identity, model: "500" } }) },
    { label: "500X", patch: (d) => ({ ...d, identity: { ...d.identity, model: "500X" } }) },
    { label: "sedan body", patch: (d) => ({ ...d, bodyClass: "Sedan" }) },
  ],
});
