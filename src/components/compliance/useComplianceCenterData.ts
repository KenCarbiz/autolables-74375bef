import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import {
  buildIssueRows,
  buildOverview,
  buildPriceRows,
  buildTitleRows,
  type CertificationRunRow,
  type DocumentFlagRow,
  type ExceptionRow,
  type IssueRow,
  type ListingRow,
  type OverviewCounts,
  type PriceRow,
  type PriceSnapshotRow,
  type RecallTaskRow,
  type TitleRow,
  type VehicleDocumentRow,
} from "./complianceData";

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

const TITLE_DOC_TYPES = ["title_front", "title_back", "mco_front", "mco_back"];

interface Result<T> {
  data: T[] | null;
}

const rows = <T,>(r: Result<T> | null | undefined): T[] => (r?.data as T[] | null) ?? [];

export interface ComplianceCenterData {
  loading: boolean;
  error: string | null;
  listings: ListingRow[];
  issueRows: IssueRow[];
  priceRows: PriceRow[];
  titleRows: TitleRow[];
  overview: OverviewCounts;
  refresh: () => void;
}

const EMPTY_OVERVIEW: OverviewCounts = {
  activeInventory: 0,
  critical: 0,
  needsReview: 0,
  missingEvidence: 0,
  auditReady: 0,
  openRecallVehicles: 0,
  recallReviewTasks: 0,
  uncertified: 0,
};

/**
 * The one read behind every compliance section. Active inventory is
 * `status <> 'archived'` — published_at stays set on archived rows and is
 * historical evidence, never a current-inventory test.
 */
export const useComplianceCenterData = (): ComplianceCenterData => {
  const { tenant } = useTenant();
  const { settings } = useDealerSettings();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const defaultDocFee = settings.doc_fee_amount || 0;
  const clerkEmail = settings.title_clerk_email || "";

  const [listings, setListings] = useState<ListingRow[]>([]);
  const [runs, setRuns] = useState<CertificationRunRow[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [flags, setFlags] = useState<DocumentFlagRow[]>([]);
  const [snapshots, setSnapshots] = useState<PriceSnapshotRow[]>([]);
  const [documents, setDocuments] = useState<VehicleDocumentRow[]>([]);
  const [recallTasks, setRecallTasks] = useState<RecallTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) {
      setListings([]); setRuns([]); setExceptions([]); setFlags([]);
      setSnapshots([]); setDocuments([]); setRecallTasks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [listingRes, runRes, exceptionRes, flagRes, snapshotRes, docRes, recallRes] = await Promise.all([
        sb().from("vehicle_listings")
          .select("id, vin, ymm, trim, condition, status, price, doc_fee, price_parse_status, price_last_verified_at, price_source_url, source_url, open_recall_count, recall_status, created_at, mc_attributes, sticker_snapshot")
          .eq("tenant_id", tenantId)
          .neq("status", "archived")
          .order("created_at", { ascending: false })
          .limit(2000),
        sb().from("ct_mvp_certification_runs")
          .select("id, vehicle_id, vin, stock, vehicle_title, ready, checks, certified_at")
          .eq("tenant_id", tenantId)
          .order("certified_at", { ascending: false })
          .limit(1500),
        sb().from("vehicle_exceptions")
          .select("vin, exception_type, severity, title, status")
          .eq("tenant_id", tenantId)
          .in("status", ["open", "in_progress"])
          .limit(5000),
        sb().from("stale_document_flags")
          .select("id, vehicle_id, severity, reason, changed_field, old_value, new_value, status, created_at")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(5000),
        sb().from("advertised_prices")
          .select("id, vin, advertised_price, source_channel, source_url, captured_at, captured_by")
          .eq("tenant_id", tenantId)
          .order("captured_at", { ascending: false })
          .limit(5000),
        sb().from("vehicle_documents")
          .select("vin, doc_type, created_at")
          .eq("tenant_id", tenantId)
          .in("doc_type", TITLE_DOC_TYPES)
          .limit(5000),
        sb().from("recall_service_tasks")
          .select("vin, status, open_recall_count")
          .eq("tenant_id", tenantId)
          .limit(2000),
      ]);

      if (listingRes?.error) throw listingRes.error;

      setListings(rows<ListingRow>(listingRes).filter((l) => !!l.vin));
      setRuns(rows<CertificationRunRow>(runRes));
      setExceptions(rows<ExceptionRow>(exceptionRes));
      setFlags(rows<DocumentFlagRow>(flagRes));
      setSnapshots(rows<PriceSnapshotRow>(snapshotRes));
      setDocuments(rows<VehicleDocumentRow>(docRes));
      setRecallTasks(rows<RecallTaskRow>(recallRes));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load compliance data");
      setListings([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  const priceRows = useMemo(
    () => buildPriceRows({ listings, snapshots, flags, defaultDocFee }),
    [listings, snapshots, flags, defaultDocFee],
  );

  const titleRows = useMemo(
    () => buildTitleRows(listings, documents, clerkEmail),
    [listings, documents, clerkEmail],
  );

  const issueRows = useMemo(
    () => buildIssueRows({ listings, runs, exceptions, priceRows, titleRows, recallTasks }),
    [listings, runs, exceptions, priceRows, titleRows, recallTasks],
  );

  const overview = useMemo(
    () => (listings.length ? buildOverview({ issueRows, titleRows, recallTasks }) : EMPTY_OVERVIEW),
    [issueRows, titleRows, recallTasks, listings.length],
  );

  return { loading, error, listings, issueRows, priceRows, titleRows, overview, refresh: load };
};
