import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useLeads } from "@/hooks/useLeads";
import { useOperatingMetrics } from "@/hooks/useOperatingMetrics";
import { useAdvertisedPrices, assessDrift } from "@/hooks/useAdvertisedPrices";
import { deriveManagerAlerts, filterAcknowledged, type ManagerAlert } from "@/lib/alerts/managerAlerts";
import { hasDealerCapability, type DealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import EmptyState from "@/components/ui/empty-state";
import { ArrowRight, Car, FileSignature, Phone, PhoneOff, Scale, Users } from "lucide-react";

const WINDOW_DAYS = 21;

// Deals the store is actively working. Mirrors the SignatureQueue definition so
// both screens agree on what "in flight" means.
const IN_FLIGHT = ["ready_for_signature", "awaiting_customer", "customer_opened", "partially_signed"];

// A shopper is called highly engaged only against a stated rule: three or more
// DISTINCT intent actions on the same vehicle. No probability is implied.
const HIGH_ENGAGEMENT_SIGNALS = 3;

const PAYMENT_SIGNALS = new Set(["finance_clicked", "cta:finance"]);
const TRADE_SIGNALS = new Set(["trade_clicked", "customer_passport_trade_clicked", "cta:trade"]);

interface EngagementRow {
  id?: string;
  created_at?: string;
  vehicle_id?: string | null;
  vin?: string | null;
  stock?: string | null;
  session_id?: string | null;
  visitor_id?: string | null;
  source?: string | null;
  surface?: string | null;
  event_type?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface ListingRow {
  id: string;
  vin: string | null;
  ymm: string | null;
  slug: string | null;
  status: string | null;
  price: number | null;
}

interface DealRow {
  id: string;
  customer_name: string | null;
  vehicle_ymm: string | null;
  vehicle_vin: string | null;
  status: string;
  lifecycle_status: string | null;
  signing_token: string | null;
  customer_signed_at: string | null;
  selling_price: number | null;
  price_verification_status: string | null;
  ready_at: string | null;
  created_at: string;
}

interface Opportunity {
  key: string;
  vehicleLabel: string;
  vin: string | null;
  listingId: string | null;
  slug: string | null;
  lastActivityAt: string;
  sessions: number;
  chips: string[];
  action: string;
}

const money = (n: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const relative = (iso: string | null) => {
  if (!iso) return "unknown";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown";
  const h = (Date.now() - t) / 3_600_000;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
};

const SalesManagerHome = () => {
  const { tenant, currentStore } = useTenant();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const can = (c: DealerCapability) => hasDealerCapability(member?.role, c, isAdmin);

  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const storeId = currentStore?.id || "";

  const { metrics, error: metricsError } = useOperatingMetrics(tenantId);
  const { leads, loading: leadsLoading } = useLeads(storeId);
  const { byVin: advertisedByVin } = useAdvertisedPrices(storeId);

  const { data, isLoading } = useQuery({
    queryKey: ["sales-manager-home", tenantId],
    enabled: !!tenantId,
    staleTime: 30_000,
    queryFn: async () => {
      const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
      // deno-lint-ignore no-explicit-any -- generated types don't cover these tables
      const db = supabase as any;
      const [events, listings, deals] = await Promise.all([
        db.from("customer_engagement_events")
          .select("id, created_at, vehicle_id, vin, stock, session_id, visitor_id, source, surface, event_type, metadata")
          .eq("tenant_id", tenantId).gte("created_at", since)
          .order("created_at", { ascending: false }).limit(2000),
        db.from("vehicle_listings")
          .select("id, vin, ymm, slug, status, price")
          .eq("tenant_id", tenantId).neq("status", "archived").limit(1000),
        db.from("addendums")
          .select("id, customer_name, vehicle_ymm, vehicle_vin, status, lifecycle_status, signing_token, customer_signed_at, selling_price, price_verification_status, ready_at, created_at")
          .eq("tenant_id", tenantId).in("lifecycle_status", IN_FLIGHT)
          .order("ready_at", { ascending: false, nullsFirst: false }).limit(100),
      ]);
      return {
        events: (events.data || []) as EngagementRow[],
        listings: (listings.data || []) as ListingRow[],
        deals: (deals.data || []) as DealRow[],
      };
    },
  });

  const listingByVin = useMemo(() => {
    const m = new Map<string, ListingRow>();
    for (const l of data?.listings || []) if (l.vin) m.set(l.vin.toUpperCase(), l);
    return m;
  }, [data?.listings]);

  const listingById = useMemo(() => {
    const m = new Map<string, ListingRow>();
    for (const l of data?.listings || []) m.set(l.id, l);
    return m;
  }, [data?.listings]);

  // Raw event types per shopper+vehicle group, keyed the same way
  // deriveManagerAlerts keys its alerts, so a chip can be sourced from an event
  // the alert engine deliberately ignores (a window-sticker scan is passive and
  // must never on its own raise an alert, but it is still a real fact).
  const rawTypesByKey = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of data?.events || []) {
      const visitor = (e.visitor_id || "").trim();
      if (!visitor) continue;
      const key = `${visitor}::${e.vehicle_id || e.vin || e.stock || "unknown"}`;
      const set = m.get(key) || new Set<string>();
      if (e.event_type) set.add(e.event_type);
      if (e.source) set.add(`source:${e.source}`);
      m.set(key, set);
    }
    return m;
  }, [data?.events]);

  const opportunities = useMemo<Opportunity[]>(() => {
    const alerts = filterAcknowledged(
      deriveManagerAlerts((data?.events || []) as Parameters<typeof deriveManagerAlerts>[0]),
    );
    return alerts.slice(0, 12).map((a: ManagerAlert) => {
      const listing = (a.vehicle.vehicleId && listingById.get(a.vehicle.vehicleId))
        || (a.vehicle.vin && listingByVin.get(a.vehicle.vin.toUpperCase()))
        || null;
      const raw = rawTypesByKey.get(a.key) || new Set<string>();
      const types = new Set(a.signals.map((s) => s.type));
      const chips: string[] = [];
      if (a.sessions > 1) chips.push("Returned visitor");
      if ([...types].some((t) => PAYMENT_SIGNALS.has(t))) chips.push("Opened payment tool");
      if ([...types].some((t) => TRADE_SIGNALS.has(t))) chips.push("Opened trade tool");
      if (raw.has("window_sticker_scanned") || raw.has("source:window_sticker_qr")) chips.push("Viewed window sticker");
      if (a.signals.length >= HIGH_ENGAGEMENT_SIGNALS) chips.push("High engagement");
      for (const s of a.signals.slice(0, 3)) chips.push(s.label);
      return {
        key: a.key,
        vehicleLabel: listing?.ymm || a.vehicle.label,
        vin: listing?.vin || a.vehicle.vin,
        listingId: listing?.id || a.vehicle.vehicleId,
        slug: listing?.status === "published" ? listing.slug : null,
        lastActivityAt: a.lastActivityAt,
        sessions: a.sessions,
        chips: [...new Set(chips)],
        action: a.suggestedAction,
      };
    });
  }, [data?.events, listingById, listingByVin, rawTypesByKey]);

  const newLeads = useMemo(() => leads.filter((l) => l.status === "new"), [leads]);
  const followUps = useMemo(
    () => leads.filter((l) => l.status === "contacted")
      .sort((a, b) => (a.updated_at || "").localeCompare(b.updated_at || "")),
    [leads],
  );

  const deals = data?.deals || [];
  const signedDeals = deals.filter((d) => !!d.customer_signed_at);

  const decisions = useMemo(() => {
    const out: { id: string; kind: string; title: string; detail: string; href: string }[] = [];
    for (const l of data?.listings || []) {
      if (l.status !== "published" || !l.vin) continue;
      const a = assessDrift(l.price || 0, advertisedByVin.get(l.vin.toUpperCase()));
      if (a.status !== "drift") continue;
      out.push({
        id: `price-${l.id}`,
        kind: "Price",
        title: l.ymm || `VIN ${l.vin.slice(-8)}`,
        detail: `Sticker ${money(a.sticker)} · ${a.delta > 0 ? "+" : ""}${money(a.delta)} against the advertised price`,
        href: "/inventory",
      });
    }
    for (const d of deals) {
      if (!d.price_verification_status || d.price_verification_status === "verified") continue;
      out.push({
        id: `pv-${d.id}`,
        kind: "Deal price",
        title: d.customer_name || "Customer",
        detail: `${d.vehicle_ymm || `VIN ${(d.vehicle_vin || "").slice(-8)}`} · price not verified against the advertised price`,
        href: `/addendum?id=${d.id}`,
      });
    }
    return out;
  }, [data?.listings, advertisedByVin, deals]);

  // Vehicles shoppers are actually working, from the same engagement window.
  const vehicleDemand = useMemo(() => {
    const counts = new Map<string, { visitors: Set<string>; events: number; listing: ListingRow | null; label: string }>();
    for (const e of data?.events || []) {
      const listing = (e.vehicle_id && listingById.get(e.vehicle_id))
        || (e.vin && listingByVin.get(e.vin.toUpperCase()))
        || null;
      const key = listing?.id || e.vehicle_id || e.vin || null;
      if (!key) continue;
      const row = counts.get(key) || {
        visitors: new Set<string>(),
        events: 0,
        listing,
        label: listing?.ymm || (e.vin ? `VIN ${e.vin.slice(-8)}` : "Vehicle"),
      };
      if (e.visitor_id) row.visitors.add(e.visitor_id);
      row.events += 1;
      counts.set(key, row);
    }
    return [...counts.entries()]
      .map(([key, v]) => ({ key, label: v.label, visitors: v.visitors.size, events: v.events, listing: v.listing }))
      .sort((a, b) => b.visitors - a.visitors || b.events - a.events)
      .slice(0, 8);
  }, [data?.events, listingById, listingByVin]);

  const vehicleHref = (listingId: string | null, slug: string | null) =>
    slug ? `/v/${slug}` : listingId ? `/vin-command/${listingId}` : "/inventory";

  return (
    <div className="p-4 lg:p-6 max-w-[1400px] mx-auto space-y-6">
      <header>
        <p className="text-al-meta font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {currentStore?.name || tenant?.name || "Your dealership"} · Sales desk
        </p>
        <h1 className="font-display text-al-page text-foreground mt-1">Customer opportunities</h1>
        <p className="text-al-body text-muted-foreground mt-1.5">
          Shoppers who acted on a vehicle in the last {WINDOW_DAYS} days, and leads nobody has worked yet.
          Every line is something a customer did — no scores, no predictions.
        </p>
      </header>

      <section className="space-y-3">
        {isLoading || leadsLoading ? (
          <div className="rounded-2xl border border-border bg-card px-5 py-6 text-al-body text-muted-foreground">
            Loading shopper activity…
          </div>
        ) : opportunities.length === 0 && newLeads.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No customers currently meet this engagement filter."
            description={`Nobody has taken an intent action — reaching out, reserving, asking about financing or a trade — on a vehicle in the last ${WINDOW_DAYS} days, and there are no unworked leads.`}
          />
        ) : (
          <>
            {newLeads.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {newLeads.slice(0, 8).map((l) => (
                  <article key={l.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-al-card text-foreground truncate">{l.name || "New lead"}</p>
                        <p className="text-al-meta text-muted-foreground mt-0.5 truncate">
                          {l.vehicle_interest || (l.vehicle_vin ? `VIN ${l.vehicle_vin.slice(-8)}` : "No vehicle recorded")}
                          {" · "}{relative(l.captured_at)}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-md bg-emerald-100 px-2 h-6 inline-flex items-center text-al-meta font-bold uppercase tracking-[0.1em] text-emerald-700">
                        Unworked
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Chip>New lead</Chip>
                      <Chip>{`Source: ${(l.source || "unknown").replace(/_/g, " ")}`}</Chip>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <PrimaryAction to="/leads">Follow Up</PrimaryAction>
                      {l.phone ? (
                        <ExternalAction href={`tel:${l.phone}`} icon={Phone}>Contact</ExternalAction>
                      ) : l.email ? (
                        <ExternalAction href={`mailto:${l.email}`} icon={Phone}>Contact</ExternalAction>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-dashed border-border text-al-meta text-muted-foreground">
                          <PhoneOff className="w-3.5 h-3.5" strokeWidth={2} /> No contact captured
                        </span>
                      )}
                      <SecondaryAction to={vehicleHref(
                        null,
                        (l.vehicle_vin && listingByVin.get(l.vehicle_vin.toUpperCase())?.status === "published")
                          ? listingByVin.get(l.vehicle_vin.toUpperCase())?.slug || null
                          : null,
                      )}>
                        View Vehicle
                      </SecondaryAction>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {opportunities.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {opportunities.map((o) => (
                  <article key={o.key} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-al-card text-foreground truncate">{o.vehicleLabel}</p>
                        <p className="text-al-meta text-muted-foreground mt-0.5">
                          Unidentified shopper · {o.sessions} visit{o.sessions === 1 ? "" : "s"} · {relative(o.lastActivityAt)}
                        </p>
                      </div>
                      {o.vin && (
                        <span className="shrink-0 text-al-meta font-mono text-muted-foreground">…{o.vin.slice(-8)}</span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {o.chips.map((c) => <Chip key={c}>{c}</Chip>)}
                    </div>
                    <p className="text-al-meta text-muted-foreground mt-2.5">{o.action}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <PrimaryAction to="/leads">Follow Up</PrimaryAction>
                      <SecondaryAction to={vehicleHref(o.listingId, o.slug)}>View Vehicle</SecondaryAction>
                      <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-dashed border-border text-al-meta text-muted-foreground">
                        <PhoneOff className="w-3.5 h-3.5" strokeWidth={2} /> No contact captured
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {can("can_view_deals") && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-al-section font-display text-foreground">Active deals</h2>
            <Link to="/signatures" className="text-al-meta font-semibold text-primary hover:underline">
              Signature queue →
            </Link>
          </div>
          {deals.length === 0 ? (
            <EmptyState
              compact
              icon={FileSignature}
              title="No deal is in flight right now."
              description="Deals appear here once they are locked for signature and stay until they are fully executed."
            />
          ) : (
            <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
              {deals.map((d) => (
                <Link
                  key={d.id}
                  to={`/addendum?id=${d.id}`}
                  className="group flex items-center gap-3 px-4 py-3.5 hover:bg-muted/40 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-al-card text-foreground truncate">{d.customer_name || "Customer"}</p>
                    <p className="text-al-meta text-muted-foreground mt-0.5 truncate">
                      {d.vehicle_ymm || (d.vehicle_vin ? `VIN ${d.vehicle_vin.slice(-8)}` : "Vehicle")}
                      {" · "}{relative(d.ready_at || d.created_at)}
                    </p>
                  </div>
                  <div className="hidden sm:flex flex-wrap gap-1.5 shrink-0">
                    {d.customer_signed_at ? <Chip>Signed</Chip> : <Chip>Deal started</Chip>}
                    {d.signing_token && !d.customer_signed_at && <Chip>Out for signature</Chip>}
                  </div>
                  {d.selling_price ? (
                    <span className="shrink-0 text-al-card tabular-nums text-foreground">{money(d.selling_price)}</span>
                  ) : null}
                  <span className="shrink-0 inline-flex items-center gap-1 text-al-meta font-semibold text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                    Work Deal <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </Link>
              ))}
              <p className="px-4 py-2.5 text-al-meta text-muted-foreground">
                {signedDeals.length} of {deals.length} already carry a customer signature.
              </p>
            </div>
          )}
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-al-section font-display text-foreground">Follow-up</h2>
          <Link to="/leads" className="text-al-meta font-semibold text-primary hover:underline">
            All leads →
          </Link>
        </div>
        {followUps.length === 0 ? (
          <EmptyState
            compact
            icon={Users}
            title="No customers currently meet this engagement filter."
            description="Leads move here once someone has contacted them and they are waiting on a next touch."
          />
        ) : (
          <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
            {followUps.slice(0, 10).map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-al-card text-foreground truncate">{l.name || "Lead"}</p>
                  <p className="text-al-meta text-muted-foreground mt-0.5 truncate">
                    {l.vehicle_interest || (l.vehicle_vin ? `VIN ${l.vehicle_vin.slice(-8)}` : "No vehicle recorded")}
                    {" · last touched "}{relative(l.updated_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {l.phone && <ExternalAction href={`tel:${l.phone}`} icon={Phone}>Contact</ExternalAction>}
                  <PrimaryAction to="/leads">Follow Up</PrimaryAction>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-al-section font-display text-foreground mb-2">Manager decisions</h2>
        {decisions.length === 0 ? (
          <EmptyState
            compact
            icon={Scale}
            title="Nothing is waiting on a desk decision."
            description="Advertised-price discrepancies and unverified deal prices surface here as soon as they appear."
          />
        ) : (
          <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
            {decisions.map((d) => (
              <Link
                key={d.id}
                to={d.href}
                className="group flex items-start gap-3 px-4 py-3.5 hover:bg-muted/40 transition-colors"
              >
                <span className="mt-0.5 shrink-0 inline-flex h-6 items-center rounded-md bg-muted px-2 text-al-meta font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  {d.kind}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-al-card text-foreground truncate">{d.title}</p>
                  <p className="text-al-meta text-muted-foreground mt-0.5 truncate">{d.detail}</p>
                </div>
                <ArrowRight className="w-4 h-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-al-section font-display text-foreground mb-2">Vehicles affecting sales</h2>
        <div className="grid grid-cols-3 rounded-2xl border border-border bg-card divide-x divide-border overflow-hidden mb-3">
          <div className="px-4 py-3.5">
            <p className="text-al-meta font-bold uppercase tracking-[0.14em] text-muted-foreground">Sellable now</p>
            <p className="font-display text-2xl tabular-nums leading-none mt-1.5 text-foreground">{metrics.retailReady}</p>
          </div>
          <div className="px-4 py-3.5">
            <p className="text-al-meta font-bold uppercase tracking-[0.14em] text-muted-foreground">Live on the site</p>
            <p className="font-display text-2xl tabular-nums leading-none mt-1.5 text-foreground">{metrics.publishedInventory}</p>
          </div>
          <div className="px-4 py-3.5">
            <p className="text-al-meta font-bold uppercase tracking-[0.14em] text-muted-foreground">On hold or wholesale</p>
            <p className={`font-display text-2xl tabular-nums leading-none mt-1.5 ${metrics.gated === 0 ? "text-muted-foreground" : "text-foreground"}`}>
              {metrics.gated}
            </p>
          </div>
        </div>
        {metricsError && (
          <p className="text-al-meta text-muted-foreground mb-3">Operating counts are unavailable: {metricsError}</p>
        )}
        {vehicleDemand.length === 0 ? (
          <EmptyState
            compact
            icon={Car}
            title="No vehicle has shopper activity in this window."
            description={`Nothing on the lot has been opened by a shopper in the last ${WINDOW_DAYS} days.`}
          />
        ) : (
          <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
            {vehicleDemand.map((v) => (
              <div key={v.key} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-al-card text-foreground truncate">{v.label}</p>
                  <p className="text-al-meta text-muted-foreground mt-0.5">
                    {v.visitors} shopper{v.visitors === 1 ? "" : "s"} · {v.events} action{v.events === 1 ? "" : "s"}
                    {v.listing && v.listing.status !== "published" ? " · not published" : ""}
                  </p>
                </div>
                <SecondaryAction to={vehicleHref(v.listing?.id || null, v.listing?.status === "published" ? v.listing.slug : null)}>
                  View Vehicle
                </SecondaryAction>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

const Chip = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex items-center h-6 rounded-md bg-muted px-2 text-al-meta font-semibold text-muted-foreground">
    {children}
  </span>
);

const PrimaryAction = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link
    to={to}
    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-primary text-primary-foreground text-al-meta font-semibold hover:brightness-110 transition-all"
  >
    {children}
  </Link>
);

const SecondaryAction = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link
    to={to}
    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md border border-border bg-card text-al-meta font-semibold text-foreground hover:bg-muted transition-colors"
  >
    {children}
  </Link>
);

const ExternalAction = ({ href, icon: Icon, children }: { href: string; icon: typeof Phone; children: ReactNode }) => (
  <a
    href={href}
    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md border border-border bg-card text-al-meta font-semibold text-foreground hover:bg-muted transition-colors"
  >
    <Icon className="w-3.5 h-3.5" strokeWidth={2} />
    {children}
  </a>
);

export default SalesManagerHome;
