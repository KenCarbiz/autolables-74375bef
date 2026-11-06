import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import type { VehicleListing } from "@/hooks/useVehicleListing";
import { assessPassportCoverage, type CoverageStatus, type PassportCoverageReport } from "@/lib/vehicleData/passportCoverage";
import { AdminButton, AdminCard, AdminTable, EmptyState, ICON, InlineNote, SkeletonBlock, StatusChip, Td, Th, type Tone } from "./v2/primitives";

// PassportDataCoveragePanel is read-only. It loads one vehicle_listings row for
// the signed-in tenant and grades what the Passports received, stored and use
// via assessPassportCoverage. It never calls a provider and never writes. If
// the row cannot be read, it shows an error and no report: a coverage report
// built from a failed read would present missing data as a finding.

const SELECT =
  "id, slug, vin, ymm, trim, mileage, condition, price, market_value, market_meta, market_payload, comparables, history_payload, recall_status, open_recall_count, recall_payload, recall_check, recall_checked_at, blackbook, enriched_at, source_url, mc_attributes, mc_raw, key_specs, epa_economy, warranty_info, owning_store_id, updated_at, hero_image_url, dealer_snapshot, photos, service_records, status";

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

const STATUS_META: Record<CoverageStatus, { label: string; tone: Tone }> = {
  full: { label: "Full", tone: "success" },
  partial: { label: "Partial", tone: "warning" },
  unavailable: { label: "Unavailable", tone: "danger" },
  held: { label: "Held", tone: "info" },
  not_requested: { label: "Not requested", tone: "neutral" },
};

const fmtDate = (iso: string | null) => {
  if (!iso) return "Unknown";
  const t = new Date(iso);
  return Number.isFinite(t.getTime()) ? t.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Unknown";
};

async function loadReport(tenantId: string, vin: string): Promise<PassportCoverageReport | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("vehicle_listings")
    .select(SELECT)
    .eq("tenant_id", tenantId)
    .eq("vin", vin)
    .maybeSingle();
  if (error) throw new Error(error.message || "Query failed");
  if (!data) return null;
  return assessPassportCoverage(data as unknown as VehicleListing);
}

function CoverageReport({ report }: { report: PassportCoverageReport }) {
  const [filter, setFilter] = useState("all");
  const statuses = useMemo(() => Array.from(new Set(report.fields.map((f) => f.status))).sort(), [report]);
  const fields = useMemo(
    () => (filter === "all" ? report.fields : report.fields.filter((f) => f.status === filter)),
    [report, filter],
  );

  return (
    <div className="space-y-4">
      <AdminCard title={`Coverage for ${report.vin}`} flush>
        <AdminTable caption="Passport data coverage by category">
          <thead>
            <tr>
              <Th>Category</Th>
              <Th>Status</Th>
              <Th>Source</Th>
              <Th>Last updated</Th>
              <Th>Detail</Th>
            </tr>
          </thead>
          <tbody>
            {report.categories.map((c) => {
              const meta = STATUS_META[c.status];
              return (
                <tr key={c.key}>
                  <Td className="font-semibold">{c.label}</Td>
                  <Td><StatusChip tone={meta.tone} icon>{meta.label}</StatusChip></Td>
                  <Td className="text-adm-muted">{c.source}</Td>
                  <Td className="text-adm-muted">{fmtDate(c.lastUpdated)}</Td>
                  <Td>
                    <p>{c.detail}</p>
                    {c.holdReason && <p className="text-[12px] leading-[18px] text-adm-warning">{c.holdReason}</p>}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </AdminTable>
      </AdminCard>

      <details className="rounded-[6px] border border-adm-border bg-adm-surface">
        <summary className="cursor-pointer px-6 py-4 text-[15px] font-semibold text-adm-ink">
          Field-level crosswalk ({report.fields.length} fields)
        </summary>
        <div className="px-6 pb-4">
          <label className="flex items-center gap-2 text-[13px] text-adm-muted mb-3">
            Status
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="min-h-[32px] rounded-md border border-adm-border bg-adm-surface px-2 text-[13px] text-adm-ink"
            >
              <option value="all">All</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <AdminTable caption="Field-level crosswalk" dense inset minWidth={760}>
            <thead>
              <tr>
                <Th>Group</Th>
                <Th>Field</Th>
                <Th>Provider</Th>
                <Th>Destination</Th>
                <Th>Status</Th>
                <Th>Present</Th>
                <Th>Note</Th>
              </tr>
            </thead>
            <tbody>
              {fields.length === 0 ? (
                <tr><Td colSpan={7} className="text-adm-muted">No fields with this status.</Td></tr>
              ) : fields.map((f) => (
                <tr key={`${f.group}:${f.path}`}>
                  <Td>{f.group}</Td>
                  <Td className="font-mono">{f.path}</Td>
                  <Td>{f.provider}</Td>
                  <Td>{f.destination}</Td>
                  <Td>{f.status}</Td>
                  <Td><StatusChip tone={f.present ? "success" : "neutral"}>{f.present ? "Present" : "Missing"}</StatusChip></Td>
                  <Td className="text-adm-muted">{f.note}</Td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        </div>
      </details>

      <AdminCard title="New provider fields not yet mapped" description="Keys the provider returned that the field registry does not know about.">
        {report.unknownFields.length === 0 ? (
          <p className="text-[14px] text-adm-muted">None. Every returned field is mapped or deliberately excluded.</p>
        ) : (
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 text-[13px]">
            {report.unknownFields.map((u) => (
              <li key={`${u.group}:${u.path}`} className="font-mono text-adm-ink">
                <span className="text-adm-muted">{u.group}.</span>{u.path}
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </div>
  );
}

export default function PassportDataCoveragePanel() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id || null;
  const [input, setInput] = useState("");
  const [vin, setVin] = useState<string | null>(null);
  const invalid = input.trim().length > 0 && !VIN_RE.test(input.trim().toUpperCase());

  const q = useQuery({
    queryKey: ["admin", "passport-coverage", tenantId, vin],
    enabled: !!tenantId && !!vin,
    staleTime: 30_000,
    retry: false,
    queryFn: () => loadReport(tenantId as string, vin as string),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = input.trim().toUpperCase();
    if (VIN_RE.test(next)) setVin(next);
  };

  return (
    <div className="space-y-3">
      <AdminCard
        title="Passport data coverage"
        description="Read-only. For one VIN: what each provider returned, what was stored, and what the Passports use. No provider calls are made."
      >
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[13px] text-adm-muted">
            VIN
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={17}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={invalid}
              className="min-h-[36px] w-64 rounded-md border border-adm-border bg-adm-surface px-3 font-mono text-[14px] uppercase text-adm-ink"
              placeholder="17-character VIN"
            />
          </label>
          <AdminButton type="submit" variant="primary" disabled={!VIN_RE.test(input.trim().toUpperCase()) || !tenantId}>
            <Search className={ICON.button} aria-hidden="true" /> Check coverage
          </AdminButton>
          {invalid && <span className="text-[13px] text-adm-danger">Enter a valid 17-character VIN.</span>}
        </form>
      </AdminCard>

      {q.isLoading && <SkeletonBlock className="h-40 w-full" />}
      {q.isError && (
        <InlineNote tone="danger" title="Coverage could not be loaded">
          The vehicle record could not be read, so no report is shown. Try again shortly.
        </InlineNote>
      )}
      {q.isSuccess && q.data === null && (
        <EmptyState compact title="No vehicle found" detail="No listing with this VIN exists for this rooftop." />
      )}
      {q.isSuccess && q.data && <CoverageReport report={q.data} />}
    </div>
  );
}
