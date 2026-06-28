import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";

// ──────────────────────────────────────────────────────────────────────
// useReconEstimates — the in-app recon workspace data layer. Service submits
// estimates; managers approve/decline; either party posts questions. Reads are
// tenant-scoped via RLS; writes go through the member-gated RPCs.
// ──────────────────────────────────────────────────────────────────────

export interface ReconLine {
  id: string; estimate_id: string; category: string | null; description: string; severity: string;
  labor_cost: number; parts_cost: number; sublet_cost: number; line_total: number; vendor: string | null;
  photos: unknown[]; approval_status: string; approved_amount: number | null; decline_reason: string | null;
  decided_by: string | null; decided_role: string | null; decided_at: string | null;
}
export interface ReconEstimate {
  id: string; vin: string; ymm: string | null; status: string; submitted_by: string | null;
  submitted_role: string | null; notes: string | null; subtotal: number; approved_total: number;
  approval_token: string; created_at: string;
}
export interface ReconMessage {
  id: string; estimate_id: string; author_id: string | null; author_name: string | null;
  author_role: string | null; body: string; created_at: string;
}
export interface NewLine {
  category?: string; description: string; severity?: string;
  labor_cost?: number; parts_cost?: number; sublet_cost?: number; vendor?: string;
}

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

export function useReconEstimates() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const [estimates, setEstimates] = useState<ReconEstimate[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const byName = (user?.user_metadata as { full_name?: string } | undefined)?.full_name || user?.email || "";
  const isManager = role === "owner" || role === "admin" || role === "manager";

  const load = useCallback(async () => {
    if (!tenantId) { setEstimates([]); setLoading(false); return; }
    setLoading(true);
    const [{ data: rows }, { data: mem }] = await Promise.all([
      sb().from("recon_estimates").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(500),
      user ? sb().from("tenant_members").select("role").eq("user_id", user.id).eq("tenant_id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    setEstimates((rows as ReconEstimate[]) || []);
    setRole((mem?.role as string) || null);
    setLoading(false);
  }, [tenantId, user]);
  useEffect(() => { load(); }, [load]);

  const loadDetail = useCallback(async (estimateId: string): Promise<{ lines: ReconLine[]; messages: ReconMessage[] }> => {
    const [{ data: lines }, { data: messages }] = await Promise.all([
      sb().from("recon_estimate_lines").select("*").eq("estimate_id", estimateId).order("created_at", { ascending: true }),
      sb().from("recon_estimate_messages").select("*").eq("estimate_id", estimateId).order("created_at", { ascending: true }),
    ]);
    return { lines: (lines as ReconLine[]) || [], messages: (messages as ReconMessage[]) || [] };
  }, []);

  const submit = useCallback(async (input: { vin: string; ymm?: string; notes?: string; lines: NewLine[] }): Promise<boolean> => {
    const { data } = await sb().rpc("recon_submit_member", {
      _vin: input.vin, _ymm: input.ymm || null, _notes: input.notes || null, _by: byName,
      _lines: input.lines.map((l) => ({
        category: l.category || null, description: l.description, severity: l.severity || "recommended",
        labor_cost: l.labor_cost || 0, parts_cost: l.parts_cost || 0, sublet_cost: l.sublet_cost || 0, vendor: l.vendor || null,
      })),
    });
    if (!data?.ok) return false;
    if (data.needs_approval && data.approval_token) {
      try { await sb().functions.invoke("notify-recon-approval", { body: { approval_token: data.approval_token } }); } catch { /* email best-effort */ }
    }
    await load();
    return true;
  }, [byName, load]);

  const decide = useCallback(async (estimateId: string, lineId: string | null, action: "approve" | "decline" | "defer", reason?: string): Promise<boolean> => {
    const { data } = await sb().rpc("recon_decide_member", {
      _estimate_id: estimateId, _line_id: lineId, _action: action, _reason: reason || null, _by: byName,
    });
    if (data?.ok) await load();
    return !!data?.ok;
  }, [byName, load]);

  const postMessage = useCallback(async (estimateId: string, body: string): Promise<boolean> => {
    const { data } = await sb().rpc("recon_post_message", { _estimate_id: estimateId, _body: body, _by: byName });
    return !!data?.ok;
  }, [byName]);

  return { estimates, role, isManager, byName, loading, reload: load, loadDetail, submit, decide, postMessage };
}
