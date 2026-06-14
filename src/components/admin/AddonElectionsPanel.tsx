import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BadgeCheck, TrendingUp, FileSignature, Layers, ArrowUpRight } from "lucide-react";

// AddonElectionsPanel — the F&I "provable election" dashboard. Reads
// signed addendums for the store and derives, per add-on, whether the
// customer affirmatively elected it (optional accept, or initialed on
// an installed item). Same derivation the Audit-Defense Packet uses,
// so the on-screen numbers match the artifact handed to a regulator.

interface SnapshotProduct {
  id?: string;
  name?: string;
  price?: number;
  badge_type?: string;
  benefit_justification?: string;
  price_in_advertised?: boolean;
}
interface AddendumRow {
  id: string;
  customer_name: string | null;
  vehicle_vin: string | null;
  vehicle_ymm: string | null;
  customer_signed_at: string | null;
  status: string;
  products_snapshot: SnapshotProduct[] | null;
  optional_selections: Record<string, string> | null;
  initials: Record<string, string> | null;
}
interface Item {
  id: string;
  name: string;
  price: number | null;
  optional: boolean;
  aboveAdvertised: boolean;
  elected: boolean;
}
interface Deal {
  id: string;
  customer: string;
  vin: string;
  ymm: string;
  signedAt: string | null;
  items: Item[];
  elected: number;
  total: number;
}

const deriveItems = (a: AddendumRow): Item[] => {
  const products = Array.isArray(a.products_snapshot) ? a.products_snapshot : [];
  const optional = a.optional_selections || {};
  const inits = a.initials || {};
  return products.map((p) => {
    const id = String(p.id ?? "");
    const isOptional = p.badge_type === "optional";
    // An installed accessory priced above the advertised price is
    // electable like an optional add-on (proof = affirmative Accept);
    // one included in the advertised price is acknowledged by initial.
    const aboveAdvertised = p.badge_type === "installed" && p.price_in_advertised === false;
    const electable = isOptional || aboveAdvertised;
    const initialed = !!(inits[id] && String(inits[id]).trim());
    return {
      id,
      name: String(p.name ?? ""),
      price: typeof p.price === "number" ? p.price : null,
      optional: isOptional,
      aboveAdvertised,
      elected: electable ? optional[id] === "accept" : initialed,
    };
  });
};

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Unsigned";
const fmtMoney = (n: number) => "$" + n.toLocaleString();

export const AddonElectionsPanel = ({ storeId }: { storeId: string }) => {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      let q = (supabase as any)
        .from("addendums")
        .select(
          "id, customer_name, vehicle_vin, vehicle_ymm, customer_signed_at, status, products_snapshot, optional_selections, initials",
        )
        .order("customer_signed_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (storeId) q = q.eq("store_id", storeId);
      const { data } = await q;
      if (!active) return;
      const rows = (data as AddendumRow[]) || [];
      const mapped: Deal[] = rows
        .map((a) => {
          const items = deriveItems(a);
          return {
            id: a.id,
            customer: a.customer_name || "Customer",
            vin: a.vehicle_vin || "—",
            ymm: a.vehicle_ymm || "",
            signedAt: a.customer_signed_at,
            items,
            elected: items.filter((i) => i.elected).length,
            total: items.length,
          };
        })
        .filter((d) => d.total > 0);
      setDeals(mapped);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [storeId]);

  const allItems = deals.flatMap((d) => d.items);
  const optionalItems = allItems.filter((i) => i.optional);
  const electedOptional = optionalItems.filter((i) => i.elected).length;
  const acceptanceRate = optionalItems.length ? Math.round((electedOptional / optionalItems.length) * 100) : 0;
  const electedRevenue = allItems.filter((i) => i.elected).reduce((s, i) => s + (i.price || 0), 0);

  // Above-advertised upcharges — the highest-scrutiny lines. Each one
  // had to be affirmatively elected; surface the elected share and the
  // exact revenue charged over the advertised price.
  const aboveItems = allItems.filter((i) => i.aboveAdvertised);
  const aboveElected = aboveItems.filter((i) => i.elected);
  const aboveElectedRevenue = aboveElected.reduce((s, i) => s + (i.price || 0), 0);
  const aboveElectionRate = aboveItems.length ? Math.round((aboveElected.length / aboveItems.length) * 100) : 0;

  const byProduct = new Map<string, { offered: number; elected: number }>();
  for (const i of optionalItems) {
    const m = byProduct.get(i.name) || { offered: 0, elected: 0 };
    m.offered += 1;
    if (i.elected) m.elected += 1;
    byProduct.set(i.name, m);
  }
  const products = Array.from(byProduct.entries())
    .map(([name, m]) => ({ name, ...m, rate: m.offered ? Math.round((m.elected / m.offered) * 100) : 0 }))
    .sort((a, b) => b.offered - a.offered)
    .slice(0, 8);

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Loading add-on elections…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-display text-lg font-bold tracking-tight text-foreground">Add-On Election Record</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Per-item proof that each customer reviewed every add-on — price, optional flag, benefit — and affirmatively
          elected or declined it. Your defensible record under FTC Act §5; the same data appears in each VIN's
          Audit-Defense Packet.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={FileSignature} label="Deals with add-ons" value={String(deals.length)} />
        <Kpi icon={Layers} label="Optional add-ons offered" value={String(optionalItems.length)} />
        <Kpi
          icon={TrendingUp}
          label="Election rate"
          value={acceptanceRate + "%"}
          note={`${electedOptional} of ${optionalItems.length} elected`}
        />
        <Kpi icon={BadgeCheck} label="Elected add-on revenue" value={fmtMoney(electedRevenue)} />
      </div>

      {aboveItems.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <ArrowUpRight className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-amber-700">Charged above the advertised price</p>
              <p className="mt-0.5 font-display text-2xl font-black tracking-tight text-foreground">
                {aboveElected.length}/{aboveItems.length} elected · {fmtMoney(aboveElectedRevenue)}
              </p>
              <p className="text-xs text-amber-800/90 mt-1 max-w-2xl leading-relaxed">
                These dealer-installed accessories were priced above the advertised price, so each required an explicit
                customer Accept/Decline. {aboveElectionRate}% were affirmatively elected; declined items were billed at
                the advertised price. The same per-item proof is in each VIN's Audit-Defense Packet.
              </p>
            </div>
          </div>
        </div>
      )}

      {products.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-3">
            Election rate by product
          </p>
          <div className="space-y-2.5">
            {products.map((p) => (
              <div key={p.name} className="flex items-center gap-3">
                <div className="w-40 truncate text-sm font-medium text-foreground">{p.name}</div>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-[#2563EB]" style={{ width: `${p.rate}%` }} />
                </div>
                <div className="w-28 text-right text-xs text-muted-foreground tabular-nums">
                  {p.elected}/{p.offered} · {p.rate}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground px-5 pt-4">
          Recent signed deals
        </p>
        {deals.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No signed addendums with add-ons yet.</p>
        ) : (
          <div className="divide-y divide-border mt-2">
            {deals.slice(0, 25).map((d) => (
              <div key={d.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{d.customer}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {d.ymm || d.vin} · {fmtDate(d.signedAt)}
                  </p>
                </div>
                <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-[#2563EB]">
                  {d.elected}/{d.total} elected
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const Kpi = ({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof BadgeCheck;
  label: string;
  value: string;
  note?: string;
}) => (
  <div className="rounded-2xl border border-border bg-card p-4">
    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-[#2563EB]">
      <Icon className="h-4 w-4" />
    </div>
    <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
    <p className="mt-0.5 font-display text-2xl font-black tracking-tight text-foreground">{value}</p>
    {note && <p className="text-[11px] text-muted-foreground mt-0.5">{note}</p>}
  </div>
);

export default AddonElectionsPanel;
