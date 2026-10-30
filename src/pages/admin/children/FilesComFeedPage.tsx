import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ChildPageFrame } from "@/components/admin/v2/AdminShell";
import { Button, EmptyState, InlineNote, KeyValueList, Panel, SkeletonBlock, StatusText, Td, Th, WorkTable } from "@/components/product";

// Files.com inventory connector, phase 1: discovery, explicit dealer mapping
// and dry-run validation. Platform admins only; the server enforces it too.
// Nothing here writes inventory.

type Tone = "neutral" | "success" | "warning" | "danger" | "info";
type FileRow = { id: string; path: string; status: string; quarantine_reason: string | null; remote_size: number | null; remote_mtime: string | null; latest_event_at: string | null; latest_notified_at: string | null; discovered_at: string | null; last_run_id: string | null };
type Binding = { id: string; path: string; tenant_id: string | null; status: "pending" | "approved" | "disabled"; approved_at: string | null };
type Field = "match" | "mismatch" | "unknown";
type Report = {
  outcome: "passed" | "rejected";
  rejectReasons: string[];
  identity: { dealerId: string; dealerName: string; address: string; city: string; postal: string; region: string } | null;
  identities: number;
  counts: Record<string, number | null>;
  errors: Array<{ row: number; vin?: string; code: string; detail?: string }>;
  comparedInventory: boolean;
  identityReview?: { verdict: "match" | "mismatch" | "incomplete"; fields: Record<string, Field> } | null;
  tenantProfile?: { name: string | null; rooftopName: string | null; street: string | null; city: string | null; postal: string | null; region: string | null } | null;
};
type Run = { id: string; path: string; status: string; failure_reason: string | null; binding_status: string | null; tenant_id: string | null; started_at: string; finished_at: string | null; remote_size: number | null; report: Report | null };
type Overview = {
  config: { origin: string; folder: string; secrets: Record<string, boolean>; callbackPath: string };
  files: FileRow[]; bindings: Binding[]; runs: Run[];
  events: Array<{ id: string; action: string; path: string; received_at: string }>;
  tenants: Array<{ id: string; name: string }>;
};

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("files-inventory-admin", { body });
  if (error) {
    let code = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) code = ((await ctx.json()) as { error?: string }).error ?? code;
    } catch { /* keep message */ }
    throw new Error(code);
  }
  return data as T;
}

const fileName = (p: string) => p.split("/").pop() ?? p;
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : "Never");
const STATUS_TONE: Record<string, Tone> = { validated: "success", passed: "success", approved: "success", rejected: "danger", failed: "danger", quarantined: "warning", pending: "info", validating: "info", running: "info", disabled: "neutral" };
const FIELD_TONE: Record<Field, Tone> = { match: "success", mismatch: "danger", unknown: "neutral" };
const callbackUrl = (path: string) => `${import.meta.env.VITE_SUPABASE_URL ?? ""}${path}`;

export default function FilesComFeedPage() {
  const { isAdmin, loading } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: Tone; text: string } | null>(null);
  const q = useQuery({ queryKey: ["filescom-overview"], queryFn: () => call<Overview>({ action: "overview" }), enabled: isAdmin });
  const run = useMutation({
    mutationFn: (body: Record<string, unknown>) => call<Record<string, unknown>>(body),
    onSuccess: (_d, body) => { setNotice({ tone: "success", text: `${String(body.action).replace(/_/g, " ")} finished` }); qc.invalidateQueries({ queryKey: ["filescom-overview"] }); },
    onError: (e: Error) => setNotice({ tone: "danger", text: e.message }),
  });

  const crumbs = [{ label: "Administration", href: "/admin" }, { label: "Integrations", href: "/admin?tab=integrations" }, { label: "Files.com inventory" }];
  if (loading) return <ChildPageFrame section="integrations" crumbs={crumbs} title="Files.com inventory"><SkeletonBlock className="h-64 w-full" /></ChildPageFrame>;
  if (!isAdmin) {
    return (
      <ChildPageFrame section="integrations" crumbs={crumbs} title="Files.com inventory">
        <Panel><EmptyState title="Platform administrators only" detail="This connector maps feeds across dealers, so it is limited to platform administrators." compact /></Panel>
      </ChildPageFrame>
    );
  }

  const d = q.data;
  const bindingOf = (path: string) => d?.bindings.find((b) => b.path === path) ?? null;
  const tenantName = (id: string | null) => (id ? d?.tenants.find((t) => t.id === id)?.name ?? "Unknown dealer" : "Not mapped");
  const latestRun = (path: string) => d?.runs.find((r) => r.path === path) ?? null;
  const keyMissing = d ? !d.config.secrets.FILESCOM_API_KEY : false;
  const sel = selected && d ? d.files.find((f) => f.path === selected) ?? null : null;

  return (
    <ChildPageFrame
      section="integrations"
      crumbs={crumbs}
      title="Files.com inventory"
      badge={<StatusText tone="info">Dry run only</StatusText>}
      subtitle="vAuto inventory files from Files.com. Validation never changes vehicles, prices or the customer Passport."
      actions={<Button variant="primary" disabled={!d || keyMissing || run.isPending} onClick={() => run.mutate({ action: "discover" })}>Discover files</Button>}
    >
      <div className="space-y-4">
        {notice && <InlineNote tone={notice.tone} title={notice.text} />}
        {q.isError && <InlineNote tone="danger" title="Could not load the connector" action={<Button size="sm" onClick={() => q.refetch()}>Retry</Button>}>{(q.error as Error).message}</InlineNote>}
        {q.isLoading && <SkeletonBlock className="h-64 w-full" />}

        {d && (
          <>
            <Panel title="Connection health">
              <KeyValueList rows={[
                { label: "Files.com site", value: d.config.origin },
                { label: "Watched folder", value: d.config.folder },
                { label: "Read-only API key", value: <StatusText tone={d.config.secrets.FILESCOM_API_KEY ? "success" : "danger"}>{d.config.secrets.FILESCOM_API_KEY ? "Saved" : "Missing: FILESCOM_API_KEY"}</StatusText> },
                { label: "Webhook verification token", value: <StatusText tone={d.config.secrets.FILESCOM_WEBHOOK_SECRET ? "success" : "danger"}>{d.config.secrets.FILESCOM_WEBHOOK_SECRET ? "Saved" : "Missing: FILESCOM_WEBHOOK_SECRET"}</StatusText> },
                { label: "Webhook callback URL", value: <code className="break-all text-[13px]">{callbackUrl(d.config.callbackPath)}</code> },
                { label: "Last webhook received", value: d.events[0] ? `${when(d.events[0].received_at)} (${d.events[0].action}, ${fileName(d.events[0].path)})` : "None received yet" },
                { label: "Last discovery", value: when(d.files.map((f) => f.discovered_at).filter(Boolean).sort().pop() ?? null) },
              ]} />
            </Panel>

            <Panel title="Files" description="Files without an approved dealer mapping are held in quarantine." flush>
              {d.files.length === 0 ? (
                <EmptyState title="No files recorded yet" detail={keyMissing ? "Save the read-only API key, then run Discover files." : "Run Discover files to list the inbound folder."} compact />
              ) : (
                <WorkTable caption="Files.com inventory files" minWidth={900}>
                  <thead><tr><Th>File</Th><Th>Dealer mapping</Th><Th>Status</Th><Th align="right">Size</Th><Th>Modified</Th><Th>Last dry run</Th><Th align="right">Actions</Th></tr></thead>
                  <tbody>
                    {d.files.map((f) => {
                      const b = bindingOf(f.path);
                      const r = latestRun(f.path);
                      return (
                        <tr key={f.id}>
                          <Td className="font-semibold">{fileName(f.path)}</Td>
                          <Td>{b ? <><StatusText tone={STATUS_TONE[b.status]}>{b.status}</StatusText> <span className="ml-1">{tenantName(b.tenant_id)}</span></> : <StatusText tone="warning">Unmapped</StatusText>}</Td>
                          <Td><StatusText tone={STATUS_TONE[f.status] ?? "neutral"}>{f.status}</StatusText>{f.quarantine_reason && <span className="ml-1 text-adm-muted text-[12px]">{f.quarantine_reason.replace(/_/g, " ")}</span>}</Td>
                          <Td align="right">{f.remote_size === null ? "Unknown" : `${Math.round(f.remote_size / 1024)} KB`}</Td>
                          <Td>{when(f.remote_mtime)}</Td>
                          <Td>{r ? <StatusText tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</StatusText> : "Never"}</Td>
                          <Td align="right">
                            <div className="flex justify-end gap-2">
                              <Button size="sm" disabled={keyMissing || run.isPending} onClick={() => run.mutate({ action: "validate", path: f.path })}>{r ? "Retry dry run" : "Dry run"}</Button>
                              <Button size="sm" variant="ghost" onClick={() => setSelected(f.path)}>Review mapping</Button>
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </WorkTable>
              )}
            </Panel>

            {sel && <MappingReview key={sel.path} path={sel.path} binding={bindingOf(sel.path)} run={latestRun(sel.path)} tenantName={tenantName} busy={run.isPending} act={(b) => run.mutate(b)} />}

            <Panel title="Dry-run history" flush>
              {d.runs.length === 0 ? <EmptyState title="No dry runs yet" compact /> : (
                <WorkTable caption="Dry-run history" minWidth={900}>
                  <thead><tr><Th>Started</Th><Th>File</Th><Th>Dealer</Th><Th>Result</Th><Th align="right">Rows</Th><Th align="right">Errors</Th><Th align="right">Additions</Th><Th align="right">Updates</Th><Th align="right">Absent</Th><Th>Reason</Th></tr></thead>
                  <tbody>
                    {d.runs.map((r) => {
                      const c = r.report?.counts;
                      const n = (k: string) => (c && c[k] !== null && c[k] !== undefined ? String(c[k]) : "Unknown");
                      return (
                        <tr key={r.id}>
                          <Td>{when(r.started_at)}</Td><Td>{fileName(r.path)}</Td><Td>{tenantName(r.tenant_id)}</Td>
                          <Td><StatusText tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</StatusText></Td>
                          <Td align="right">{n("rows")}</Td><Td align="right">{n("errors")}</Td><Td align="right">{n("additions")}</Td><Td align="right">{n("updates")}</Td><Td align="right">{n("absenceCandidates")}</Td>
                          <Td className="text-[12px]">{r.failure_reason?.replace(/_/g, " ") ?? ""}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </WorkTable>
              )}
            </Panel>
            <InlineNote tone="info" title="Absent vehicles are not marked sold">A vehicle listed in AutoLabels but missing from a file is counted as absent for review only. Phase 1 makes no inventory changes and no MarketCheck requests.</InlineNote>
          </>
        )}
      </div>
    </ChildPageFrame>
  );
}

function MappingReview({ path, binding, run, tenantName, busy, act }: { path: string; binding: Binding | null; run: Run | null; tenantName: (id: string | null) => string; busy: boolean; act: (b: Record<string, unknown>) => void }) {
  const [term, setTerm] = useState("");
  const [ack, setAck] = useState(false);
  const search = useQuery({ queryKey: ["filescom-tenants", term], queryFn: () => call<{ tenants: Array<{ id: string; name: string; is_active: boolean }> }>({ action: "search_tenants", q: term }), enabled: term.trim().length >= 2 });
  const report = run?.report ?? null;
  const reviewForBinding = run && binding && run.tenant_id === binding.tenant_id ? report?.identityReview ?? null : null;
  const id = report?.identity;
  const tp = run && binding && run.tenant_id === binding.tenant_id ? report?.tenantProfile ?? null : null;
  const rows: Array<[string, string, Field | null, string | null | undefined, string | null | undefined]> = [
    ["Dealer name", "name", reviewForBinding?.fields.name ?? null, id?.dealerName, tp ? [tp.name, tp.rooftopName].filter(Boolean).join(" / ") : null],
    ["Address", "address", reviewForBinding?.fields.address ?? null, id?.address, tp?.street],
    ["City", "city", reviewForBinding?.fields.city ?? null, id?.city, tp?.city],
    ["Postal code", "postal", reviewForBinding?.fields.postal ?? null, id?.postal, tp?.postal],
    ["Region", "region", reviewForBinding?.fields.region ?? null, id?.region, tp?.region],
  ];

  return (
    <Panel title={`Mapping review: ${fileName(path)}`} description="Map this file to exactly one dealer. The filename alone never decides it.">
      <div className="space-y-4">
        <KeyValueList rows={[
          { label: "Current mapping", value: binding ? `${binding.status}: ${tenantName(binding.tenant_id)}` : "Unmapped (quarantined)" },
          { label: "File DealerId", value: id?.dealerId || (report ? (report.identities > 1 ? `Mixed: ${report.identities} identities` : "Missing") : "Run a dry run to read it") },
        ]} />

        {report && (
          <WorkTable caption="Identity comparison" inset>
            <thead><tr><Th>Field</Th><Th>In the file</Th><Th>Dealer on record</Th><Th>Result</Th></tr></thead>
            <tbody>
              {rows.map(([label, k, f, a, b]) => (
                <tr key={k}><Td>{label}</Td><Td>{a || "Missing"}</Td><Td>{b || (binding ? "Not on record" : "No dealer chosen")}</Td><Td>{f ? <StatusText tone={FIELD_TONE[f]}>{f}</StatusText> : "Not compared"}</Td></tr>
              ))}
            </tbody>
          </WorkTable>
        )}
        {binding && run && run.tenant_id !== binding.tenant_id && <InlineNote tone="warning" title="Run a dry run against the proposed dealer before approving." />}
        {report && report.outcome === "rejected" && <InlineNote tone="danger" title="Latest dry run was rejected">{report.rejectReasons.join(", ").replace(/_/g, " ")}{report.errors.length > 0 && ` (first: row ${report.errors[0].row}, ${report.errors[0].code.replace(/_/g, " ")})`}</InlineNote>}

        {binding?.status !== "approved" && (
          <div className="space-y-2">
            <label className="block text-[13px] font-semibold text-adm-ink" htmlFor="fc-tenant-search">Propose a dealer</label>
            <input id="fc-tenant-search" className="w-full max-w-md rounded-[4px] border border-adm-border bg-adm-surface px-3 py-2 text-[14px]" placeholder="Search dealer name" value={term} onChange={(e) => setTerm(e.target.value)} />
            {(search.data?.tenants ?? []).map((t) => (
              <div key={t.id} className="flex items-center justify-between max-w-md border-b border-adm-border py-1.5">
                <span>{t.name}{!t.is_active && " (inactive)"}</span>
                <Button size="sm" disabled={busy} onClick={() => act({ action: "propose_binding", path, tenant_id: t.id })}>Propose</Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {binding?.status === "pending" && (
            <>
              {reviewForBinding && reviewForBinding.verdict !== "match" && (
                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I reviewed the {reviewForBinding.verdict} fields and confirm this dealer</label>
              )}
              <Button variant="primary" disabled={busy || !reviewForBinding || (reviewForBinding.verdict !== "match" && !ack)} onClick={() => act({ action: "approve_binding", path, acknowledge_identity: ack })}>Approve mapping</Button>
            </>
          )}
          {binding && binding.status !== "disabled" && <Button variant="danger" disabled={busy} onClick={() => act({ action: "disable_binding", path })}>Disable mapping</Button>}
        </div>
      </div>
    </Panel>
  );
}
