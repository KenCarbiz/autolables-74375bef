import type { NormalizeNeovinInput } from "../normalizeNeovin";

const dealer = (): NormalizeNeovinInput["dealer"] => ({
  tenantId: "tn_01hfixture000000000000001",
  name: "Harte INFINITI",
  address: "1 Weston Park Ave",
  city: "Hartford",
  state: "CT",
  postalCode: "06103",
  phone: "860-555-0140",
  website: "https://www.harteinfiniti.com",
});

const doc = (documentId: string, slug: string): NormalizeNeovinInput["document"] => ({
  documentId,
  passportUrl: `https://autolabels.io/v/${slug}`,
  templateVersion: "1.0.0",
  rendererVersion: "1.0.0",
  dataVersion: "2026-07-01",
  generatedAt: "2026-07-21T12:00:00.000Z",
});

// Benchmark: base 89450 + options 4250 + destination 1995 = 95695 reported -> MATCHED.
export const infinitiLuxurySuv = (): NormalizeNeovinInput => ({
  listing: {
    id: "veh_qx80_0001",
    vin: "JN8AZ2NE8P9123456",
    ymm: "2026 INFINITI QX80",
    trim: "Autograph",
    condition: "new",
    features: ["Panoramic Moonroof", "Heated Front Seats"],
    warranty_info: {
      basic: "4 years / 60,000 miles",
      powertrain: "6 years / 70,000 miles",
      corrosion: "7 years / unlimited miles",
      roadside: "4 years / unlimited miles",
      source_verified: true,
    },
    mc_attributes: {
      specs_source: "neovin",
      vin: "JN8AZ2NE8P9123456",
      stock_no: "N26041",
      engine: "3.5L V6 Twin-Turbo",
      transmission: "9-Speed Automatic",
      drivetrain: "AWD",
      fuel_type: "Premium Unleaded",
      body_type: "SUV",
      exterior_color: "Moonbow Blue",
      interior_color: "Graphite Semi-Aniline Leather",
      city_mpg: 16,
      highway_mpg: 19,
      combined_mpg: 17,
      base_msrp: 89450,
      delivery_charges: 1995,
      total_msrp: 95695,
      options: [
        "ILLUMINATED KICK PLATES",
        "WELCOME LIGHTING",
        "ROOF RAIL CROSSBARS",
        "CARGO PACKAGE",
        "22-INCH DARK FORGED WHEELS",
      ],
      features: ["PROPILOT ASSIST 2.1", "WIRELESS CARPLAY"],
      build_sheet: {
        source: "neovin",
        generic: false,
        decoded_at: "2026-07-01T00:00:00.000Z",
        packages: [
          {
            name: "PREMIUM REAR SEAT PACKAGE",
            contents: ["MASSAGING FRONT SEATS", "REAR SEAT ENTERTAINMENT", "HEADREST PILLOWS"],
          },
        ],
        options: [
          { name: "ILLUMINATED KICK PLATES", msrp: 500 },
          { name: "WELCOME LIGHTING", msrp: 425 },
          { name: "ROOF RAIL CROSSBARS", msrp: 375 },
          { name: "CARGO PACKAGE", msrp: 450 },
          { name: "22-INCH DARK FORGED WHEELS", msrp: 2500 },
          { name: "MASSAGING FRONT SEATS" },
        ],
        key_features: {
          adas: ["PROPILOT ASSIST 2.1", "BLIND SPOT INTERVENTION"],
          infotainment: ["WIRELESS CARPLAY", "BOSE PERFORMANCE AUDIO -- 24 SPEAKERS"],
        },
        standard: {
          safety_features: ["FORWARD COLLISION WARNING", "LANE DEPARTURE WARNING", "10 AIRBAGS"],
          interior: ["SEMI-ANILINE LEATHER SEATS", "TRI-ZONE CLIMATE CONTROL"],
          exterior: ["LED HEADLIGHTS", "POWER PANORAMIC MOONROOF", "ROOF RAILS"],
          mechanical: ["ELECTRONIC AIR SUSPENSION", "TOW HITCH RECEIVER"],
        },
      },
    },
  },
  dealer: dealer(),
  document: doc("doc_qx80_0001", "demo-qx80"),
});

// Priced package + explicitly included package: 52000 + 2200 + 1495 = 55695 -> MATCHED.
export const packagePricingTruck = (): NormalizeNeovinInput => ({
  listing: {
    id: "veh_f150_0002",
    vin: "1FTFW1E58PFA10234",
    ymm: "2025 Ford F-150",
    trim: "Lariat",
    condition: "new",
    mc_attributes: {
      specs_source: "neovin",
      base_msrp: 52000,
      delivery_charges: 1495,
      total_msrp: 55695,
      options: ["TRAILER TOW PACKAGE"],
      build_sheet: {
        source: "neovin",
        generic: false,
        packages: [
          { name: "TRAILER TOW PACKAGE", msrp: 2200, contents: ["CLASS IV HITCH", "TRAILER BRAKE CONTROLLER"] },
          { name: "LARIAT EQUIPMENT GROUP 501A", included: true, contents: ["HEATED FRONT SEATS", "POWER TAILGATE"] },
        ],
        options: [],
        key_features: {},
        standard: { mechanical: ["3.5L ECOBOOST V6 ENGINE"] },
      },
    },
  },
  dealer: dealer(),
  document: doc("doc_f150_0002", "demo-f150"),
});

// One priced option, one unpriced (UNAVAILABLE): 41000 + 800 + 1395 = 43195 vs 43250 -> MINOR_VARIATION (55).
export const incompleteOptionPricing = (): NormalizeNeovinInput => ({
  listing: {
    id: "veh_ody_0003",
    vin: "5FNRL6H87PB012345",
    ymm: "2025 Honda Odyssey",
    trim: "Touring",
    condition: "new",
    mc_attributes: {
      specs_source: "neovin",
      base_msrp: 41000,
      delivery_charges: 1395,
      total_msrp: 43250,
      options: ["ROOF CROSSBARS", "ALL-SEASON FLOOR MATS"],
      build_sheet: {
        source: "neovin",
        generic: false,
        packages: [],
        options: [
          { name: "ROOF CROSSBARS", msrp: 800 },
          { name: "ALL-SEASON FLOOR MATS" },
        ],
        key_features: {},
        standard: { safety_features: ["HONDA SENSING SUITE"] },
      },
    },
  },
  dealer: dealer(),
  document: doc("doc_ody_0003", "demo-odyssey"),
});

// No EPA fields, no NHTSA data anywhere; feed-only equipment.
export const noEpaNhtsa = (): NormalizeNeovinInput => ({
  listing: {
    id: "veh_rav4_0004",
    vin: "2T3P1RFV8MW123456",
    ymm: "2021 Toyota RAV4",
    trim: "XLE",
    condition: "used",
    features: ["Power Liftgate", "Blind Spot Monitor", "Power Liftgate"],
    mc_attributes: {
      base_msrp: 29500,
      delivery_charges: 1175,
      total_msrp: 30675,
    },
  },
  dealer: dealer(),
  document: doc("doc_rav4_0004", "demo-rav4"),
});

// Material MSRP mismatch: 30000 + 500 + 1200 = 31700 vs 32750 -> diff -1050 -> REVIEW_REQUIRED.
export const materialMsrpMismatch = (): NormalizeNeovinInput => ({
  listing: {
    id: "veh_tahoe_0005",
    vin: "1GNSKCKD8PR123456",
    ymm: "2025 Chevrolet Tahoe",
    trim: "LT",
    condition: "new",
    mc_attributes: {
      specs_source: "neovin",
      base_msrp: 30000,
      delivery_charges: 1200,
      total_msrp: 32750,
      options: ["ASSIST STEPS"],
      build_sheet: {
        source: "neovin",
        generic: false,
        packages: [],
        options: [{ name: "ASSIST STEPS", msrp: 500 }],
        key_features: {},
        standard: {},
      },
    },
  },
  dealer: dealer(),
  document: doc("doc_tahoe_0005", "demo-tahoe"),
});

// No base MSRP -> INSUFFICIENT_DATA, no calculated total.
export const missingBaseMsrp = (): NormalizeNeovinInput => ({
  listing: {
    id: "veh_bmw_0006",
    vin: "WBA53AY08PFR12345",
    ymm: "2025 BMW 530i",
    condition: "new",
    mc_attributes: {
      specs_source: "neovin",
      delivery_charges: 1175,
      total_msrp: 62000,
      options: ["M SPORT PACKAGE"],
      build_sheet: {
        source: "neovin",
        generic: false,
        packages: [{ name: "M SPORT PACKAGE", msrp: 3300, contents: ["M SPORT BRAKES"] }],
        options: [],
        key_features: {},
        standard: {},
      },
    },
  },
  dealer: dealer(),
  document: doc("doc_bmw_0006", "demo-530i"),
});

// Destination missing and the reported total cannot be explained without it:
// 45000 + 1000 = 46000 vs 47495 -> diff -1495 -> REVIEW_REQUIRED.
export const missingDestination = (): NormalizeNeovinInput => ({
  listing: {
    id: "veh_pal_0007",
    vin: "KM8R5DHE8PU123456",
    ymm: "2025 Hyundai Palisade",
    trim: "Limited",
    condition: "new",
    mc_attributes: {
      specs_source: "neovin",
      base_msrp: 45000,
      total_msrp: 47495,
      options: ["TOW HITCH"],
      build_sheet: {
        source: "neovin",
        generic: false,
        packages: [],
        options: [{ name: "TOW HITCH", msrp: 1000 }],
        key_features: {},
        standard: {},
      },
    },
  },
  dealer: dealer(),
  document: doc("doc_pal_0007", "demo-palisade"),
});

export const ALL_FIXTURES = {
  infinitiLuxurySuv,
  packagePricingTruck,
  incompleteOptionPricing,
  noEpaNhtsa,
  materialMsrpMismatch,
  missingBaseMsrp,
  missingDestination,
};
