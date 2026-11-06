import type { LookupResult, VehicleLookup, VehicleRecordsActions } from "@/lib/vehicleHistory/types";

const READ_ONLY = { ok: false as const, message: "Design fixture: there is no database behind this screen, so nothing was written." };

export function fixtureActions(vehicles: VehicleLookup[], stockByVin: Record<string, string>): VehicleRecordsActions {
  const lookup = async (query: string): Promise<LookupResult> => {
    const q = query.trim().toUpperCase();
    const hits = vehicles.filter((v) => v.vin === q || (stockByVin[v.vin] ?? "").toUpperCase() === q);
    return hits.length ? { kind: "found", vehicles: hits } : { kind: "none" };
  };
  return { lookup, resolveReview: async () => READ_ONLY, replay: async () => READ_ONLY, saveSetting: async () => READ_ONLY };
}
