import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useReconEstimates, type ReconEstimate, type NewLine } from "@/hooks/useReconEstimates";
import { useDealerSettings, type ReconCannedService } from "@/contexts/DealerSettingsContext";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Trash2, Send, Loader2 } from "lucide-react";
import { Button, LocalTabs, MetricStrip, PageBody, PageHeader, QueryState, Td, Th, WorkTable, type LocalTab } from "@/components/product";
import { EstimateState, ageOf, money } from "@/components/recon/estimateParts";

type ReconView = "pending" | "in-recon" | "closed" | "all";
const CATEGORIES = ["mechanical", "safety", "tires", "glass", "cosmetic", "interior", "detail", "keys", "sublet"];

export default function ReconBoard() {
  const { estimates, isManager, loading, submit } = useReconEstimates();
  const { settings } = useDealerSettings();
  const canned = settings.recon_canned_services || [];
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const viewParam = searchParams.get("view");
  const view: ReconView = viewParam === "in-recon" || viewParam === "closed" || viewParam === "all" ? viewParam : "pending";
  const [showNew, setShowNew] = useState(false);
  const { tenant } = useTenant();
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!tenant?.id || tenant.id === "house") return;
    // deno-lint-ignore no-explicit-any
    void (supabase as any).rpc("list_tenant_members", { p_tenant_id: tenant.id }).then(({ data }: { data: Array<{ user_id?: string; email?: string }> | null }) => {
      const map: Record<string, string> = {};
      for (const m of data || []) if (m.user_id && m.email) map[m.user_id] = m.email.split("@")[0];
      setNames(map);
    });
  }, [tenant?.id]);
  const legacyEstimate = searchParams.get("estimate");

  const groups = useMemo(() => ({
    needs: estimates.filter((e) => e.status === "submitted"),
    inRecon: estimates.filter((e) => e.status === "approved" || e.status === "partially_approved"),
    closed: estimates.filter((e) => e.status === "declined" || e.status === "completed" || e.status === "voided"),
  }), [estimates]);

  const tabDefs: Array<{ id: ReconView; label: string; items: ReconEstimate[] }> = [
    { id: "pending", label: isManager ? "Pending review" : "Awaiting approval", items: groups.needs },
    { id: "in-recon", label: "In recon", items: groups.inRecon },
    { id: "closed", label: "Closed", items: groups.closed },
    { id: "all", label: "All estimates", items: estimates },
  ];
  const tabs: LocalTab[] = tabDefs.map((t) => ({
    key: t.id,
    label: t.label,
    to: `/recon?view=${t.id}`,
    count: loading ? null : t.items.length,
    active: t.id === view,
  }));
  const shown = tabDefs.find((t) => t.id === view)!;
  const openEstimate = (id: string) => navigate(`/recon/estimates/${encodeURIComponent(id)}`);
  const status = loading ? "loading" : shown.items.length === 0 ? "empty" : "ready";

  if (legacyEstimate) return <Navigate to={`/recon/estimates/${encodeURIComponent(legacyEstimate)}`} replace />;

  return (
    <PageBody width="wide">
      <PageHeader
        title="Recon Approvals"
        actions={<Button variant="primary" onClick={() => setShowNew(true)}>New estimate</Button>}
      />

      <LocalTabs label="Recon estimate states" tabs={tabs} />

      <MetricStrip
        numberFirst
        label="Recon estimate totals"
        metrics={[
          { label: isManager ? "Pending review" : "Awaiting approval", value: loading ? null : groups.needs.length, loading, tone: "warning" },
          { label: "Pending amount", value: loading ? null : money(groups.needs.reduce((s, e) => s + (e.subtotal || 0), 0)), loading, tone: "neutral" },
          { label: "In recon", value: loading ? null : groups.inRecon.length, loading, tone: "info" },
          { label: "Approved amount", value: loading ? null : money(groups.inRecon.reduce((s, e) => s + (e.approved_total || 0), 0)), loading, tone: "success" },
        ]}
      />

      <div>
        <QueryState
          status={status}
          emptyTitle={estimates.length === 0 ? "No recon estimates yet." : `No estimates are ${shown.label.toLowerCase()}.`}
          emptyDetail={estimates.length === 0 ? "Service submits the first one with New estimate." : `This is the ${shown.label} view only; ${estimates.length} ${estimates.length === 1 ? "estimate exists" : "estimates exist"} in total.`}
        >
          <div className="overflow-hidden rounded-[6px] border border-adm-border bg-adm-surface">
            <WorkTable caption="Recon estimates" minWidth={820}>
              <thead>
                <tr>
                  <Th>Age</Th>
                  <Th>Estimate #</Th>
                  <Th>Vehicle</Th>
                  <Th>Owner</Th>
                  <Th align="right">Total</Th>
                  <Th>Status</Th>
                  <Th>Next action</Th>
                </tr>
              </thead>
              <tbody>
                {shown.items.map((e) => (
                  <tr key={e.id} className="h-14 hover:bg-adm-workspace">
                    <Td className="whitespace-nowrap text-adm-muted">{ageOf(e.created_at)}</Td>
                    <Td className="whitespace-nowrap font-mono text-[13px] text-adm-muted">{`REC-${e.id.slice(0, 8).toUpperCase()}`}</Td>
                    <Td className="max-w-[300px] truncate font-medium text-adm-ink">{e.ymm || "Vehicle"}</Td>
                    <Td className="text-adm-muted">{(e.submitted_by && names[e.submitted_by]) || "Unknown"}</Td>
                    <Td align="right" className="tabular-nums">{money(e.subtotal)}</Td>
                    <Td><EstimateState status={e.status} /></Td>
                    <Td><button type="button" onClick={() => openEstimate(e.id)} aria-label={`Review estimate for ${e.ymm || e.vin}`} className="text-[14px] font-semibold text-adm-primary hover:underline">{e.status === "submitted" ? "Review" : "View"}</button></Td>
                  </tr>
                ))}
              </tbody>
            </WorkTable>
          </div>
        </QueryState>
      </div>

      {showNew && <NewEstimateModal canned={canned} onClose={() => setShowNew(false)} onSubmit={async (input) => { const ok = await submit(input); if (ok) { setShowNew(false); toast.success("Recon estimate submitted"); } else toast.error("Couldn't submit — check the VIN belongs to your inventory."); return ok; }} />}
    </PageBody>
  );
}

function NewEstimateModal({ canned, onClose, onSubmit }: { canned: ReconCannedService[]; onClose: () => void; onSubmit: (input: { vin: string; ymm?: string; notes?: string; lines: NewLine[] }) => Promise<boolean> }) {
  const [vin, setVin] = useState("");
  const [ymm, setYmm] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<NewLine[]>([{ description: "", category: "mechanical", severity: "recommended", labor_cost: 0, parts_cost: 0 }]);
  const [busy, setBusy] = useState(false);
  const valid = vin.trim().length >= 11 && lines.some((l) => l.description.trim());
  const set = (i: number, patch: Partial<NewLine>) => setLines((s) => s.map((l, x) => x === i ? { ...l, ...patch } : l));
  const addCanned = (c: ReconCannedService) => setLines((s) => {
    const next = [...s.filter((l) => l.description.trim()), { description: c.label, category: c.category, severity: c.severity, labor_cost: c.labor_cost, parts_cost: c.parts_cost }];
    return next.length ? next : s;
  });
  // Sort the preprinted choices most-used first (self-aware common services).
  const cannedSorted = [...canned].sort((a, b) => (b.uses || 0) - (a.uses || 0));

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-adm-surface w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-adm-ink mb-3">New recon estimate</h2>
        {cannedSorted.length > 0 && (
          <div className="mb-3">
            <p className="text-[12px] leading-[18px] font-semibold uppercase tracking-wider text-adm-muted mb-1.5">Quick add</p>
            <div className="flex flex-wrap gap-1.5">
              {cannedSorted.map((c, i) => (
                <button key={i} onClick={() => addCanned(c)} className="h-8 px-2.5 rounded-md border border-adm-border text-xs font-medium hover:border-primary hover:bg-primary/5">
                  + {c.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} placeholder="VIN" className="h-10 rounded-lg border border-adm-border bg-adm-surface px-3 text-sm" />
          <input value={ymm} onChange={(e) => setYmm(e.target.value)} placeholder="Year Make Model" className="h-10 rounded-lg border border-adm-border bg-adm-surface px-3 text-sm" />
        </div>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes for the manager (optional)" className="w-full h-10 rounded-lg border border-adm-border bg-adm-surface px-3 text-sm mb-3" />

        <div className="space-y-3">
          {lines.map((l, i) => (
            <div key={i} className="rounded-xl border border-adm-border p-3 space-y-2">
              <div className="flex gap-2">
                <input value={l.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="Work needed (e.g. Front brake pads & rotors)" className="flex-1 h-9 rounded-lg border border-adm-border bg-adm-surface px-3 text-sm" />
                {lines.length > 1 && <button onClick={() => setLines((s) => s.filter((_, x) => x !== i))} className="w-9 h-9 grid place-items-center rounded-lg border border-adm-border text-adm-muted"><Trash2 className="w-4 h-4" /></button>}
              </div>
              <div className="flex gap-2">
                <select value={l.category} onChange={(e) => set(i, { category: e.target.value })} className="h-9 rounded-lg border border-adm-border bg-adm-surface px-2 text-sm flex-1">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={l.severity} onChange={(e) => set(i, { severity: e.target.value })} className="h-9 rounded-lg border border-adm-border bg-adm-surface px-2 text-sm">
                  <option value="required">Required</option><option value="recommended">Recommended</option>
                </select>
              </div>
              <div className="flex gap-2">
                <input type="number" min={0} value={l.labor_cost || ""} onChange={(e) => set(i, { labor_cost: parseFloat(e.target.value) || 0 })} placeholder="Labor $" className="h-9 rounded-lg border border-adm-border bg-adm-surface px-3 text-sm w-1/3" />
                <input type="number" min={0} value={l.parts_cost || ""} onChange={(e) => set(i, { parts_cost: parseFloat(e.target.value) || 0 })} placeholder="Parts $" className="h-9 rounded-lg border border-adm-border bg-adm-surface px-3 text-sm w-1/3" />
                <input type="number" min={0} value={l.sublet_cost || ""} onChange={(e) => set(i, { sublet_cost: parseFloat(e.target.value) || 0 })} placeholder="Sublet $" className="h-9 rounded-lg border border-adm-border bg-adm-surface px-3 text-sm w-1/3" />
              </div>
            </div>
          ))}
          <button onClick={() => setLines((s) => [...s, { description: "", category: "mechanical", severity: "recommended", labor_cost: 0, parts_cost: 0 }])} className="h-9 px-3 rounded-lg border border-dashed border-adm-border text-xs font-semibold inline-flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add line</button>
        </div>

        <div className="flex gap-2 mt-4">
          <button disabled={!valid || busy} onClick={async () => { setBusy(true); await onSubmit({ vin: vin.trim(), ymm: ymm.trim() || undefined, notes: notes.trim() || undefined, lines: lines.filter((l) => l.description.trim()) }); setBusy(false); }} className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Submit to manager</button>
          <button onClick={onClose} className="h-11 px-5 rounded-xl border border-adm-border font-semibold">Cancel</button>
        </div>
      </div>
    </div>
  );
}
