export type OemId =
  | "INFINITI"
  | "NISSAN"
  | "HYUNDAI"
  | "GENESIS"
  | "TOYOTA"
  | "LEXUS"
  | "HONDA"
  | "ACURA"
  | "FORD"
  | "LINCOLN"
  | "CHEVROLET"
  | "GMC"
  | "BUICK"
  | "CADILLAC"
  | "JEEP"
  | "DODGE"
  | "RAM"
  | "CHRYSLER"
  | "VOLKSWAGEN"
  | "AUDI"
  | "BMW"
  | "MERCEDES_BENZ"
  | "SUBARU"
  | "MAZDA"
  | "KIA"
  | "VOLVO"
  | "LAND_ROVER"
  | "PORSCHE"
  | "TESLA"
  | "AUTOLABELS_FALLBACK";

export interface OemIdentity {
  id: OemId;
  displayName: string;
  country: string;
  group?: string;
}

export const OEM_REGISTRY: Record<OemId, OemIdentity> = {
  INFINITI: { id: "INFINITI", displayName: "INFINITI", country: "JP", group: "Nissan Motor Corporation" },
  NISSAN: { id: "NISSAN", displayName: "Nissan", country: "JP", group: "Nissan Motor Corporation" },
  HYUNDAI: { id: "HYUNDAI", displayName: "Hyundai", country: "KR", group: "Hyundai Motor Group" },
  GENESIS: { id: "GENESIS", displayName: "Genesis", country: "KR", group: "Hyundai Motor Group" },
  TOYOTA: { id: "TOYOTA", displayName: "Toyota", country: "JP", group: "Toyota Motor Corporation" },
  LEXUS: { id: "LEXUS", displayName: "Lexus", country: "JP", group: "Toyota Motor Corporation" },
  HONDA: { id: "HONDA", displayName: "Honda", country: "JP", group: "Honda Motor Co." },
  ACURA: { id: "ACURA", displayName: "Acura", country: "JP", group: "Honda Motor Co." },
  FORD: { id: "FORD", displayName: "Ford", country: "US", group: "Ford Motor Company" },
  LINCOLN: { id: "LINCOLN", displayName: "Lincoln", country: "US", group: "Ford Motor Company" },
  CHEVROLET: { id: "CHEVROLET", displayName: "Chevrolet", country: "US", group: "General Motors" },
  GMC: { id: "GMC", displayName: "GMC", country: "US", group: "General Motors" },
  BUICK: { id: "BUICK", displayName: "Buick", country: "US", group: "General Motors" },
  CADILLAC: { id: "CADILLAC", displayName: "Cadillac", country: "US", group: "General Motors" },
  JEEP: { id: "JEEP", displayName: "Jeep", country: "US", group: "Stellantis" },
  DODGE: { id: "DODGE", displayName: "Dodge", country: "US", group: "Stellantis" },
  RAM: { id: "RAM", displayName: "Ram", country: "US", group: "Stellantis" },
  CHRYSLER: { id: "CHRYSLER", displayName: "Chrysler", country: "US", group: "Stellantis" },
  VOLKSWAGEN: { id: "VOLKSWAGEN", displayName: "Volkswagen", country: "DE", group: "Volkswagen Group" },
  AUDI: { id: "AUDI", displayName: "Audi", country: "DE", group: "Volkswagen Group" },
  BMW: { id: "BMW", displayName: "BMW", country: "DE", group: "BMW Group" },
  MERCEDES_BENZ: { id: "MERCEDES_BENZ", displayName: "Mercedes-Benz", country: "DE", group: "Mercedes-Benz Group" },
  SUBARU: { id: "SUBARU", displayName: "Subaru", country: "JP", group: "Subaru Corporation" },
  MAZDA: { id: "MAZDA", displayName: "Mazda", country: "JP", group: "Mazda Motor Corporation" },
  KIA: { id: "KIA", displayName: "Kia", country: "KR", group: "Hyundai Motor Group" },
  VOLVO: { id: "VOLVO", displayName: "Volvo", country: "SE", group: "Volvo Cars" },
  LAND_ROVER: { id: "LAND_ROVER", displayName: "Land Rover", country: "GB", group: "JLR" },
  PORSCHE: { id: "PORSCHE", displayName: "Porsche", country: "DE", group: "Volkswagen Group" },
  TESLA: { id: "TESLA", displayName: "Tesla", country: "US", group: "Tesla, Inc." },
  AUTOLABELS_FALLBACK: { id: "AUTOLABELS_FALLBACK", displayName: "AutoLabels", country: "US" },
};

export type OemResolutionConfidence = "EXACT" | "ALIAS" | "FUZZY" | "UNRESOLVED";

export interface OemResolution {
  identity: OemIdentity;
  confidence: OemResolutionConfidence;
  fallbackReason?: string;
}

const makeKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

const RESOLVABLE_IDS = (Object.keys(OEM_REGISTRY) as OemId[]).filter((id) => id !== "AUTOLABELS_FALLBACK");

const EXACT_KEYS = new Map<string, OemId>();
for (const id of RESOLVABLE_IDS) {
  EXACT_KEYS.set(makeKey(id), id);
  EXACT_KEYS.set(makeKey(OEM_REGISTRY[id].displayName), id);
}

const ALIASES: Record<string, OemId> = {
  chevy: "CHEVROLET",
  chev: "CHEVROLET",
  vw: "VOLKSWAGEN",
  volkswagon: "VOLKSWAGEN",
  mercedes: "MERCEDES_BENZ",
  benz: "MERCEDES_BENZ",
  mercedesamg: "MERCEDES_BENZ",
  rangerover: "LAND_ROVER",
  jaguarlandrover: "LAND_ROVER",
  jaguarlandroverlimited: "LAND_ROVER",
  jaguarlandrovernorthamerica: "LAND_ROVER",
  jaguarlandrovernorthamericallc: "LAND_ROVER",
  jlr: "LAND_ROVER",
  landrovernorthamerica: "LAND_ROVER",
  infinity: "INFINITI",
  datsun: "NISSAN",
  scion: "TOYOTA",
  genesismotors: "GENESIS",
  genesismotor: "GENESIS",
  gmctruck: "GMC",
  gmctrucks: "GMC",
  ramtruck: "RAM",
  ramtrucks: "RAM",
  dodgeram: "RAM",
  dodgedivision: "DODGE",
  dodgebrand: "DODGE",
  ramdivision: "RAM",
  ramcommercial: "RAM",
  fcausram: "RAM",
  stellantisram: "RAM",
  fordmotorcompany: "FORD",
  // "GM Cadillac" would otherwise fuzzy-match both GMC and CADILLAC and
  // resolve to review; the division names are explicit instead.
  buickmotordivision: "BUICK",
  buickdivision: "BUICK",
  buickgmc: "BUICK",
  gmcadillac: "CADILLAC",
  generalmotorscadillac: "CADILLAC",
  cadillacmotorcardivision: "CADILLAC",
  audiag: "AUDI",
  porscheag: "PORSCHE",
  porschecarsnorthamerica: "PORSCHE",
  porschecarsnorthamericainc: "PORSCHE",
  dringhcfporscheag: "PORSCHE",
  volvocars: "VOLVO",
  teslamotors: "TESLA",
  teslamotorsinc: "TESLA",
  teslainc: "TESLA",
};

const unresolved = (reason: string): OemResolution => ({
  identity: OEM_REGISTRY.AUTOLABELS_FALLBACK,
  confidence: "UNRESOLVED",
  fallbackReason: reason,
});

// Compatibility / styling qualifiers: "Land Rover-compatible" and
// "Range Rover-style" describe an aftermarket relationship to a brand, not
// the brand itself, and must never select that brand's template.
const QUALIFIER_TOKENS = [
  "compatible", "style", "styled", "styling", "replica", "inspired",
  "lookalike", "aftermarket", "tribute", "clone", "conversion",
  // Finance arms, dealer groups and parts channels carry a brand name but
  // are not the vehicle's manufacturer ("Chrysler Capital", "Chrysler-
  // certified dealer", "Mopar accessories").
  "capital", "financial", "finance", "certified", "dealer", "accessor",
];

// Standalone words that are a substring of a real make but are not that
// make on their own ("Rover" is not Land Rover; MG Rover and Austin Rover
// are unrelated marques). These resolve to review rather than a guess.
const AMBIGUOUS_STANDALONE = new Set(["rover", "range", "land"]);

// Corporate parents that build several brands. A record saying "Stellantis"
// or "FCA US LLC" does not identify which brand the vehicle is, so it must
// go to review rather than inherit whichever brand fuzzy-matches first.
const CORPORATE_PARENTS = new Set([
  "stellantis", "stellantisnorthamerica", "stellantisnv",
  "fca", "fcaus", "fcausllc", "fiatchrysler", "fiatchryslerautomobiles",
  "generalmotors", "gm", "gmcorp", "fordmotor", "hyundaimotorgroup",
  "volkswagengroup", "vwgroup", "tatamotors", "geely", "bmwgroup",
  "mercedesbenzgroup", "hondamotor", "toyotamotor", "nissanmotor",
  "cdjr", "chryslerdodgejeepram",
]);

// Sibling marques with no template of their own. Jaguar shares JLR with
// Land Rover but is a separate brand and must never inherit its template.
const SIBLING_MARQUES = new Set(["jaguar", "jaguarcars", "jaguarlandroverjaguar"]);

// Commercial-truck marques that would otherwise fuzzy-match a passenger
// brand (e.g. "Volvo Trucks" contains "volvo"). These must never receive
// a passenger-car template — they resolve to review instead of guessing.
const NON_PASSENGER_MAKES = new Set([
  "volvotrucks",
  "volvotruck",
  "volvogroup",
  "abvolvo",
  "macktrucks",
  "mack",
]);

export function resolveOem(rawMake: string, modelYear?: number): OemResolution {
  const raw = String(rawMake ?? "").trim();
  if (!raw) return unresolved("empty make");
  const key = makeKey(raw);
  if (!key) return unresolved(`make "${raw}" has no resolvable characters`);
  if (NON_PASSENGER_MAKES.has(key)) {
    return unresolved(`make "${raw}" is a commercial-truck marque, not a passenger brand`);
  }
  if (CORPORATE_PARENTS.has(key)) {
    return unresolved(`make "${raw}" is a corporate parent, not a vehicle brand`);
  }
  if (SIBLING_MARQUES.has(key)) {
    return unresolved(`make "${raw}" is a separate marque without its own template`);
  }
  if (AMBIGUOUS_STANDALONE.has(key)) {
    return unresolved(`make "${raw}" is ambiguous on its own and needs an explicit brand`);
  }
  for (const token of QUALIFIER_TOKENS) {
    if (key.includes(token)) {
      return unresolved(`make "${raw}" is a compatibility/styling qualifier, not a manufacturer`);
    }
  }

  // Ram was a Dodge nameplate until the 2011 brand split.
  if (key === "ram" && modelYear !== undefined && modelYear <= 2010) {
    return { identity: OEM_REGISTRY.DODGE, confidence: "ALIAS" };
  }

  const exact = EXACT_KEYS.get(key);
  if (exact) return { identity: OEM_REGISTRY[exact], confidence: "EXACT" };

  const alias = ALIASES[key];
  if (alias) return { identity: OEM_REGISTRY[alias], confidence: "ALIAS" };

  if (key.length >= 3) {
    const matches = new Set<OemId>();
    const candidates: Array<[string, OemId]> = [];
    for (const id of RESOLVABLE_IDS) {
      candidates.push([makeKey(id), id], [makeKey(OEM_REGISTRY[id].displayName), id]);
    }
    for (const [ak, id] of Object.entries(ALIASES)) candidates.push([ak, id]);
    for (const [ck, id] of candidates) {
      if (ck.length >= 3 && (key.includes(ck) || (key.length >= 4 && ck.includes(key)))) {
        matches.add(id);
      }
    }
    if (matches.size === 1) {
      const id = [...matches][0];
      return { identity: OEM_REGISTRY[id], confidence: "FUZZY" };
    }
    if (matches.size > 1) {
      return unresolved(`make "${raw}" matches multiple OEMs: ${[...matches].sort().join(", ")}`);
    }
  }

  return unresolved(`unknown make "${raw}"`);
}
