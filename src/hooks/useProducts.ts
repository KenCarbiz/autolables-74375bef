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
  benefit_justification: string | null;
  sort_order: number;
  is_active: boolean;
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
