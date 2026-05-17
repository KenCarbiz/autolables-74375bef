import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeInvalidate } from "./useRealtimeInvalidate";
import { Product } from "./useProducts";

// ──────────────────────────────────────────────────────────────
// useProductRules — Supabase-backed, TanStack-Query-wrapped
// (Wave 13b).
//
// Was localStorage-only: a dealer editing rules on desktop
// wouldn't see them on the lot tablet. Now reads/writes
// public.product_rules (migration 20260518100000), tenant-scoped
// via RLS so every device in the tenant sees the same set.
//
// Public API is preserved — no args, returns { rules, addRule,
// updateRule, deleteRule, getMatchingProducts } — so Index.tsx
// and Admin.tsx need no changes.
// ──────────────────────────────────────────────────────────────

export interface ProductRule {
  id: string;
  product_id: string;
  year_min: string;
  year_max: string;
  makes: string[];       // empty = all makes
  models: string[];      // empty = all models
  trims: string[];       // empty = all trims
  body_styles: string[]; // empty = all
  condition: "new" | "used" | "all";
  mileage_max: number;   // 0 = no limit
}

export interface VehicleContext {
  year: string;
  make: string;
  model: string;
  trim: string;
  bodyStyle: string;
  condition?: "new" | "used";
  mileage?: number;
}

const productRulesKey = ["product_rules"] as const;

export const useProductRules = () => {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: productRulesKey,
    queryFn: async (): Promise<ProductRule[]> => {
      const { data } = await (supabase as any)
        .from("product_rules")
        .select("*")
        .order("created_at", { ascending: true });
      return ((data as ProductRule[]) || []);
    },
    staleTime: 60_000,
  });

  const rules = q.data ?? [];
  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: productRulesKey }),
    [qc],
  );

  // Cross-device sync — an F&I manager editing rules on desktop
  // updates the lot tablet's addendum builder in real time. RLS
  // already scopes the realtime stream to the current tenant.
  useRealtimeInvalidate({
    table: "product_rules",
    queryKey: productRulesKey,
  });

  const addRuleMutation = useMutation({
    mutationFn: async (rule: Omit<ProductRule, "id">): Promise<ProductRule | null> => {
      const { data: row, error } = await (supabase as any)
        .from("product_rules")
        .insert({
          product_id: rule.product_id,
          year_min: rule.year_min || "",
          year_max: rule.year_max || "",
          makes: rule.makes || [],
          models: rule.models || [],
          trims: rule.trims || [],
          body_styles: rule.body_styles || [],
          condition: rule.condition || "all",
          mileage_max: rule.mileage_max || 0,
        })
        .select()
        .single();
      if (error || !row) return null;
      return row as ProductRule;
    },
    onSuccess: invalidate,
  });

  const updateRuleMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<ProductRule> }) => {
      await (supabase as any)
        .from("product_rules")
        .update(updates)
        .eq("id", id);
    },
    onSuccess: invalidate,
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: string) => {
      await (supabase as any)
        .from("product_rules")
        .delete()
        .eq("id", id);
    },
    onSuccess: invalidate,
  });

  // Existing consumers call addRule(data) / updateRule(id, updates) /
  // deleteRule(id) without awaiting — keep that fire-and-forget
  // surface so Admin.tsx doesn't need rewrites. The mutations'
  // onSuccess invalidations refresh the cache asynchronously.
  const addRule = useCallback(
    (rule: Omit<ProductRule, "id">) => addRuleMutation.mutateAsync(rule),
    [addRuleMutation],
  );
  const updateRule = useCallback(
    (id: string, updates: Partial<ProductRule>) =>
      updateRuleMutation.mutateAsync({ id, updates }),
    [updateRuleMutation],
  );
  const deleteRule = useCallback(
    (id: string) => deleteRuleMutation.mutateAsync(id),
    [deleteRuleMutation],
  );

  // Pure predicate — same logic as the localStorage version, now
  // working over the Supabase-backed rules array.
  const getMatchingProducts = useCallback(
    (vehicle: VehicleContext, allProducts: Product[]): Product[] => {
      if (!vehicle.year && !vehicle.make && !vehicle.model) return allProducts;

      const matchedProductIds = new Set<string>();
      const productsWithRules = new Set(rules.map(r => r.product_id));

      // Products without ANY rule always show — rules are
      // "include" filters; absence means "no constraint".
      allProducts.forEach(p => {
        if (!productsWithRules.has(p.id)) {
          matchedProductIds.add(p.id);
        }
      });

      for (const rule of rules) {
        if (matchesRule(rule, vehicle)) {
          matchedProductIds.add(rule.product_id);
        }
      }

      return allProducts.filter(p => matchedProductIds.has(p.id));
    },
    [rules],
  );

  return { rules, loading: q.isLoading, addRule, updateRule, deleteRule, getMatchingProducts };
};

function matchesRule(rule: ProductRule, vehicle: VehicleContext): boolean {
  const vYear = parseInt(vehicle.year) || 0;
  const rMin = parseInt(rule.year_min) || 0;
  const rMax = parseInt(rule.year_max) || 9999;

  if (vYear && (vYear < rMin || vYear > rMax)) return false;

  if (rule.makes.length > 0 && vehicle.make) {
    const vmake = vehicle.make.toLowerCase();
    if (!rule.makes.some(m => m.toLowerCase() === vmake)) return false;
  }

  if (rule.models.length > 0 && vehicle.model) {
    const vmodel = vehicle.model.toLowerCase();
    if (!rule.models.some(m => m.toLowerCase() === vmodel)) return false;
  }

  if (rule.trims.length > 0 && vehicle.trim) {
    const vtrim = vehicle.trim.toLowerCase();
    if (!rule.trims.some(t => t.toLowerCase() === vtrim)) return false;
  }

  if (rule.body_styles.length > 0 && vehicle.bodyStyle) {
    const vbody = vehicle.bodyStyle.toLowerCase();
    if (!rule.body_styles.some(b => b.toLowerCase() === vbody)) return false;
  }

  if (rule.condition !== "all" && vehicle.condition && rule.condition !== vehicle.condition) {
    return false;
  }

  if (rule.mileage_max > 0 && vehicle.mileage && vehicle.mileage > rule.mileage_max) {
    return false;
  }

  return true;
}
