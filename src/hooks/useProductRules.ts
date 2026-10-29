import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeInvalidate } from "./useRealtimeInvalidate";
import { Product } from "./useProducts";
import { evaluateProduct, type EligibilityVehicle, type ProductEvaluation } from "@/lib/productEligibility";

// ──────────────────────────────────────────────────────────────
// useProductRules — Supabase-backed, TanStack-Query-wrapped
// (Wave 13b).
//
// Was localStorage-only: a dealer editing rules on desktop
// wouldn't see them on the lot tablet. Now reads/writes
// public.product_rules (migration 20260518100000), tenant-scoped
// via RLS so every device in the tenant sees the same set.
//
// Returns { rules, addRule, updateRule, deleteRule,
// getProductEligibility }. Eligibility goes through
// lib/productEligibility, the same predicate the Administration
// applicability samples use.
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
  /** Condition label as recorded; read by lib/productEligibility (missing or unrecognized is unknown). */
  condition?: string | null;
  /** Odometer as recorded; missing or unreadable is unknown, never zero. */
  mileage?: string | number | null;
}

export interface ProductEligibilityResult {
  /** False before the vehicle is identified (no year, make or model): every product is listed, as before. */
  engaged: boolean;
  eligible: Product[];
  excluded: Array<{ product: Product; evaluation: ProductEvaluation }>;
  undetermined: Array<{ product: Product; evaluation: ProductEvaluation }>;
}

/** Sorts products by their rules through the canonical predicate in lib/productEligibility. */
export function productEligibility(rules: ProductRule[], vehicle: VehicleContext, allProducts: Product[]): ProductEligibilityResult {
  if (!vehicle.year && !vehicle.make && !vehicle.model) return { engaged: false, eligible: allProducts, excluded: [], undetermined: [] };
  const byProduct = new Map<string, ProductRule[]>();
  for (const r of rules) byProduct.set(r.product_id, [...(byProduct.get(r.product_id) ?? []), r]);
  const subject: EligibilityVehicle = vehicle;
  const result: ProductEligibilityResult = { engaged: true, eligible: [], excluded: [], undetermined: [] };
  for (const p of allProducts) {
    const evaluation = evaluateProduct(byProduct.get(p.id) ?? [], subject);
    if (evaluation.status === "eligible") result.eligible.push(p);
    else if (evaluation.status === "excluded") result.excluded.push({ product: p, evaluation });
    else result.undetermined.push({ product: p, evaluation });
  }
  return result;
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
    mutationFn: async (rule: Omit<ProductRule, "id">): Promise<ProductRule> => {
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
      if (error) throw new Error(error.message || "The rule could not be created.");
      if (!row) throw new Error("The rule could not be created.");
      return row as ProductRule;
    },
    onSuccess: invalidate,
  });

  const updateRuleMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<ProductRule> }) => {
      const { error } = await (supabase as any)
        .from("product_rules")
        .update(updates)
        .eq("id", id);
      if (error) throw new Error(error.message || "The rule could not be updated.");
    },
    onSuccess: invalidate,
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("product_rules")
        .delete()
        .eq("id", id);
      if (error) throw new Error(error.message || "The rule could not be deleted.");
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

  const getProductEligibility = useCallback(
    (vehicle: VehicleContext, allProducts: Product[]): ProductEligibilityResult => productEligibility(rules, vehicle, allProducts),
    [rules],
  );

  return { rules, loading: q.isLoading, addRule, updateRule, deleteRule, getProductEligibility };
};
