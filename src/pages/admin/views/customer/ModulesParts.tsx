import { useId } from "react";
import { cn } from "@/lib/utils";
import { AdminButton } from "@/components/admin/v2/primitives";
import { AdminIcon, AdminIconTile, DetailDrawer, EditorEmpty, StatusBadge } from "@/components/admin/v3/editor";
import { PACKET_MODULES, type PacketModule } from "@/lib/packetModules";
import { adminTabHref } from "@/lib/admin/sections";
import { OwnerLink, ToggleRow } from "./customerParts";
import { DATA_NEED, isOn, MODULE_GROUPS, MODULE_ICONS, OEM_MODULE_IDS, overrideExamples, REQUIRED_BY_POLICY, type ModulesDraft } from "./modulesModel";
import type { OemBrandStatus, OemState } from "./useOemStatus";

export function ModuleRow({ m, on, canEdit, historyOff, unknown, onToggle, onOpen }: { m: PacketModule; on: boolean; canEdit: boolean; historyOff: boolean; unknown: boolean; onToggle: (next: boolean) => void; onOpen: () => void }) {
  const overridden = m.id === "historyReport" && historyOff && on;
  const id = useId();
  return (
    <li data-module={m.id} className="rounded-lg border border-adm-divider px-3 py-1.5 flex items-center gap-3 min-h-[56px]">
      <AdminIconTile name={MODULE_ICONS[m.id] ?? "layers"} tone={on && !unknown ? "primary" : "neutral"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <label htmlFor={id} className="text-[14px] leading-[20px] font-medium text-adm-ink">{m.label}</label>
          {!unknown && !on && <StatusBadge state="disabled" label="Off" />}
          {!unknown && overridden && <StatusBadge state="overridden" label="Off store-wide" />}
        </div>
        <p className="hidden sm:block text-[13px] leading-[18px] text-adm-muted">{m.desc}</p>
        {overridden && <p className="text-[13px] leading-[18px] text-adm-muted">Switched off for the whole store below, so shoppers never see this module.</p>}
      </div>
      {unknown ? (
        <span className="text-[13px] leading-[18px] text-adm-muted flex-shrink-0">Unknown</span>
      ) : (
        <span className={cn("relative inline-flex items-center justify-center flex-shrink-0 w-12 h-11", !canEdit && "opacity-60")}>
          <input id={id} type="checkbox" role="switch" className="peer absolute inset-0 w-full h-full opacity-0 m-0 cursor-pointer disabled:cursor-not-allowed" checked={on} disabled={!canEdit} onChange={(e) => onToggle(e.target.checked)} />
          <span aria-hidden="true" className="pointer-events-none relative inline-block w-10 h-6 rounded-full bg-adm-border transition-colors peer-checked:bg-adm-primary peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-adm-primary after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4" />
        </span>
      )}
      <button type="button" onClick={onOpen} aria-label={`Details for ${m.label}`} className="inline-grid place-items-center w-11 h-11 flex-shrink-0 rounded-lg text-adm-primary hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary">
        <AdminIcon name="chevron-right" size="control" />
      </button>
    </li>
  );
}

export function ModulesPreview({ defaults, historyOn, unknown }: { defaults: Record<string, boolean>; historyOn: boolean; unknown: boolean }) {
  const state = (id: string) => (unknown ? "unknown" : id === "historyReport" && !historyOn ? "hidden" : isOn(defaults, id) ? "shown" : "hidden");
  const bar = "h-2.5 rounded bg-[#E2E8F0]";
  return (
    <div className="space-y-3" data-modules-preview="">
      <div className="rounded-xl border border-adm-divider bg-[#F4F6F9] p-3 space-y-2">
        <div className="flex items-center justify-between" aria-hidden="true"><span className="h-3 w-20 rounded bg-[#CBD5E1]" /><span className="h-3 w-10 rounded bg-[#CBD5E1]" /></div>
        <div aria-hidden="true" className="h-20 rounded-lg bg-[#E2E8F0]" />
        <ul aria-label="Passport modules in approximate order" className="space-y-1.5">
          {REQUIRED_BY_POLICY.map((r) => (
            <li key={r.id} className="rounded-md bg-white border border-[#E6E8EC] px-2.5 py-1.5 flex items-center justify-between gap-2">
              <span className="text-[13px] leading-[18px] text-[#0F172A] min-w-0 break-words">{r.label}</span>
              <span className="text-[13px] leading-[18px] font-medium text-[#475569] flex-shrink-0">Always</span>
            </li>
          ))}
          {PACKET_MODULES.map((m) => {
            const st = state(m.id);
            return (
              <li key={m.id} data-preview-module={m.id} data-state={st} className={cn("rounded-md border px-2.5 py-1.5 flex items-center justify-between gap-2", st === "shown" ? "bg-white border-[#E6E8EC]" : "bg-transparent border-dashed border-[#CBD5E1]")}>
                <span className={cn("text-[13px] leading-[18px] min-w-0 break-words", st === "shown" ? "text-[#0F172A]" : "text-[#475569]")}>{m.label}</span>
                <span className="text-[13px] leading-[18px] font-medium text-[#475569] flex-shrink-0">{st === "shown" ? "Shown" : st === "hidden" ? "Hidden" : "Unknown"}</span>
              </li>
            );
          })}
        </ul>
        <div aria-hidden="true" className={`${bar} w-1/2`} />
      </div>
      <p className="text-[13px] leading-[18px] text-adm-muted">A schematic of the Passport. Order is approximate. A shown module appears only when the vehicle has its data, and a vehicle's own override wins.</p>
    </div>
  );
}

export function RequiredList() {
  return (
    <ul aria-label="Required by policy" className="grid gap-2 sm:grid-cols-3">
      {REQUIRED_BY_POLICY.map((r) => (
        <li key={r.id} className="rounded-lg border border-adm-divider bg-adm-workspace px-3 py-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{r.label}</p>
            <StatusBadge state="required" />
          </div>
          <p className="mt-1 hidden sm:block text-[13px] leading-[18px] text-adm-muted">{r.detail}</p>
        </li>
      ))}
    </ul>
  );
}

export function ModuleDrawer({ id, draft, canEdit, oemState, onToggle, onClose, onOverrides, onOem }: { id: string | null; draft: ModulesDraft; canEdit: boolean; oemState: OemState; onToggle: (id: string, on: boolean) => void; onClose: () => void; onOverrides: () => void; onOem: () => void }) {
  const m = PACKET_MODULES.find((x) => x.id === id);
  const group = m ? MODULE_GROUPS.find((g) => g.ids.includes(m.id)) : undefined;
  const on = m ? isOn(draft.packet_module_defaults, m.id) : false;
  const ex = m ? overrideExamples(draft.packet_module_defaults, m.id) : null;
  const yes = (v: boolean) => (v ? "Shown" : "Hidden");
  return (
    <DetailDrawer open={!!m} onClose={onClose} title={m?.label ?? "Module"} description={group ? `${group.title}. Store default for new and existing passports.` : undefined} footer={<AdminButton variant="primary" onClick={onClose}>Done</AdminButton>}>
      {m && ex && (
        <div className="space-y-5">
          <ToggleRow label={`${m.label} by default`} description={m.desc} checked={on} disabled={!canEdit} onChange={(v) => onToggle(m.id, v)} />
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[150px_1fr] text-[14px] leading-[20px]">
            <dt className="text-adm-muted">Needs</dt><dd className="min-w-0 break-words">{DATA_NEED[m.id]}</dd>
            <dt className="text-adm-muted">When there is no data</dt><dd className="min-w-0">Switching it on does not create content. Shoppers see the module only when the vehicle has the data above.</dd>
            <dt className="text-adm-muted">Vehicle has no override</dt><dd>{yes(ex.inherit)}</dd>
            <dt className="text-adm-muted">Vehicle forced on</dt><dd>{yes(ex.forcedOn)}</dd>
            <dt className="text-adm-muted">Vehicle forced off</dt><dd>{yes(ex.forcedOff)}</dd>
          </dl>
          {m.id === "historyReport" && (
            <p className={`text-[14px] leading-[20px] ${draft.history_report_links_enabled ? "text-adm-muted" : "text-adm-warning font-medium"}`}>
              {draft.history_report_links_enabled ? "The store-wide history link switch is on, so this module follows the setting above." : "The store-wide history link switch is off. It overrides this module so shoppers never reach a paywalled report."}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <AdminButton variant="secondary" onClick={onOverrides}>How vehicle overrides work</AdminButton>
            {OEM_MODULE_IDS.includes(m.id) && <AdminButton variant="secondary" disabled={oemState === "loading"} onClick={onOem}>Manufacturer document permission</AdminButton>}
          </div>
        </div>
      )}
    </DetailDrawer>
  );
}

export function OverrideDrawer({ open, onClose, draft }: { open: boolean; onClose: () => void; draft: ModulesDraft }) {
  const sample = ["insights", "photos", "historyReport"];
  return (
    <DetailDrawer open={open} onClose={onClose} title="How vehicle overrides work" description="One rule decides whether a shopper sees a module." footer={<AdminButton variant="primary" onClick={onClose}>Close</AdminButton>}>
      <div className="space-y-5">
        <ol className="space-y-3">
          {[
            ["1", "The vehicle's own setting", "If someone forced the module on or off for this vehicle in its Shopper Passport Builder, that wins."],
            ["2", "The store default on this page", "Otherwise the switch on this page decides."],
            ["3", "Shown", "A module with no setting anywhere is shown, and then appears only if the vehicle has its data."],
          ].map(([n, t, d]) => (
            <li key={n} className="flex items-start gap-3">
              <span aria-hidden="true" className="w-7 h-7 rounded-full bg-adm-workspace text-[13px] font-semibold inline-grid place-items-center flex-shrink-0">{n}</span>
              <div className="min-w-0"><p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{t}</p><p className="text-[13px] leading-[18px] text-adm-muted">{d}</p></div>
            </li>
          ))}
        </ol>
        <p className="text-[14px] leading-[20px] text-adm-ink">Changing a default here never rewrites a vehicle's own override, so vehicles with an override keep what they have.</p>
        <div>
          <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">With your draft</p>
          <ul className="mt-2 divide-y divide-adm-divider rounded-lg border border-adm-divider">
            {sample.map((id) => {
              const m = PACKET_MODULES.find((x) => x.id === id);
              const ex = overrideExamples(draft.packet_module_defaults, id);
              return (
                <li key={id} className="px-3 py-2.5 text-[14px] leading-[20px]">
                  <p className="font-medium text-adm-ink">{m?.label}</p>
                  <p className="text-[13px] leading-[18px] text-adm-muted">No override: {ex.inherit ? "shown" : "hidden"}. Forced on: {ex.forcedOn ? "shown" : "hidden"}. Forced off: {ex.forcedOff ? "shown" : "hidden"}.</p>
                </li>
              );
            })}
          </ul>
        </div>
        <p className="text-[13px] leading-[18px] text-adm-muted">The per-vehicle control is on the Vehicle File, in the Shopper Passport Builder. Auto-publish is a separate shared setting owned by <OwnerLink to={adminTabHref("effective-policy")}>Publishing</OwnerLink>.</p>
      </div>
    </DetailDrawer>
  );
}

export function OemDrawer({ open, onClose, state, brands }: { open: boolean; onClose: () => void; state: OemState; brands: OemBrandStatus[] }) {
  return (
    <DetailDrawer open={open} onClose={onClose} title="Manufacturer document permission" description="Whether this account may serve its own copy of a manufacturer's documents, or must link to the manufacturer." footer={<AdminButton variant="primary" onClick={onClose}>Close</AdminButton>}>
      <div className="space-y-4">
        <p className="text-[14px] leading-[20px] text-adm-ink">This is the server's current answer. It is not a setting, nothing here grants or removes a permission, and this page does not work it out from your inventory.</p>
        {state === "loading" && <p role="status" className="text-[14px] text-adm-muted">Checking the current status.</p>}
        {state === "unknown" && <EditorEmpty tone="danger" artwork="search" title="Status could not be confirmed" description="Until it loads, every vehicle links to the manufacturer. An unknown answer is treated as no permission." />}
        {state === "none" && <EditorEmpty artwork="documents" title="No brand has a confirmed status" description="Every vehicle links to the manufacturer's own site." />}
        {state === "ready" && (
          <ul aria-label="Manufacturer status" className="divide-y divide-adm-divider rounded-lg border border-adm-divider">
            {brands.map((b) => (
              <li key={b.brand} className="flex items-center gap-3 px-3 py-2.5 min-h-[56px]">
                <AdminIconTile name="shield-check" tone="neutral" />
                <p className="min-w-0 flex-1 text-[14px] leading-[20px] font-semibold text-adm-ink">{b.label}</p>
                <StatusBadge state={b.served ? "enabled" : "unavailable"} label={b.served ? "Served directly" : "Link only"} />
              </li>
            ))}
          </ul>
        )}
        <p className="text-[13px] leading-[18px] text-adm-muted">Any vehicle without a confirmed status for its brand shows a link to the manufacturer instead of a stored copy.</p>
      </div>
    </DetailDrawer>
  );
}

export function PublishImpact({ before, after, autoPublish }: { before: ModulesDraft; after: ModulesDraft; autoPublish: boolean }) {
  const turnedOff = PACKET_MODULES.filter((m) => isOn(before.packet_module_defaults, m.id) && !isOn(after.packet_module_defaults, m.id));
  const turnedOn = PACKET_MODULES.filter((m) => !isOn(before.packet_module_defaults, m.id) && isOn(after.packet_module_defaults, m.id));
  const names = (l: PacketModule[]) => l.map((m) => m.label).join(", ");
  return (
    <div className="space-y-2 text-[14px] leading-[20px]" data-publish-impact="">
      <p className="font-semibold text-adm-ink">Effect on shoppers</p>
      <ul className="list-disc pl-5 space-y-1 text-adm-ink">
        {turnedOff.length > 0 && <li>Hidden on every vehicle without its own override: {names(turnedOff)}.</li>}
        {turnedOn.length > 0 && <li>Shown again, where the vehicle has the data: {names(turnedOn)}.</li>}
        {before.history_report_links_enabled !== after.history_report_links_enabled && <li>{after.history_report_links_enabled ? "History report links may appear again for used, certified and demo vehicles." : "History report links disappear for every vehicle, whatever the module setting says."}</li>}
        <li>Already published passports pick the change up the next time a shopper opens them. Vehicles with their own override do not change.</li>
        <li>Auto-publish is {autoPublish ? "on" : "off"} and is not changed here.</li>
      </ul>
      <p className="text-[13px] leading-[18px] text-adm-muted">Vehicle counts are not available in this editor.</p>
    </div>
  );
}
