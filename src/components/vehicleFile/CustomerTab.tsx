import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Activity, CheckCircle2, Clock, Save, UserRound, Users } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { formatPhone, composeName } from "@/components/addendum/CustomerInfoSection";
import ShopperActivityDrawer from "@/components/vehicle/ShopperActivityDrawer";
import { useShopperActivity } from "@/hooks/useShopperActivity";
import { useDealRecord, dealDocStatus } from "@/hooks/useDealRecord";
import { mmss } from "@/lib/shopperActivity";
import { listingHero } from "@/lib/photos";
import { vehicleStockNumber } from "@/lib/vehicleStockNumber";
import { Card, EmptyNote, Pair, StatRow, TabHeader, btn, btnPrimary, fmtWhen } from "./primitives";
import { useVehicleSignatures } from "./SignaturesSection";
import type { CustomerInfoBag, PersonInfo, VehicleRow } from "./types";

const SUFFIXES = ["", "Jr.", "Sr.", "II", "III", "IV", "V"];
const INPUT = "w-full h-9 px-2.5 rounded-lg border border-border bg-background text-al-body text-foreground outline-none focus:border-primary";
const LABEL = "text-al-meta font-bold uppercase tracking-wider text-muted-foreground";

// MUST be module-scope: defining it inside the tab made it a new component
// type on every keystroke, remounting the inputs and dropping focus.
const PersonFields = ({ info, set }: { info: PersonInfo; set: (u: PersonInfo) => void }) => (
  <div className="space-y-3">
    <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
      <div className="md:col-span-2"><label className={LABEL}>First name</label><input value={info.first_name || ""} onChange={(e) => set({ ...info, first_name: e.target.value })} className={INPUT} /></div>
      <div><label className={LABEL}>M.I.</label><input value={info.middle_initial || ""} maxLength={1} onChange={(e) => set({ ...info, middle_initial: e.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase() })} className={`${INPUT} text-center`} /></div>
      <div className="md:col-span-2"><label className={LABEL}>Last name</label><input value={info.last_name || ""} onChange={(e) => set({ ...info, last_name: e.target.value })} className={INPUT} /></div>
      <div><label className={LABEL}>Suffix</label>
        <select value={info.suffix || ""} onChange={(e) => set({ ...info, suffix: e.target.value })} className={`${INPUT} cursor-pointer`}>
          {SUFFIXES.map((s) => <option key={s} value={s}>{s || "—"}</option>)}
        </select>
      </div>
    </div>
    <div><label className={LABEL}>Street address</label><input value={info.address || ""} onChange={(e) => set({ ...info, address: e.target.value })} placeholder="123 Main St" className={INPUT} /></div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <div className="md:col-span-2"><label className={LABEL}>City</label><input value={info.city || ""} onChange={(e) => set({ ...info, city: e.target.value })} className={INPUT} /></div>
      <div><label className={LABEL}>State</label><input value={info.state || ""} maxLength={2} onChange={(e) => set({ ...info, state: e.target.value.toUpperCase() })} placeholder="CT" className={`${INPUT} uppercase`} /></div>
      <div><label className={LABEL}>ZIP</label><input value={info.zip || ""} onChange={(e) => set({ ...info, zip: e.target.value.replace(/[^0-9-]/g, "").slice(0, 10) })} placeholder="06010" className={INPUT} /></div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      <div><label className={LABEL}>Phone</label><input value={info.phone || ""} type="tel" onChange={(e) => set({ ...info, phone: formatPhone(e.target.value) })} placeholder="(555) 555-5555" className={INPUT} /></div>
      <div><label className={LABEL}>Email</label><input value={info.email || ""} type="email" onChange={(e) => set({ ...info, email: e.target.value })} placeholder="customer@email.com" className={INPUT} /></div>
    </div>
  </div>
);

interface LeadRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  status: string | null;
  captured_at: string;
  first_response_at: string | null;
  routed_agent_id: string | null;
}

// The passport actions a shopper can take, counted from the captured event
// stream. An action nobody has taken shows a zero, never a filler row.
const ACTIVITY_GROUPS: Array<{ key: string; label: string; events: string[] }> = [
  { key: "passport", label: "Passport opened", events: ["passport_opened", "customer_passport_opened", "public_listing_opened"] },
  { key: "sticker", label: "Window sticker scanned", events: ["window_sticker_scanned"] },
  { key: "documents", label: "Documents opened", events: ["packet_opened", "document_opened", "document_downloaded", "document_printed"] },
  { key: "payment", label: "Financing / payment tapped", events: ["finance_clicked"] },
  { key: "trade", label: "Trade-in tapped", events: ["trade_clicked", "customer_passport_trade_clicked"] },
  { key: "reserve", label: "Reserve tapped", events: ["customer_passport_reserve_clicked"] },
  { key: "contact", label: "Call / text / contact tapped", events: ["call_clicked", "text_clicked", "customer_passport_call_clicked", "customer_passport_contact_clicked"] },
];

export const CustomerTab = ({ vehicle }: { vehicle: VehicleRow }) => {
  const { tenant } = useTenant();
  const [buyer, setBuyer] = useState<PersonInfo>({});
  const [cobuyer, setCobuyer] = useState<PersonInfo>({});
  const [showCobuyer, setShowCobuyer] = useState(false);
  const [soldAt, setSoldAt] = useState("");
  const [loadingCustomer, setLoadingCustomer] = useState(true);
  const [saving, setSaving] = useState(false);
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);

  const { summary, loading: activityLoading } = useShopperActivity({
    vin: vehicle.vin, tenantId: vehicle.tenant_id, vehicleId: vehicle.id, viewCount: vehicle.view_count,
  });
  const { record: deal, loading: dealLoading } = useDealRecord(vehicle.vin, vehicle.id, vehicle.tenant_id);
  const signatures = useVehicleSignatures(vehicle.vin);

  useEffect(() => {
    let on = true;
    (async () => {
      let q = (supabase as any).from("vehicle_files").select("id, customer_info, sold_at");
      q = vehicle.vehicle_file_id
        ? q.eq("id", vehicle.vehicle_file_id)
        : q.eq("tenant_id", tenant?.id || "").eq("vin", vehicle.vin);
      const { data } = await q.maybeSingle();
      if (!on) return;
      if (data) {
        const ci = (data.customer_info || {}) as CustomerInfoBag;
        setBuyer(ci.buyer || {});
        setCobuyer(ci.cobuyer || {});
        setShowCobuyer(!!ci.cobuyer && Object.keys(ci.cobuyer).length > 0);
        setSoldAt(data.sold_at ? String(data.sold_at).slice(0, 10) : "");
      }
      setLoadingCustomer(false);
    })();
    return () => { on = false; };
  }, [vehicle.vehicle_file_id, vehicle.vin, tenant?.id]);

  useEffect(() => {
    let on = true;
    (async () => {
      const { data } = await (supabase as any)
        .from("leads")
        .select("id, name, phone, email, source, status, captured_at, first_response_at, routed_agent_id")
        .eq("vehicle_vin", vehicle.vin)
        .order("captured_at", { ascending: false })
        .limit(50);
      if (on) setLeads((data || []) as LeadRow[]);
    })();
    return () => { on = false; };
  }, [vehicle.vin]);

  const activityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of ACTIVITY_GROUPS) counts[g.key] = 0;
    for (const e of summary.clickstream) {
      for (const g of ACTIVITY_GROUPS) if (g.events.includes(e.eventType)) counts[g.key] += 1;
    }
    counts.sticker += summary.totals.qrScans;
    return counts;
  }, [summary]);

  const save = async () => {
    if (!tenant?.id) { toast.error("No tenant in context"); return; }
    setSaving(true);
    const customer_info: CustomerInfoBag = { buyer, ...(showCobuyer ? { cobuyer } : {}) };
    const { error } = await (supabase as any).from("vehicle_files").upsert({
      tenant_id: tenant.id,
      vin: vehicle.vin,
      customer_info,
      sold_at: soldAt ? new Date(soldAt).toISOString() : null,
      customer_name: composeName(buyer.first_name || "", buyer.middle_initial || "", buyer.last_name || "", buyer.suffix || ""),
      customer_phone: buyer.phone || "",
      customer_email: buyer.email || "",
      cobuyer_name: showCobuyer ? composeName(cobuyer.first_name || "", cobuyer.middle_initial || "", cobuyer.last_name || "", cobuyer.suffix || "") : "",
      cobuyer_phone: showCobuyer ? (cobuyer.phone || "") : "",
      cobuyer_email: showCobuyer ? (cobuyer.email || "") : "",
    }, { onConflict: "tenant_id,vin" });
    setSaving(false);
    if (error) { toast.error("Could not save the customer record"); return; }
    toast.success("Customer record saved");
  };

  const docs = deal ? dealDocStatus(deal) : null;
  const signedCount = signatures.signings.length;
  const pendingLinks = signatures.tokens.filter((t) => t.status === "pending").length;

  return (
    <div className="space-y-6">
      <TabHeader
        title="Customer"
        description="Who is interested in this vehicle, what they did with it, and where the deal and its signatures stand."
        action={
          <button onClick={() => setActivityOpen(true)} className={btn}>
            <Activity className="w-3.5 h-3.5" /> Shopper activity
          </button>
        }
      />

      <Card title="Interested customers">
        {leads === null ? (
          <p className="text-al-body text-muted-foreground">Loading leads…</p>
        ) : leads.length === 0 ? (
          <EmptyNote
            title="No leads captured on this VIN"
            detail="A lead is created when a shopper submits the passport's contact, reserve, test-drive or trade form. Nothing is listed here until one exists."
          />
        ) : (
          <div className="space-y-2">
            {leads.map((l) => (
              <div key={l.id} className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
                <span className="w-9 h-9 rounded-lg bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                  <UserRound className="w-4 h-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-al-body font-semibold text-foreground truncate">{l.name || "Unnamed lead"}</p>
                  <div className="flex items-center gap-3 text-al-meta text-muted-foreground mt-0.5 flex-wrap">
                    <span>{new Date(l.captured_at).toLocaleString()}</span>
                    {l.source && <span>{l.source}</span>}
                    {l.status && <span className="font-bold uppercase tracking-wider">{l.status}</span>}
                    {l.phone && <span>{l.phone}</span>}
                    {l.email && <span className="truncate">{l.email}</span>}
                    <span className={l.first_response_at ? "text-emerald-700 font-semibold" : "text-amber-700 font-semibold"}>
                      {l.first_response_at ? `Responded ${fmtWhen(l.first_response_at)}` : "No response recorded"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Assigned salesperson">
        <p className="text-al-body text-muted-foreground">
          There is no salesperson assignment on a vehicle in this system. Leads carry a routing target, but nothing resolves it to a named person yet,
          so no name is shown rather than guessing one.
        </p>
        {leads && leads.some((l) => l.routed_agent_id) && (
          <p className="text-al-meta text-muted-foreground">
            {leads.filter((l) => l.routed_agent_id).length} of {leads.length} lead(s) on this VIN were routed to an agent id.
          </p>
        )}
      </Card>

      <Card title="Engagement">
        {activityLoading && !summary.hasAnyData ? (
          <p className="text-al-body text-muted-foreground">Loading engagement…</p>
        ) : !summary.hasAnyData ? (
          <EmptyNote
            title="No shopper sessions recorded yet"
            detail="Engagement appears here the first time a customer opens this vehicle's passport or scans its window sticker."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              <Pair label="Page views" value={(summary.totals.views ?? vehicle.view_count ?? 0).toLocaleString()} />
              <Pair label="Sessions" value={summary.totals.sessions.toLocaleString()} />
              <Pair label="Return visits" value={summary.totals.returningVisitors.toLocaleString()} />
              <Pair label="Time on packet" value={summary.totals.totalSeconds > 0 ? mmss(summary.totals.totalSeconds) : "Not tracked yet"} />
            </div>
            <div className="space-y-2.5">
              <StatRow label="Last seen" value={fmtWhen(summary.shopperContext.lastSeen) ?? "Unknown"} />
              <StatRow label="Call-to-action clicks" value={summary.totals.ctaClicks.toLocaleString()} />
              <StatRow label="Lead forms opened" value={summary.totals.leadFormOpens.toLocaleString()} />
              <StatRow label="Leads submitted" value={summary.totals.leadSubmits.toLocaleString()} />
              <StatRow
                label="Most attention"
                value={summary.totals.topSection ? summary.totals.topSection.label : "Not tracked yet"}
                tone={summary.totals.topSection ? undefined : "muted"}
              />
            </div>
          </>
        )}
      </Card>

      <Card title="Passport, sticker, payment & trade activity">
        {!summary.hasAnyData ? (
          <EmptyNote
            title="No passport actions recorded"
            detail="These counts come from the captured customer event stream. They stay at zero until a shopper interacts with this vehicle's passport."
          />
        ) : (
          <div className="space-y-2.5">
            {ACTIVITY_GROUPS.map((g) => (
              <StatRow key={g.key} label={g.label} value={(activityCounts[g.key] ?? 0).toLocaleString()} tone={activityCounts[g.key] ? undefined : "muted"} />
            ))}
          </div>
        )}
      </Card>

      <Card title="Deal & signature state">
        {dealLoading || !deal || !docs ? (
          <p className="text-al-body text-muted-foreground">Loading the deal record…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              <Pair label="Addendum" value={docs.addendum ? "Accepted" : "Not accepted"} />
              <Pair label="Get-Ready" value={docs.getReady ? "Complete" : "Open"} />
              {deal.isUsed && <Pair label="Safety inspection" value={docs.k208 ? "Executed" : "Not executed"} />}
              {deal.isUsed && <Pair label="Buyers Guide" value={docs.buyersGuide ? "Filed" : "Not filed"} />}
              <Pair label="Deal processed" value={deal.processedAt ? (fmtWhen(deal.processedAt) ?? "Yes") : "Not processed"} />
              <Pair label="Customer signed" value={deal.addendum?.signed ? "Yes" : "No"} />
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-4 flex items-start gap-3">
              {docs.complete
                ? <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                : <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />}
              <p className="text-al-body text-foreground">
                {docs.complete
                  ? "Every required document for this deal is on file."
                  : "The deal package is not complete yet. The Documents tab produces and files the missing forms."}
              </p>
            </div>
            <div className="space-y-2.5">
              <StatRow label="Signatures captured" value={signatures.loading ? "…" : signedCount.toLocaleString()} tone={signedCount ? undefined : "muted"} />
              <StatRow label="Active signing links" value={signatures.loading ? "…" : pendingLinks.toLocaleString()} tone={pendingLinks ? undefined : "muted"} />
            </div>
            <p className="text-al-meta text-muted-foreground">The full signature audit trail lives on the Compliance tab.</p>
          </>
        )}
      </Card>

      <Card title="Sold-to record" action={
        <button onClick={save} disabled={saving} className={btnPrimary}>
          <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save"}
        </button>
      }>
        <p className="text-al-body text-muted-foreground">
          Captured when the vehicle is sold. Stored on the internal file only — never shown on the public passport.
        </p>
        {loadingCustomer ? (
          <p className="text-al-body text-muted-foreground">Loading the customer record…</p>
        ) : (
          <div className="space-y-4 max-w-3xl">
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-al-card text-foreground inline-flex items-center gap-1.5"><UserRound className="w-4 h-4 text-muted-foreground" /> Buyer</p>
                <div><label className={LABEL}>Sold date</label><input type="date" value={soldAt} onChange={(e) => setSoldAt(e.target.value)} className={`${INPUT} w-auto`} /></div>
              </div>
              <PersonFields info={buyer} set={setBuyer} />
            </div>
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={showCobuyer} onChange={(e) => setShowCobuyer(e.target.checked)} />
                <span className="text-al-card text-foreground inline-flex items-center gap-1.5"><Users className="w-4 h-4 text-muted-foreground" /> Add co-buyer</span>
              </label>
              {showCobuyer && (
                <>
                  {(buyer.address || buyer.city || buyer.zip) && (
                    <button
                      type="button"
                      onClick={() => setCobuyer({ ...cobuyer, address: buyer.address, city: buyer.city, state: buyer.state, zip: buyer.zip })}
                      className="text-al-meta font-bold uppercase tracking-wider text-primary hover:underline"
                    >
                      Same address as buyer
                    </button>
                  )}
                  <PersonFields info={cobuyer} set={setCobuyer} />
                </>
              )}
            </div>
          </div>
        )}
      </Card>

      <ShopperActivityDrawer
        open={activityOpen}
        onOpenChange={setActivityOpen}
        vin={vehicle.vin}
        tenantId={vehicle.tenant_id}
        vehicleId={vehicle.id}
        viewCount={vehicle.view_count}
        title={vehicle.ymm || vehicle.vin}
        trim={vehicle.trim}
        stock={vehicleStockNumber(vehicle)}
        thumbnailUrl={listingHero(vehicle) || null}
      />
    </div>
  );
};

export default CustomerTab;
