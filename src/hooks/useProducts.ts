import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Product {
  id: string;
  name: string;
  subtitle: string | null;
  warranty: string | null;
  badge_type: string;
  price: number;
  price_label: string | null;
  disclosure: string | null;
  sort_order: number;
  is_active: boolean;
  // Wave 16 — seeded into the per-addendum products_snapshot
  // line; dealers can override per-vehicle at addendum time.
  // Required on installed products before the compliance red-
  // team will release a signing link (FTC §5 + CA SB 766
  // §11713.21).
  benefit_justification: string;
  // True (default) when the accessory's price is already in the
  // advertised price — itemized for transparency but never charged
  // again on top. False marks a dealer-installed upcharge above the
  // advertised price, which is additive and confirmed at signing.
  price_in_advertised: boolean;
  // Optional-disposition copy. `disclosure` / `benefit_justification`
  // are the pre-installed versions; these are used when the line is sold
  // as a customer-elected optional add-on (fall back to the pre-installed
  // text when blank).
  disclosure_optional: string | null;
  benefit_justification_optional: string | null;
}

export const useProducts = () => {
  return useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data as Product[];
    },
  });
};
