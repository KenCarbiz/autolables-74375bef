import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { getPilotDashboard, getUsage, PILOT_ACCOUNT } from "@/lib/inventoryNetwork/api";
import { Al97Frame, Banner, Card, Glyph, KeyVals, Metrics, Savebar, useFixtureCopy, useNetFixture, type MetricItem, type ScopePicker } from "@/components/admin/al97/al97ui";
import { mcModeLabel, useNet } from "./shared";

// Provider usage & budgets for MarketCheck. Quota and reserve come from the
// provider account; billed cost is Unknown until the provider reports actuals,
// never $0. The store policy is shown read-only here; it is edited only in the
// policy form below, which keeps its own confirmation step.

const Chip = ({ tone, children }: { tone: string; children: ReactNode }) => <span className={`chip ${tone}`}>{children}</span>;

export default function ProviderBudgets({ scope, children }: { scope?: ScopePicker; children?: ReactNode }) {
  const fx = useNetFixture();
  const copy = useFixtureCopy();
  const { stores, href } = useNet();
  const [params, setParams] = useSearchParams();
  const picked = params.get("store");
  const storeId = picked && stores.some((s) => s.store.id === picked) ? picked : stores[0]?.store.id ?? "";
  const s = stores.find((x) => x.store.id === storeId) ?? null;

  const pilotQ = useQuery({ queryKey: ["inv-net", "pilot", PILOT_ACCOUNT], queryFn: () => getPilotDashboard(PILOT_ACCOUNT), enabled: !fx });
  const usageQ = useQuery({ queryKey: ["inv-net", "usage", storeId], queryFn: () => getUsage(storeId), enabled: !fx && !!storeId });
  const account = fx ? fx.providerAccount ?? null : pilotQ.data ? { quota: pilotQ.data.account.monthly_call_quota, reserve: pilotQ.data.account.protected_reserve } : null;
  const actualUsd = fx ? fx.storeUsage?.month.actual_usd ?? null : usageQ.data?.month.actual_usd ?? null;

  const others = stores.filter((x) => !x.store.is_primary_inventory_store);
  const enriched = others.filter((x) => x.policy?.mode === "enrichment" && !x.policy.budget_blocked).length;
  const mode = mcModeLabel(s?.policy ?? null);
  const p = s?.policy ?? null;
  const shared = !!p?.enrich_shared_inventory;

  const items: MetricItem[] = [
    { label: "Account request quota", value: account ? account.quota.toLocaleString() : "Unknown", sub: account ? copy("budget.quotaSub", "Configured pool") : "Provider account not read", icon: "database", known: !!account },
    { label: "Protected reserve", value: account ? account.reserve.toLocaleString() : "Unknown", sub: account ? "Configured protection" : "Provider account not read", icon: "shield", known: !!account },
    { label: "Additional stores", value: enriched === 0 ? "Feed only" : `${enriched} enriched`, sub: enriched === 0 ? "No paid store refresh" : "Paid refresh allowed under caps", icon: "store" },
    { label: "Actual billed cost", value: actualUsd == null ? "Unknown" : `$${Number(actualUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, sub: actualUsd == null ? "Provider invoice not reconciled" : "Provider-reported actuals", icon: "dollar" },
  ];
  const enrichTone = mode.label === "Feed only" ? "blue" : mode.label === "Enrichment enabled" ? "amber" : "";

  const main = (
    <div className="work">
      <Banner tone="amber" icon="warning" title="Tracking coverage is incomplete" detail="A zero total in one ledger does not establish zero provider activity or zero billed cost." />
      <Metrics label="Provider budget summary" items={items} />
      <Card id="pb-gates" title="Gate coverage">
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Call path</th><th scope="col">Control</th><th scope="col">Tracking</th><th scope="col">Result</th></tr></thead>
            <tbody>
              <tr><td>Store inventory enrichment</td><td>Store mode + caps + account gate</td><td>Coordinator ledger</td><td><Chip tone={enrichTone}>{mode.label}</Chip></td></tr>
              <tr><td>Legacy manual refresh</td><td>Needs caller trace</td><td>Legacy call events</td><td><Chip tone="amber">Verify coverage</Chip></td></tr>
              <tr><td>Files.com import</td><td>No MarketCheck request</td><td>Import job ledger</td><td><Chip tone="green">No paid enrichment</Chip></td></tr>
              <tr><td>Optional external services</td><td>Provider-specific gate needed</td><td>Not consolidated</td><td><Chip tone="amber">Unknown coverage</Chip></td></tr>
            </tbody>
          </table>
        </div>
      </Card>
      <div className="split">
        <div>
          <Card id="pb-costs" title="Cost categories">
            <KeyVals rows={[["Consumed requests", "Logged provider requests"], ["Refused before calling", "Zero provider request"], ["HTTP 429", "Billing uncertain until reconciled"], ["Estimated spend", "Not an invoice"], ["Verified cost", "Provider actuals / agreed rate"]]} />
          </Card>
        </div>
        <div>
          <Card id="pb-policy" title="Store policy">
            <div className="fields">
              <label className="field">
                <span>Store</span>
                <div className="input pick">{s?.store.display_name ?? "No store"} ▾<Glyph name="chevron" />
                  <select aria-label="Store" value={storeId} onChange={(e) => setParams(new URLSearchParams({ ...Object.fromEntries(params), view: "marketcheck", store: e.target.value }))}>
                    {stores.map((x) => <option key={x.store.id} value={x.store.id}>{x.store.display_name}</option>)}
                  </select>
                </div>
              </label>
              <div className="field"><span>Mode</span><div className="input" aria-readonly="true">{mode.label} ▾<Glyph name="chevron" /></div></div>
              <div className="field"><span>Daily / monthly request cap</span><div className="input" aria-readonly="true">{(p?.daily_request_limit ?? 0).toLocaleString()} / {(p?.monthly_request_cap ?? 0).toLocaleString()}</div></div>
            </div>
            <div className="toggle-row">
              <div><strong>Enrich shared inventory</strong><p>{shared ? "On; vehicles this store receives from siblings may be looked up under its caps." : "Off; displaying sibling inventory does not request data."}</p></div>
              <span role="switch" aria-checked={shared} aria-disabled="true" aria-label="Enrich shared inventory, edited in the policy form below" className={`switch ${shared ? "on" : ""} disabled`} />
            </div>
          </Card>
        </div>
      </div>
      <Savebar title="No provider calls made" detail="Budget authorization and provider refresh require separate reviewed actions."
        action={<Link to={href("pilot")} className="btn">Review gate coverage</Link>} />
    </div>
  );
  return (
    <Al97Frame crumb="Provider usage & budgets" title="Provider usage & budgets" subtitle="Know what is metered, what is capped, and what remains unknown." scope={scope} storeName={stores.find((x) => x.store.is_primary_inventory_store)?.store.display_name ?? null} main={main}>
      {children}
    </Al97Frame>
  );
}
