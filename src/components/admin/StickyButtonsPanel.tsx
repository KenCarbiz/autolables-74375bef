import { useState } from "react";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import {
  STICKY_BUTTON_OPTIONS, STICKY_LABELS, MAX_STICKY_BUTTONS, DEFAULT_STICKY_BUTTONS,
  validateStickyButtons, type StickyBottomButtons,
} from "@/lib/stickyButtons";
import { toast } from "sonner";
import { ChevronUp, ChevronDown, X, Plus, Save, Star } from "lucide-react";

// Dealer admin: configure the Vehicle Passport's sticky bottom CTA bar.
// Choose up to 4 buttons, reorder them, pick the primary, and edit labels.
const StickyButtonsPanel = () => {
  const { settings, updateSettings } = useDealerSettings();
  const [cfg, setCfg] = useState<StickyBottomButtons>(() => {
    const s = settings.sticky_bottom_buttons;
    return s && Array.isArray(s.buttons) ? JSON.parse(JSON.stringify(s)) : JSON.parse(JSON.stringify(DEFAULT_STICKY_BUTTONS));
  });
  const [saving, setSaving] = useState(false);

  const reindex = (buttons: StickyBottomButtons["buttons"]) => buttons.map((b, i) => ({ ...b, order: i + 1 }));
  const usedKeys = new Set(cfg.buttons.map((b) => b.key));
  const remaining = STICKY_BUTTON_OPTIONS.filter((o) => !usedKeys.has(o.key));
  const atMax = cfg.buttons.length >= MAX_STICKY_BUTTONS;

  const addButton = (key: string) => {
    if (atMax || !key) return;
    setCfg((c) => ({ ...c, buttons: reindex([...c.buttons, { key, label: STICKY_LABELS[key] || key, enabled: true, order: c.buttons.length + 1 }]) }));
  };
  const removeButton = (key: string) => setCfg((c) => {
    const buttons = reindex(c.buttons.filter((b) => b.key !== key));
    return { ...c, buttons, primary_key: c.primary_key === key ? (buttons[0]?.key ?? "") : c.primary_key };
  });
  const move = (idx: number, dir: -1 | 1) => setCfg((c) => {
    const j = idx + dir; if (j < 0 || j >= c.buttons.length) return c;
    const b = [...c.buttons]; [b[idx], b[j]] = [b[j], b[idx]];
    return { ...c, buttons: reindex(b) };
  });
  const setLabel = (key: string, label: string) => setCfg((c) => ({ ...c, buttons: c.buttons.map((b) => b.key === key ? { ...b, label } : b) }));

  const error = validateStickyButtons(cfg);
  const save = async () => {
    if (error) { toast.error(error); return; }
    setSaving(true);
    const ok = await updateSettings({ sticky_bottom_buttons: { ...cfg, buttons: reindex(cfg.buttons) } });
    setSaving(false);
    if (ok !== false) toast.success("Sticky buttons saved");
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[22px] font-bold tracking-tight text-foreground">Passport Sticky Buttons</h2>
          <p className="text-sm text-slate-500 mt-1">Choose up to {MAX_STICKY_BUTTONS} call-to-action buttons for the sticky bottom bar shown to shoppers on the Vehicle Passport.</p>
        </div>
        <button onClick={save} disabled={saving || !!error} className="shrink-0 inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {/* Enable */}
      <div className="rounded-2xl border border-border bg-card p-4 flex items-start gap-3">
        <button onClick={() => setCfg((c) => ({ ...c, enabled: !c.enabled }))} role="switch" aria-checked={cfg.enabled}
          className={`mt-0.5 w-10 h-6 rounded-full flex items-center px-0.5 shrink-0 transition-colors ${cfg.enabled ? "bg-blue-600 justify-end" : "bg-slate-300 justify-start"}`}>
          <span className="w-5 h-5 rounded-full bg-white shadow" />
        </button>
        <div>
          <p className="text-sm font-semibold text-foreground">Show the sticky bottom bar</p>
          <p className="text-[12px] text-slate-500">When off, no sticky CTA bar appears on the passport.</p>
        </div>
      </div>

      {/* Selected buttons */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">Selected buttons ({cfg.buttons.length}/{MAX_STICKY_BUTTONS})</h3>
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 font-semibold"><Star className="w-3 h-3" /> = primary</span>
        </div>
        {cfg.buttons.length === 0 ? (
          <p className="text-[13px] text-slate-500 py-4 text-center">No buttons selected yet — add up to {MAX_STICKY_BUTTONS} below.</p>
        ) : cfg.buttons.map((b, i) => (
          <div key={b.key} className="flex items-center gap-2 rounded-xl border border-border p-2.5">
            <div className="flex flex-col">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="text-slate-400 hover:text-foreground disabled:opacity-30"><ChevronUp className="w-4 h-4" /></button>
              <button onClick={() => move(i, 1)} disabled={i === cfg.buttons.length - 1} className="text-slate-400 hover:text-foreground disabled:opacity-30"><ChevronDown className="w-4 h-4" /></button>
            </div>
            <input value={b.label} onChange={(e) => setLabel(b.key, e.target.value)} className="flex-1 h-9 px-2.5 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary" />
            <button onClick={() => setCfg((c) => ({ ...c, primary_key: b.key }))} title="Make primary"
              className={`h-9 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 ${cfg.primary_key === b.key ? "bg-amber-100 text-amber-700 border border-amber-200" : "border border-border text-slate-500 hover:bg-muted"}`}>
              <Star className={`w-3.5 h-3.5 ${cfg.primary_key === b.key ? "fill-amber-500 text-amber-500" : ""}`} /> Primary
            </button>
            <button onClick={() => removeButton(b.key)} className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40"><X className="w-4 h-4" /></button>
          </div>
        ))}
        {!atMax && remaining.length > 0 && (
          <div className="flex items-center gap-2 pt-1">
            <select onChange={(e) => { addButton(e.target.value); e.target.value = ""; }} defaultValue="" className="flex-1 h-9 px-2.5 rounded-lg border border-border bg-background text-sm cursor-pointer">
              <option value="" disabled>Add a button…</option>
              {remaining.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <span className="text-[11px] text-slate-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" /> up to {MAX_STICKY_BUTTONS}</span>
          </div>
        )}
        {atMax && <p className="text-[11px] text-slate-400">Maximum of {MAX_STICKY_BUTTONS} reached — remove one to add another.</p>}
      </div>

      {error && <p className="text-[12px] font-semibold text-red-600">{error}</p>}

      {/* Preview */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Preview</p>
        <div className="rounded-2xl border border-border bg-[#f4f5f7] p-3">
          {cfg.enabled && cfg.buttons.length > 0 ? (
            <div className="bg-white rounded-xl border border-[#e8ebef] p-3" style={{ gridTemplateColumns: `repeat(${Math.min(cfg.buttons.length, MAX_STICKY_BUTTONS)}, minmax(0,1fr))`, display: "grid", gap: 8 }}>
              {cfg.buttons.slice(0, MAX_STICKY_BUTTONS).map((b) => (
                <div key={b.key} className={`h-11 rounded-xl text-[11px] font-bold inline-flex items-center justify-center text-center px-1 ${b.key === cfg.primary_key ? "bg-[#1a6dff] text-white" : "border border-[#d8dce0] text-[#1a1d21]"}`}>{b.label}</div>
              ))}
            </div>
          ) : <p className="text-[13px] text-slate-400 text-center py-4">Sticky bar is off.</p>}
        </div>
      </div>
    </div>
  );
};

export default StickyButtonsPanel;
