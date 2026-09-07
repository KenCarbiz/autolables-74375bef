import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import {
  buildCustomerBook,
  type CustomerBook,
  type DealRow,
  type DocumentRequestRow,
  type DwellRow,
  type EngagementRow,
  type LeadRow,
  type ListingRow,
  type SigningRow,
} from "./customerBook";

// Loads every source the Customers + Deals surfaces are allowed to claim.
// Each table is tenant-scoped by RLS; leads are store-scoped because a lead
// inserted by an anonymous shopper carries store_id, not tenant_id.

const WINDOW_DAYS = 45;

// deno-lint-ignore no-explicit-any -- generated types don't cover these tables
const db = supabase as any;

interface Result {
  book: CustomerBook;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const EMPTY: CustomerBook = { customers: [], deals: [], passiveVisitors: 0, linkedVisitors: 0 };

export function useCustomerBook(): Result {
  const { tenant, currentStore } = useTenant();
  const { settings } = useDealerSettings();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const storeId = currentStore?.id || null;

  const query = useQuery({
    queryKey: ["customer-book", tenantId, storeId],
    enabled: !!tenantId || !!storeId,
    staleTime: 30_000,
    queryFn: async () => {
      const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
      const none = Promise.resolve({ data: [] });

      const leadsQuery = storeId
        ? db.from("leads")
            .select("id, name, phone, email, vehicle_interest, vehicle_vin, source, sub_source, status, notes, captured_at, first_response_at, escalated_at, escalation_level, routed_agent_id")
            .eq("store_id", storeId).order("captured_at", { ascending: false }).limit(500)
        : none;

      const eventsQuery = tenantId
        ? db.from("customer_engagement_events")
            .select("session_id, visitor_id, vin, stock, vehicle_id, event_type, document_type, source, device_type, city, region, metadata, created_at, occurred_at")
            .eq("tenant_id", tenantId).gte("created_at", since)
            .order("created_at", { ascending: false }).limit(3000)
        : none;

      const dwellQuery = tenantId
        ? db.from("passport_engagement").select("session_id, vin, module, seconds, last_at")
            .eq("tenant_id", tenantId).gte("last_at", since).limit(3000)
        : none;

      const docsQuery = tenantId
        ? db.from("passport_document_delivery_requests")
            .select("id, customer_name, customer_email, customer_phone, vin, stock, vehicle_id, visitor_id, session_id, requested_documents, delivery_status, verification_status, requested_at, delivered_at")
            .eq("tenant_id", tenantId).order("requested_at", { ascending: false }).limit(500)
        : none;

      const dealsQuery = tenantId
        ? db.from("addendums")
            .select("id, customer_name, customer_email, vehicle_vin, vehicle_ymm, vehicle_stock, selling_price, total_with_optional, status, lifecycle_status, price_verification_status, price_verification_delta, accepted_at, customer_signed_at, employee_signed_at, delivered_at, employee_name, signing_token, ready_at, created_at, updated_at")
            .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(400)
        : none;

      const signingsQuery = tenantId
        ? db.from("addendum_signings")
            .select("id, addendum_id, vin, signer_type, signer_name, signed_at, return_status, return_window_closes_at, return_requested_at, return_completed_at, return_reason")
            .eq("tenant_id", tenantId).order("signed_at", { ascending: false }).limit(600)
        : none;

      const listingsQuery = tenantId
        ? db.from("vehicle_listings").select("id, vin, ymm, slug, stock_number").eq("tenant_id", tenantId).limit(1000)
        : none;

      const [leadsRes, eventsRes, dwellRes, docsRes, dealsRes, signingsRes, listingsRes] = await Promise.all([
        leadsQuery, eventsQuery, dwellQuery, docsQuery, dealsQuery, signingsQuery, listingsQuery,
      ]);

      return {
        leads: (leadsRes?.data || []) as LeadRow[],
        events: (eventsRes?.data || []) as EngagementRow[],
        dwell: (dwellRes?.data || []) as DwellRow[],
        documentRequests: (docsRes?.data || []) as DocumentRequestRow[],
        deals: (dealsRes?.data || []) as DealRow[],
        signings: (signingsRes?.data || []) as SigningRow[],
        listings: (listingsRes?.data || []) as ListingRow[],
      };
    },
  });

  const agents = useMemo(
    () => (settings.passport_agents || []).map((a) => ({ id: a.id, name: a.name })),
    [settings.passport_agents],
  );

  const book = useMemo(() => {
    if (!query.data) return EMPTY;
    return buildCustomerBook({ ...query.data, agents });
  }, [query.data, agents]);

  return {
    book,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: () => { void query.refetch(); },
  };
}
