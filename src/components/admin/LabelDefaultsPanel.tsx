import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useStickerCatalog } from "@/lib/stickerStudio/useStickerCatalog";
import { useStickerPrefs } from "@/lib/stickerStudio/useStickerPrefs";
import {
  LABEL_SLOTS, LABEL_BUILDERS, resolveLabelDefault, parseLabelRef,
  type LabelSlot,
} from "@/lib/labelDefaults";

// Tenant label template defaults — one picker per slot (window/addendum ×
// used/new). Options span the dedicated builders and every matching Sticker
// Studio template, so "which label is in effect" is one visible setting
// instead of a hidden star in the studio.
export default function LabelDefaultsPanel() {
  const { settings, updateSettings } = useDealerSettings();
  const { templates } = useStickerCatalog();
  const { defaults: legacy } = useStickerPrefs();

  const optionsFor = (slot: LabelSlot) => {
    const def = LABEL_SLOTS.find((s) => s.slot === slot)!;
    const builders = Object.values(LABEL_BUILDERS).filter((b) => b.kind === def.kind && b.conditions.includes(def.condition));
    const studio = templates.filter((t) => t.config.type === def.kind);
    return [
      ...builders.map((b) => ({ value: `builder:${b.key}`, label: b.label })),
      ...studio.map((t) => ({ value: `studio:${t.config.id}`, label: `${t.config.name} (${t.config.size})` })),
    ];
  };

  const setSlot = (slot: LabelSlot, ref: string) =>
    updateSettings({ label_defaults: { ...(settings.label_defaults || {}), [slot]: ref } });

  return (
    <div className="bg-card rounded-lg p-4 shadow-premium mb-3">
      <h4 className="text-sm font-bold text-foreground mb-1">Label templates in effect</h4>
      <p className="text-xs text-muted-foreground mb-3">
        The window sticker and addendum template your store uses by default, per vehicle condition.
        Generate Sticker on a vehicle opens the template chosen here; you can still pick a different
        one per vehicle from its Labels tab.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {LABEL_SLOTS.map((def) => {
          const current = resolveLabelDefault(settings.label_defaults, def.slot, legacy) || "";
          const explicit = !!settings.label_defaults?.[def.slot];
          const opts = optionsFor(def.slot);
          const known = opts.some((o) => o.value === current);
          return (
            <div key={def.slot}>
              <label className="text-xs font-semibold text-muted-foreground">{def.title}</label>
              <select
                value={known ? current : ""}
                onChange={(e) => e.target.value && setSlot(def.slot, e.target.value)}
                className="w-full px-3 py-2 border border-border-custom rounded text-sm"
              >
                {!known && <option value="">Choose a template…</option>}
                {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                {def.sub}{!explicit && current ? ` · Using ${parseLabelRef(current)?.kind === "builder" ? "the platform default" : "your starred Sticker Studio template"}` : ""}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
