import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { feeExclusiveEquivalent } from "@/components/compliance/complianceData";
import { isExecutedSignoff, isFailedInspection } from "@/lib/commandCenter/inspectionState";
import type { StatusFact } from "./statusFacts";
import type { VehicleRow } from "./types";

export interface ComplianceFacts {
  loading: boolean;
  price: StatusFact & { checkedAt: string | null };
  safety: StatusFact & { checkedAt: string | null };
  delivery: StatusFact;
  title: StatusFact & { checkedAt: string | null };
}

const UNREAD: StatusFact = { label: "", value: "Reading", tone: "neutral" };

export function useComplianceFacts(vehicle: VehicleRow): ComplianceFacts {
  const [state, setState] = useState<Omit<ComplianceFacts, "loading"> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const vin = (vehicle.vin || "").toUpperCase();
      const tenantId = vehicle.tenant_id;
      if (!vin || !tenantId) return;
      const isNew = String(vehicle.condition || "").toLowerCase() === "new";
      const sb = supabase as unknown as { from: (t: string) => any };
      const [ads, insp, prep, detail, docs] = await Promise.all([
        sb.from("advertised_prices").select("advertised_price, source_channel, captured_at").eq("tenant_id", tenantId).eq("vin", vin).order("captured_at", { ascending: false }).limit(100),
        sb.from("safety_inspections").select("status, result, signed_at").eq("vin", vin).eq("tenant_id", tenantId),
        sb.from("prep_sign_offs").select("listing_unlocked").eq("vin", vin).eq("tenant_id", tenantId),
        sb.from("detail_signoffs").select("status").eq("vin", vin).eq("tenant_id", tenantId),
        sb.from("vehicle_documents").select("doc_type, created_at").eq("tenant_id", tenantId).eq("vin", vin).in("doc_type", ["title_front", "title_back", "mco_front", "mco_back"]).order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;

      const adRows = (ads.data || []) as { advertised_price: number; source_channel: string; captured_at: string }[];
      const latest = new Map<string, (typeof adRows)[number]>();
      for (const r of adRows) if (!latest.has(r.source_channel)) latest.set(r.source_channel, r);
      const channels = [...latest.values()];
      const mismatches = vehicle.price == null ? [] : channels.filter((c) => Math.abs((feeExclusiveEquivalent(c.advertised_price, vehicle) ?? c.advertised_price) - vehicle.price!) > 1);
      const price: ComplianceFacts["price"] = channels.length === 0
        ? { label: "Price consistency", value: "Not checked", tone: "neutral", detail: "No advertised price has been captured.", checkedAt: null }
        : mismatches.length > 0
          ? { label: "Price consistency", value: `${mismatches.length} mismatch${mismatches.length === 1 ? "" : "es"}`, tone: "danger", detail: "Advertised price differs from the lot price.", checkedAt: channels[0].captured_at }
          : { label: "Price consistency", value: "No issues detected", tone: "success", detail: "Matches captured advertised prices.", checkedAt: channels[0].captured_at };

      const inspRows = (insp.data || []) as { status: string; result: string | null; signed_at: string | null }[];
      const newestSigned = inspRows.filter((r) => r.status === "signed").sort((a, b) => String(b.signed_at || "").localeCompare(String(a.signed_at || "")))[0] ?? null;
      const signed = newestSigned ? { status: "signed", result: newestSigned.result } : null;
      const executed = isExecutedSignoff(signed);
      const safety: ComplianceFacts["safety"] = isNew
        ? { label: "Safety inspection", value: "Not required", tone: "neutral", detail: "New stock.", checkedAt: null }
        : executed
          ? { label: "Safety inspection", value: "Executed", tone: "success", detail: "A signed inspection is on file.", checkedAt: newestSigned?.signed_at ?? null }
          : isFailedInspection(signed)
            ? { label: "Safety inspection", value: "Failed", tone: "danger", detail: "Open failures need repair and reinspection.", checkedAt: newestSigned?.signed_at ?? null }
            : { label: "Safety inspection", value: "Not executed", tone: "danger", detail: "Inspection not yet completed.", checkedAt: null };

      const prepDone = ((prep.data || []) as { listing_unlocked: boolean }[]).some((r) => r.listing_unlocked);
      const detailDone = ((detail.data || []) as { status: string }[]).some((r) => r.status === "signed");
      const total = isNew ? 2 : 3;
      const done = [prepDone, detailDone, isNew ? null : executed].filter((x) => x === true).length;
      const delivery: StatusFact = {
        label: "Delivery requirements",
        value: `${done} / ${total} complete`,
        tone: done === total ? "success" : "warning",
        detail: done === total ? "Sign-offs are complete." : "Additional sign-offs required before delivery.",
      };

      const docRows = (docs.data || []) as { created_at: string }[];
      const title: ComplianceFacts["title"] = docRows.length > 0
        ? { label: "Title & registration", value: "On file", tone: "success", detail: isNew ? "MCO on file." : "Title on file.", checkedAt: docRows[0].created_at }
        : { label: "Title & registration", value: "Missing", tone: "warning", detail: isNew ? "MCO not on file." : "Title not on file.", checkedAt: null };

      setState({ price, safety, delivery, title });
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [vehicle.vin, vehicle.tenant_id, vehicle.condition, vehicle.price]);

  const unread = { ...UNREAD };
  return state
    ? { loading: false, ...state }
    : {
        loading: true,
        price: { ...unread, label: "Price consistency", checkedAt: null },
        safety: { ...unread, label: "Safety inspection", checkedAt: null },
        delivery: { ...unread, label: "Delivery requirements" },
        title: { ...unread, label: "Title & registration", checkedAt: null },
      };
}
