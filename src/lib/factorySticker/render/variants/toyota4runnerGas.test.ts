import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { TOYOTA_4RUNNER_REFERENCE_VIN, toyota4runnerListing, toyota4runnerReferenceMatchData, toyota4runnerRenderData } from "../__fixtures__/toyota4runner";
import { TOYOTA_4RUNNER_GAS_ID } from "./toyota4runnerGas";

describeCatalogTemplate({
  title: "Toyota 4Runner gasoline",
  templateId: TOYOTA_4RUNNER_GAS_ID,
  make: "Toyota",
  model: "4Runner",
  stressLabel: "2022 4Runner SR5 record",
  listing: toyota4runnerListing,
  renderData: toyota4runnerRenderData,
  referenceMatch: toyota4runnerReferenceMatchData,
  referenceVin: TOYOTA_4RUNNER_REFERENCE_VIN,
  referenceStrings: ["SUPERSONIC RED", "TAHARA", "44,270", "45,628", "47,223", "1,595", "MECHANICSVILLE", "45074", "$3,250", "$2,350", "417 GRAMS", "$1,358"],
  referenceExpect: ["21", "19", "25", "4.8", "$3,250", "$2,350", "$44,270.00", "$45,628.00", "$1,595.00", "$47,223.00", "$345.00", "SUPERSONIC RED (FA10)", "TAHARA, AICHI, JAPAN"],
  ownExpect: [],
  supported: [
    { label: "other trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "TRD Off-Road" } }) },
    { label: "no drivetrain", patch: (d) => ({ ...d, mechanical: { engine: null, transmission: null, drivetrain: null } }) },
  ],
  unsupported: [
    { label: "4Runner Hybrid model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "4Runner Hybrid" } }) },
    { label: "hybrid-only TRD Pro trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "TRD Pro" } }) },
    { label: "hybrid-only Trailhunter trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Trailhunter" } }) },
    { label: "hybrid-only Platinum trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Platinum" } }) },
    { label: "i-FORCE MAX hybrid trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Limited i-FORCE MAX" } }) },
    { label: "hybrid powertrain on the 4Runner model", patch: (d) => ({ ...d, epa: { ...d.epa!, fuelType: "Hybrid" } }) },
    { label: "hybrid decode with a gasoline EPA fuel name", patch: (d) => ({ ...d, neovin: { ratingMetadata: [], madeIn: null, hybridDecode: true } }) },
    { label: "2025 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2025" } }) },
    { label: "other model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Land Cruiser" } }) },
    { label: "pickup body", patch: (d) => ({ ...d, bodyClass: "Pickup" }) },
  ],
});
