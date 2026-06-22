import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity, Car, FileText, Flame, HeartHandshake, Mail, MousePointerClick, Phone, RefreshCw, TrendingUp } from "lucide-react";

type EngagementEvent = {
  id?: string;
  created_at?: string;
  tenant_id?: string | null;
  store_id?: string | null;
  vehicle_id?: string | null;
  vin?: string | null;
  stock?: string | null;
  session_id?: string | null;
  visitor_id?: string | null;
  source?: string | null;
  surface?: string | null;
  event_type?: string | null;
  document_type?: string | null;
  document_title?: string | null;
  packet_id?: string | null;
  qr_token?: string | null;
  metadata?: Record<string, unknown> | null;
};

type VehicleRollup = {
  key: string;
  vin?: string | null;
  stock?: string | null;
  vehicleId?: string | null;
  opens: number;
  docs: number;
  packets: number;
  trades: number;
  calls: number;
  texts: number;
  directions: number;
  visitors: Set<string>;
  lastSeen?: string;
};

const EVENT_LABELS: Record<string, string> = {
  passport_opened: "Passport opened",
  packet_opened: "Packet requested",
  document_opened: "Document opened",
  trade_clicked: "Trade clicked",
  cta_clicked: "CTA clicked",
  call_clicked: "Call clicked",
  text_clicked: "Text clicked",
  directions_clicked: "Directions clicked",
};

const statClass = "rounded-3xl border border-border bg-card p-4 shadow-sm";

const scoreFor = (item: VehicleRollup) =>
  item.opens * 3 + item.docs * 5 + item.packets * 12 + item.trades * 14 + item.calls * 10 + item.texts * 10 + item.directions * 8 + item.visitors.size * 4;

const formatTime = (value?: string) => {
  if (!value) return "No timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export default function PassportEngagementDashboard() {
  const [events, setEvents] = useState<EngagementEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (supabase as any)
      .from("customer_engagement_events")
      .select("id, created_at, tenant_id, store_id, vehicle_id, vin, stock, session_id, visitor_id, source, surface, event_type, document_type, document_title, packet_id, qr_token, metadata")
      .in("surface", ["vehicle_passport", "document_packet", "document_viewer", "lead_form"])
      .order("created_at", { ascending: false })
      .limit(250);

    setLoading(false);
    if (error) { setErr(error.message); return; }
    setErr(null);
    setEvents((data || []) as EngagementEvent[]);
  };

  useEffect(() => { load(); }, []);

  const summary = useMemo(() => {
    const uniqueVisitors = new Set(events.map((e) => e.visitor_id || e.session_id).filter(Boolean));
    return {
      opens: events.filter((e) => e.event_type === "passport_opened").length,
      docs: events.filter((e) => e.event_type === "document_opened").length,
      packets: events.filter((e) => e.event_type === "packet_opened" || e.event_type === "lead_submitted").length,
      trades: events.filter((e) => e.event_type === "trade_clicked" || (e.event_type === "cta_clicked" && e.metadata?.cta === "trade")).length,
      calls: events.filter((e) => e.event_type === "call_clicked").length,
      visitors: uniqueVisitors.size,
    };
  }, [events]);

  const vehicles = useMemo(() => {
    const map = new Map<string, VehicleRollup>();
    for (const event of events) {
      const key = event.vehicle_id || event.vin || event.stock || event.packet_id || event.session_id || "unknown";
      const existing = map.get(key) || {
        key,
        vin: event.vin,
        stock: event.stock,
        vehicleId: event.vehicle_id,
        opens: 0,
        docs: 0,
        packets: 0,
        trades: 0,
        calls: 0,
        texts: 0,
        directions: 0,
        visitors: new Set<string>(),
        lastSeen: event.created_at,
      };
      if (event.visitor_id || event.session_id) existing.visitors.add(event.visitor_id || event.session_id || "unknown");
      if (event.created_at && (!existing.lastSeen || new Date(event.created_at) > new Date(existing.lastSeen))) existing.lastSeen = event.created_at;
      if (event.event_type === "passport_opened") existing.opens += 1;
      if (event.event_type === "document_opened") existing.docs += 1;
      if (event.event_type === "packet_opened" || event.event_type === "lead_submitted") existing.packets += 1;
      if (event.event_type === "trade_clicked" || (event.event_type === "cta_clicked" && event.metadata?.cta === "trade")) existing.trades += 1;
      if (event.event_type === "call_clicked") existing.calls += 1;
      if (event.event_type === "text_clicked") existing.texts += 1;
      if (event.event_type === "directions_clicked") existing.directions += 1;
      map.set(key, existing);
    }
    return [...map.values()].sort((a, b) => scoreFor(b) - scoreFor(a)).slice(0, 12);
  }, [events]);

  const hotLeads = vehicles.filter((vehicle) => scoreFor(vehicle) >= 20).slice(0, 5);
  const recent = events.slice(0, 20);

  if (loading) return <p className="p-4 text-sm text-muted-foreground">Loading Passport engagement…</p>;

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-orange-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-orange-700"><Flame className="h-3.5 w-3.5" /> Passport Intelligence</div>
            <h2 className="mt-3 text-2xl font-black tracking-tight text-foreground">Passport Engagement Dashboard</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">See which vehicles are getting attention, what documents customers opened, and which shoppers clicked trade, call, text, or packet actions.</p>
            {err ? <p className="mt-2 text-xs font-semibold text-amber-700">Database note: {err}</p> : null}
          </div>
          <button onClick={load} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-black text-foreground hover:bg-muted"><RefreshCw className="h-4 w-4" /> Refresh</button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div className={statClass}><Activity className="mb-3 h-5 w-5 text-blue-600" /><p className="text-2xl font-black text-foreground">{summary.opens}</p><p className="text-xs font-bold uppercase text-muted-foreground">Passport opens</p></div>
        <div className={statClass}><FileText className="mb-3 h-5 w-5 text-blue-600" /><p className="text-2xl font-black text-foreground">{summary.docs}</p><p className="text-xs font-bold uppercase text-muted-foreground">Docs viewed</p></div>
        <div className={statClass}><Mail className="mb-3 h-5 w-5 text-blue-600" /><p className="text-2xl font-black text-foreground">{summary.packets}</p><p className="text-xs font-bold uppercase text-muted-foreground">Packet actions</p></div>
        <div className={statClass}><HeartHandshake className="mb-3 h-5 w-5 text-blue-600" /><p className="text-2xl font-black text-foreground">{summary.trades}</p><p className="text-xs font-bold uppercase text-muted-foreground">Trade clicks</p></div>
        <div className={statClass}><Phone className="mb-3 h-5 w-5 text-blue-600" /><p className="text-2xl font-black text-foreground">{summary.calls}</p><p className="text-xs font-bold uppercase text-muted-foreground">Call clicks</p></div>
        <div className={statClass}><MousePointerClick className="mb-3 h-5 w-5 text-blue-600" /><p className="text-2xl font-black text-foreground">{summary.visitors}</p><p className="text-xs font-bold uppercase text-muted-foreground">Visitors</p></div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-3xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-black text-foreground">Hot vehicle activity</h3>
              <p className="text-sm text-muted-foreground">Ranked by opens, documents, packet requests, trade, and contact actions.</p>
            </div>
            <TrendingUp className="h-5 w-5 text-orange-600" />
          </div>
          <div className="mt-4 space-y-3">
            {vehicles.length ? vehicles.map((vehicle) => (
              <div key={vehicle.key} className="rounded-2xl border border-border bg-background p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-foreground">{vehicle.stock ? `Stock ${vehicle.stock}` : vehicle.vin || vehicle.vehicleId || "Unknown vehicle"}</p>
                    <p className="text-xs text-muted-foreground">VIN {vehicle.vin || "—"} · Last seen {formatTime(vehicle.lastSeen)}</p>
                  </div>
                  <div className="rounded-full bg-orange-50 px-3 py-1 text-xs font-black text-orange-700">Score {scoreFor(vehicle)}</div>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs sm:grid-cols-7">
                  <span className="rounded-lg bg-muted px-2 py-1 font-bold">{vehicle.opens} opens</span>
                  <span className="rounded-lg bg-muted px-2 py-1 font-bold">{vehicle.docs} docs</span>
                  <span className="rounded-lg bg-muted px-2 py-1 font-bold">{vehicle.packets} packet</span>
                  <span className="rounded-lg bg-muted px-2 py-1 font-bold">{vehicle.trades} trade</span>
                  <span className="rounded-lg bg-muted px-2 py-1 font-bold">{vehicle.calls} call</span>
                  <span className="rounded-lg bg-muted px-2 py-1 font-bold">{vehicle.texts} text</span>
                  <span className="rounded-lg bg-muted px-2 py-1 font-bold">{vehicle.visitors.size} visitor</span>
                </div>
              </div>
            )) : <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No Passport engagement recorded yet.</p>}
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-black text-foreground">Recent customer actions</h3>
              <p className="text-sm text-muted-foreground">A sales-friendly feed of what shoppers just did.</p>
            </div>
            <Car className="h-5 w-5 text-blue-600" />
          </div>
          <div className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-background">
            {recent.length ? recent.map((event) => (
              <div key={event.id || `${event.created_at}-${event.event_type}`} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-foreground">{EVENT_LABELS[event.event_type || ""] || event.event_type || "Engagement event"}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{event.document_title || event.document_type || event.stock || event.vin || event.vehicle_id || "Vehicle Passport"}</p>
                  </div>
                  <span className="text-[11px] font-semibold text-muted-foreground">{formatTime(event.created_at)}</span>
                </div>
              </div>
            )) : <p className="p-6 text-center text-sm text-muted-foreground">No recent events.</p>}
          </div>
        </section>
      </div>

      <section className="rounded-3xl border border-orange-200 bg-orange-50 p-5 text-orange-950">
        <div className="flex items-start gap-3">
          <Flame className="mt-1 h-6 w-6" />
          <div>
            <h3 className="text-lg font-black">Sales use case</h3>
            <p className="mt-1 text-sm leading-relaxed">A hot Passport lead is not just a form fill. It is a shopper who opened documents, viewed the vehicle story, clicked trade value, or contacted the store. This dashboard turns QR scans into follow-up context.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
