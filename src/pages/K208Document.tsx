import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { Printer, Loader2, ShieldCheck, Archive } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { persistArchivedPdf } from "@/lib/pdfArchive";
import { K208_INSPECTION_CATEGORIES, K208_INSPECTION_RESULTS, K208_CERTIFICATION_TEXT } from "@/data/ctK208Form";

// /k208/:vin — the completed official CT DMV K-208, populated with the tenant's
// dealer info + DMV license number and the vehicle's data, ready to print as the
// buyer's copy and for the vehicle / evidence file. Loads the latest signed
// inspection for the VIN (tenant-scoped via RLS).

interface Inspection {
  id: string; vin: string; ymm: string | null; stock_number: string | null;
  checklist: { id?: string; label?: string; result?: string; explanation?: string }[];
  result: string | null; inspector_name: string | null; signature_data: string | null;
  signed_at: string | null; result_initial: string | null;
  buyer_name: string | null; buyer_signature_data: string | null; buyer_signed_at: string | null;
}
interface Listing { ymm: string | null; mileage: number | null; body_style: string | null; condition: string | null; }

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-US") : "");
const OFFICIAL_ITEMS = K208_INSPECTION_CATEGORIES[0].items;

export default function K208Document() {
  const { vin = "" } = useParams();
  const { tenant } = useTenant();
  const { settings } = useDealerSettings();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const [insp, setInsp] = useState<Inspection | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [filing, setFiling] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  // The dealer initials the A/B/C warranty result. Members may update the
  // inspection directly under RLS, so no extra RPC is needed.
  const setResult = async (code: "A" | "B" | "C") => {
    if (!insp || !tenantId) return;
    const prev = insp.result_initial;
    setInsp({ ...insp, result_initial: code });
    const { error } = await sb().from("safety_inspections").update({ result_initial: code }).eq("id", insp.id);
    if (error) { setInsp((s) => (s ? { ...s, result_initial: prev } : s)); toast.error("Couldn't save the result."); }
  };

  // Render the displayed form to a PDF and store it immutably in the evidence
  // file (signed_document_archive via archive-pdf).
  const saveToEvidence = async () => {
    if (!insp || !formRef.current) return;
    setFiling(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas-pro"), import("jspdf")]);
      const canvas = await html2canvas(formRef.current, { scale: 2, backgroundColor: "#ffffff" });
      const img = canvas.toDataURL("image/jpeg", 0.92);
      const pdf = new jsPDF({ unit: "pt", format: "letter" });
      const pw = pdf.internal.pageSize.getWidth();
      const ph = (canvas.height / canvas.width) * pw;
      pdf.addImage(img, "JPEG", 0, 0, pw, Math.min(ph, pdf.internal.pageSize.getHeight()));
      const res = await persistArchivedPdf(pdf, { docType: "k208", entityId: insp.id, vin: insp.vin });
      if (res.ok) toast.success("Signed K-208 saved to the evidence file");
      else toast.error("Couldn't save to evidence — try again.");
    } catch { toast.error("Couldn't render the K-208 for filing."); }
    setFiling(false);
  };

  useEffect(() => {
    if (!tenantId || !vin) { setLoading(false); return; }
    (async () => {
      const v = vin.toUpperCase();
      const [{ data: ins }, { data: lst }] = await Promise.all([
        sb().from("safety_inspections").select("*").eq("tenant_id", tenantId).eq("vin", v).eq("status", "signed").order("signed_at", { ascending: false }).limit(1).maybeSingle(),
        sb().from("vehicle_listings").select("ymm, mileage, condition").eq("tenant_id", tenantId).eq("vin", v).maybeSingle(),
      ]);
      setInsp((ins as Inspection) || null);
      setListing((lst as Listing) || null);
      setLoading(false);
    })();
  }, [tenantId, vin]);

  // Map the stored checklist to the official item order, by id then label.
  const rows = useMemo(() => {
    const byId = new Map((insp?.checklist || []).map((c) => [c.id, c]));
    const byLabel = new Map((insp?.checklist || []).map((c) => [(c.label || "").toLowerCase(), c]));
    return OFFICIAL_ITEMS.map((it) => {
      const rec = byId.get(it.id) || byLabel.get(it.label.toLowerCase());
      return { label: it.label, result: rec?.result || "", explanation: rec?.explanation || "" };
    });
  }, [insp]);

  const ymmParts = (insp?.ymm || listing?.ymm || "").split(" ");
  const year = ymmParts[0] || "";
  const makeModel = ymmParts.slice(1).join(" ");

  if (loading) return <div className="min-h-screen grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!insp) return (
    <div className="min-h-screen grid place-items-center p-6 text-center">
      <div>
        <ShieldCheck className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No completed K-208 on file for {vin.toUpperCase()} yet.</p>
      </div>
    </div>
  );

  return (
    <div className="bg-muted/30 min-h-screen py-6 print:bg-white print:py-0">
      <style>{`@media print { .no-print { display: none !important; } @page { size: letter; margin: 0.5in; } }`}</style>
      <div className="no-print max-w-[850px] mx-auto mb-4 flex justify-end gap-2">
        <button onClick={saveToEvidence} disabled={filing} className="h-10 px-4 rounded-lg border border-border text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted disabled:opacity-50">{filing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />} Save to evidence file</button>
        <button onClick={() => window.print()} className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2"><Printer className="w-4 h-4" /> Print customer copy</button>
      </div>

      <div ref={formRef} className="max-w-[850px] mx-auto bg-white text-[#0F172A] p-8 shadow-premium print:shadow-none text-[12px] leading-snug">
        {/* Header */}
        <div className="text-center border-b-2 border-black pb-2">
          <div className="font-bold text-[13px]">STATE OF CONNECTICUT &middot; DEPARTMENT OF MOTOR VEHICLES</div>
          <div className="text-[11px]">Commercial Vehicle Safety Division</div>
          <div className="font-bold text-[14px] mt-1">CT LICENSED DEALER VEHICLE INSPECTION FORM &mdash; K-208</div>
          <div className="text-[9px] text-slate-500">NEW 10-2012 &middot; Required by CGS 14-62(g)</div>
        </div>

        {/* Vehicle + Dealer */}
        <div className="grid grid-cols-2 gap-4 mt-3">
          <div>
            <SectionTitle>Vehicle Information</SectionTitle>
            <Field label="Year" value={year} />
            <Field label="Make / Model" value={makeModel} />
            <Field label="Body Style" value={listing?.body_style || ""} />
            <Field label="VIN" value={insp.vin} />
            <Field label="Mileage" value={listing?.mileage != null ? listing.mileage.toLocaleString() : ""} />
            <Field label="Stock #" value={insp.stock_number || ""} />
          </div>
          <div>
            <SectionTitle>Dealer License Information</SectionTitle>
            <Field label="Dealer" value={settings.dealer_name || ""} />
            <Field label="Phone" value={settings.dealer_phone || ""} />
            <Field label="Address" value={settings.dealer_address || ""} />
            <Field label="Town / State / Zip" value={[settings.dealer_city, settings.dealer_state, settings.dealer_zip].filter(Boolean).join(", ")} />
            <Field label="Principal Dealer License #" value={settings.dealer_license_number || ""} bold />
          </div>
        </div>

        {/* Inspection grid */}
        <table className="w-full border-collapse mt-3 border border-black">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-black text-left px-2 py-1 w-[28%]">Inspection Item</th>
              <th className="border border-black px-2 py-1 w-[8%]">Pass</th>
              <th className="border border-black px-2 py-1 w-[8%]">Fail</th>
              <th className="border border-black text-left px-2 py-1">Explanation of Defects or Repairs Needed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="border border-black px-2 py-1 font-medium">{r.label}</td>
                <td className="border border-black text-center py-1">{r.result === "pass" ? "X" : ""}</td>
                <td className="border border-black text-center py-1">{r.result === "fail" ? "X" : ""}</td>
                <td className="border border-black px-2 py-1">{r.explanation}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Inspection results A/B/C */}
        <div className="mt-3">
          <SectionTitle>Inspection Results &mdash; Dealer Must Initial A, B or C</SectionTitle>
          {K208_INSPECTION_RESULTS.map((res) => (
            <div key={res.code} className="flex gap-2 items-start py-0.5">
              <button onClick={() => setResult(res.code as "A" | "B" | "C")} title={`Initial ${res.code}`}
                className={`font-bold border border-black w-6 h-6 inline-grid place-items-center shrink-0 ${insp.result_initial === res.code ? "bg-slate-900 text-white print:bg-white print:text-black" : "hover:bg-slate-100 print:hover:bg-white"}`}>
                {insp.result_initial === res.code ? res.code : ""}
              </button>
              <span className="text-[11px]"><b>{res.code}.</b> {res.label}</span>
            </div>
          ))}
          <p className="no-print text-[10px] text-slate-500 mt-1">Tap A, B, or C to record the dealer's warranty determination.</p>
          <div className="text-[10px] text-slate-600 mt-1">Vehicle shall be emissions compliant per 14-164c(n).</div>
        </div>

        {/* Certification */}
        <div className="mt-3 border-t border-black pt-2">
          <div className="font-bold text-[11px]">Certification &mdash; Must Be Signed By Licensee</div>
          <p className="text-[10px] mt-1">{K208_CERTIFICATION_TEXT}</p>
          <div className="grid grid-cols-2 gap-6 mt-3">
            <SignatureLine label="Licensee Signature & Printed Name" sig={insp.signature_data} name={insp.inspector_name} date={fmtDate(insp.signed_at)} dateLabel="Date of Completion" />
            <SignatureLine label="Buyer Signature & Printed Name" sig={insp.buyer_signature_data} name={insp.buyer_name} date={fmtDate(insp.buyer_signed_at)} dateLabel="Date of Signature" />
          </div>
        </div>

        <div className="text-center text-[10px] font-bold mt-4 border border-black py-1">A COPY OF THIS DOCUMENT MUST BE PROVIDED TO THE BUYER</div>
      </div>

      <div className="no-print max-w-[850px] mx-auto mt-4">
        <K208History inspectionId={insp.id} />
      </div>
    </div>
  );
}

interface Revision { id: string; result: string | null; result_initial: string | null; status: string | null; inspector_name: string | null; failure_notes: string | null; captured_at: string }

// Repair / re-inspection history — every prior state of this K-208, preserved so
// an original failure is never erased when an item is repaired and re-inspected.
function K208History({ inspectionId }: { inspectionId: string }) {
  const [revs, setRevs] = useState<Revision[] | null>(null);
  useEffect(() => {
    let off = false;
    (async () => {
      const { data } = await sb().from("safety_inspection_revisions")
        .select("id, result, result_initial, status, inspector_name, failure_notes, captured_at")
        .eq("inspection_id", inspectionId).order("captured_at", { ascending: false });
      if (!off) setRevs((data || []) as Revision[]);
    })();
    return () => { off = true; };
  }, [inspectionId]);

  if (!revs || revs.length === 0) return null;
  const failed = (r: Revision) => r.result === "fail";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm font-semibold text-foreground mb-2">Repair &amp; re-inspection history</p>
      <p className="text-xs text-muted-foreground mb-3">Prior states of this inspection, kept for the record — an original failure is never overwritten.</p>
      <ul className="space-y-2">
        {revs.map((r) => (
          <li key={r.id} className="flex items-start gap-3 text-sm border-t border-border/60 pt-2 first:border-0 first:pt-0">
            <span className={`mt-0.5 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${failed(r) ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>{r.result || r.status || "—"}</span>
            <div className="min-w-0 flex-1">
              <p className="text-foreground">
                {r.result_initial ? `Result ${r.result_initial} · ` : ""}{r.status || ""}{r.inspector_name ? ` · ${r.inspector_name}` : ""}
              </p>
              {r.failure_notes && <p className="text-xs text-muted-foreground truncate">{r.failure_notes}</p>}
            </div>
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">{new Date(r.captured_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="font-bold text-[11px] uppercase tracking-wide border-b border-black mb-1">{children}</div>;
}
function Field({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex gap-2 py-0.5">
      <span className="text-slate-600 w-[40%] shrink-0">{label}:</span>
      <span className={`flex-1 border-b border-dotted border-slate-400 min-h-[14px] ${bold ? "font-bold" : ""}`}>{value || " "}</span>
    </div>
  );
}
function SignatureLine({ label, sig, name, date, dateLabel }: { label: string; sig: string | null; name: string | null; date: string; dateLabel: string }) {
  return (
    <div>
      <div className="h-12 border-b border-black flex items-end">
        {sig && sig.startsWith("data:image") ? <img src={sig} alt="" className="max-h-12" /> : <span className="text-[14px] italic pb-0.5">{sig || name || ""}</span>}
      </div>
      <div className="text-[9px] text-slate-600 mt-0.5">{label}</div>
      {name && <div className="text-[11px] font-medium">{name}</div>}
      <div className="text-[10px] mt-1">{dateLabel}: <b>{date || "      "}</b></div>
    </div>
  );
}
