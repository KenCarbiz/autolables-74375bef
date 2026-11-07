import { useMemo, useState } from "react";
import { AdminIcon, ScopeLabel, SectionCard, StatusBadge } from "@/components/admin/v3/editor";
import PassportPublishingCard from "@/components/admin/PassportPublishingCard";
import { adminTabHref } from "@/lib/admin/sections";
import { PACKET_MODULES } from "@/lib/packetModules";
import { Banner } from "../brand/feeds/bits";
import { useSettingsEditor } from "../brand/feeds/useSettingsEditor";
import { ApplyChrome, LoadingBlock, OwnerLink, ToggleRow } from "./customerParts";
import { ModuleDrawer, ModuleRow, OemDrawer, OverrideDrawer, PublishImpact, RequiredList } from "./ModulesParts";
import { ignoredValues, isOn, MODULE_GROUPS, MODULE_LABELS, moduleChangeRows, modulesToPatch, moduleById, readModules, setModule, unknownEntries, type ModulesDraft } from "./modulesModel";
import { useOemStatus } from "./useOemStatus";

const OPTIONS = {
  read: readModules,
  toPatch: modulesToPatch,
  labels: MODULE_LABELS,
  fixtureViewId: "passport-modules",
};

export default function PassportModulesView() {
  const ed = useSettingsEditor<ModulesDraft>(OPTIONS);
  const { edit, canEdit, settings } = ed;
  const oem = useOemStatus();
  const [openId, setOpenId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState(false);
  const [oemOpen, setOemOpen] = useState(false);
  const draft = edit.draft;
  const baseline = edit.baseline;
  const rows = useMemo(() => (draft && baseline ? moduleChangeRows(baseline, draft) : []), [draft, baseline]);
  if (!draft || !baseline) return <LoadingBlock label="Loading Passport modules" />;

  const defaults = draft.packet_module_defaults;
  const offCount = PACKET_MODULES.filter((m) => !isOn(defaults, m.id)).length;
  const unknown = unknownEntries(defaults);
  const ignored = ignoredValues(defaults);
  const toggle = (id: string, on: boolean) => edit.set("packet_module_defaults", setModule(defaults, baseline.packet_module_defaults, id, on));
  const api = { ...ed, rows };
  const autoPublish = settings.ingest_auto_publish !== false;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <ScopeLabel scope="all_rooftops" />
        <p className="text-[13px] leading-[18px] text-adm-muted">{PACKET_MODULES.length - offCount} of {PACKET_MODULES.length} optional modules on by default. Saved once for the account.</p>
      </div>
      {!canEdit && <Banner tone="neutral" icon="lock" title="You can view these defaults but not change them">Changing Passport modules needs the manage settings permission. Ask an owner or manager to make the change.</Banner>}
      {ed.unreadable && <Banner tone="danger" title="Settings could not be read">Switches are not shown as saved and nothing can be applied until settings load.</Banner>}
      {!draft.history_report_links_enabled && <Banner tone="warning" icon="lock" title="History report links are off for the whole store">Shoppers never see a CARFAX or AutoCheck link, whatever the module switch says. Turn the store-wide switch back on below when the subscription is active.</Banner>}
      {(unknown.length > 0 || ignored.length > 0) && (
        <Banner tone="warning" title="Some saved entries are not recognized">
          {unknown.length > 0 && <>Not a current module: {unknown.join(", ")}. </>}
          {ignored.length > 0 && <>Not on or off, so ignored and treated as on: {ignored.join(", ")}. </>}
          They are kept exactly as saved.
        </Banner>
      )}

      <SectionCard icon="lock" title="Required by policy" description="These always show. They are not modules and have no switch.">
        <RequiredList />
      </SectionCard>

      {MODULE_GROUPS.map((g) => (
        <SectionCard key={g.id} id={`modules-${g.id}`} icon={g.icon} title={g.title} description={g.description}>
          <ul aria-label={g.title} className="space-y-2">
            {g.ids.map((id) => {
              const m = moduleById(id);
              if (!m) return null;
              return <ModuleRow key={id} m={m} on={isOn(defaults, id)} canEdit={canEdit} historyOff={!draft.history_report_links_enabled} onToggle={(v) => toggle(id, v)} onOpen={() => setOpenId(id)} />;
            })}
          </ul>
          {g.id === "documents" && (
            <div className="rounded-lg border border-adm-divider p-3 space-y-1">
              <ToggleRow
                label="History report links, store-wide"
                description="Store-wide kill switch for your dealer-paid CARFAX or AutoCheck links. Turn it off if the subscription lapses so shoppers never land on a paywall. It overrides the module switch above and applies to used, certified and demo vehicles."
                checked={draft.history_report_links_enabled}
                disabled={!canEdit}
                onChange={(v) => edit.set("history_report_links_enabled", v)}
                badge={<StatusBadge state={draft.history_report_links_enabled ? "enabled" : "disabled"} />}
              />
            </div>
          )}
        </SectionCard>
      ))}

      <SectionCard icon="layers" title="Order and publishing" description="What this page does not change.">
        <Banner tone="neutral" icon="info" title="Module order is not configurable">
          The Passport arranges its modules in a fixed layout and there is no saved order setting, so reordering is not offered here.
        </Banner>
        <PassportPublishingCard readOnly value={autoPublish} manageTo={adminTabHref("effective-policy")} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <button type="button" onClick={() => setOverrides(true)} className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-[32px] font-semibold text-[14px] text-adm-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary rounded-sm"><AdminIcon name="help" size="compact" />How vehicle overrides work</button>
          <button type="button" onClick={() => setOemOpen(true)} className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-[32px] font-semibold text-[14px] text-adm-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary rounded-sm"><AdminIcon name="shield-check" size="compact" />Manufacturer document permission</button>
          <OwnerLink to={adminTabHref("customer-previews")}>Customer previews</OwnerLink>
        </div>
      </SectionCard>

      <ApplyChrome
        api={api}
        scope={<ScopeLabel scope="all_rooftops" />}
        timing="Takes effect the next time a shopper opens a Passport."
        impact={<PublishImpact before={baseline} after={draft} autoPublish={autoPublish} />}
      />

      <ModuleDrawer id={openId} draft={draft} canEdit={canEdit} oemState={oem.state} onToggle={toggle} onClose={() => setOpenId(null)} onOverrides={() => { setOpenId(null); setOverrides(true); }} onOem={() => { setOpenId(null); setOemOpen(true); }} />
      <OverrideDrawer open={overrides} onClose={() => setOverrides(false)} draft={draft} />
      <OemDrawer open={oemOpen} onClose={() => setOemOpen(false)} state={oem.state} brands={oem.brands} />
    </div>
  );
}
