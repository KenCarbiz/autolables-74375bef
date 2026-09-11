import { useState } from "react";

export interface BlackBookData {
  // Factory Equipment
  standardEquipment: string[];
  optionalEquipment: { name: string; code: string; msrp: string }[];
  // Market Data
  marketValue: {
    wholesale: { low: string; avg: string; high: string };
    retail: { low: string; avg: string; high: string };
    tradeIn: { low: string; avg: string; high: string };
  };
  // Vehicle Info
  baseRetailPrice: string;
  baseMsrp: string;
  vehicleClass: string;
  // Source
  lastUpdated: string;
}

// Black Book integration hook
// In production, calls Black Book's VIN Decode + Market Value APIs
// via a Supabase Edge Function (requires Black Book API key).
// For now, provides a structured interface and demo data.
export const useBlackBook = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BlackBookData | null>(null);

  const pull = async (vin: string): Promise<BlackBookData | null> => {
    if (!vin || vin.length !== 17) {
      setError("Valid 17-character VIN required");
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      // In production:
      // const { data, error } = await supabase.functions.invoke('blackbook-lookup', { body: { vin } });
      // For now, return structured placeholder indicating API connection needed

      await new Promise(r => setTimeout(r, 800));

      const result: BlackBookData = {
        standardEquipment: [
          "Connect Signal House & Black Book API keys in Admin > Integrations to activate live data.",
          "Standard equipment, optional equipment, and live market values will auto-populate from Black Book.",
        ],
        optionalEquipment: [],
        marketValue: {
          wholesale: { low: "—", avg: "—", high: "—" },
          retail: { low: "—", avg: "—", high: "—" },
          tradeIn: { low: "—", avg: "—", high: "—" },
        },
        baseRetailPrice: "—",
        baseMsrp: "—",
        vehicleClass: "—",
        lastUpdated: new Date().toISOString(),
      };

      setData(result);
      setLoading(false);
      return result;
    } catch (err: any) {
      setError(err.message || "Black Book lookup failed");
      setLoading(false);
      return null;
    }
  };

  return { pull, loading, error, data };
};
