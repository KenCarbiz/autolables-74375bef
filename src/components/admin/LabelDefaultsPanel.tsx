import { useState } from "react";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useStickerCatalog } from "@/lib/stickerStudio/useStickerCatalog";
import { useStickerPrefs } from "@/lib/stickerStudio/useStickerPrefs";
import {
  LABEL_SLOTS, LABEL_BUILDERS, resolveLabelDefault, parseLabelRef,
  type LabelSlot,
} from "@/lib/labelDefaults";
import { AdminButton, AdminLinkButton, StatusChip } from "@/components/admin/v2/primitives";
import { SectionCard, SelectField, useIsNarrow } from "@/components/admin/v3/editor";
import { useAdminFixture, useViewFixture } from "@/lib/admin/dataSource";

// Tenant label template defaults — one picker per slot (window/addendum ×
// used/new). Options span the dedicated builders and every matching Sticker
// Studio template, so "which label is in effect" is one visible setting
// instead of a hidden star in the studio.
type StudioTemplate = { config: { id: string; name: string; size: string; type: string } };
type LegacyDefaults = ReturnType<typeof useStickerPrefs>["defaults"];

/** Live data comes from the Sticker Studio catalog; a design fixture supplies its own list and makes no request. */
export default function LabelDefaultsPanel() {
  const fixture = useAdminFixture();
  return fixture ? <LabelDefaultsFixture /> : <LabelDefaultsLive />;
}

function LabelDefaultsLive() {
  const { settings, updateSettings } = useDealerSettings();
  const { templates } = useStickerCatalog();
  const { defaults: legacy } = useStickerPrefs();
  return <LabelDefaultsBody fixture={false} studio={templates as StudioTemplate[]} legacy={legacy} saved={settings.label_defaults} onSelect={(slot, ref) => updateSettings({ label_defaults: { ...(settings.label_defaults || {}), [slot]: ref } })} />;
}

function LabelDefaultsFixture() {
  const catalog = useViewFixture<{ catalog: Array<{ id: string; name: string; type: string; size: string }> }>("templates");
  const { settings } = useDealerSettings();
  const [picked, setPicked] = useState<Record<string, string>>({});
  const studio = (catalog?.catalog ?? []).map((t) => ({ config: { id: t.id, name: t.name, size: t.size, type: t.type } }));
  return <LabelDefaultsBody fixture studio={studio} legacy={{} as LegacyDefaults} saved={{ ...(settings.label_defaults || {}), ...picked }} onSelect={(slot, ref) => setPicked((p) => ({ ...p, [slot]: ref }))} />;
}

function LabelDefaultsBody({ fixture, studio, legacy, saved, onSelect }: { fixture: boolean; studio: StudioTemplate[]; legacy: LegacyDefaults; saved: Record<string, string> | undefined; onSelect: (slot: LabelSlot, ref: string) => void }) {
  const narrow = useIsNarrow();
  const optionsFor = (slot: LabelSlot) => {
    const def = LABEL_SLOTS.find((s) => s.slot === slot)!;
    const builders = Object.values(LABEL_BUILDERS).filter((b) => b.kind === def.kind && b.conditions.includes(def.condition));
    return [
      ...builders.map((b) => ({ value: `builder:${b.key}`, label: b.label })),
      ...studio.filter((t) => t.config.type === def.kind).map((t) => ({ value: `studio:${t.config.id}`, label: `${t.config.name} (${t.config.size})` })),
    ];
  };

  const createAction = (
        fixture ? (
          <span className="inline-flex flex-col items-end">
            <AdminButton variant="primary" disabled aria-describedby="create-template-note" className="min-h-[44px] sm:min-h-[36px]">Create template</AdminButton>
            <span id="create-template-note" className="mt-1 text-[13px] leading-[18px] text-adm-muted">Opens Sticker Studio. Not available in the design fixture.</span>
          </span>
        ) : (
          <AdminLinkButton to="/sticker-studio" variant="primary" className="min-h-[44px] sm:min-h-[36px]">Create template</AdminLinkButton>
        )
  );

  return (
    <SectionCard
      icon="file"
      title="Default templates by condition"
      description="The template each document uses for new and used vehicles. Choose one per row."
      actions={narrow ? undefined : createAction}
    >
      {narrow && <div>{createAction}</div>}
      <ul aria-label="Default templates by condition" className="-mx-4 sm:-mx-6 -my-5 divide-y divide-adm-divider">
        {LABEL_SLOTS.map((def) => {
          const current = resolveLabelDefault(saved, def.slot, legacy) || "";
          const explicit = !!saved?.[def.slot];
          const opts = optionsFor(def.slot);
          const known = opts.some((o) => o.value === current);
          const source = explicit ? "Your selection" : current ? (parseLabelRef(current)?.kind === "builder" ? "Platform default" : "Starred in Sticker Studio") : "Unknown";
          return (
            <li key={def.slot} className="px-4 sm:px-6 py-4 grid gap-3 md:grid-cols-[minmax(160px,200px)_minmax(0,1fr)_minmax(150px,auto)] md:items-center">
              <div className="min-w-0">
                <p className="text-[15px] leading-[22px] font-semibold text-adm-ink capitalize">{def.condition}</p>
                <p className="text-[13px] leading-[18px] text-adm-muted">{def.kind === "window" ? "Window sticker" : "Addendum"}</p>
              </div>
              <SelectField
                aria-label={def.title}
                value={known ? current : ""}
                onChange={(e) => e.target.value && onSelect(def.slot, e.target.value)}
              >
                {!known && <option value="">Choose a template</option>}
                {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </SelectField>
              <div className="flex md:flex-col md:items-end items-center gap-2 md:gap-1 flex-wrap">
                <StatusChip tone={known ? "success" : "warning"} className="text-[13px]">{known ? "Active" : "Not set"}</StatusChip>
                <span className="text-[13px] leading-[18px] text-adm-muted">{source}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
