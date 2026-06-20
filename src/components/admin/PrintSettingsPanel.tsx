import { useState } from "react";
import { useDealerPrintSettings } from "@/lib/stickerStudio/useDealerPrintSettings";
import type { PrintCalibration } from "@/lib/stickerStudio/printConfig";
import type { StickerType } from "@/lib/stickerStudio/templates";
import { Printer, Sun, Moon, Crop, SquareDashed, FlaskConical, Save } from "lucide-react";
import { toast } from "sonner";

// Dealer-facing print configuration + calibration wizard. Persists to
// dealer_print_settings (tenant-scoped); the saved profile is read by the
// Sticker Studio generator and the chrome-free /print routes.
export default function PrintSettingsPanel() {
  const { calibration, save, loading } = useDealerPrintSettings();
  const [draft, setDraft] = useState<PrintCalibration | null>(null);
  const cal = draft ?? calibration;
  const set = (p: Partial<PrintCalibration>) => setDraft({ ...cal, ...p });
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    setSaving(true);
    const r = await save(cal);
    setSaving(false);
    if (r.ok) { setDraft(null); toast.success("Print settings saved"); }
    else toast.error("Couldn't save print settings");
  };

  // Open the test-label sheet in a new tab with the current (possibly unsaved)
  // calibration so the dealer can measure before committing.
  const printTest = (size: StickerType) => {
    try {
      const key = `test-label-${crypto.randomUUID()}`;
      localStorage.setItem(key, JSON.stringify({ size, calibration: cal }));
      const w = window.open(`/print/test-label?h=${key}`, "_blank", "noopener");
      if (!w) toast.error("Allow pop-ups to open the test sheet");
    } catch { toast.error("Couldn't open test sheet"); }
  };

  const label = "text-[10px] font-bold uppercase tracking-wider text-muted-foreground";
  const input = "w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm outline-none focus:border-primary";
  const num = (v: number) => (Number.isFinite(v) ? v : 0);

  if (loading) return <p className="text-sm text-muted-foreground p-4">Loading print settings…</p>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-foreground inline-flex items-center gap-2"><Printer className="w-4 h-4 text-primary" /> Print settings &amp; calibration</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Tune how window stickers (8.5×11) and addendums (4.5×11) land on your label stock. Saved settings apply to every Sticker Studio print and PDF.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Settings form */}
        <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
          <h3 className="text-sm font-bold text-foreground">Defaults</h3>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Window sticker size</label>
              <select className={input} value="8.5x11" disabled><option value="8.5x11">8.5 × 11 in</option></select>
            </div>
            <div>
              <label className={label}>Addendum size</label>
              <select className={input} value="4.5x11" disabled><option value="4.5x11">4.5 × 11 in</option></select>
            </div>
          </div>

          <div>
            <label className={label}>Label mode</label>
            <div className="mt-1 inline-flex rounded-md border border-border bg-card p-0.5">
              <button onClick={() => set({ labelMode: "white" })} className={`inline-flex items-center gap-1 px-2.5 h-8 rounded text-xs font-semibold ${cal.labelMode === "white" ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground"}`}><Sun className="w-3.5 h-3.5" /> White label</button>
              <button onClick={() => set({ labelMode: "black" })} className={`inline-flex items-center gap-1 px-2.5 h-8 rounded text-xs font-semibold ${cal.labelMode === "black" ? "bg-slate-900 text-white" : "text-muted-foreground hover:text-foreground"}`}><Moon className="w-3.5 h-3.5" /> Black label</button>
            </div>
          </div>

          <div>
            <label className={label}>Default printer name</label>
            <input className={input} value={cal.printerName || ""} onChange={(e) => set({ printerName: e.target.value })} placeholder="e.g. Lobby HP LaserJet" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={label}>X offset (in)</label>
              <input type="number" step="0.01" className={input} value={num(cal.xOffsetIn)} onChange={(e) => set({ xOffsetIn: parseFloat(e.target.value) })} />
            </div>
            <div>
              <label className={label}>Y offset (in)</label>
              <input type="number" step="0.01" className={input} value={num(cal.yOffsetIn)} onChange={(e) => set({ yOffsetIn: parseFloat(e.target.value) })} />
            </div>
            <div>
              <label className={label}>Scale (%)</label>
              <input type="number" step="0.5" className={input} value={num(cal.scalePct)} onChange={(e) => set({ scalePct: parseFloat(e.target.value) })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Top safe margin (in)</label>
              <input type="number" step="0.05" className={input} value={num(cal.topSafeMarginIn)} onChange={(e) => set({ topSafeMarginIn: parseFloat(e.target.value) })} />
            </div>
            <div>
              <label className={label}>Left safe margin (in)</label>
              <input type="number" step="0.05" className={input} value={num(cal.leftSafeMarginIn)} onChange={(e) => set({ leftSafeMarginIn: parseFloat(e.target.value) })} />
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={cal.showCropMarks} onChange={(e) => set({ showCropMarks: e.target.checked })} /> <Crop className="w-3.5 h-3.5 text-muted-foreground" /> Show crop marks on print</label>
            <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={cal.showSafeArea} onChange={(e) => set({ showSafeArea: e.target.checked })} /> <SquareDashed className="w-3.5 h-3.5 text-muted-foreground" /> Show safe-area guide on print</label>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button onClick={onSave} disabled={saving} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"><Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save settings"}</button>
            {draft && <button onClick={() => setDraft(null)} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Discard changes</button>}
          </div>
        </div>

        {/* Calibration wizard */}
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <h3 className="text-sm font-bold text-foreground inline-flex items-center gap-2"><FlaskConical className="w-4 h-4 text-primary" /> Calibration wizard</h3>
          <ol className="space-y-3 text-sm">
            <li className="flex gap-2.5">
              <Step n={1} />
              <div className="flex-1">
                <p className="font-semibold text-foreground">Print a test sheet</p>
                <p className="text-xs text-muted-foreground">Opens a ruled target with crop + center marks at your current settings.</p>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => printTest("window")} className="h-8 px-3 rounded-md border border-border text-xs font-semibold hover:bg-muted inline-flex items-center gap-1.5"><Printer className="w-3.5 h-3.5" /> Window 8.5×11</button>
                  <button onClick={() => printTest("addendum")} className="h-8 px-3 rounded-md border border-border text-xs font-semibold hover:bg-muted inline-flex items-center gap-1.5"><Printer className="w-3.5 h-3.5" /> Addendum 4.5×11</button>
                </div>
              </div>
            </li>
            <li className="flex gap-2.5">
              <Step n={2} />
              <div>
                <p className="font-semibold text-foreground">Measure the drift</p>
                <p className="text-xs text-muted-foreground">On the printed sheet, measure how far the border box sits from the label edge. Right/down is positive.</p>
              </div>
            </li>
            <li className="flex gap-2.5">
              <Step n={3} />
              <div>
                <p className="font-semibold text-foreground">Enter the offsets</p>
                <p className="text-xs text-muted-foreground">Type the measured X / Y offset (and scale, if the sheet prints over/undersized) into the Defaults form.</p>
              </div>
            </li>
            <li className="flex gap-2.5">
              <Step n={4} />
              <div>
                <p className="font-semibold text-foreground">Save &amp; re-test</p>
                <p className="text-xs text-muted-foreground">Save the profile, then print another test sheet to confirm it lands clean. The saved profile auto-applies to every sticker PDF.</p>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}

const Step = ({ n }: { n: number }) => (
  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-50 text-blue-700 text-xs font-bold inline-flex items-center justify-center">{n}</span>
);
