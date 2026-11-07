import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { AdvancedDisclosure, DraftActionBar, LeaveGuardDialog, ReviewChangesDialog, ScopeLabel } from "@/components/admin/v3/editor";
import { adminTabHref } from "@/lib/admin/sections";
import { GROUPS, HIDDEN_KEYS, readStore, storePatch, STORE_LABELS, validateStore, type Group, type StoreDraft } from "./feeds/storeSettingsModel";
import { useSettingsEditor } from "./feeds/useSettingsEditor";
import { Banner, LinkRow } from "./feeds/bits";
import { GroupCard, GroupDrawer } from "./feeds/StoreParts";

const CHOICE_TEXT: Record<string, string> = {
  selective: "Selective", all_installed: "All as installed", all_optional: "All as optional", manual: "Manual", auto: "Auto-send on ingest",
};

const OPTIONS = {
  read: readStore,
  toPatch: storePatch,
  labels: STORE_LABELS,
  validate: validateStore,
  fixtureViewId: "store-settings",
  describe: (key: string, value: unknown) => {
    if (typeof value === "boolean") return value ? "On" : "Off";
    if (typeof value === "string" && CHOICE_TEXT[value] && (key === "product_default_mode" || key.startsWith("ingest_"))) return CHOICE_TEXT[value];
    return value === undefined || value === null || value === "" ? "Not set" : String(value);
  },
};

const PANEL_GROUP: Record<string, string> = {
  "product-default-mode": "products", "shopper-engagement": "engagement", "feed-automation": "feed-automation", integrations: "integrations", "feature-toggles": "signing",
};

const keysOf = (g: Group) => g.items.flatMap((i) => ("key" in i && i.key ? [i.key as string] : []));

export default function StoreSettingsView() {
  const ed = useSettingsEditor<StoreDraft>(OPTIONS);
  const { source, edit, canEdit } = ed;
  const { search } = useLocation();
  const [openId, setOpenId] = useState<string | null>(() => {
    const params = new URLSearchParams(search);
    return source.isFixture ? params.get("open") : PANEL_GROUP[params.get("panel") ?? ""] ?? null;
  });
  const draft = edit.draft;
  const open = useMemo(() => GROUPS.find((g) => g.id === openId) ?? null, [openId]);
  const rooftop = source.stores.find((s) => s.id === source.activeStoreId)?.name;

  if (!draft) return <div className="h-48 rounded-xl border border-adm-divider bg-adm-surface animate-pulse" aria-busy="true" aria-label="Loading store settings" />;

  const changeCount = (g: Group) => keysOf(g).filter((k) => edit.changedKeys.includes(k as keyof StoreDraft & string)).length;
  const totalOn = GROUPS.reduce((n, g) => n + g.items.filter((i) => i.kind === "switch" && draft[i.key]).length, 0);
  const totalSwitches = GROUPS.reduce((n, g) => n + g.items.filter((i) => i.kind === "switch").length, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ScopeLabel scope="all_rooftops" />
        <p className="text-[13px] leading-[18px] text-adm-muted">{totalOn} of {totalSwitches} switches are on. Saved once for the dealer group{rooftop ? `; you are viewing ${rooftop}` : ""}.</p>
      </div>

      {!canEdit && <Banner tone="neutral" icon="lock" title="You can view these settings but not change them">Changing store settings needs the manage settings permission. Ask an owner or manager to make the change.</Banner>}
      {ed.unreadable && <Banner tone="danger" title="Settings could not be read">Switches are not shown as saved and nothing can be applied until the settings load.</Banner>}

      <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" aria-label="Setting groups">
        {GROUPS.map((g) => (
          <GroupCard key={g.id} group={g} draft={draft} settings={ed.settings} changes={changeCount(g)} canEdit={canEdit} onOpen={() => setOpenId(g.id)} />
        ))}
      </ul>

      <div>
        <h2 className="text-[16px] leading-[24px] font-semibold text-adm-ink mb-2">Settings that moved</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <LinkRow to={adminTabHref("effective-policy")} icon="globe" title="Passport publishing" description="Auto-publish on intake and listing rules" />
          <LinkRow to={adminTabHref("price-rules")} icon="dollar" title="Doc fee and price display" description="Pricing and incentives" />
          <LinkRow to={adminTabHref("service-policy")} icon="wrench" title="Service policy" description="Title, recon approval and signing gates" />
          <LinkRow to={adminTabHref("templates")} icon="printer" title="Paper size and templates" description="Addendum paper size and label stock" />
        </div>
      </div>

      <AdvancedDisclosure title="Advanced: settings kept but not offered">
        <p className="text-[14px] leading-[20px] text-adm-muted">These two stored values have no working feature behind them, so no switch is shown. Their saved values are kept as they are.</p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          {HIDDEN_KEYS.map((k) => (
            <div key={k} className="flex justify-between gap-3 border-b border-adm-divider py-2 text-[14px]"><dt className="text-adm-muted"><code className="text-[13px]">{k}</code></dt><dd className="font-medium">{ed.settings[k] ? "Saved on" : "Saved off"}</dd></div>
          ))}
        </dl>
      </AdvancedDisclosure>

      {canEdit && <DraftActionBar state={ed.barState} onDiscard={ed.discard} onReview={ed.flow.openReview} onRetry={() => void ed.apply()} onRefresh={ed.refresh} retryDisabled={!ed.canApply} />}

      <GroupDrawer group={open} draft={draft} settings={ed.settings} canEdit={canEdit} errors={ed.edit.errors as Partial<Record<string, string>>} onSet={(k, v) => edit.set(k, v as never)} onClose={() => setOpenId(null)} />

      <ReviewChangesDialog open={ed.flow.phase === "reviewing" || ed.flow.phase === "saving"} scope={<ScopeLabel scope="all_rooftops" />}
        timing="Takes effect for new documents and the next intake run."
        changes={ed.rows} impact={<p className="text-[14px] text-adm-muted">Only the switches listed change. Documents already produced and published passports are not changed.</p>}
        applying={ed.flow.phase === "saving"} applyDisabled={!ed.canApply} error={!ed.canApply ? ed.blockedReason : undefined}
        onCancel={ed.flow.closeReview} onApply={() => void ed.apply()} />
      <LeaveGuardDialog open={ed.guard.pending} onStay={ed.guard.stay} onLeave={ed.guard.leave} />
    </div>
  );
}
