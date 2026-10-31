import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSearchParams } from "react-router-dom";
import { Button, EmptyState, KeyValueList, Panel, StatusText, Td, Th, WorkTable } from "@/components/product";
import { friendlyMessage, saveStore, type DealerStore, type StoreDraft, type StoreOverview, type SubscriptionStatus } from "@/lib/inventoryNetwork/api";
import { CheckField, NumberField, SelectField, TextField, STATUS_TONE, humanize, storeAddress, useAct, useNet, when } from "./shared";

interface Form {
  display_name: string; legal_name: string; street: string; city: string; state: string; zip: string; phone: string; website: string;
  status: "active" | "inactive"; subscription_status: SubscriptionStatus;
  is_primary_inventory_store: boolean; inventory_feed_enabled: boolean; feed_import_paused: boolean; inventory_sharing_enabled: boolean;
  customer_browser_enabled: boolean; listing_sync_enabled: boolean; feed_price_updates_listing: boolean; adopt_legacy_matches: boolean;
  retirement_automation_enabled: boolean; missing_snapshot_threshold: number | null; max_invalid_rows: number | null;
}

const blank: Form = {
  display_name: "", legal_name: "", street: "", city: "", state: "", zip: "", phone: "", website: "", status: "active", subscription_status: "unsubscribed",
  is_primary_inventory_store: false, inventory_feed_enabled: false, feed_import_paused: false, inventory_sharing_enabled: false, customer_browser_enabled: false,
  listing_sync_enabled: false, feed_price_updates_listing: false, adopt_legacy_matches: false, retirement_automation_enabled: false, missing_snapshot_threshold: 3, max_invalid_rows: 0,
};

const fromStore = (s: DealerStore): Form => ({
  display_name: s.display_name, legal_name: s.legal_name ?? "", street: s.street ?? "", city: s.city ?? "", state: s.state ?? "", zip: s.zip ?? "", phone: s.phone ?? "", website: s.website ?? "",
  status: s.status, subscription_status: s.subscription_status, is_primary_inventory_store: s.is_primary_inventory_store, inventory_feed_enabled: s.inventory_feed_enabled,
  feed_import_paused: s.feed_import_paused, inventory_sharing_enabled: s.inventory_sharing_enabled, customer_browser_enabled: s.customer_browser_enabled, listing_sync_enabled: s.listing_sync_enabled,
  feed_price_updates_listing: s.feed_price_updates_listing, adopt_legacy_matches: s.adopt_legacy_matches, retirement_automation_enabled: s.retirement_automation_enabled,
  missing_snapshot_threshold: s.missing_snapshot_threshold, max_invalid_rows: s.max_invalid_rows,
});

type Errors = Partial<Record<keyof Form, string>>;
function validate(f: Form): Errors {
  const e: Errors = {};
  const name = f.display_name.trim();
  if (name.length < 2 || name.length > 120) e.display_name = "Use 2 to 120 characters.";
  if (f.state && !/^[A-Z]{2}$/.test(f.state.toUpperCase())) e.state = "Two letters, such as CT.";
  if (f.zip && !/^[0-9]{5}(-[0-9]{4})?$/.test(f.zip)) e.zip = "Five digits, or ZIP+4.";
  if (f.missing_snapshot_threshold === null || f.missing_snapshot_threshold < 2 || f.missing_snapshot_threshold > 30) e.missing_snapshot_threshold = "Between 2 and 30.";
  if (f.max_invalid_rows === null || f.max_invalid_rows < 0 || f.max_invalid_rows > 100) e.max_invalid_rows = "Between 0 and 100.";
  return e;
}

const identityPayload = (f: Form) => ({
  display_name: f.display_name.trim(), legal_name: f.legal_name.trim(), street: f.street.trim(), city: f.city.trim(), state: f.state.trim().toUpperCase(),
  zip: f.zip.trim(), phone: f.phone.trim(), website: f.website.trim(), subscription_status: f.subscription_status,
});

function StoreForm({ store, initial, groupId, onSaved, savedAt }: { store: StoreOverview | null; initial: Form; groupId: string; onSaved: (id: string) => void; savedAt: string | null }) {
  const { act, busy } = useAct();
  const { notify, refresh, clearNewStoreDraft } = useNet();
  const [form, setForm] = useState<Form>(initial);
  const [baseline, setBaseline] = useState<Form>(initial);
  const [conflict, setConflict] = useState(false);
  const errors = useMemo(() => validate(form), [form]);
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const subscribed = form.subscription_status === "subscribed";
  const invalid = Object.keys(errors).length > 0;
  const isNew = !store;

  const setSubscription = (v: string) => setForm((f) => ({ ...f, subscription_status: v as SubscriptionStatus, ...(v === "subscribed" ? {} : { customer_browser_enabled: false, listing_sync_enabled: false }) }));

  const save = async () => {
    setConflict(false);
    const payload: StoreDraft = isNew
      ? { group_id: groupId, ...identityPayload(form) }
      : { id: store.store.id, expected_updated_at: store.store.updated_at, ...identityPayload(form), status: form.status, is_primary_inventory_store: form.is_primary_inventory_store, inventory_feed_enabled: form.inventory_feed_enabled,
          feed_import_paused: form.feed_import_paused, inventory_sharing_enabled: form.inventory_sharing_enabled, customer_browser_enabled: subscribed && form.customer_browser_enabled,
          listing_sync_enabled: subscribed && form.listing_sync_enabled, feed_price_updates_listing: form.feed_price_updates_listing, adopt_legacy_matches: form.adopt_legacy_matches,
          retirement_automation_enabled: form.retirement_automation_enabled, missing_snapshot_threshold: form.missing_snapshot_threshold ?? 3, max_invalid_rows: form.max_invalid_rows ?? 0 };
    const r = await act(async () => {
      try {
        return await saveStore(payload);
      } catch (e) {
        if (e instanceof Error && e.message === friendlyMessage("store_changed_since_loaded")) setConflict(true);
        throw e;
      }
    }, isNew ? "Store added" : "Store saved");
    if (r.ok) {
      setBaseline(form);
      if (isNew) clearNewStoreDraft();
      onSaved(r.value);
    }
  };

  const reload = () => { refresh(); notify("info", "Reloaded. Your unsaved edits were discarded."); setForm(baseline); setConflict(false); };

  return (
    <Panel
      title={isNew ? "Add store" : store.store.display_name}
      description={isNew ? "Enter the rooftop's identity. Feed and sharing settings unlock after the store exists." : "Changes apply to this store only."}
      action={
        <div className="flex items-center gap-3">
          {dirty ? <StatusText tone="warning">Unsaved changes</StatusText> : savedAt ? <StatusText tone="success">Saved {savedAt}</StatusText> : <StatusText tone="neutral">No changes</StatusText>}
          <Button variant="primary" disabled={busy || !dirty || invalid} onClick={save}>{isNew ? "Add store" : "Save changes"}</Button>
        </div>
      }
    >
      <div className="space-y-6">
        {conflict && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-[6px] border border-[#F1D58A] bg-adm-warning-bg px-4 py-3 text-[13px]">
            <span>Someone else changed this store after you opened it. Reload it to see their changes.</span>
            <Button size="sm" onClick={reload}>Reload store</Button>
          </div>
        )}
        <fieldset className="space-y-4">
          <legend className="mb-2 text-[14px] font-semibold text-adm-ink">Identity</legend>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField id="st-name" label="Display name" value={form.display_name} onChange={(v) => set("display_name", v)} error={errors.display_name} hint="Shown to customers as the vehicle's location." />
            <TextField id="st-legal" label="Legal name" value={form.legal_name} onChange={(v) => set("legal_name", v)} />
            <TextField id="st-street" label="Street" value={form.street} onChange={(v) => set("street", v)} />
            <TextField id="st-city" label="City" value={form.city} onChange={(v) => set("city", v)} />
            <div className="grid grid-cols-2 gap-4">
              <TextField id="st-state" label="State" value={form.state} onChange={(v) => set("state", v.toUpperCase())} error={errors.state} />
              <TextField id="st-zip" label="ZIP" value={form.zip} onChange={(v) => set("zip", v)} error={errors.zip} />
            </div>
            <TextField id="st-phone" label="Phone" value={form.phone} onChange={(v) => set("phone", v)} type="tel" />
            <TextField id="st-web" label="Website" value={form.website} onChange={(v) => set("website", v)} type="url" />
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-2 text-[14px] font-semibold text-adm-ink">Subscription</legend>
          <div className="grid gap-4 md:grid-cols-2">
            <SelectField id="st-sub" label="Subscription status" value={form.subscription_status} onChange={setSubscription} options={[{ value: "unsubscribed", label: "Unsubscribed" }, { value: "subscribed", label: "Subscribed" }, { value: "suspended", label: "Suspended" }]} hint="Only subscribed stores can use the customer browser or listing sync." />
            {!isNew && <SelectField id="st-status" label="Store status" value={form.status} onChange={(v) => set("status", v as Form["status"])} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} hint="Inactive stores drop out of sharing and customer browsing." />}
          </div>
        </fieldset>

        {!isNew && (
          <>
            <fieldset className="space-y-4">
              <legend className="mb-2 text-[14px] font-semibold text-adm-ink">Feed</legend>
              <CheckField id="st-primary" label="Primary inventory store" checked={form.is_primary_inventory_store} onChange={(v) => set("is_primary_inventory_store", v)} hint="Only one store per group can be primary. It is listed first." />
              <CheckField id="st-feed" label="Feed enabled" checked={form.inventory_feed_enabled} onChange={(v) => set("inventory_feed_enabled", v)} hint="Lets approved feed files update this store's inventory. Off means the feed is ignored for this store." />
              <CheckField id="st-paused" label="Feed import paused" checked={form.feed_import_paused} onChange={(v) => set("feed_import_paused", v)} hint="Holds this store's incoming files without turning the feed off for the whole network." />
              <CheckField id="st-price" label="Feed price updates the listing" checked={form.feed_price_updates_listing} onChange={(v) => set("feed_price_updates_listing", v)} hint="Overwrites the dealer's listing price with the feed price on each import. Leave off until you trust the feed prices." />
              <CheckField id="st-adopt" label="Adopt legacy matches" checked={form.adopt_legacy_matches} onChange={(v) => set("adopt_legacy_matches", v)} hint="Links older listings with the same VIN to this store automatically. Leave off to review each match yourself." />
              <CheckField id="st-retire" label="Retirement automation" checked={form.retirement_automation_enabled} onChange={(v) => set("retirement_automation_enabled", v)} hint={`Archives vehicles that are absent from ${form.missing_snapshot_threshold ?? "N"} clean snapshots in a row. Leave off until the feed has been validated.`} />
              <div className="grid gap-4 md:grid-cols-2">
                <NumberField id="st-miss" label="Missing snapshot threshold" value={form.missing_snapshot_threshold} onChange={(v) => set("missing_snapshot_threshold", v)} min={2} max={30} step={1} error={errors.missing_snapshot_threshold} hint="How many clean snapshots in a row a vehicle must be absent before review." />
                <NumberField id="st-inv" label="Max invalid rows" value={form.max_invalid_rows} onChange={(v) => set("max_invalid_rows", v)} min={0} max={100} step={1} error={errors.max_invalid_rows} hint="A file with more bad rows than this is quarantined instead of applied. 0 means none are tolerated." />
              </div>
            </fieldset>

            <fieldset className="space-y-4">
              <legend className="mb-2 text-[14px] font-semibold text-adm-ink">Customer-facing</legend>
              <CheckField id="st-share" label="Sharing enabled" checked={form.inventory_sharing_enabled} onChange={(v) => set("inventory_sharing_enabled", v)} hint="Lets this store's customers see vehicles from sibling stores that have a sharing rule. Rules still decide what appears." />
              <CheckField id="st-browser" label="Customer browser enabled" checked={subscribed && form.customer_browser_enabled} disabled={!subscribed} onChange={(v) => set("customer_browser_enabled", v)} hint={subscribed ? "Shows the group inventory browser to this store's customers." : "Available once the store is subscribed."} />
              <CheckField id="st-sync" label="Listing sync" checked={subscribed && form.listing_sync_enabled} disabled={!subscribed} onChange={(v) => set("listing_sync_enabled", v)} hint={subscribed ? "Creates and updates dealer listings from feed vehicles for this store." : "Available once the store is subscribed."} />
            </fieldset>

            <div>
              <h4 className="mb-2 text-[14px] font-semibold text-adm-ink">Feed mappings</h4>
              {store.mappings.length === 0 ? <p className="text-[13px] text-adm-muted">No source dealer is mapped to this store. Map one from Feed mapping.</p> : (
                <KeyValueList rows={store.mappings.map((m) => ({ label: `DealerId ${m.source_dealer_id}`, value: <StatusText tone={STATUS_TONE[m.status]}>{m.status}</StatusText> }))} />
              )}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

export default function StoresSection() {
  const { stores, groupId, href, go, newStoreDraft } = useNet();
  const [params] = useSearchParams();
  const sel = params.get("store");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  useEffect(() => { setSavedAt(null); }, [sel]);
  const current = sel && sel !== "new" ? stores.find((s) => s.store.id === sel) ?? null : null;
  const initial = useMemo(() => (current ? fromStore(current.store) : { ...blank, ...(newStoreDraft ?? {}) } as Form), [current, newStoreDraft]);

  return (
    <div className="space-y-4">
      <Panel title="Stores" description="Every rooftop in this group." flush action={<Link to={href("stores", { store: "new" })} className="inline-flex min-h-[32px] items-center rounded-md border border-adm-primary bg-adm-primary px-3 text-[13px] font-semibold text-white hover:bg-adm-primary-hover">Add store</Link>}>
        {stores.length === 0 ? (
          <EmptyState title="No stores yet" detail="Stores are never created automatically. Add each rooftop, then map its feed identity to it." compact />
        ) : (
          <WorkTable caption="Stores" minWidth={760}>
            <thead><tr><Th>Store</Th><Th>Address</Th><Th>Subscription</Th><Th>Feed</Th><Th>Updated</Th><Th align="right">Actions</Th></tr></thead>
            <tbody>
              {stores.map(({ store: s }) => (
                <tr key={s.id} className={s.id === sel ? "bg-adm-selected/50" : undefined}>
                  <Td className="font-semibold">{s.display_name}{s.is_primary_inventory_store && <span className="ml-2"><StatusText tone="info">Primary</StatusText></span>}</Td>
                  <Td>{storeAddress(s) || "Not set"}</Td>
                  <Td><StatusText tone={STATUS_TONE[s.subscription_status]}>{humanize(s.subscription_status)}</StatusText></Td>
                  <Td>{s.inventory_feed_enabled ? (s.feed_import_paused ? <StatusText tone="warning">Paused</StatusText> : <StatusText tone="success">On</StatusText>) : <StatusText tone="neutral">Off</StatusText>}</Td>
                  <Td>{when(s.updated_at)}</Td>
                  <Td align="right"><Link className="text-[13px] font-semibold text-adm-primary hover:underline" to={href("stores", { store: s.id })}>Open</Link></Td>
                </tr>
              ))}
            </tbody>
          </WorkTable>
        )}
      </Panel>

      {sel === "new" && <StoreForm key={`new-${JSON.stringify(newStoreDraft)}`} store={null} initial={initial} groupId={groupId} savedAt={null} onSaved={(id) => go("stores", { store: id })} />}
      {current && <StoreForm key={`${current.store.id}-${current.store.updated_at}`} store={current} initial={initial} groupId={groupId} savedAt={savedAt} onSaved={() => setSavedAt(new Date().toLocaleTimeString())} />}
      {sel && sel !== "new" && !current && <Panel><EmptyState title="That store is not in this group" detail="Pick a store from the list above." compact /></Panel>}
      {!sel && stores.length > 0 && <p className="text-[13px] text-adm-muted">Select a store to edit its settings.</p>}
    </div>
  );
}
