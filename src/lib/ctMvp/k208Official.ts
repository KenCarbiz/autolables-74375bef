export const CT_EMISSIONS_STATUS_URL = "https://ctemissions.com/TestDueDateSearch";

export const K208_OFFICIAL_ITEMS = [
  "SERVICE BRAKES",
  "PARKING BRAKE",
  "TIRES/WHEELS",
  "STEERING SYSTEM",
  "SUSPENSION",
  "FRAME/CHASSIS",
  "EXHAUST",
  "FUEL SYSTEM",
  "HEADLIGHTS",
  "STOP/TURN LIGHTS",
  "MISC. LIGHTS",
  "WIPERS/WASHER",
  "WINDSHIELD, TINT",
  "HORN",
  "VIN VERIFIED",
  "MIRRORS",
  "SEAT BELTS",
  "AIR BAGS",
  "EMISSIONS",
] as const;

export type K208OfficialItem = typeof K208_OFFICIAL_ITEMS[number];
export type K208PassFail = "pass" | "fail" | "not_checked";

export type K208InspectionResult = "A" | "B" | "C";

export const K208_RESULT_LABELS: Record<K208InspectionResult, string> = {
  A: "Legal operation condition; may be covered by warranty",
  B: "Legal operation condition; sold AS IS and not subject to warranty under CGS 42-224",
  C: "Not in condition for legal operation; sold AS IS with noted defects",
};

export const createBlankK208Checklist = () =>
  K208_OFFICIAL_ITEMS.map((item) => ({
    item,
    result: "not_checked" as K208PassFail,
    notes: "",
  }));
