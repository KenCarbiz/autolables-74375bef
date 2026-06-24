import { useState } from "react";

// ──────────────────────────────────────────────────────────────
// Website Syndication Feed
//
// Pushes addendum add-on data to dealer website VDPs so online
// shoppers see the same pricing as lot shoppers.
//
// In production, this calls a Supabase Edge Function that
// pushes to the dealer's website provider (Dealer.com,
// DealerInspire, DealerFire, etc.) via their API or SFTP.
// ──────────────────────────────────────────────────────────────

export interface SyndicationItem {
  vin: string;
  stockNumber: string;
  ymm: string;
  products: { name: string; price: number; type: "installed" | "optional" }[];
  totalAccessories: number;
  basePrice: number;
  finalPrice: number;
  stickerUrl: string;
  signingUrl: string;
  lastUpdated: string;
}

export const useSyndicationFeed = () => {
  const [pushing, setPushing] = useState(false);
  const [lastPush, setLastPush] = useState<string | null>(null);

  const generateFeed = (storeId: string): SyndicationItem[] => {
    try {
      const files = JSON.parse(localStorage.getItem("vehicle_files") || "[]") as any[];
      return files
        .filter((f: any) => f.store_id === storeId && f.stickers?.length > 0)
        .map((f: any) => {
          const latest = f.stickers[f.stickers.length - 1];
          return {
            vin: f.vin,
            stockNumber: f.stock_number,
            ymm: `${f.year} ${f.make} ${f.model} ${f.trim}`.trim(),
            products: (latest.products_snapshot || []).map((p: any) => ({
              name: p.name, price: p.price, type: p.badge_type,
            })),
            totalAccessories: latest.totals?.accessories_total || 0,
            basePrice: latest.totals?.base_price || 0,
            finalPrice: latest.totals?.final_price || 0,
            stickerUrl: `${window.location.origin}/v/${f.vin}`,
            signingUrl: latest.signing_url || "",
            lastUpdated: latest.printed_at,
          };
        });
    } catch { return []; }
  };

  const pushFeed = async (storeId: string): Promise<{ count: number }> => {
    setPushing(true);
    const feed = generateFeed(storeId);
    // In production: await supabase.functions.invoke("syndication-push", { body: { feed } });
    const queue = JSON.parse(localStorage.getItem("syndication_queue") || "[]");
    queue.push({ storeId, feed, pushedAt: new Date().toISOString(), count: feed.length });
    localStorage.setItem("syndication_queue", JSON.stringify(queue));
    setLastPush(new Date().toISOString());
    setPushing(false);
    return { count: feed.length };
  };

  const exportJson = (storeId: string): string => JSON.stringify(generateFeed(storeId), null, 2);

  return { pushFeed, pushing, lastPush, generateFeed, exportJson };
};
