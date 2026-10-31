import { useEffect, useState } from "react";
import { AdminCard, AdminLinkButton, StatusChip } from "@/components/admin/v2/primitives";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useViewFixture } from "@/lib/admin/dataSource";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import { normalizeEstimatorConfig, validateEstimatorConfig } from "@/lib/payment/estimator";
import { tenantIdOf } from "@/pages/admin/views/pricing/pricingData";
import type { EstimatorFixture } from "./data";
import { EstimatorIcon } from "./icons";

type Summary =
  | { kind: "loading" }
  | { kind: "unknown" }
  | { kind: "none" }
  | { kind: "saved"; enabled: boolean; ranges: number; complete: boolean; updatedAt: string | null };

type Db = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

function summarize(raw: { config: unknown; updatedAt: string | null } | null): Summary {
  if (!raw) return { kind: "none" };
  const config = normalizeEstimatorConfig(raw.config);
  return { kind: "saved", enabled: config.enabled, ranges: config.rules.filter((r) => r.enabled).length, complete: validateEstimatorConfig({ ...config, enabled: true }).length === 0, updatedAt: raw.updatedAt };
}

/** Document defaults entry point: the selected store's estimator status and a link to configure it. Read-only. */
export function PaymentEstimatorSummaryCard() {
  const fixture = useViewFixture<{ paymentEstimator?: EstimatorFixture }>("document-defaults");
  const { tenant, currentStore } = useTenant();
  const tenantId = tenantIdOf(tenant);
  const storeId = currentStore?.id ?? tenantId;
  const storeName = fixture?.paymentEstimator?.storeName ?? currentStore?.name ?? tenant?.name ?? "this store";
  const [summary, setSummary] = useState<Summary>(() => fixture
    ? summarize(fixture.paymentEstimator?.published ? { config: fixture.paymentEstimator.published.config, updatedAt: fixture.paymentEstimator.published.updatedAt ?? null } : null)
    : { kind: "loading" });

  useEffect(() => {
    if (fixture || !tenantId || !storeId) return;
    let live = true;
    (async () => {
      try {
        const { data, error } = await (supabase as unknown as Db).from("passport_payment_estimator_settings")
          .select("config, updated_at").eq("tenant_id", tenantId).eq("store_id", storeId).maybeSingle();
        if (!live) return;
        setSummary(error ? { kind: "unknown" } : summarize(data ? { config: data.config, updatedAt: data.updated_at ?? null } : null));
      } catch {
        if (live) setSummary({ kind: "unknown" });
      }
    })();
    return () => { live = false; };
  }, [fixture, tenantId, storeId]);

  const chip = summary.kind === "saved"
    ? (summary.enabled ? <StatusChip tone="success">On</StatusChip> : <StatusChip tone="neutral">Off</StatusChip>)
    : summary.kind === "none" ? <StatusChip tone="neutral">Not set up</StatusChip> : null;

  const detail = summary.kind === "loading" ? "Checking this store's settings…"
    : summary.kind === "unknown" ? "Status couldn't be read here. Open the estimator to see this store's settings."
    : summary.kind === "none" ? "No payment assumptions are set, so shoppers see no payment estimate."
    : `${summary.ranges} model-year ${summary.ranges === 1 ? "range" : "ranges"}${summary.complete ? "" : ", incomplete"}${summary.updatedAt ? `. Last applied ${new Date(summary.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}.`;

  return (
    <AdminCard title="Passport payment estimator" action={chip}
      description={`Retail finance assumptions for ${storeName}: model-year ranges, terms, assumed APRs and the default down payment. Every estimate shows its term, down payment and APR.`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[14px] text-adm-ink" aria-live="polite">
          <EstimatorIcon name="calculator" size={20} className="flex-shrink-0 text-adm-muted" />
          {detail}
        </p>
        <AdminLinkButton to={ADMIN_CHILD_ROUTES.paymentEstimator} variant="primary" className="min-h-[44px]">Configure estimator</AdminLinkButton>
      </div>
    </AdminCard>
  );
}
