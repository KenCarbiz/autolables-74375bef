import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

// An optional higher tier for multi-level products (e.g. Door Edge Guard
// Standard -> Platinum). Applying it on an addendum line swaps the line to
// this tier's package price, disclosure, and benefit (per disposition).
export interface ProductUpgrade {
  name: string;
  price: number;
  disclosure: string;
  benefit_justification: string;
  disclosure_optional: string;
  benefit_justification_optional: string;
  // False = this tier is installed after delivery only and can never be
  // pre-installed, so applying it forces the line to customer-elected.
  // Undefined/true on legacy rows keeps the tier pre-installable.
  available_preinstalled?: boolean;
}

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
  // False = sold only as a customer-elected option, never pre-installed.
  available_preinstalled: boolean;
  // Optional higher tier for multi-level products (null when none).
  upgrade: ProductUpgrade | null;
  // Required substantiating document — the product contract, or the
  // warranty card when there is no contract. contract_doc_type records
  // which kind was attached ('contract' | 'warranty').
  contract_url: string | null;
  contract_doc_type: string | null;
  // Optional vehicle-category pricing. Map of pricing bucket
  // ("car" | "suv" | "truck" | "van") to price. When the addendum's
  // vehicle matches a bucket with a positive price, that price overrides
  // the base `price`; otherwise the base price is used.
  price_tiers: Record<string, number> | null;
}

export const useProducts = () => {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["products", tenant?.id || null],
    // Always refetch on mount + window focus so the addendum can never run
    // its compliance checks against a stale product list (e.g. after the
    // dealer just edited benefit text in the Products tab).
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: async () => {
      // Tenant-scoped: this tenant's catalog plus legacy pre-scoping rows
      // (tenant_id null). RLS enforces the same shape server-side; the
      // explicit filter keeps multi-tenant admins from mixing catalogs.
      let q = supabase
        .from("products")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      if (tenant?.id && tenant.id !== "house") {
        q = q.or(`tenant_id.eq.${tenant.id},tenant_id.is.null`);
      }
      let { data, error } = await q;
      // Pre-migration schema (no tenant_id column): fall back to the
      // unfiltered query so the addendum keeps working until it's applied.
      if (error && /tenant_id/i.test(error.message || "")) {
        ({ data, error } = await supabase.from("products").select("*").eq("is_active", true).order("sort_order"));
      }
      if (error) throw error;
      // `upgrade` is jsonb in the DB (Json); cast through unknown so the
      // typed ProductUpgrade shape lands on the client.
      const rows = (data as unknown as Product[]) || [];
      // Collapse duplicate products by name. The catalog can end up with two
      // rows for the same product (e.g. an older empty copy plus the dealer's
      // filled-in copy); without this, the addendum would show the empty one
      // and falsely flag it for a missing benefit. Keep the most complete row:
      // benefit text present wins, then a disclosure, then the later row.
      const score = (p: Product) =>
        ((p.benefit_justification || "").trim() ? 4 : 0) +
        ((p.benefit_justification_optional || "").trim() ? 2 : 0) +
        ((p.disclosure || "").trim() || (p.disclosure_optional || "").trim() ? 1 : 0);
      const byName = new Map<string, Product>();
      for (const p of rows) {
        const key = (p.name || "").trim().toLowerCase();
        const existing = byName.get(key);
        if (!existing || score(p) >= score(existing)) byName.set(key, p);
      }
      return Array.from(byName.values()).sort((a, b) => a.sort_order - b.sort_order);
    },
  });
};
