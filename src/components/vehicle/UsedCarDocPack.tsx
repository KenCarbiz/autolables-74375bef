import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { FileText, ScrollText, ShieldCheck, FileCheck, CheckCircle2, Circle, ChevronRight, RefreshCw } from "lucide-react";

// ──────────────────────────────────────────────────────────────────────
// UsedCarDocPack — the four compliance documents every used car needs before
// delivery, auto-tracked for each used/cpo vehicle. Generation itself is
// client-rendered (each "Generate" opens the right generator pre-filled with
// THIS vehicle), but the pack is surfaced and status-tracked automatically so
// the four docs never get missed on intake:
//   1. Used-car window sticker (Monroney)   → /used-car-sticker
//   2. Used-car addendum / accessory sticker → /addendum
//   3. FTC warranty window sticker (Buyers Guide) → /used-vehicle-documents
//   4. Connecticut K-208 warranty worksheet  → /used-vehicle-documents
// ──────────────────────────────────────────────────────────────────────

type DocState = "generated" | "draft" | "missing";

interface PackRow {
  key: string;
  title: string;
  icon: React.ElementType;
  state: DocState;
  href: string;
}

const STATE_META: Record<DocState, { label: string; cls: string; icon: React.ElementType }> = {
  generated: { label: "Generated", cls: "text-emerald-600", icon: CheckCircle2 },
  draft: { label: "Draft", cls: "text-amber-600", icon: Circle },
  missing: { label: "Not generated", cls: "text-muted-foreground", icon: Circle },
};

interface Props {
  vehicleId: string;
  vin: string | null;
  condition: string | null;
}

export const UsedCarDocPack = ({ vehicleId, vin, condition }: Props) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PackRow[] | null>(null);

  const isUsedLike = condition === "used" || condition === "cpo" || !condition;

  const load = useCallback(async () => {
    if (!isUsedLike || !vehicleId) return;
    const v = (vin || "").toUpperCase();
    // deno-lint-ignore no-explicit-any
    const sb = supabase as unknown as { from: (t: string) => any };
    const [gen, archive, addenda] = await Promise.all([
      sb.from("generated_documents").select("document_type, document_status").eq("vehicle_id", vehicleId),
      v ? sb.from("signed_document_archive").select("kind").eq("vin", v) : Promise.resolve({ data: [] }),
      v ? sb.from("addendums").select("status").eq("vehicle_vin", v) : Promise.resolve({ data: [] }),
    ]);
    const gd = (gen.data || []) as { document_type: string; document_status: string }[];
    const arc = (archive.data || []) as { kind: string }[];
    const add = (addenda.data || []) as { status: string }[];

    const genOf = (t: string): DocState => {
      const rows = gd.filter((r) => r.document_type === t);
      if (rows.some((r) => r.document_status === "published")) return "generated";
      if (rows.length) return "draft";
      return "missing";
    };
    const archived = (k: string) => arc.some((r) => r.kind === k);
    const addendumState: DocState = genOf("addendum") !== "missing"
      ? genOf("addendum")
      : add.length ? "draft" : "missing";

    const qs = `vehicleId=${encodeURIComponent(vehicleId)}${v ? `&vin=${encodeURIComponent(v)}` : ""}`;
    setRows([
      { key: "window", title: "Used-car window sticker (Monroney)", icon: FileText, state: genOf("window"), href: `/used-car-sticker?${qs}` },
      { key: "addendum", title: "Addendum / accessory sticker", icon: FileCheck, state: addendumState, href: `/addendum?${qs}` },
      { key: "ftc", title: "FTC warranty window sticker", icon: ShieldCheck, state: archived("ftc_buyers_guide") ? "generated" : "missing", href: `/used-vehicle-documents?${qs}` },
      { key: "k208", title: "Connecticut K-208 worksheet", icon: ScrollText, state: archived("k208_warranty") ? "generated" : "missing", href: `/used-vehicle-documents?${qs}` },
    ]);
  }, [vehicleId, vin, isUsedLike]);

  useEffect(() => { load(); }, [load]);

  if (!isUsedLike || !rows) return null;

  const done = rows.filter((r) => r.state === "generated").length;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-foreground">Used-Car Document Pack</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Auto-tracked on intake — the four docs every used car needs before delivery.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${done === rows.length ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{done}/{rows.length} generated</span>
          <button onClick={load} title="Refresh" className="w-7 h-7 inline-flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground"><RefreshCw className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      <div className="divide-y divide-border/60">
        {rows.map((r) => {
          const meta = STATE_META[r.state];
          const Icon = r.icon;
          const StateIcon = meta.icon;
          return (
            <button key={r.key} onClick={() => navigate(r.href)} className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-muted/40 -mx-1 px-1 rounded-lg transition-colors">
              <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-foreground truncate">{r.title}</p>
                <p className={`text-[11px] font-semibold inline-flex items-center gap-1 ${meta.cls}`}><StateIcon className="w-3 h-3" />{meta.label}</p>
              </div>
              <span className="text-[12px] font-semibold text-blue-600 inline-flex items-center gap-0.5 shrink-0">{r.state === "generated" ? "View" : "Generate"} <ChevronRight className="w-3.5 h-3.5" /></span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default UsedCarDocPack;
