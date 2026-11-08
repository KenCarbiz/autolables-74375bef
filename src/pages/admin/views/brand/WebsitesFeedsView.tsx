import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AdminButton } from "@/components/admin/v2/primitives";
import {
  AdminIcon, AdvancedDisclosure, DraftActionBar, EditorEmpty, FieldRow, INPUT_CLASS, LeaveGuardDialog, PreviewOnlyNotice, ReviewChangesDialog,
  ScopeLabel, SectionCard, StatusBadge, SwitchField, useIsNarrow,
} from "@/components/admin/v3/editor";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";
import { checkUrl, joinLabels, parseLabels, parseTerms, PROVIDERS, validateWebsiteDraft, WEBSITES_FEED_KEYS, WEBSITES_FEED_LABELS, type ProviderSpec, type WebsitesFeedKey } from "./feeds/websitesModel";
import { runPriceTest, type PriceTestResult } from "./feeds/priceTest";
import { directPatch, pickRead, useSettingsEditor } from "./feeds/useSettingsEditor";
import { Banner, LinkRow, StatTile, TenantScope } from "./feeds/bits";
import { ConditionMapping, LabelList, PriceTestResultPanel, ProviderCard, ProviderDrawer, UrlField } from "./feeds/WebsitesParts";

const describe = (key: string, value: unknown) => {
  if (key === "vdp_strip_finance_params") return value === false ? "Off" : "On";
  if (key === "vdp_price_labels") return parseLabels(value as string).map((l, i) => `${i + 1}. ${l}`).join("  ") || "Not set";
  return value === undefined || value === null || String(value).trim() === "" ? "Not set" : String(value);
};

const OPTIONS = {
  read: pickRead(WEBSITES_FEED_KEYS),
  toPatch: directPatch,
  labels: WEBSITES_FEED_LABELS,
  validate: validateWebsiteDraft,
  describe,
  fixtureViewId: "websites-feeds",
};

export default function WebsitesFeedsView() {
  const ed = useSettingsEditor(OPTIONS);
  const { source, edit, canEdit, variant } = ed;
  const draft = edit.draft;
  const narrow = useIsNarrow();
  const [drawer, setDrawer] = useState<ProviderSpec | null>(null);
  const [testUrl, setTestUrl] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [testing, setTesting] = useState(false);
  const [liveResult, setLiveResult] = useState<PriceTestResult | null>(null);
  const result = source.isFixture ? (ed.fixture?.results?.[variant] as PriceTestResult | undefined) ?? null : liveResult;

  const labels = useMemo(() => parseLabels(draft?.vdp_price_labels), [draft?.vdp_price_labels]);
  const terms = useMemo(() => parseTerms(draft?.vehicle_conditions), [draft?.vehicle_conditions]);

  if (!draft) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading websites and feeds">
        {[0, 1, 2].map((i) => <div key={i} className="h-40 rounded-xl border border-adm-divider bg-adm-surface animate-pulse" />)}
      </div>
    );
  }

  const set = <K extends WebsitesFeedKey>(key: K, value: (typeof draft)[K]) => edit.set(key, value);
  const err = (k: WebsitesFeedKey) => edit.errors[k];
  const savedProviders = PROVIDERS.filter((p) => checkUrl(draft[p.key] as string).state !== "empty").length;
  const hasInventory = checkUrl(draft.new_inventory_url).state === "valid" || checkUrl(draft.used_inventory_url).state === "valid";
  const priceFieldsDirty = edit.changedKeys.some((k: string) => k === "vdp_price_labels" || k === "vdp_strip_finance_params");
  const testBlocked = source.isFixture ? "Not available in the design fixture. The result shown is an example." : !source.tenantId ? "No dealership context." : priceFieldsDirty ? "Apply your label changes first. The test reads the saved labels, not your draft." : checkUrl(testUrl).state !== "valid" ? "Enter a vehicle page address." : !acknowledged ? "Tick the note above to allow one test." : null;
  const invalidTest = testUrl.trim() !== "" && checkUrl(testUrl).state === "invalid";

  const runTest = async () => {
    if (!source.tenantId || testBlocked) return;
    setTesting(true);
    setLiveResult(null);
    setAcknowledged(false);
    setLiveResult(await runPriceTest(source.tenantId, testUrl.trim()));
    setTesting(false);
  };

  return (
    <div className="space-y-4">
      <TenantScope />

      {!canEdit && <Banner tone="neutral" icon="lock" title="You can view these settings but not change them">Changing website, marketplace and price-label settings needs the manage settings permission. Ask an owner or manager to make the change.</Banner>}
      {!source.isFixture && source.loadError && <Banner tone="danger" title="Settings could not be read">{source.loadError}. Nothing can be saved until they load.</Banner>}
      {source.isFixture && variant === "error" && <Banner tone="danger" title="Settings could not be read">The server did not answer. Your values are not shown as saved and nothing can be applied until they load.</Banner>}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3" aria-label="Summary">
        <StatTile icon="globe" label="Dealer inventory pages" value={hasInventory ? "Address saved" : "Not set"} state={hasInventory ? "enabled" : "setup_required"} stateLabel={hasInventory ? "Format valid" : "Setup required"} />
        <StatTile icon="database" label="DMS provider" value={draft.dms_provider?.trim() || "Not set"} state={draft.dms_provider?.trim() ? "enabled" : "setup_required"} stateLabel={draft.dms_provider?.trim() ? "Recorded" : "Setup required"} hint="A label only. It does not connect to your DMS." />
        <StatTile icon="link" label="Marketplace listing pages" value={`${savedProviders} of ${PROVIDERS.length} saved`} state={savedProviders > 0 ? "enabled" : "setup_required"} stateLabel={savedProviders > 0 ? "Addresses saved" : "Setup required"} hint="Saved is not connected." />
        <StatTile icon="tag" label="Price labels" value={labels.length === 0 ? "None" : `${labels.length} in order`} state={labels.length > 0 ? "enabled" : "setup_required"} stateLabel={labels.length > 0 ? "Configured" : "Setup required"} hint={draft.vdp_strip_finance_params === false ? "Finance parameters kept." : "Finance parameters removed."} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4 xl:gap-6 items-start">
        <div className="min-w-0 space-y-4">
          <SectionCard icon="globe" title="Dealer website and DMS" description={narrow ? undefined : "Your DMS is the source of truth for inventory and pricing. These addresses let AutoLabels find your vehicle pages."}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <FieldRow label="DMS provider" htmlFor="dms-provider" help="For example CDK, Reynolds, Dealertrack or Tekion.">
                {(p) => <input {...p} value={draft.dms_provider ?? ""} disabled={!canEdit} onChange={(e) => set("dms_provider", e.target.value)} className={INPUT_CLASS} placeholder="Your DMS name" />}
              </FieldRow>
              <div className="rounded-lg bg-adm-workspace border border-adm-divider px-4 py-3 max-sm:py-2 text-[14px] leading-[20px]">
                <p className="font-medium text-adm-ink">Public website <span className="sm:hidden font-normal text-adm-muted">(edited under Hours &amp; Contact)</span></p>
                <p className="text-adm-muted max-sm:hidden">Edited under Hours &amp; Contact, so it is not saved twice.</p>
                <Link to={adminTabHref("hours-contact")} className="mt-1 inline-flex items-center gap-1 min-h-[40px] max-sm:min-h-[44px] items-center font-semibold text-adm-primary hover:underline max-sm:mt-0">Open Hours &amp; Contact <AdminIcon name="chevron-right" size="inline" /></Link>
              </div>
              <div className="md:col-span-2 space-y-5">
              <UrlField id="new-inventory" label="New inventory page" value={draft.new_inventory_url ?? ""} onChange={(v) => set("new_inventory_url", v)} error={err("new_inventory_url")} disabled={!canEdit} placeholder="https://your-dealer-site.example/new-inventory" />
              <UrlField id="used-inventory" label="Used inventory page" value={draft.used_inventory_url ?? ""} onChange={(v) => set("used_inventory_url", v)} error={err("used_inventory_url")} disabled={!canEdit} placeholder="https://your-dealer-site.example/used-inventory" />
              </div>
            </div>
            <p className="max-sm:hidden text-[13px] leading-[18px] text-adm-muted">AutoLabels checks the format of an address when you type it. It does not open the page until a crawler run or the test below.</p>
          </SectionCard>
        </div>
        <aside aria-label="Feed diagnostics" className="min-w-0 xl:sticky xl:top-4">
          {narrow ? (
            <AdvancedDisclosure title="Feed diagnostics">
              <div className="space-y-2">
              <LinkRow to={adminTabHref("inventory-feed")} icon="database" title="Inventory feed" description="Sync status, freshness and failures" />
              <LinkRow to={ADMIN_CHILD_ROUTES.storeInventory} icon="building" title="Store inventory" description="Per-rooftop inventory and feeds" />
              <LinkRow to={ADMIN_CHILD_ROUTES.jobs} icon="clock" title="Jobs" description="Crawler and sync runs" />
              <LinkRow to={adminTabHref("data-quality")} icon="shield-check" title="Data quality" description="Price evidence and mismatches" />
            </div>
            </AdvancedDisclosure>
          ) : (
          <SectionCard icon="activity" title="Feed diagnostics" description="Feed internals are managed under Integrations.">
            <div className="space-y-2">
              <LinkRow to={adminTabHref("inventory-feed")} icon="database" title="Inventory feed" description="Sync status, freshness and failures" />
              <LinkRow to={ADMIN_CHILD_ROUTES.storeInventory} icon="building" title="Store inventory" description="Per-rooftop inventory and feeds" />
              <LinkRow to={ADMIN_CHILD_ROUTES.jobs} icon="clock" title="Jobs" description="Crawler and sync runs" />
              <LinkRow to={adminTabHref("data-quality")} icon="shield-check" title="Data quality" description="Price evidence and mismatches" />
            </div>
          </SectionCard>
          )}
        </aside>
      </div>

      <div className="space-y-3 sm:space-y-4">

          <SectionCard icon="link" title="Marketplace listing pages" description={narrow ? undefined : "Where your inventory is advertised. The price crawler compares these pages with your sticker price."}
>
            {!narrow && <div><StatusBadge state={savedProviders > 0 ? "enabled" : "setup_required"} label={`${savedProviders} of ${PROVIDERS.length} saved`} /></div>}
            {narrow ? <p className="text-[13px] leading-[18px] text-adm-muted">A saved address is not a connected account. No login or live link, and no price is verified until a crawler run.</p> : <Banner tone="neutral" icon="info" title="A saved address is not a connected account">{narrow ? "No login or live link. No price is verified until a crawler run." : "Each card lists what the address does today. AutoLabels holds no login or live link to any marketplace, and no price is marked verified until a crawler run or test reads it."}</Banner>}
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4" aria-label="Marketplace providers">
              {PROVIDERS.map((p) => (
                <ProviderCard key={p.id} provider={p} value={(draft[p.key] as string) ?? ""} onChange={(v) => set(p.key, v)} error={err(p.key)} canEdit={canEdit} onDetails={() => setDrawer(p)} />
              ))}
            </ul>
          </SectionCard>

          <SectionCard icon="tag" title="Advertised price extraction" description={narrow ? undefined : "The wording your website uses beside the selling price. The crawler tries each label in order."}>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 xl:gap-8 items-start">
            <div className="min-w-0 space-y-5">
            <LabelList labels={labels} onChange={(next) => set("vdp_price_labels", joinLabels(next))} canEdit={canEdit} error={err("vdp_price_labels")} />
            <div className="rounded-lg border border-adm-divider p-4 space-y-2">
              <SwitchField label="Strip finance and lease URL parameters" checked={draft.vdp_strip_finance_params !== false} disabled={!canEdit} onChange={(v) => set("vdp_strip_finance_params", v)} />
              <p className="text-[13px] leading-[18px] text-adm-muted">{narrow ? "Removes ?type=finance and ?type=lease before reading the page." : "Removes ?type=finance and ?type=lease from a vehicle page address before reading it, so the page shows the standard price instead of a payment."}</p>
            </div>
            {!narrow && (          <SectionCard icon="info" title="What this page does not claim">
            <ul className="space-y-2 text-[14px] leading-[20px] text-adm-ink list-disc pl-5">
              <li>A valid address is only well formed. It may still be the wrong page.</li>
              <li>No marketplace price is called verified here. Only a crawler run that reads the page can do that.</li>
              <li>Your feed data is never changed by the condition list.</li>
            </ul>
          </SectionCard>
          )}
            </div>
            {narrow ? (
              <AdvancedDisclosure title="Test one vehicle page" className="min-w-0">
                <div className="space-y-4" id="price-test">
              <div>
                <h3 className="text-[16px] leading-[24px] font-semibold text-adm-ink">Test one vehicle page</h3>
                <p className="max-sm:hidden text-[14px] leading-[20px] text-adm-muted">Reads one page with your saved labels and shows which label matched, the value and why it failed.</p>
              </div>
              <PreviewOnlyNotice>Read-only. The test stores nothing, publishes nothing and changes no price. It uses the saved labels, not unsaved edits.</PreviewOnlyNotice>
              {canEdit ? (
                <>
                  <label className="flex items-start gap-3 rounded-lg border border-adm-divider bg-adm-workspace px-4 py-3 min-h-[44px] cursor-pointer">
                    <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5 h-5 w-5 flex-shrink-0 accent-[rgb(var(--adm-primary))]" />
                    <span className="text-[14px] leading-[20px] text-adm-ink">I understand this one test may use one metered page render if the website blocks a plain read. The tick covers a single run. The crawler can also be paused, in which case nothing runs.</span>
                  </label>
                  <FieldRow label="Vehicle page address" htmlFor="price-test-url" error={invalidTest ? (checkUrl(testUrl) as { reason: string }).reason : undefined}>
                    {(p) => (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input {...p} value={testUrl} onChange={(e) => setTestUrl(e.target.value)} placeholder="https://your-dealer-site.example/used/vehicle-page" inputMode="url" className={INPUT_CLASS} />
                        <AdminButton variant="primary" onClick={() => void runTest()} disabled={testing || !!testBlocked} className="sm:w-auto sm:whitespace-nowrap sm:shrink-0">{testing ? "Reading the page" : "Run one test (may use one metered render)"}</AdminButton>
                      </div>
                    )}
                  </FieldRow>
                  {testBlocked && <p className="text-[13px] leading-[18px] text-adm-muted">{testBlocked}</p>}
                </>
              ) : (
                <p className="text-[14px] text-adm-muted">Only people who can manage settings can run the test.</p>
              )}
              {result ? <PriceTestResultPanel result={result} labels={labels} /> : (
                narrow ? <p className="text-[13px] leading-[18px] text-adm-muted">No test run yet. Results show the matched label, the value read and the reason when nothing was found.</p> : <EditorEmpty artwork="search" title="No test run yet" description="Results appear here with the matched label, the value read and the reason when nothing was found." className="py-6" />
              )}
            </div>
              </AdvancedDisclosure>
            ) : (
            <div className="min-w-0 border-t xl:border-t-0 xl:border-l border-adm-divider pt-5 xl:pt-0 xl:pl-8 space-y-4" id="price-test">
              <div>
                <h3 className="text-[16px] leading-[24px] font-semibold text-adm-ink">Test one vehicle page</h3>
                <p className="max-sm:hidden text-[14px] leading-[20px] text-adm-muted">Reads one page with your saved labels and shows which label matched, the value and why it failed.</p>
              </div>
              <PreviewOnlyNotice>Read-only. The test stores nothing, publishes nothing and changes no price. It uses the saved labels, not unsaved edits.</PreviewOnlyNotice>
              {canEdit ? (
                <>
                  <label className="flex items-start gap-3 rounded-lg border border-adm-divider bg-adm-workspace px-4 py-3 min-h-[44px] cursor-pointer">
                    <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5 h-5 w-5 flex-shrink-0 accent-[rgb(var(--adm-primary))]" />
                    <span className="text-[14px] leading-[20px] text-adm-ink">I understand this one test may use one metered page render if the website blocks a plain read. The tick covers a single run. The crawler can also be paused, in which case nothing runs.</span>
                  </label>
                  <FieldRow label="Vehicle page address" htmlFor="price-test-url" error={invalidTest ? (checkUrl(testUrl) as { reason: string }).reason : undefined}>
                    {(p) => (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input {...p} value={testUrl} onChange={(e) => setTestUrl(e.target.value)} placeholder="https://your-dealer-site.example/used/vehicle-page" inputMode="url" className={INPUT_CLASS} />
                        <AdminButton variant="primary" onClick={() => void runTest()} disabled={testing || !!testBlocked} className="sm:w-auto sm:whitespace-nowrap sm:shrink-0">{testing ? "Reading the page" : "Run one test (may use one metered render)"}</AdminButton>
                      </div>
                    )}
                  </FieldRow>
                  {testBlocked && <p className="text-[13px] leading-[18px] text-adm-muted">{testBlocked}</p>}
                </>
              ) : (
                <p className="text-[14px] text-adm-muted">Only people who can manage settings can run the test.</p>
              )}
              {result ? <PriceTestResultPanel result={result} labels={labels} /> : (
                narrow ? <p className="text-[13px] leading-[18px] text-adm-muted">No test run yet. Results show the matched label, the value read and the reason when nothing was found.</p> : <EditorEmpty artwork="search" title="No test run yet" description="Results appear here with the matched label, the value read and the reason when nothing was found." className="py-6" />
              )}
            </div>
            )}
            </div>
          </SectionCard>

          <SectionCard icon="car" title="Vehicle condition mapping" description={narrow ? undefined : "Each term your team uses is stored as New, Used or CPO for documents and compliance."}>
            <ConditionMapping terms={terms} onChange={(next) => set("vehicle_conditions", next.join(", "))} canEdit={canEdit} />
            {err("vehicle_conditions") && <p role="alert" className="text-adm-danger text-[13px]">{err("vehicle_conditions")}</p>}
          </SectionCard>

          <div>
          <AdvancedDisclosure title={narrow ? "Notes and storage" : "Advanced: how these settings are stored"}>
            {narrow && <ul className="space-y-2 text-[14px] leading-[20px] text-adm-ink list-disc pl-5">
              <li>A valid address is only well formed. It may still be the wrong page.</li>
              <li>No marketplace price is called verified here. Only a crawler run that reads the page can do that.</li>
              <li>Your feed data is never changed by the condition list.</li>
            </ul>}
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-[14px] leading-[20px]">
              {WEBSITES_FEED_KEYS.map((k) => (
                <div key={k} className="flex justify-between gap-3 border-b border-adm-divider py-1.5"><dt className="text-adm-muted">{WEBSITES_FEED_LABELS[k]}</dt><dd><code className="text-[13px]">{k}</code></dd></div>
              ))}
            </dl>
            <p className="text-[13px] leading-[18px] text-adm-muted">Price labels and condition terms are stored as one comma-separated line each, so a label cannot contain a comma.</p>
          </AdvancedDisclosure>
          </div>
      </div>

      {canEdit && (
        <DraftActionBar state={ed.barState} onDiscard={ed.discard} onReview={ed.flow.openReview} onRetry={() => void ed.apply()} onRefresh={ed.refresh} retryDisabled={!ed.canApply} />
      )}

      <ProviderDrawer provider={drawer} value={drawer ? ((draft[drawer.key] as string) ?? "") : ""} onChange={(v) => drawer && set(drawer.key, v)} error={drawer ? err(drawer.key) : undefined} canEdit={canEdit} onClose={() => setDrawer(null)} />

      <ReviewChangesDialog
        open={ed.flow.phase === "reviewing" || ed.flow.phase === "saving"}
        scope={<ScopeLabel scope="all_rooftops" />}
        timing="The crawler uses new labels on its next run. Inventory addresses are used wherever your website is shown."
        changes={ed.rows}
        impact={<p className="text-[14px] text-adm-muted">No price, listing or published sticker changes when you apply. {ed.blockedReason ? <span className="font-medium text-adm-warning">{ed.blockedReason}</span> : null}</p>}
        applying={ed.flow.phase === "saving"}
        applyLabel="Apply changes"
        onCancel={ed.flow.closeReview}
        onApply={() => void ed.apply()}
        applyDisabled={!ed.canApply}
        error={!ed.canApply ? ed.blockedReason : undefined}
      />
      <LeaveGuardDialog open={ed.guard.pending} onStay={ed.guard.stay} onLeave={ed.guard.leave} />
    </div>
  );
}
