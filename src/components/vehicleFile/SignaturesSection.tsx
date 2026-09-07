import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock, Copy, ExternalLink, MessageSquare, Plus, Send, Signature } from "lucide-react";
import EmptyState from "@/components/ui/empty-state";
import { Card, Section, btn, btnPrimary } from "./primitives";
import type { VehicleRow } from "./types";

export interface DealTokenRow {
  id: string;
  token: string;
  status: "pending" | "signed" | "expired" | "revoked";
  vehicle_payload: { vin?: string; ymm?: string; buyer?: { name?: string }; coBuyer?: { name?: string } } | null;
  content_hash: string | null;
  customer_ip: string | null;
  expires_at: string;
  signed_at: string | null;
  created_at: string;
}

export interface SigningRow {
  id: string;
  signer_type: string;
  signer_name: string | null;
  signature_type: string | null;
  ip_address: string | null;
  user_agent: string | null;
  signed_at: string;
  addendum_id: string | null;
  deal_token_id: string | null;
}

export interface SignatureRecord {
  tokens: DealTokenRow[];
  signings: SigningRow[];
  loading: boolean;
}

export function useVehicleSignatures(vin: string): SignatureRecord {
  const [state, setState] = useState<SignatureRecord>({ tokens: [], signings: [], loading: true });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: t }, { data: s }] = await Promise.all([
        (supabase as any)
          .from("deal_signing_tokens")
          .select("id,token,status,vehicle_payload,content_hash,customer_ip,expires_at,signed_at,created_at")
          .eq("vehicle_payload->>vin", vin)
          .order("created_at", { ascending: false })
          .limit(20),
        (supabase as any)
          .from("addendum_signings")
          .select("id,signer_type,signer_name,signature_type,ip_address,user_agent,signed_at,addendum_id,deal_token_id")
          .eq("vin", vin)
          .order("signed_at", { ascending: false })
          .limit(50),
      ]);
      if (cancelled) return;
      setState({ tokens: (t || []) as DealTokenRow[], signings: (s || []) as SigningRow[], loading: false });
    })();
    return () => { cancelled = true; };
  }, [vin]);
  return state;
}

const DealTokenCard = ({ row, url, onCopy, onSms }: {
  row: DealTokenRow;
  url: string;
  onCopy: () => void;
  onSms: () => void;
}) => {
  const buyerName = row.vehicle_payload?.buyer?.name || "Customer";
  const cobuyerName = row.vehicle_payload?.coBuyer?.name;
  const statusCls =
    row.status === "signed" ? "bg-emerald-100 text-emerald-700"
      : row.status === "revoked" ? "bg-red-100 text-red-700"
      : row.status === "expired" ? "bg-muted text-muted-foreground"
      : "bg-amber-100 text-amber-700";
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
      <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${statusCls}`}>
        {row.status === "signed" ? <CheckCircle2 className="w-4 h-4" />
          : row.status === "expired" ? <Clock className="w-4 h-4" />
          : row.status === "revoked" ? <AlertTriangle className="w-4 h-4" />
          : <Send className="w-4 h-4" />}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-al-body font-semibold text-foreground truncate">
          {buyerName}{cobuyerName ? <span className="text-muted-foreground"> + {cobuyerName}</span> : null}
        </p>
        <div className="flex items-center gap-3 text-al-meta text-muted-foreground mt-0.5 flex-wrap">
          <span className={`font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${statusCls}`}>{row.status}</span>
          <span>{new Date(row.created_at).toLocaleDateString()}</span>
          {row.signed_at && <span>signed {new Date(row.signed_at).toLocaleString()}</span>}
          {row.status === "pending" && <span>expires {new Date(row.expires_at).toLocaleDateString()}</span>}
          {row.content_hash && <span className="font-mono">hash: {row.content_hash.slice(0, 10)}…</span>}
        </div>
      </div>
      {row.status === "pending" && (
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={onCopy} className={btn} title="Copy the signing link"><Copy className="w-3 h-3" /> Link</button>
          <button onClick={onSms} className={btnPrimary} title="Text the link to the customer"><MessageSquare className="w-3 h-3" /> Text</button>
        </div>
      )}
      {row.status === "signed" && (
        <a href={url} target="_blank" rel="noreferrer" className={btn}>View <ExternalLink className="w-3 h-3" /></a>
      )}
    </div>
  );
};

const SigningCard = ({ row, onOpen }: { row: SigningRow; onOpen: () => void }) => {
  const ua = (row.user_agent || "").slice(0, 36);
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
      <span className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
        <Signature className="w-4 h-4" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-al-body font-semibold text-foreground truncate">
          {row.signer_name || "Unnamed signer"}
          <span className="ml-2 text-al-meta font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {row.signer_type.replace(/_/g, " ")}
          </span>
        </p>
        <div className="flex items-center gap-3 text-al-meta text-muted-foreground mt-0.5 flex-wrap">
          <span>{new Date(row.signed_at).toLocaleString()}</span>
          {row.signature_type && <span>{row.signature_type}</span>}
          {row.ip_address && <span className="font-mono">ip: {row.ip_address}</span>}
          {ua && <span className="truncate font-mono" title={row.user_agent || ""}>{ua}…</span>}
        </div>
      </div>
      {(row.addendum_id || row.deal_token_id) && (
        <button onClick={onOpen} className={btn}>Open <ArrowUpRight className="w-3 h-3" /></button>
      )}
    </div>
  );
};

export const SignaturesSection = ({ vehicle, record }: { vehicle: VehicleRow; record: SignatureRecord }) => {
  const navigate = useNavigate();
  const { tokens, signings, loading } = record;
  const pending = tokens.filter((t) => t.status === "pending");
  const completed = tokens.filter((t) => t.status === "signed");
  const expired = tokens.filter((t) => t.status === "expired" || t.status === "revoked");

  const dealUrl = (token: string) => `${window.location.origin}/deal/${token}`;

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(dealUrl(token));
      toast.success("Signing link copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  const smsLink = (token: string) => {
    const body = encodeURIComponent(`Sign your paperwork for ${vehicle.ymm || "your vehicle"}: ${dealUrl(token)}`);
    window.open(`sms:?body=${body}`, "_blank");
  };

  return (
    <Card title="Signatures" action={
      <button onClick={() => navigate("/addendum")} className={btn}><Plus className="w-3.5 h-3.5" /> New signing link</button>
    }>
      <p className="text-al-body text-muted-foreground">
        Active signing links and the full signature audit trail for VIN <span className="font-mono text-foreground">{vehicle.vin}</span>.
        Every signature stores its content hash, IP, user agent and E-SIGN consent.
      </p>
      {loading ? (
        <p className="text-al-body text-muted-foreground">Loading signatures…</p>
      ) : pending.length === 0 && signings.length === 0 && completed.length === 0 && expired.length === 0 ? (
        <EmptyState
          icon={Signature}
          title="No signatures captured for this vehicle"
          description="Generate a signing link from an addendum and the customer can sign on any phone."
          actions={[{ label: "Build addendum", icon: Plus, onClick: () => navigate("/addendum") }]}
        />
      ) : (
        <div className="space-y-4">
          {pending.length > 0 && (
            <Section title={`Active links (${pending.length})`}>
              {pending.map((t) => (
                <DealTokenCard key={t.id} row={t} url={dealUrl(t.token)} onCopy={() => copyLink(t.token)} onSms={() => smsLink(t.token)} />
              ))}
            </Section>
          )}
          {signings.length > 0 && (
            <Section title={`Signatures captured (${signings.length})`}>
              {signings.map((s) => (
                <SigningCard key={s.id} row={s} onOpen={() => (s.addendum_id ? navigate(`/addendum?id=${s.addendum_id}`) : navigate("/saved"))} />
              ))}
            </Section>
          )}
          {completed.length > 0 && (
            <Section title={`Completed deal jackets (${completed.length})`}>
              {completed.map((t) => (
                <DealTokenCard key={t.id} row={t} url={dealUrl(t.token)} onCopy={() => copyLink(t.token)} onSms={() => smsLink(t.token)} />
              ))}
            </Section>
          )}
          {expired.length > 0 && (
            <Section title={`Expired / revoked (${expired.length})`}>
              {expired.map((t) => (
                <DealTokenCard key={t.id} row={t} url={dealUrl(t.token)} onCopy={() => copyLink(t.token)} onSms={() => smsLink(t.token)} />
              ))}
            </Section>
          )}
        </div>
      )}
    </Card>
  );
};

export default SignaturesSection;
