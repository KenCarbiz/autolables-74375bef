import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Loader2, FileText, Upload, ShieldCheck, Camera } from "lucide-react";

// ──────────────────────────────────────────────────────────────────────
// /title/:token — no-login office upload of a vehicle Title (used) or the
// Manufacturer's Certificate of Origin (new), front + back. Reached from the
// per-vehicle QR/link emailed to the office. Files go to the PRIVATE vehicle-
// docs bucket (PII) and attach to the vehicle internally — never the customer
// packet.
// ──────────────────────────────────────────────────────────────────────

interface Ctx { ok: boolean; reason?: string; tenant_id?: string; vin?: string; ymm?: string; stock_number?: string; }
type Kind = "title" | "mco";
type Side = "front" | "back";

export default function TitleUpload() {
  const { token = "" } = useParams();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<Kind>("title");
  const [done, setDone] = useState<Record<Side, boolean>>({ front: false, back: false });
  const [busy, setBusy] = useState<Side | null>(null);
  const frontRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      // deno-lint-ignore no-explicit-any
      const { data } = await (supabase as any).rpc("get_dept_signoff_token", { _token: token });
      setCtx((data as Ctx) || { ok: false, reason: "not_found" });
      setLoading(false);
    })();
  }, [token]);

  const docLabel = kind === "title" ? "Vehicle Title" : "Manufacturer's Certificate of Origin (MCO)";

  const upload = async (side: Side, file: File | undefined) => {
    if (!file) return;
    setBusy(side);
    try {
      const dataBase64: string = await new Promise((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file);
      });
      // 1) upload to the PRIVATE bucket (returns a storage path, not a URL)
      const up = await supabase.functions.invoke("signoff-upload", {
        body: { token, filename: file.name, contentType: file.type, dataBase64, private: true },
      });
      const path = (up.data as { path?: string })?.path;
      if (up.error || !path) throw new Error("upload failed");
      // 2) attach to the vehicle (internal-only)
      // deno-lint-ignore no-explicit-any
      const { data } = await (supabase as any).rpc("attach_title_document", {
        _token: token, _doc_type: `${kind}_${side}`, _path: path, _filename: file.name,
      });
      if ((data as { ok?: boolean })?.ok) setDone((d) => ({ ...d, [side]: true }));
      else throw new Error("attach failed");
    } catch { toast.error(`Couldn't save the ${side} — please retake and try again.`); }
    setBusy(null);
  };

  if (loading) return <div className="min-h-screen grid place-items-center bg-[#F6F7F9]"><Loader2 className="w-6 h-6 animate-spin text-[#2563EB]" /></div>;

  if (!ctx?.ok) {
    const msg = ctx?.reason === "expired" ? "This upload link has expired." : "This upload link is no longer valid.";
    return (
      <div className="min-h-screen grid place-items-center px-6 bg-[#F6F7F9]">
        <div className="max-w-md w-full rounded-2xl border border-[#E6E8EC] bg-white p-8 text-center">
          <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-[#0F172A]">{msg}</h1>
          <p className="text-sm text-[#64748B] mt-2">Ask the dealership to resend the title upload link.</p>
        </div>
      </div>
    );
  }

  const bothDone = done.front && done.back;

  const Slot = ({ side, inputRef }: { side: Side; inputRef: React.RefObject<HTMLInputElement> }) => (
    <div className="rounded-2xl border border-[#E6E8EC] bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-[#0F172A] capitalize">{side}</p>
        {done[side] && <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#16A34A]"><CheckCircle2 className="w-4 h-4" /> Saved</span>}
      </div>
      <input ref={inputRef} type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => upload(side, e.target.files?.[0])} />
      <button onClick={() => inputRef.current?.click()} disabled={busy === side}
        className={`mt-2 w-full h-12 rounded-xl text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors ${done[side] ? "border border-[#E6E8EC] bg-[#F6F7F9] text-[#64748B]" : "bg-[#2563EB] hover:bg-[#1d4fd7] text-white"}`}>
        {busy === side ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
        {done[side] ? "Retake / replace" : `Photograph ${side}`}
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F6F7F9] pb-10" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <div className="sticky top-0 z-10 bg-[#2563EB] text-white px-4 py-3">
        <div className="max-w-md mx-auto flex items-center gap-2">
          <ShieldCheck className="w-5 h-5" />
          <div><div className="font-bold leading-tight">Title / MCO Upload</div><div className="text-xs opacity-90">{ctx.ymm || "Vehicle"} · {ctx.stock_number ? `Stock ${ctx.stock_number} · ` : ""}{ctx.vin}</div></div>
        </div>
      </div>

      <div className="max-w-md mx-auto p-4 space-y-4">
        {bothDone ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
            <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
            <h1 className="text-xl font-bold text-emerald-900">{docLabel} saved</h1>
            <p className="text-sm text-emerald-700 mt-1">Front and back are on file for this vehicle. You can close this page.</p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-[#E6E8EC] bg-white p-1.5 flex gap-1.5">
              {(["title", "mco"] as Kind[]).map((k) => (
                <button key={k} onClick={() => { setKind(k); setDone({ front: false, back: false }); }}
                  className={`flex-1 h-10 rounded-xl text-[13px] font-bold transition-colors ${kind === k ? "bg-[#2563EB] text-white" : "text-[#0F172A] hover:bg-[#F6F7F9]"}`}>
                  {k === "title" ? "Vehicle Title" : "MCO (new car)"}
                </button>
              ))}
            </div>
            <p className="text-[13px] text-[#64748B] inline-flex items-center gap-1.5"><Upload className="w-4 h-4" /> Photograph the <b className="text-[#0F172A]">front</b> and <b className="text-[#0F172A]">back</b> of the {docLabel}.</p>
            <Slot side="front" inputRef={frontRef} />
            <Slot side="back" inputRef={backRef} />
            <p className="text-[11px] text-[#94A3B8] text-center">Stored securely for dealership use only — never shown to shoppers.</p>
          </>
        )}
      </div>
    </div>
  );
}
