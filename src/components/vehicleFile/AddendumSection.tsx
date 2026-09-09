import { useCallback, useEffect, useState } from "react";
import { deriveRecallView } from "@/lib/vehicleTruth/recallView";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, Clock, Copy, FileText, Loader2, Plus, Printer, RefreshCw, Send,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { deriveGetReadyDispatch } from "@/hooks/useGetReady";
import EmptyState from "@/components/ui/empty-state";
import { Card, Section, btn, btnPrimary } from "./primitives";
import type { VehicleRow } from "./types";

interface AddendumRow {
  id: string;
  created_at: string;
  updated_at: string | null;
  status: string | null;
  customer_name: string | null;
  cobuyer_name: string | null;
  content_hash: string | null;
  signed_at: string | null;
  token: string | null;
  total_price: number | null;
  accepted_at: string | null;
  getready_dispatched_at: string | null;
}

const AddendumCard = ({ row, onOpen, onCopyLink, canAccept, accepting, onAccept, stale, onUpdate }: {
  row: AddendumRow;
  onOpen: () => void;
  onCopyLink: (token: string | null) => void;
  canAccept?: boolean;
  accepting?: boolean;
  onAccept?: () => void;
  stale?: boolean;
  onUpdate?: () => void;
}) => {
  const signed = row.status === "signed" || !!row.signed_at;
  const accepted = !!row.accepted_at;
  return (
    <div className={`rounded-xl border bg-card p-4 flex items-center gap-4 ${stale ? "border-amber-300" : "border-border"}`}>
      <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
        signed ? "bg-emerald-100 text-emerald-700" : accepted ? "bg-emerald-50 text-emerald-700" : "bg-amber-100 text-amber-700"
      }`}>
        {signed || accepted ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-al-body font-semibold text-foreground truncate">
          {row.customer_name || "Unnamed customer"}
          {row.cobuyer_name ? <span className="text-muted-foreground"> + {row.cobuyer_name}</span> : null}
        </p>
        <div className="flex items-center gap-3 text-al-meta text-muted-foreground mt-0.5 flex-wrap">
          <span>{new Date(row.created_at).toLocaleDateString()}</span>
          {typeof row.total_price === "number" && <span className="tabular-nums">${row.total_price.toLocaleString()}</span>}
          {!signed && accepted && (
            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
              <CheckCircle2 className="w-3 h-3" /> Accepted {new Date(row.accepted_at as string).toLocaleDateString()}
            </span>
          )}
          {row.getready_dispatched_at && (
            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
              <Send className="w-3 h-3" /> Get-Ready sent
            </span>
          )}
          {stale && (
            <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
              <AlertTriangle className="w-3 h-3" /> Get-Ready changed since acceptance
            </span>
          )}
          {row.content_hash && <span className="font-mono">hash: {row.content_hash.slice(0, 10)}…</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {!signed && stale && onUpdate && (
          <button onClick={onUpdate} className={btn} title="Rebuild this addendum from the latest Get-Ready installs">
            <RefreshCw className="w-3 h-3" /> Update
          </button>
        )}
        {!signed && !accepted && canAccept && onAccept && (
          <button onClick={onAccept} disabled={accepting} className={btn} title="Accept this addendum and send the Get-Ready to the shop">
            {accepting ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Accept &amp; send
          </button>
        )}
        {!signed && row.token && (
          <button onClick={() => onCopyLink(row.token)} className={btn} title="Copy the signing link">
            <Copy className="w-3 h-3" /> Link
          </button>
        )}
        <button onClick={onOpen} className={btnPrimary}>Open <ArrowUpRight className="w-3 h-3" /></button>
      </div>
    </div>
  );
};

export const AddendumSection = ({ vehicle }: { vehicle: VehicleRow }) => {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  // A used_car_manager / sales_manager (who holds can_approve_print) accepts the
  // draft; sales staff only build and copy the link. Platform admins pass too.
  const canAccept = hasDealerCapability(member?.role, "can_approve_print", isAdmin);
  const [rows, setRows] = useState<AddendumRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState<string | null>(null);
  // Newest verified install proof for this VIN. If it lands AFTER an addendum
  // was accepted, the Get-Ready changed since the manager approved it and the
  // addendum needs a refresh.
  const [proofMaxTs, setProofMaxTs] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const base = "id,created_at,updated_at,status,customer_name,cobuyer_name,content_hash,signed_at,token,total_price";
    // Resilient select: the acceptance columns may not be applied yet in a given
    // environment; fall back to the base column set rather than erroring to [].
    let data: AddendumRow[] | null = null;
    const withAccept = await (supabase as any)
      .from("addendums")
      .select(`${base},accepted_at,getready_dispatched_at`)
      .eq("vehicle_vin", vehicle.vin)
      .order("created_at", { ascending: false })
      .limit(50);
    if (withAccept.error) {
      const basic = await (supabase as any)
        .from("addendums").select(base)
        .eq("vehicle_vin", vehicle.vin)
        .order("created_at", { ascending: false }).limit(50);
      data = (basic.data || []) as AddendumRow[];
    } else {
      data = (withAccept.data || []) as AddendumRow[];
    }
    setRows(data);

    let pr = await (supabase as any)
      .from("install_proofs").select("verified_at, is_verified")
      .eq("vehicle_vin", vehicle.vin).order("verified_at", { ascending: false }).limit(50);
    if (pr.error) pr = await (supabase as any)
      .from("install_proofs").select("verified_at").eq("vehicle_vin", vehicle.vin).limit(50);
    const proofs = (pr.data as { verified_at: string | null; is_verified?: boolean }[]) || [];
    setProofMaxTs(proofs
      .filter((p) => p.is_verified !== false && p.verified_at)
      .reduce<string | null>((m, p) => (!m || (p.verified_at as string) > m ? (p.verified_at as string) : m), null));
    setLoading(false);
  }, [vehicle.vin]);

  useEffect(() => { load(); }, [load]);

  const signed = rows.filter((r) => r.status === "signed" || !!r.signed_at);
  const drafts = rows.filter((r) => !(r.status === "signed" || !!r.signed_at));

  // Accept the draft, then dispatch the Get-Ready to the shop in the same click.
  // Acceptance is recorded even if the shop email is not configured; the
  // dispatch is best-effort and never blocks the acceptance.
  const acceptAndDispatch = async (row: AddendumRow) => {
    setAccepting(row.id);
    try {
      const { data, error } = await (supabase as any).rpc("accept_addendum", { _addendum_id: row.id });
      if (error || !data?.ok) { toast.error("Couldn't accept the addendum"); return; }
      toast.success("Addendum accepted");
      try {
        const { depts, vendors } = await deriveGetReadyDispatch(data.tenant_id, data.vin);
        const res = await (supabase as any).functions.invoke("notify-getready", {
          body: { tenant_id: data.tenant_id, vin: data.vin, depts, vendors, app_base: window.location.origin },
        });
        if (res?.data?.ok) {
          await (supabase as any).rpc("mark_addendum_getready_dispatched", { _addendum_id: row.id });
          toast.success("Get-Ready sent to the shop");
        } else if (res?.data?.error === "no_recipient") {
          toast.message("Accepted. Add a detail shop email in Settings to auto-send the Get-Ready.");
        } else if (res?.data?.error === "no_token") {
          toast.message("Accepted. Get-Ready link not ready yet — send it from the Ready Board.");
        } else if (res?.error) {
          toast.message("Accepted. Couldn't reach the Get-Ready dispatcher — send it from the Ready Board.");
        }
      } catch { /* dispatch is best-effort; acceptance is already recorded */ }
      await load();
    } finally {
      setAccepting(null);
    }
  };

  const copyLink = async (token: string | null) => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/sign/${token}`);
      toast.success("Signing link copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  // Carry the vehicle identity into the addendum builder so the dealer never
  // re-keys VIN / year-make-model / mileage that we already have on file.
  const startAddendum = () => {
    const params = new URLSearchParams();
    params.set("vehicleId", vehicle.id);
    if (vehicle.vin) params.set("vin", vehicle.vin);
    if (vehicle.ymm) params.set("ymm", vehicle.ymm);
    if (vehicle.trim) params.set("trim", vehicle.trim);
    if (vehicle.mileage != null) params.set("mileage", String(vehicle.mileage));
    // Carry the recall signal so the addendum's compliance receipt reflects the
    // real status instead of a generic "check ready" line. The status and the
    // count are the VIN-level ones: `recall_status = 'clear'` and
    // `open_recall_count = 0` are a MODEL-level NHTSA answer and must not
    // print a clearance onto a customer document.
    const recall = deriveRecallView(vehicle);
    if (recall.vin.checkComplete) {
      params.set("recall", recall.vin.state === "OPEN" ? "open_recalls" : "clear");
      if (recall.vin.openCount != null) params.set("open", String(recall.vin.openCount));
    } else if (recall.riskSignalled) {
      params.set("recall", "open_recalls");
    } else {
      params.set("recall", "unverified");
    }
    navigate(`/addendum?${params.toString()}`);
  };

  return (
    <Card title="Addendum" action={
      <div className="flex items-center gap-2">
        <button onClick={() => navigate(`/addendum-label/${vehicle.id}`)} className={btn}>
          <Printer className="w-3.5 h-3.5" /> Addendum label
        </button>
        <button onClick={startAddendum} className={btnPrimary}>
          <Plus className="w-3.5 h-3.5" /> New addendum
        </button>
      </div>
    }>
      <p className="text-al-body text-muted-foreground">
        Every addendum for this vehicle, scoped to VIN <span className="font-mono text-foreground">{vehicle.vin}</span>.
      </p>
      {loading ? (
        <p className="text-al-body text-muted-foreground">Loading addendums…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No addendums for this vehicle yet"
          description="Build one and the customer can sign on any phone. Every signed copy is hash-sealed and archived to the compliance record."
          actions={[{ label: "Start addendum", icon: Plus, onClick: startAddendum }]}
        />
      ) : (
        <div className="space-y-4">
          {signed.length > 0 && (
            <Section title={`Signed (${signed.length})`}>
              {signed.map((r) => (
                <AddendumCard key={r.id} row={r} onOpen={() => navigate(`/addendum?id=${r.id}`)} onCopyLink={copyLink} />
              ))}
            </Section>
          )}
          {drafts.length > 0 && (
            <Section title={`Drafts (${drafts.length})`}>
              {drafts.map((r) => (
                <AddendumCard
                  key={r.id}
                  row={r}
                  onOpen={() => navigate(`/addendum?id=${r.id}`)}
                  onCopyLink={copyLink}
                  canAccept={canAccept}
                  accepting={accepting === r.id}
                  onAccept={() => acceptAndDispatch(r)}
                  stale={!!r.accepted_at && !!proofMaxTs && new Date(proofMaxTs) > new Date(r.updated_at || r.accepted_at)}
                  onUpdate={() => navigate(`/addendum?id=${r.id}&edit=1`)}
                />
              ))}
            </Section>
          )}
        </div>
      )}
    </Card>
  );
};

export default AddendumSection;
