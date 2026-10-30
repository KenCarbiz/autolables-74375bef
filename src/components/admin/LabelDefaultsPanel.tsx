import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useStickerCatalog } from "@/lib/stickerStudio/useStickerCatalog";
import { useStickerPrefs } from "@/lib/stickerStudio/useStickerPrefs";
import {
  LABEL_SLOTS, LABEL_BUILDERS, resolveLabelDefault, parseLabelRef,
  type LabelSlot,
} from "@/lib/labelDefaults";
import { AdminCard, AdminLinkButton, AdminTable, StatusChip, Td, Th } from "@/components/admin/v2/primitives";

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
    <AdminCard
      title="Default templates by condition"
      flush
      inset="sm"
      action={<AdminLinkButton to="/sticker-studio" variant="primary">Create template</AdminLinkButton>}
    >
      <AdminTable caption="Default templates by condition" minWidth={760}>
        <thead>
          <tr>
            <Th>Condition</Th>
            <Th>Document</Th>
            <Th>Template</Th>
            <Th>Source</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {LABEL_SLOTS.map((def) => {
            const current = resolveLabelDefault(settings.label_defaults, def.slot, legacy) || "";
            const explicit = !!settings.label_defaults?.[def.slot];
            const opts = optionsFor(def.slot);
            const known = opts.some((o) => o.value === current);
            return (
              <tr key={def.slot}>
                <Td className="font-medium capitalize">{def.condition}</Td>
                <Td className="whitespace-nowrap">{def.kind === "window" ? "Window sticker" : "Addendum"}</Td>
                <Td className="min-w-[260px]">
                  <select
                    aria-label={def.title}
                    value={known ? current : ""}
                    onChange={(e) => e.target.value && setSlot(def.slot, e.target.value)}
                    className="h-9 w-full rounded-md border border-adm-border bg-adm-surface px-2 text-[14px] text-adm-ink"
                  >
                    {!known && <option value="">Choose a template</option>}
                    {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Td>
                <Td className="text-adm-muted">{explicit ? "Your selection" : current ? (parseLabelRef(current)?.kind === "builder" ? "Platform default" : "Starred in Sticker Studio") : "Unknown"}</Td>
                <Td><StatusChip tone={known ? "success" : "warning"}>{known ? "Active" : "Not set"}</StatusChip></Td>
              </tr>
            );
          })}
        </tbody>
      </AdminTable>
    </AdminCard>
  );
}
