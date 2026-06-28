import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText, CheckCircle2, Circle, Mail, ExternalLink, Loader2 } from "lucide-react";

// ──────────────────────────────────────────────────────────────────────
// TitleMcoPanel — dealer-internal view of the vehicle's Title (used) or MCO
// (new), front + back, uploaded by the office via the emailed QR/link. Files
// live in the PRIVATE vehicle-docs bucket; we sign them on view. Never shown
// on the customer packet. Includes a one-click "email the office the link".
// ──────────────────────────────────────────────────────────────────────

interface Props {
  vin: string | null;
  tenantId: string | null;
  condition: string | null;
}

interface DocRow { doc_type: string; url: string; created_at: string }

const SIDE_LABEL: Record<string, string> = {
  front: "Front", back: "Back",
};

export const TitleMcoPanel = ({ vin, tenantId, condition }: Props) => {
  const isNew = String(condition || "").toLowerCase() === "new";
  const kind = isNew ? "mco" : "title";
  const docName = isNew ? "Manufacturer's Certificate of Origin (MCO)" : "Vehicle Title";
  const [rows, setRows] = useState<DocRow[] | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!vin || !tenantId) return;
    // deno-lint-ignore no-explicit-any
    const { data } = await (supabase as unknown as { from: (t: string) => any })
      .from("vehicle_documents")
      .select("doc_type, url, created_at")
      .eq("tenant_id", tenantId).eq("vin", vin.toUpperCase())
      .in("doc_type", ["title_front", "title_back", "mco_front", "mco_back"])
      .order("created_at", { ascending: false });
    setRows((data as DocRow[]) || []);
  }, [vin, tenantId]);

  useEffect(() => { load(); }, [load]);

  const view = async (path: string) => {
    const { data } = await supabase.storage.from("vehicle-docs").createSignedUrl(path, 60 * 10);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
    else toast.error("Could not open document");
  };

  const emailOffice = async () => {
    if (!vin || !tenantId) return;
    setSending(true);
    const { data, error } = await supabase.functions.invoke("email-title-request", { body: { tenant_id: tenantId, vin } });
    setSending(false);
    if (error || !(data as { ok?: boolean })?.ok) {
      toast.error((data as { error?: string })?.error || "Could not send — set an office email in Settings.");
      return;
    }
    const r = (data as { recipients?: string[] }).recipients || [];
    toast.success(`Upload link emailed${r.length ? ` to ${r.join(", ")}` : ""}`);
  };

  if (!rows) return null;
  const latest = (side: string) => rows.find((r) => r.doc_type === `${kind}_${side}`);

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-bold text-foreground inline-flex items-center gap-1.5"><FileText className="w-4 h-4" /> {docName}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Office uploads front &amp; back from the emailed link — internal only, never shown to shoppers.</p>
        </div>
        <button onClick={emailOffice} disabled={sending} className="h-9 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 shrink-0">
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />} Email office
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {(["front", "back"] as const).map((side) => {
          const doc = latest(side);
          return (
            <div key={side} className={`rounded-xl border p-3 ${doc ? "border-emerald-200 bg-emerald-50/50" : "border-dashed border-border bg-muted/30"}`}>
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-foreground">{SIDE_LABEL[side]}</span>
                {doc ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <Circle className="w-4 h-4 text-muted-foreground/50" />}
              </div>
              {doc ? (
                <button onClick={() => view(doc.url)} className="mt-1.5 text-[12px] font-semibold text-blue-600 inline-flex items-center gap-1 hover:underline">
                  <ExternalLink className="w-3 h-3" /> View
                </button>
              ) : (
                <p className="text-[11px] text-muted-foreground mt-1.5">Awaiting upload</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TitleMcoPanel;
