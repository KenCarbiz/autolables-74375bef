import { useMemo, useState } from "react";
import { AdminButton } from "@/components/admin/v2/primitives";
import { AdminIcon, ScopeLabel, SectionCard, StatusBadge } from "@/components/admin/v3/editor";
import { useAdminNow } from "@/lib/admin/dataSource";
import { MAX_STICKY_BUTTONS, STICKY_LABELS, type StickyButton } from "@/lib/stickyButtons";
import { Banner } from "../brand/feeds/bits";
import { useSettingsEditor } from "../brand/feeds/useSettingsEditor";
import { ApplyChrome, LoadingBlock, PreviewLayout, ToggleRow } from "./customerParts";
import { ActionEditorDrawer, ActionLibrary, AfterHoursCtaDrawer, SelectedActions, StickyPreview } from "./CtaParts";
import { CTA_LABELS, ctaContextFrom, ctaToPatch, describeCta, readCtas, selectedOf, SLIDEOUT_VARIANTS, validateCtas, withSelected, type CtaDraft } from "./ctaModel";

const OPTIONS = {
  read: readCtas,
  toPatch: ctaToPatch,
  labels: CTA_LABELS,
  validate: validateCtas,
  describe: describeCta,
  fixtureViewId: "ctas",
};

export default function CallsToActionView() {
  const ed = useSettingsEditor<CtaDraft>(OPTIONS);
  const { edit, canEdit, settings } = ed;
  const now = new Date(useAdminNow());
  const [editing, setEditing] = useState<string | null>(null);
  const [afterHours, setAfterHours] = useState(false);
  const [mode, setMode] = useState<"mobile" | "desktop">("mobile");
  const draft = edit.draft;
  const ctx = useMemo(() => ctaContextFrom(settings), [settings]);
  const namedAgents = useMemo(() => (settings.passport_agents ?? []).filter((a) => a.name.trim()), [settings.passport_agents]);
  if (!draft) return <LoadingBlock label="Loading calls to action" />;

  const cfg = draft.sticky_bottom_buttons;
  const selected = selectedOf(cfg);
  const errors = edit.errors as Partial<Record<string, string>>;
  const setCfg = (next: typeof cfg) => edit.set("sticky_bottom_buttons", next);
  const add = (key: string) => {
    if (selected.length >= MAX_STICKY_BUTTONS) return;
    const b: StickyButton = { key, label: STICKY_LABELS[key] ?? key, enabled: true, order: selected.length + 1 };
    setCfg(withSelected(cfg, [...selected, b], selected.length === 0 ? key : cfg.primary_key));
  };
  const remove = (key: string) => setCfg(withSelected(cfg, selected.filter((b) => b.key !== key)));
  const setLabel = (key: string, label: string) => setCfg({ ...cfg, buttons: cfg.buttons.map((b) => (b.key === key ? { ...b, label } : b)) });
  const variant = SLIDEOUT_VARIANTS.find((v) => v.id === draft.mobile_slideout_cta_variant);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <ScopeLabel scope="all_rooftops" />
        <p className="text-[13px] leading-[18px] text-adm-muted">Saved once for the account. The Passport reads these the next time a shopper opens it.</p>
      </div>
      {!canEdit && <Banner tone="neutral" icon="lock" title="You can view these buttons but not change them">Changing calls to action needs the manage settings permission. Ask an owner or manager to make the change.</Banner>}
      {ed.unreadable && <Banner tone="danger" title="Settings could not be read">Nothing is shown as saved and nothing can be applied until settings load.</Banner>}
      <PreviewLayout
        previewLabel="Passport preview"
        preview={(
          <SectionCard icon="eye" title="Live preview" description="An approximation of the Passport bottom bar for this draft.">
            <div className="flex gap-2" role="group" aria-label="Preview size">
              {(["mobile", "desktop"] as const).map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`min-h-[44px] sm:min-h-[40px] px-3 rounded-md border text-[14px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-adm-primary ${mode === m ? "bg-adm-selected border-adm-primary text-adm-primary" : "bg-adm-surface border-adm-border text-adm-ink hover:bg-adm-workspace"}`}>{m === "mobile" ? "Mobile" : "Desktop"}</button>
              ))}
            </div>
            <StickyPreview cfg={cfg} mode={mode} />
            <p className="text-[13px] leading-[18px] text-adm-muted">Draft preview. It shows your selected actions in order with your labels. Real wording and spacing come from the Passport.</p>
            <AdminButton variant="secondary" className="w-full sm:w-auto" onClick={() => setAfterHours(true)}><AdminIcon name="clock" />After-hours preview</AdminButton>
          </SectionCard>
        )}
      >
        <SectionCard
          icon="layers"
          title="Sticky bottom bar"
          description="Up to four buttons on phones and tablets. Exactly one is the primary action."
        >
          <StatusBadge state={selected.length > MAX_STICKY_BUTTONS ? "failed" : "enabled"} label={`${selected.length} of ${MAX_STICKY_BUTTONS} selected`} className="self-start" />
          <ToggleRow label="Show the sticky bottom bar" description={cfg.enabled ? "Shoppers on phones and tablets see the bar." : "Off: no bar appears on the Passport."} checked={cfg.enabled} disabled={!canEdit} onChange={(v) => setCfg({ ...cfg, enabled: v })} />
          {errors.sticky_bottom_buttons && <p role="alert" className="flex items-start gap-1.5 text-[14px] leading-[20px] font-medium text-adm-danger"><AdminIcon name="alert" className="mt-0.5" />{errors.sticky_bottom_buttons}</p>}
          <SelectedActions
            cfg={cfg}
            ctx={ctx}
            canEdit={canEdit}
            onReorder={(next) => setCfg(withSelected(cfg, next))}
            onPrimary={(k) => setCfg({ ...cfg, primary_key: k })}
            onEdit={setEditing}
            onRemove={remove}
          />
        </SectionCard>

        <SectionCard icon="plus" title="Action library" description="Every action opens a fixed place in the Passport. Unavailable actions say why.">
          <ActionLibrary cfg={cfg} ctx={ctx} canEdit={canEdit} onAdd={add} />
        </SectionCard>

        <SectionCard icon="message" title="Mobile slide-out style" description="The bottom area inside mobile Passport panels. Also shown, read only, on Why Buy.">
          <fieldset className="space-y-2" disabled={!canEdit}>
            <legend className="sr-only">Mobile slide-out style</legend>
            {SLIDEOUT_VARIANTS.map((v) => (
              <label key={v.id} className={`flex items-start gap-3 rounded-lg border px-3 py-3 min-h-[56px] cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-adm-primary ${draft.mobile_slideout_cta_variant === v.id ? "border-adm-primary bg-adm-selected" : "border-adm-divider hover:bg-adm-workspace"}`}>
                <input type="radio" name="slideout-variant" className="mt-1 w-5 h-5 accent-[var(--adm-primary,#2457D6)]" checked={draft.mobile_slideout_cta_variant === v.id} onChange={() => edit.set("mobile_slideout_cta_variant", v.id)} />
                <span className="min-w-0">
                  <span className="block text-[14px] leading-[20px] font-semibold text-adm-ink">{v.label}</span>
                  <span className="block text-[13px] leading-[18px] text-adm-muted">{v.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {!variant && <p role="alert" className="text-[14px] font-medium text-adm-danger">{errors.mobile_slideout_cta_variant ?? "Choose one of the four styles."}</p>}
        </SectionCard>
      </PreviewLayout>

      <ApplyChrome
        api={ed}
        scope={<ScopeLabel scope="all_rooftops" />}
        timing="Takes effect the next time a shopper opens a Passport."
        impact={<p className="text-[14px] text-adm-muted">Only the buttons and style listed change. The Passport layout is not changed, and no message is sent.</p>}
      />

      <ActionEditorDrawer buttonKey={editing} cfg={cfg} ctx={ctx} canEdit={canEdit} count={selected.length} onClose={() => setEditing(null)} onLabel={setLabel} onPrimary={(k) => setCfg({ ...cfg, primary_key: k })} afterHours={{ routingRaw: settings.passport_contact_routing, agents: namedAgents, now }} />
      <AfterHoursCtaDrawer open={afterHours} onClose={() => setAfterHours(false)} cfg={cfg} ctx={ctx} routingRaw={settings.passport_contact_routing} agents={namedAgents} now={now} />
    </div>
  );
}
