import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, PenLine, ExternalLink, Link2, ChevronDown, ChevronRight, CheckCircle2, Send } from "lucide-react";
import { toast } from "sonner";
import EmptyState from "@/components/ui/empty-state";
import AddendumStatusTimeline from "@/components/addendum/AddendumStatusTimeline";
import QRCodeModal, { type DeliveryChannel } from "@/components/addendum/QRCodeModal";
import { useSmsDelivery } from "@/hooks/useSmsDelivery";
import { useAdvertisedPrices, assessDrift } from "@/hooks/useAdvertisedPrices";

// "Waiting for Signatures" — the queue of deals that have been LOCKED
// (Ready for Signatures) but not yet fully executed. The dealer confirms
// everything is right here, then the signatures happen. Reads addendums
// with an in-flight lifecycle_status; a deal whose legacy status has
// flipped to 'signed' drops into the Recently executed section.

interface AddendumRow {
  id: string;
  signing_token: string | null;
  version_label: string | null;
  vehicle_ymm: string | null;
  vehicle_vin: string | null;
  status: string;
  lifecycle_status: string | null;
  customer_name: string | null;
  ready_at: string | null;
  created_at: string;
  frozen_snapshot: { vehicle_price?: number | null } | null;
}

const IN_FLIGHT = ["ready_for_signature", "awaiting_customer", "customer_opened", "partially_signed"];

const SignatureQueue = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { sendSigningLink } = useSmsDelivery();
  const { byVin } = useAdvertisedPrices();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // The deal whose delivery panel (QR / SMS / Email / Copy) is open.
  const [sendFor, setSendFor] = useState<AddendumRow | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["signature-queue"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("addendums")
        .select("id,signing_token,version_label,vehicle_ymm,vehicle_vin,status,lifecycle_status,customer_name,ready_at,created_at,frozen_snapshot")
        .in("lifecycle_status", IN_FLIGHT)
        .order("ready_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data as AddendumRow[];
    },
    enabled: !!user,
    refetchInterval: 20000,
  });

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
        <p className="text-muted-foreground mb-4">Sign in to view the signature queue.</p>
        <button onClick={() => navigate("/login")} className="font-semibold text-[13px] px-5 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-85">
          Login
        </button>
      </div>
    );
  }

  const rows = data || [];
  const waiting = rows.filter((a) => a.status !== "signed");
  const executed = rows.filter((a) => a.status === "signed");

  const reviewUrl = (token: string | null) =>
    token ? `${window.location.origin}/review/${token}` : "";

  const copyLink = (token: string | null) => {
    const url = reviewUrl(token);
    if (!url) { toast.error("No signing link on this deal."); return; }
    navigator.clipboard.writeText(url).then(() => toast.success("Signing link copied"));
  };

  const toggle = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  // Dealer counter-sign: records the dealer_signed event then flips the
  // deal to fully_executed, which drops it out of the in-flight queue and
  // completes the signing status stepper.
  const executeDeal = async (a: AddendumRow) => {
    await (supabase as any).from("addendum_events").insert({
      addendum_id: a.id,
      signing_token: a.signing_token,
      event: "dealer_signed",
      actor: "dealer",
      actor_name: user?.email || null,
    });
    const { error } = await (supabase as any).rpc("mark_addendum_executed", { _addendum_id: a.id });
    if (error) { toast.error("Could not finalize the deal."); return; }
    toast.success("Counter-signed · deal executed");
    refetch();
  };

  // Append a link_sent event so the timeline records the channel + sender.
  const emitLinkSent = async (a: AddendumRow, channel: DeliveryChannel) => {
    await (supabase as any).from("addendum_events").insert({
      addendum_id: a.id,
      signing_token: a.signing_token,
      event: "link_sent",
      channel,
      actor: "dealer",
      actor_name: user?.email || null,
    });
    refetch();
  };

  const sendSms = async (a: AddendumRow, phone: string) => {
    const res = await sendSigningLink(phone, reviewUrl(a.signing_token), a.vehicle_ymm || "your vehicle");
    toast[res.success ? "success" : "error"](res.message);
  };

  const sendEmail = async (a: AddendumRow, toEmail: string) => {
    const url = reviewUrl(a.signing_token);
    const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#0e1f3d">
      <p>Your ${a.vehicle_ymm || "vehicle"} addendum is ready to review and sign.</p>
      <p><a href="${url}" style="color:#2563eb">Review &amp; sign your addendum</a></p>
      <p style="font-size:12px;color:#64748b">Or open this link: ${url}</p>
    </div>`;
    const { error } = await supabase.functions.invoke("send-email", {
      body: { to: [toEmail], subject: `Review & sign your ${a.vehicle_ymm || "vehicle"} addendum`, html },
    });
    if (error) { toast.error("Email could not be sent."); return; }
    toast.success("Email sent");
  };

  const Card = ({ a, done }: { a: AddendumRow; done: boolean }) => {
    // Re-verification: compare the price this deal was LOCKED at against the
    // latest advertised price for the VIN. If the website price moved after
    // lock, flag it so the dealer can re-verify before the customer signs.
    const lockedPrice = Number(a.frozen_snapshot?.vehicle_price) || 0;
    const ad = a.vehicle_vin ? byVin.get(a.vehicle_vin.toUpperCase()) : undefined;
    const drift = lockedPrice > 0 && ad ? assessDrift(lockedPrice, ad) : null;
    return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-3 p-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${done ? "bg-emerald-100 text-emerald-700" : "bg-navy/10 text-navy"}`}>
          {done ? <CheckCircle2 className="w-5 h-5" /> : <PenLine className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-foreground truncate">{a.vehicle_ymm || "Vehicle"}</p>
            {a.version_label && (
              <span className="text-[10px] font-mono text-muted-foreground">{a.version_label}</span>
            )}
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${done ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
              {done ? "Signed" : "Waiting for customer"}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground font-mono">
            {a.vehicle_vin ? `VIN ${a.vehicle_vin.slice(-8)}` : ""}
            {a.ready_at ? `  ·  locked ${format(new Date(a.ready_at), "MMM d, h:mm a")}` : ""}
            {a.customer_name ? `  ·  ${a.customer_name}` : ""}
          </p>
          {drift && drift.status === "drift" && (
            <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
              Advertised price moved · now ${drift.advertised?.toLocaleString()} vs locked ${drift.sticker.toLocaleString()} — re-verify
            </span>
          )}
          {drift && drift.status === "match" && (
            <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
              Price verified vs advertised
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {done && (
            <button
              onClick={() => executeDeal(a)}
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700"
              title="Counter-sign and finalize"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Execute
            </button>
          )}
          {a.signing_token && !done && (
            <button onClick={() => setSendFor(a)} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md bg-blue-600 text-white text-[11px] font-semibold hover:bg-blue-700 shadow-sm shadow-blue-600/30 ring-1 ring-inset ring-white/15" title="Send the signing link by QR, text, or email">
              <Send className="w-3.5 h-3.5" /> Send
            </button>
          )}
          {a.signing_token && (
            <>
              <button onClick={() => copyLink(a.signing_token)} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border text-[11px] font-semibold text-foreground hover:bg-muted" title="Copy signing link">
                <Link2 className="w-3.5 h-3.5" /> Link
              </button>
              <a href={reviewUrl(a.signing_token)} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md bg-navy text-primary-foreground text-[11px] font-semibold hover:opacity-90" title="Open the customer review">
                <ExternalLink className="w-3.5 h-3.5" /> Open
              </a>
            </>
          )}
          <button onClick={() => toggle(a.id)} className="w-8 h-8 inline-flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground" title="Show activity">
            {expanded[a.id] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {expanded[a.id] && (
        <div className="px-4 pb-4">
          <AddendumStatusTimeline addendumId={a.id} version={a.version_label || undefined} />
        </div>
      )}
    </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate("/addendum")} className="p-2 rounded-md hover:bg-muted transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold font-barlow-condensed text-foreground">Waiting for Signatures</h1>
            <p className="text-[12px] text-muted-foreground">Locked deals, confirmed and queued for the customer to sign.</p>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading queue…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={PenLine}
            title="Nothing waiting"
            description="When you click Ready for Signatures on an addendum, the locked deal lands here until the customer signs."
          />
        ) : (
          <div className="space-y-6">
            <div className="space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                Awaiting customer · {waiting.length}
              </p>
              {waiting.length === 0 ? (
                <p className="text-sm text-muted-foreground">No deals awaiting a customer right now.</p>
              ) : (
                waiting.map((a) => <Card key={a.id} a={a} done={false} />)
              )}
            </div>

            {executed.length > 0 && (
              <div className="space-y-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  Customer signed · counter-sign to finalize · {executed.length}
                </p>
                {executed.map((a) => <Card key={a.id} a={a} done />)}
              </div>
            )}
          </div>
        )}
      </div>

      {sendFor && (
        <QRCodeModal
          open={!!sendFor}
          signingUrl={reviewUrl(sendFor.signing_token)}
          dealId={sendFor.id}
          version={sendFor.version_label || undefined}
          onClose={() => setSendFor(null)}
          onChannel={(channel) => { if (sendFor) emitLinkSent(sendFor, channel); }}
          onSendSms={(phone) => sendFor ? sendSms(sendFor, phone) : undefined}
          onSendEmail={(email) => sendFor ? sendEmail(sendFor, email) : undefined}
        />
      )}
    </div>
  );
};

export default SignatureQueue;
