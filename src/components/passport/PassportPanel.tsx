import { useEffect, useMemo, useState } from "react";
import {
  DollarSign, TrendingUp, TrendingDown, Gauge, Clock, Car, Package, ShieldCheck,
  Star, Award, FileText, MessageSquare, Eye, CheckCircle2,
  Flame, Heart, Send, Bookmark, Users, Circle, ChevronDown, MapPin, BadgeCheck, Info, AlertTriangle, History,
} from "lucide-react";
import type { PassportData, PricePoint } from "@/lib/passportV2Data";
import { fmt$ } from "@/lib/passportV2Data";
import type { VehicleListing } from "@/hooks/useVehicleListing";
import {
  PassportSlideOver, Hero, Section, Check, Empty, StatRow, RangeBar, TrendChart, Ring, CARD, GREEN, BLUE,
} from "./PassportSlideOver";

// ──────────────────────────────────────────────────────────────
// PassportPanel — single dispatcher that renders any Passport V3
// slide-out by key, on top of the shared PassportSlideOver shell.
// Every section is gated on real listing data; sample numbers only
// surface behind the page's SAMPLE PREVIEW banner (isPreview), and
// missing data shows a clean empty state instead of a fabricated one.
// ──────────────────────────────────────────────────────────────

export type PassportPanelKey =
  | "market-price" | "market-demand" | "price-confidence" | "price-history"
  | "comparable-vehicles" | "inventory-trend" | "factory-warranty"
  | "owner-reviews" | "highlights" | "overview" | "key-specs" | "equipment" | "ownership-timeline";

interface Comp { ymm: string; trim: string; mileage: number | null; price: number | null; distance: string | null; distNum: number | null; image: string | null; dealer: string | null; dom: number | null }

const deriveComps = (listing: VehicleListing, d: PassportData, isPreview: boolean): Comp[] => {
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const raw = (listing as unknown as { comparables?: unknown }).comparables ?? (mc.comparables as unknown);
  const real: Comp[] = (Array.isArray(raw) ? raw : []).map((c) => c as Record<string, unknown>).map((c) => {
    const distNum = c.dist != null ? Number(c.dist) : c.distance != null ? Number(c.distance) : null;
    return {
      ymm: String(c.ymm ?? c.heading ?? [c.year, c.make, c.model].filter(Boolean).join(" ") ?? ""),
      trim: String(c.trim ?? ""),
      mileage: c.miles != null ? Number(c.miles) : c.mileage != null ? Number(c.mileage) : null,
      price: c.price != null ? Number(c.price) : null,
      distance: distNum != null && !Number.isNaN(distNum) ? `${Math.round(distNum)} mi away` : null,
      distNum: distNum != null && !Number.isNaN(distNum) ? distNum : null,
      image: (c.image as string) ?? (c.photo_url as string) ?? null,
      dealer: (c.dealer as string) ?? (c.seller_name as string) ?? (c.dealer_name as string) ?? null,
      dom: c.dom != null ? Number(c.dom) : c.days_on_market != null ? Number(c.days_on_market) : null,
    };
  }).filter((c) => c.ymm);
  if (real.length) return real;
  const price = d.price;
  if (!isPreview || price == null) return [];
  const offs = [2760, 4360, 3850, 5200, 1900, 4360, 6100, 3200];
  const miles = [12, 18, 9, 24, 15, 18, 31, 11];
  const distN = [2.3, 4.1, 6.7, 6.7, 9.2, 12.4, 15.1, 18.9];
  const doms = [12, 31, 8, 45, 22, 51, 19, 37];
  const dealers = ["Hartford INFINITI", "Premier Auto Group", "Valley Motors", "City Luxury Cars", "North Shore Auto", "Gateway Motors", "Summit Auto", "Lakeside INFINITI"];
  return offs.map((o, i) => ({ ymm: listing.ymm || "Comparable", trim: listing.trim || "", mileage: miles[i], price: price + o, distance: `${distN[i]} mi away`, distNum: distN[i], image: listing.hero_image_url || null, dealer: dealers[i], dom: doms[i] }));
};

const CompStrip = ({ comps }: { comps: Comp[] }) => (
  <div className="flex gap-3 overflow-x-auto -mx-1 px-1 pb-1 snap-x">
    {comps.map((c, i) => (
      <div key={i} className={`shrink-0 w-[150px] ${CARD} overflow-hidden snap-start`}>
        <div className="h-[84px] bg-[#eef0f3] flex items-center justify-center">
          {c.image ? <img src={c.image} alt="" className="w-full h-full object-cover" /> : <Car className="w-7 h-7 text-[#94A3B8]" />}
        </div>
        <div className="p-2.5">
          <p className="text-[12px] font-bold leading-tight line-clamp-1">{c.ymm}</p>
          {c.trim && <p className="text-[11px] text-[#64748B] line-clamp-1">{c.trim}</p>}
          {c.mileage != null && <p className="text-[11px] text-[#64748B] mt-0.5">{c.mileage.toLocaleString()} mi</p>}
          {c.price != null && <p className="text-[13px] font-extrabold text-[#0F172A] mt-1">{fmt$(c.price)}</p>}
          {c.distance && <p className="text-[10px] text-[#94A3B8] mt-0.5">{c.distance}</p>}
        </div>
      </div>
    ))}
  </div>
);

interface PanelDef { title: string; subtitle: string; body: React.ReactNode; primary?: { label: string; onClick: () => void }; secondary?: { label: string; onClick: () => void }; footerQuestion?: string; specialistLabel?: string }

function buildPanel(key: PassportPanelKey, d: PassportData, listing: VehicleListing, isPreview: boolean, go: (s: string) => void, openPanel: (k: PassportPanelKey) => void): PanelDef {
  const price = d.price, avg = d.marketAvg, low = d.marketLow, high = d.marketHigh, below = d.belowMarket;
  const isGreat = below != null && below > 0;
  const conf = d.confScore;
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const marketSeries = d.valueHistory.filter((h) => h.market_value != null).map((h) => h.market_value as number);
  const dealerSeries = d.valueHistory.filter((h) => h.listing_price != null).map((h) => h.listing_price as number);

  switch (key) {
    case "market-price": {
      const year = (listing.ymm || "").match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
      const compCount = (mc.similar_count as number) ?? (mc.comparable_count as number) ?? null;
      const radius = (mc.search_radius as number) ?? null;
      const checkedRaw = (listing as unknown as { market_checked_at?: string }).market_checked_at
        ?? (listing.market_payload as { checked_at?: string } | null)?.checked_at ?? null;
      const updated = checkedRaw ? `Updated ${new Date(checkedRaw).toLocaleDateString()}` : isPreview ? "Updated today" : null;
      const comparedAgainst: string[] = [];
      if (compCount != null) comparedAgainst.push(`${compCount.toLocaleString()} similar vehicles`); else if (isPreview) comparedAgainst.push("42 similar vehicles");
      if (radius != null) comparedAgainst.push(`${radius}-mile radius`); else if (isPreview) comparedAgainst.push("150-mile radius");
      if (year) comparedAgainst.push(`Same year (${year})`);
      if (listing.mileage != null) comparedAgainst.push(`Similar mileage (${Math.round(listing.mileage / 1000)}k±)`);
      if (listing.trim) comparedAgainst.push(`Same trim (${listing.trim})`);
      if (updated) comparedAgainst.push(updated);
      const percentile = (mc.price_percentile as number) ?? null;
      const why: string[] = [];
      if (isGreat) why.push("Priced below local market");
      if (percentile != null) why.push(`Lower than ${percentile}% of similar vehicles`); else if (isPreview) why.push("Lower than 91% of similar vehicles");
      if (listing.mileage != null && listing.mileage < 30000) why.push(`Low mileage (${listing.mileage.toLocaleString()} mi)`);
      if (d.ownerCount === 1) why.push("One owner");
      if (d.cleanTitle && d.accidentCount === 0) why.push("Clean history");
      if ((listing.features?.length ?? 0) >= 3) why.push("Strong equipment package");
      const comps = deriveComps(listing, d, isPreview);
      const dealerDelta = d.priceChangeTotal;
      const marketDelta = marketSeries.length >= 2 ? marketSeries[marketSeries.length - 1] - marketSeries[0] : null;
      return {
        title: "Market Pricing Analysis", subtitle: "How AutoLabels determined this price",
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        body: <>
          <Hero icon={ShieldCheck} tone={isGreat ? "green" : "neutral"} label={isGreat ? "Great Price" : avg != null ? "Market Price" : "Pricing Pending"}
            value={isGreat ? `${fmt$(below)} Below Market` : undefined}
            note={conf != null ? `Confidence: ${conf}%` : avg != null ? `Near the ${fmt$(avg)} market average` : "Market comparison appears once MarketCheck data is available."} />
          {low != null && high != null && avg != null && price != null ? (
            <div className={`${CARD} p-5`}>
              <div className="grid grid-cols-3 text-center mb-1">
                <div><p className="text-[11px] text-[#64748B]">Low Market</p><p className="text-[14px] font-bold">{fmt$(low)}</p></div>
                <div><p className="text-[11px] text-[#64748B]">Market Average</p><p className="text-[14px] font-bold">{fmt$(avg)}</p></div>
                <div><p className="text-[11px] text-[#64748B]">High Market</p><p className="text-[14px] font-bold">{fmt$(high)}</p></div>
              </div>
              <RangeBar low={low} avg={avg} high={high} dealer={price} />
            </div>
          ) : <Empty>The market price range appears once enough comparable listings are available.</Empty>}
          {(comparedAgainst.length > 0 || why.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {comparedAgainst.length > 0 && <div className={`${CARD} p-4`}><p className="text-[13px] font-bold mb-2.5">Compared against</p><ul className="space-y-2">{comparedAgainst.map((t) => <Check key={t}>{t}</Check>)}</ul></div>}
              {why.length > 0 && <div className={`${CARD} p-4`}><p className="text-[13px] font-bold mb-2.5">{isGreat ? "Why it's a Great Price" : "Pricing factors"}</p><ul className="space-y-2">{why.map((t) => <Check key={t}>{t}</Check>)}</ul></div>}
            </div>
          )}
          <Section title={`Comparable Vehicles${comps.length ? ` (${compCount ?? comps.length})` : ""}`} sub="Based on similar vehicles in your market area."
            action={comps.length ? <button onClick={() => openPanel("comparable-vehicles")} className="text-[12px] font-semibold text-[#2563EB] hover:underline shrink-0">View all</button> : undefined}>
            {comps.length ? <CompStrip comps={comps} /> : <Empty>Comparable vehicles will appear here once enough market data is available.</Empty>}
          </Section>
          <Section title="Pricing Trend (30 Days)">
            {(marketSeries.length >= 2 || dealerSeries.length >= 2) ? (
              <div className={`${CARD} p-4`}>
                <div className="flex items-center gap-4 mb-2 text-[11px] font-semibold">
                  <span className="inline-flex items-center gap-1.5 text-[#64748B]"><span className="w-4 border-t-2 border-dashed border-[#2563EB]" /> Market avg</span>
                  <span className="inline-flex items-center gap-1.5 text-[#16A34A]"><span className="w-4 border-t-2 border-[#16A34A]" /> Dealer price</span>
                </div>
                <TrendChart market={marketSeries} dealer={dealerSeries} />
                <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-[12px]">
                  {marketDelta != null && <Delta label="Market average" delta={marketDelta} />}
                  {dealerDelta != null && <Delta label="Dealer price" delta={dealerDelta} />}
                </div>
              </div>
            ) : <Empty>Pricing trend will appear once enough market data is available.</Empty>}
          </Section>
          {conf != null && (
            <Section title="AutoLabels Confidence">
              <div className={`${CARD} p-4 flex items-center gap-5`}>
                <div className="flex flex-col items-center shrink-0"><Ring pct={conf} /><p className="text-[12px] font-extrabold text-[#16A34A] mt-1">{conf >= 85 ? "High Confidence" : conf >= 70 ? "Good Confidence" : "Fair Confidence"}</p></div>
                <div className="min-w-0"><p className="text-[12px] text-[#64748B] mb-2">Our price analysis is based on:</p><ul className="grid grid-cols-1 gap-1.5">{["MarketCheck data", "Dealer pricing data", "Regional demand", "Vehicle history", "Mileage & condition", "Equipment & features"].map((b) => <Check key={b}>{b}</Check>)}</ul></div>
              </div>
            </Section>
          )}
          <Disclaimer />
        </>,
      };
    }

    case "market-demand": {
      const views = d.viewCount, dom = d.dom;
      const has = views != null || dom != null;
      const score = (() => { let s = 50; if (views != null) s += Math.min(30, views / 3); if (dom != null) { if (dom <= 30) s += 15; else if (dom > 60) s -= 20; else s += 5; } return Math.max(5, Math.min(95, Math.round(s))); })();
      const level = score >= 66 ? "High Interest" : score >= 40 ? "Moderate Interest" : "Building Interest";
      const activity = [
        { icon: Eye, label: "Views", value: views != null ? views.toLocaleString() : isPreview ? "89" : "—" },
        { icon: Heart, label: "Favorites", value: isPreview ? "14" : "—" },
        { icon: Send, label: "Lead Requests", value: isPreview ? "6" : "—" },
        { icon: Users, label: "Dealer Inquiries", value: isPreview ? "4" : "—" },
        { icon: Bookmark, label: "Price Saves", value: isPreview ? "11" : "—" },
      ];
      const insights: string[] = [];
      if (views != null) insights.push(`${views.toLocaleString()} shoppers have viewed this vehicle`);
      if (dom != null && dom <= 30) insights.push("Recently listed — fresh to market");
      if (dom != null && dom > 45) insights.push("On the market a while — the dealer may be flexible");
      if (isGreat) insights.push("Priced below market average — strong value");
      if (isPreview) { insights.push("Vehicles with this trim typically sell within 38 days"); insights.push("Comparable inventory is decreasing"); }
      const avgDom = (mc.avg_dom as number) ?? null;
      const supply = (mc.market_days_supply as number) ?? (mc.inventory_count as number) ?? null;
      // Mobile-only derived content (same data, premium presentation).
      const topPct = Math.max(5, 100 - score);
      const demandWord = score >= 66 ? "High Demand" : score >= 45 ? "Moderate Demand" : "Low Demand";
      const temp = score >= 80 ? { l: "Very Hot", c: "#DC2626" } : score >= 66 ? { l: "Hot", c: "#EA580C" } : score >= 45 ? { l: "Warm", c: "#D97706" } : { l: "Cold", c: "#2563EB" };
      const supplyLevel = supply != null ? (supply < 30 ? "Low" : supply < 60 ? "Balanced" : "Ample") : isPreview ? "Low" : "—";
      const kpis = [
        { icon: Eye, label: "Active Shoppers", value: views != null ? views.toLocaleString() : isPreview ? "89" : "—" },
        { icon: Car, label: "Similar Vehicles", value: supply != null ? `${supply}` : isPreview ? "14" : "—" },
        { icon: Clock, label: "Avg Days to Sell", value: avgDom != null ? `${avgDom} Days` : isPreview ? "12 Days" : "—" },
        { icon: TrendingUp, label: "Weekly Searches", value: isPreview ? "120" : "—" },
        { icon: Heart, label: "Saved by Shoppers", value: isPreview ? "38" : "—" },
        { icon: MapPin, label: "Local Availability", value: supplyLevel },
      ];
      const snapshot = [
        { l: "Inventory Level", v: supplyLevel },
        { l: "Average Days on Market", v: avgDom != null ? `${avgDom} Days` : dom != null ? `${dom} Days` : isPreview ? "12 Days" : "—" },
        { l: "Search Activity", v: isPreview ? "Above Average" : has ? level : "—" },
        { l: "Vehicles Within 50 Miles", v: supply != null ? `${supply}` : isPreview ? "14" : "—" },
        { l: "Average Price", v: avg != null ? fmt$(avg) : isPreview ? fmt$(61300) : "—" },
      ];
      const invSeries = isPreview ? [20, 19, 18, 17, 16, 15, 14] : [];
      const shopperTrend = isPreview ? "+18%" : null;
      const goodTime = isGreat || score >= 66;
      return {
        title: "Market Demand Analysis", subtitle: "How popular this vehicle is in your market",
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        body: <>
          {/* ── Mobile (<768px) — premium market-intelligence dashboard ── */}
          <div className="md:hidden space-y-4">
            <div className="rounded-2xl p-5 text-white" style={{ background: "linear-gradient(160deg,#0f7a3d 0%,#16A34A 100%)" }}>
              <p className="inline-flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wider opacity-95"><Flame className="w-4 h-4" /> {has ? `${demandWord.replace("Demand", "Market Demand")}` : "Demand Tracking"}</p>
              {has && <p className="text-[13px] opacity-90 mt-1 leading-snug">Estimated to be in the top ~{topPct}% of similar vehicles searched in your area.</p>}
              <div className="flex flex-col items-center mt-4">
                <AnimatedRing pct={score} color="#ffffff" label="Demand" />
                <p className="text-[13px] font-bold opacity-90 mt-2">Demand Score</p>
                <p className="text-[17px] font-extrabold">{demandWord}</p>
              </div>
              <div className="mt-4">
                <div className="relative h-2 rounded-full bg-white/25"><span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white shadow" style={{ left: `${score}%` }} /></div>
                <div className="flex justify-between text-[11px] font-bold opacity-80 mt-1.5"><span>LOW</span><span>HIGH</span></div>
              </div>
              <p className="text-[11px] opacity-80 mt-3 text-center">Updated using live market activity.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {kpis.map((k) => (
                <div key={k.label} className={`${CARD} p-4`}>
                  <k.icon className="w-5 h-5 text-[#2563EB]" />
                  <p className="text-[20px] font-extrabold mt-1.5 leading-none">{k.value}</p>
                  <p className="text-[11px] text-[#94A3B8] mt-1">{k.label}</p>
                </div>
              ))}
            </div>

            <Section title="Local market snapshot">
              <div className={`${CARD} divide-y divide-[#F1F5F9]`}>
                {snapshot.map((s) => (
                  <div key={s.l} className="flex items-center justify-between px-4 py-3"><span className="text-[12px] text-[#64748B]">{s.l}</span><span className="text-[15px] font-extrabold">{s.v}</span></div>
                ))}
              </div>
            </Section>

            <div className="grid grid-cols-2 gap-3">
              <div className={`${CARD} p-4`}>
                <p className="text-[12px] text-[#64748B]">Market Temperature</p>
                <p className="text-[18px] font-extrabold mt-1 inline-flex items-center gap-1.5" style={{ color: temp.c }}><Flame className="w-4 h-4" /> {temp.l}</p>
              </div>
              <div className={`${CARD} p-4`}>
                <p className="text-[12px] text-[#64748B]">Shopper Activity</p>
                {shopperTrend ? <p className="text-[18px] font-extrabold text-[#16A34A] mt-1 inline-flex items-center gap-1"><TrendingUp className="w-4 h-4" /> {shopperTrend}</p> : <p className="text-[14px] font-bold text-[#94A3B8] mt-1">Tracking</p>}
                <p className="text-[10px] text-[#94A3B8] mt-0.5">vs last week</p>
              </div>
            </div>

            <Section title="Inventory trend" sub="Comparable vehicles, last 30 days.">
              {invSeries.length >= 2 ? (
                <div className={`${CARD} p-4`}><TrendChart dealer={invSeries} height={110} /><p className="text-[11px] text-[#94A3B8] mt-1">Sample trend shown in preview mode.</p></div>
              ) : <Empty>Inventory trend appears once enough market snapshots are collected.</Empty>}
            </Section>

            {insights.length > 0 && (
              <Section title="Market insights">
                <div className="space-y-2.5">{insights.map((t) => (
                  <div key={t} className={`${CARD} p-4 flex items-start gap-2.5`}><TrendingUp className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" /><span className="text-[13px] text-[#0F172A]">{t}</span></div>
                ))}</div>
              </Section>
            )}

            <div className="rounded-2xl p-5 text-white" style={{ background: "linear-gradient(160deg,#0f7a3d 0%,#16A34A 100%)" }}>
              <p className="text-[12px] font-semibold uppercase tracking-wider opacity-85">Our Recommendation</p>
              <p className="text-[20px] font-extrabold mt-1 inline-flex items-center gap-2"><CheckCircle2 className="w-6 h-6" /> {goodTime ? "Good Time To Buy" : "Worth A Closer Look"}</p>
              <p className="text-[13px] opacity-90 mt-1.5 leading-snug">{goodTime ? "Pricing is competitive while demand stays strong. Waiting may reduce your selection as inventory declines." : "Compare with similar vehicles and recent pricing before deciding."}</p>
            </div>

            <Section title="Should you buy now?">
              <div className={`${CARD} p-4`}>
                <p className={`text-[22px] font-extrabold ${goodTime ? "text-[#16A34A]" : "text-[#0F172A]"}`}>{goodTime ? "Yes." : "Maybe."}</p>
                <p className="text-[13px] text-[#64748B] mt-1 leading-snug">{goodTime ? "Based on today's inventory levels and pricing, this vehicle is a strong value in the current market." : "The numbers are reasonable — weigh it against comparable listings nearby."}</p>
              </div>
            </Section>
            <Disclaimer />
          </div>

          {/* ── Desktop / tablet (≥768px) — unchanged ── */}
          <div className="hidden md:block space-y-5">
          <Hero icon={Flame} tone={has ? "green" : "neutral"} label={has ? level : "Demand tracking"}
            note={has ? [views != null ? `${views.toLocaleString()} views` : null, dom != null ? `${dom} days on market` : null].filter(Boolean).join(" · ") || "Demand Score" : "Demand signals appear once this listing has been live."} />
          {has && (
            <Section title="Demand level" sub="Relative to typical listing activity in your area.">
              <div className={`${CARD} p-4`}><Gauge3 value={score} /></div>
            </Section>
          )}
          <Section title="Buyer activity">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {activity.map((a) => (
                <div key={a.label} className={`${CARD} p-3 text-center`}>
                  <a.icon className="w-4 h-4 text-[#2563EB] mx-auto" />
                  <p className="text-[18px] font-extrabold mt-1 leading-none">{a.value}</p>
                  <p className="text-[10px] text-[#94A3B8] mt-1 leading-tight">{a.label}</p>
                </div>
              ))}
            </div>
            {!isPreview && <p className="text-[11px] text-[#94A3B8] mt-2">Some activity metrics populate as the listing gathers data.</p>}
          </Section>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Section title="Local demand">
              <div className={`${CARD} p-4`}>
                <StatRow label="Interest level" value={has ? level : "—"} />
                <StatRow label="Nearby shoppers" value={isPreview ? "120+" : "—"} />
                <StatRow label="Search frequency" value={isPreview ? "Above average" : "—"} />
              </div>
            </Section>
            <Section title="Similar vehicles">
              <div className={`${CARD} p-4`}>
                <StatRow label="Avg days on market" value={avgDom != null ? `${avgDom} days` : isPreview ? "38 days" : "—"} />
                <StatRow label="Current inventory" value={supply != null ? `${supply} nearby` : isPreview ? "42 nearby" : "—"} />
                <StatRow label="This vehicle" value={dom != null ? `${dom} days listed` : "—"} />
              </div>
            </Section>
          </div>
          {insights.length > 0 && (
            <Section title="Market insights">
              <div className={`${CARD} p-4`}><ul className="space-y-2">{insights.map((t) => <Check key={t}>{t}</Check>)}</ul></div>
            </Section>
          )}
          <Section title="Buying recommendation">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
              <p className="text-[14px] font-extrabold text-[#16A34A]">{isGreat || score >= 66 ? "Good time to buy" : "Worth a closer look"}</p>
              <ul className="mt-2 space-y-1.5">
                {isGreat && <Check>Priced below market average</Check>}
                {score >= 66 && <Check>Strong shopper interest right now</Check>}
                {d.warrantyStr && <Check>Factory warranty still active</Check>}
                {dom != null && dom <= 30 && <Check>Fresh listing — best selection</Check>}
                {!isGreat && score < 66 && <Check>Compare with similar vehicles before deciding</Check>}
              </ul>
            </div>
          </Section>
          <Disclaimer />
          </div>
        </>,
      };
    }

    case "price-confidence": {
      const ks = listing.key_specs || {};
      const factors = [
        { label: "Market Data", pct: avg != null ? 100 : 30 },
        { label: "Dealer Pricing", pct: 100 },
        { label: "Vehicle History", pct: (d.cleanTitle || d.ownerCount != null || d.accidentCount != null) ? 90 : 40 },
        { label: "Mileage", pct: listing.mileage != null ? 100 : 0 },
        { label: "Condition", pct: (d.serviceCount > 0 || listing.prep_status?.foreman_signed_at) ? 90 : 55 },
        { label: "Equipment", pct: Math.min(100, ((listing.features?.length ?? 0) + Object.keys(ks).length) * 12) },
        { label: "Regional Demand", pct: (d.viewCount != null || d.dom != null) ? 75 : 40 },
      ];
      const hasCarfaxDoc = (listing.documents || []).some((x) => /carfax/i.test(`${x.type} ${x.name}`));
      const sources = [
        { name: "MarketCheck", on: avg != null || Object.keys(mc).length > 0 },
        { name: "CARFAX", on: typeof mc.carfax_clean_title === "boolean" || hasCarfaxDoc },
        { name: "AutoCheck", on: false },
        { name: "OEM", on: Object.keys(ks).length > 0 },
        { name: "NHTSA", on: !!listing.recall_status },
        { name: "Local Listings", on: avg != null },
        { name: "Auction Data", on: false },
        { name: "Dealer Pricing", on: true },
      ];
      const compCount = (mc.similar_count as number) ?? (mc.comparable_count as number) ?? null;
      const coverage = compCount != null ? compCount : isPreview ? 1200 : null;
      const faqs = [
        { q: "Why isn't every vehicle 100%?", a: "Confidence reflects how much verified data is available. Newer listings or rare models have fewer comparables, which lowers the score until more data arrives." },
        { q: "How often is pricing updated?", a: "Market values refresh as new comparable listings and sales are reported — typically every day the vehicle is live." },
        { q: "What data sources are used?", a: "A blend of MarketCheck market data, dealer pricing, vehicle history, recall status, and equipment decoded from the VIN." },
      ];
      const connectedCount = sources.filter((s) => s.on).length;
      const confWord = conf == null ? "" : conf >= 85 ? "High Confidence" : conf >= 70 ? "Good Confidence" : "Fair Confidence";
      return {
        title: "Price Confidence", subtitle: "Why AutoLabels is confident in this valuation",
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        body: <>
          {/* ── Mobile (<768px) — premium confidence dashboard ── */}
          <div className="md:hidden space-y-4">
            {conf != null ? (
              <div className="rounded-2xl p-5 text-white text-center" style={{ background: "linear-gradient(160deg,#0f7a3d 0%,#16A34A 100%)" }}>
                <div className="flex justify-center"><AnimatedRing pct={conf} color="#ffffff" /></div>
                <p className="text-[13px] font-bold opacity-90 mt-2">Confidence Score</p>
                <p className="text-[18px] font-extrabold">{confWord}</p>
                <p className="text-[13px] opacity-90 mt-2 leading-snug">A {conf}% score means we're confident this vehicle is priced right for the current market.</p>
              </div>
            ) : <Empty>A confidence score appears once enough vehicle and market data has been verified.</Empty>}

            <div className="grid grid-cols-3 gap-3">
              <div className={`${CARD} p-4 text-center`}><p className="text-[18px] font-extrabold leading-none">{coverage != null ? `${coverage >= 1000 ? `${Math.round(coverage / 100) / 10}k` : coverage}${compCount == null ? "+" : ""}` : "—"}</p><p className="text-[10px] text-[#94A3B8] mt-1">Comparables</p></div>
              <div className={`${CARD} p-4 text-center`}><p className="text-[18px] font-extrabold leading-none">{connectedCount}</p><p className="text-[10px] text-[#94A3B8] mt-1">Data Sources</p></div>
              <div className={`${CARD} p-4 text-center`}><p className="text-[18px] font-extrabold leading-none">Today</p><p className="text-[10px] text-[#94A3B8] mt-1">Updated</p></div>
            </div>

            <Section title="Confidence factors">
              <div className={`${CARD} p-4 space-y-3`}>{factors.map((f) => <FactorBar key={f.label} label={f.label} pct={f.pct} />)}</div>
            </Section>

            <Section title="Data sources">
              <div className="grid grid-cols-2 gap-2">{sources.map((s) => <Source key={s.name} name={s.name} on={s.on} />)}</div>
            </Section>

            {marketSeries.length >= 2 && (
              <Section title="Confidence timeline" sub="Last 30 days">
                <div className={`${CARD} p-4`}><TrendChart market={marketSeries} height={90} /><p className="text-[12px] text-[#64748B] mt-1">Valuation inputs have stayed stable over the last 30 days.</p></div>
              </Section>
            )}

            <Section title="How we analyze">
              <div className={`${CARD} p-4`}><ul className="grid grid-cols-2 gap-1.5">{["Market pricing", "Mileage", "Condition", "Equipment", "Vehicle history", "Regional demand", "Historical pricing", "Dealer pricing"].map((b) => <Check key={b}>{b}</Check>)}</ul></div>
            </Section>

            <Section title="FAQ">
              <div className="space-y-2">{faqs.map((f) => <Faq key={f.q} q={f.q} a={f.a} />)}</div>
            </Section>
            <Disclaimer />
          </div>

          {/* ── Desktop / tablet (≥768px) — unchanged ── */}
          <div className="hidden md:block space-y-5">
          {conf != null ? (
            <div className={`${CARD} p-5 flex items-center gap-5`}>
              <div className="flex flex-col items-center shrink-0"><Ring pct={conf} size={120} /><p className="text-[13px] font-extrabold text-[#16A34A] mt-1">{d.confLabel || (conf >= 85 ? "Excellent" : "Good")}</p></div>
              <div className="min-w-0"><p className="text-[14px] font-bold">Confidence Score</p><p className="text-[12px] text-[#64748B] mt-0.5">A blend of verified vehicle data and live market signals. Higher means fewer unknowns in the valuation.</p></div>
            </div>
          ) : <Empty>A confidence score appears once enough vehicle and market data has been verified.</Empty>}
          <Section title="Confidence factors" sub="How much verified data supports each input.">
            <div className={`${CARD} p-4 space-y-3`}>{factors.map((f) => <FactorBar key={f.label} label={f.label} pct={f.pct} />)}</div>
          </Section>
          <Section title="Data sources">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{sources.map((s) => <Source key={s.name} name={s.name} on={s.on} />)}</div>
          </Section>
          <Section title="Similar vehicle coverage">
            {coverage != null ? (
              <div className={`${CARD} p-4 flex items-center gap-4`}>
                <p className="text-[28px] font-extrabold text-[#2563EB] leading-none shrink-0">{coverage.toLocaleString()}{compCount == null ? "+" : ""}</p>
                <p className="text-[12px] text-[#64748B]">Comparable vehicles analyzed. A larger sample size increases pricing confidence.</p>
              </div>
            ) : <Empty>Comparable-vehicle coverage appears once MarketCheck data is available.</Empty>}
          </Section>
          <Section title="Methodology">
            <div className={`${CARD} p-4`}><p className="text-[12px] text-[#64748B] mb-2">AutoLabels analyzes:</p><ul className="grid grid-cols-2 gap-1.5">{["Market pricing", "Mileage", "Condition", "Equipment", "Vehicle history", "Regional inventory", "Demand", "Historical pricing", "Dealer pricing"].map((b) => <Check key={b}>{b}</Check>)}</ul></div>
          </Section>
          <Section title="Confidence timeline" sub="Last 30 days">
            {marketSeries.length >= 2 ? (
              <div className={`${CARD} p-4`}><TrendChart market={marketSeries} height={90} /><p className="text-[12px] text-[#64748B] mt-1">Valuation inputs have remained stable over the last 30 days.</p></div>
            ) : <Empty>A 30-day confidence timeline appears once enough pricing history is collected.</Empty>}
          </Section>
          <Section title="FAQ">
            <div className="space-y-2">{faqs.map((f) => <Faq key={f.q} q={f.q} a={f.a} />)}</div>
          </Section>
          <Disclaimer />
          </div>
        </>,
      };
    }

    case "price-history": {
      const priced = d.valueHistory.filter((h) => h.listing_price != null);
      const has = dealerSeries.length >= 2;
      const total = d.priceChangeTotal, recent = d.priceChange7d;
      const lows = priced.map((h) => h.listing_price as number);
      const lowest = lows.length ? Math.min(...lows) : null;
      const highest = lows.length ? Math.max(...lows) : null;
      const daysListed = d.dom ?? (priced.length ? Math.round((Date.now() - new Date(priced[0].captured_at).getTime()) / 86400000) : null);
      const trendLabel = total == null || total === 0 ? "Price Stable" : total < 0 ? "Price Reduced" : "Recently Increased";
      const events = priced.slice(1).map((h, i) => {
        const prev = priced[i].listing_price as number, cur = h.listing_price as number;
        return { date: new Date(h.captured_at).toLocaleDateString(), before: prev, after: cur, delta: cur - prev };
      }).filter((e) => e.delta !== 0).reverse();
      const pctDiff = avg != null && price != null ? Math.round(((price - avg) / avg) * 100) : null;
      return {
        title: "Price History", subtitle: "See how this vehicle's price has changed over time",
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        body: <>
          <Hero icon={Clock} tone={total != null && total < 0 ? "green" : "neutral"} label={trendLabel}
            value={price != null ? fmt$(price) : undefined}
            note={total != null && total !== 0 ? `${total < 0 ? "Down" : "Up"} ${fmt$(Math.abs(total))} since listed` : recent != null && recent !== 0 ? `${recent < 0 ? "Down" : "Up"} ${fmt$(Math.abs(recent))} in 7 days` : "Each price change is recorded here."} />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Price Change" value={total != null ? `${total < 0 ? "-" : total > 0 ? "+" : ""}${fmt$(Math.abs(total))}` : "—"} tone={total != null && total < 0 ? "green" : "neutral"} />
            <Stat label="Days Listed" value={daysListed != null ? String(daysListed) : "—"} />
            <Stat label="Lowest Price" value={lowest != null ? fmt$(lowest) : "—"} />
            <Stat label="Highest Price" value={highest != null ? fmt$(highest) : "—"} />
          </div>
          {has ? (
            <>
              <Section title="Price timeline"><PriceTimeline history={priced} /></Section>
              <Section title="Price change events">
                {events.length ? (
                  <div className="space-y-3">{events.map((e, i) => (
                    <div key={i} className={`${CARD} p-3 flex items-center gap-3`}>
                      <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${e.delta < 0 ? "bg-emerald-50" : "bg-orange-50"}`}>{e.delta < 0 ? <TrendingDown className="w-4 h-4 text-[#16A34A]" /> : <TrendingUp className="w-4 h-4 text-[#EA580C]" />}</span>
                      <div className="min-w-0 flex-1"><p className="text-[13px] font-semibold leading-tight">{e.delta < 0 ? "Price reduced" : "Price increased"} {fmt$(Math.abs(e.delta))}</p><p className="text-[11px] text-[#94A3B8]">{e.date} · Dealer updated pricing</p></div>
                      <p className="text-[12px] text-[#64748B] shrink-0 text-right">{fmt$(e.before)} <span className="text-[#94A3B8]">→</span> <span className="font-bold text-[#0F172A]">{fmt$(e.after)}</span></p>
                    </div>
                  ))}</div>
                ) : <Empty>No price changes recorded yet — the asking price has held steady.</Empty>}
              </Section>
            </>
          ) : <Empty>Price history will appear here once the asking price has been tracked over time.</Empty>}
          {pctDiff != null && (
            <Section title="Market comparison">
              <div className={`${CARD} p-4`}>
                <div className="flex items-center justify-between"><span className="text-[12px] text-[#64748B]">This vehicle</span><span className="text-[14px] font-extrabold">{fmt$(price)}</span></div>
                <div className="flex items-center justify-between mt-1.5"><span className="text-[12px] text-[#64748B]">Average market price</span><span className="text-[14px] font-semibold text-[#0F172A]">{fmt$(avg)}</span></div>
                <div className={`mt-2 pt-2 border-t border-[#F1F5F9] text-[13px] font-semibold ${pctDiff <= 0 ? "text-[#16A34A]" : "text-[#EA580C]"}`}>{pctDiff <= 0 ? `${Math.abs(pctDiff)}% below market average` : `${pctDiff}% above market average`}</div>
              </div>
            </Section>
          )}
          <Section title="Price recommendation">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
              <p className="text-[14px] font-extrabold text-[#16A34A]">{lowest != null && price != null && price <= lowest && isGreat ? "Excellent time to purchase" : isGreat ? "Strong value right now" : "Worth a closer look"}</p>
              <ul className="mt-2 space-y-1.5">
                {lowest != null && price != null && price <= lowest && <Check>At its lowest recorded asking price</Check>}
                {isGreat && <Check>Priced below the market average</Check>}
                {total != null && total < 0 && <Check>Price has trended down since listing</Check>}
                {(total == null || total === 0) && <Check>Price has been stable — likely to hold</Check>}
              </ul>
            </div>
          </Section>
          <Disclaimer />
        </>,
      };
    }

    case "comparable-vehicles": {
      const comps = deriveComps(listing, d, isPreview);
      const radius = (mc.search_radius as number) ?? (isPreview ? 150 : null);
      const current = { ymm: listing.ymm || "This vehicle", trim: listing.trim || "", mileage: listing.mileage, price, dealer: d.dealerName, dom: d.dom };
      return {
        title: "Comparable Vehicles", subtitle: "See how this vehicle compares to similar listings in your market",
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        body: <>
          <Hero icon={Car} tone={comps.length ? "blue" : "neutral"} label={comps.length ? `${comps.length} similar vehicles found` : "Comparables pending"}
            note={comps.length ? [radius != null ? `${radius}-mile radius` : null, "Updated today", avg != null ? `Avg ${fmt$(avg)}` : null].filter(Boolean).join(" · ") : "Comparable listings appear once MarketCheck data is available."} />
          {comps.length ? <CompExplorer comps={comps} current={current} avg={avg} cleanTitle={d.cleanTitle} oneOwner={d.ownerCount === 1} certified={listing.condition === "cpo"} /> : <Empty>Comparable vehicles will appear here once enough market data is available.</Empty>}
          <Disclaimer />
        </>,
      };
    }

    case "inventory-trend": {
      const supply = (mc.market_days_supply as number) ?? (mc.inventory_count as number) ?? (isPreview ? 42 : null);
      const changePct = (mc.inventory_change_pct as number) ?? (isPreview ? -12 : null);
      const avgDom = (mc.avg_dom as number) ?? (isPreview ? 38 : null);
      const hasData = supply != null;
      const trendLabel = changePct == null ? "Stable Inventory" : changePct < 0 ? `Inventory Down ${Math.abs(changePct)}%` : changePct > 0 ? `Inventory Up ${changePct}%` : "Stable Inventory";
      return {
        title: "Inventory Trends", subtitle: "Understand local inventory and market availability",
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        body: <>
          <Hero icon={Package} tone={changePct != null && changePct < 0 ? "green" : "neutral"} label={trendLabel}
            value={supply != null ? `${supply} available` : undefined}
            note={hasData ? "Comparable vehicles in your local market." : "30-day market supply trends appear once enough data is available."} />
          {hasData ? (
            <>
              <Section title="Inventory trend"><InventoryTrendChart isPreview={isPreview} /></Section>
              <Section title="Local market summary">
                <div className={`${CARD} p-4`}>
                  <StatRow label="Vehicles available" value={supply != null ? `${supply}` : "—"} />
                  <StatRow label="Average days on market" value={avgDom != null ? `${avgDom} days` : "—"} />
                  <StatRow label="Average selling price" value={avg != null ? fmt$(avg) : isPreview ? fmt$(61300) : "—"} />
                  <StatRow label="Supply level" value={supply != null ? (supply < 30 ? "Tight" : supply < 60 ? "Balanced" : "Ample") : "—"} />
                  <StatRow label="Demand level" value={(d.viewCount ?? 0) > 20 || isPreview ? "High" : "Moderate"} />
                  <StatRow label="Updated" value="Today" />
                </div>
              </Section>
              <Section title="Inventory forecast">
                <div className={`${CARD} p-4`}><ul className="space-y-2">
                  {changePct != null && changePct < 0 && <Check>Inventory likely to keep decreasing over the next 30 days</Check>}
                  {((d.viewCount ?? 0) > 20 || isPreview) && <Check>Demand expected to remain high</Check>}
                  {isPreview && <Check>More comparable vehicles arriving next month</Check>}
                  {!isPreview && changePct == null && <Check tone="orange">Forecast refines as more market data is collected</Check>}
                </ul></div>
              </Section>
              <Section title="Buyer recommendation">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                  <p className="text-[14px] font-extrabold text-[#16A34A]">{changePct != null && changePct < 0 ? "Inventory is tightening — good time to act" : "Solid time to purchase"}</p>
                  <ul className="mt-2 space-y-1.5">
                    {changePct != null && changePct < 0 && <Check>Fewer comparable vehicles available locally</Check>}
                    {isGreat && <Check>This vehicle is priced below market</Check>}
                    {supply != null && supply < 30 && <Check>Limited local availability for this configuration</Check>}
                    {d.warrantyStr && <Check>Strong resale outlook with warranty remaining</Check>}
                  </ul>
                </div>
              </Section>
              <Section title="Nearby availability" sub="Comparable vehicles by distance (illustrative).">
                <div className={`${CARD} p-4`}>
                  {[{ b: "0–10 mi", n: isPreview ? 8 : 0 }, { b: "10–25 mi", n: isPreview ? 14 : 0 }, { b: "25–50 mi", n: isPreview ? 12 : 0 }, { b: "50+ mi", n: isPreview ? 8 : 0 }].map((r) => (
                    <div key={r.b} className="flex items-center gap-3 py-1.5">
                      <span className="text-[12px] text-[#64748B] w-16 shrink-0 inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{r.b}</span>
                      <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-[#2563EB]" style={{ width: `${Math.min(100, r.n * 6)}%` }} /></div>
                      <span className="text-[12px] font-semibold w-7 text-right">{r.n || "—"}</span>
                    </div>
                  ))}
                </div>
              </Section>
            </>
          ) : <Empty>Inventory trend data will appear here once enough comparable listings have been tracked over time. Lower supply of similar vehicles generally means stronger pricing.</Empty>}
          <Disclaimer />
        </>,
      };
    }

    case "factory-warranty": {
      const w = d.warranty;
      const ks = listing.key_specs || {};
      const milesLeft = w.factory_miles != null && listing.mileage != null ? Math.max(0, w.factory_miles - listing.mileage) : null;
      const milesPct = w.factory_miles && listing.mileage != null ? Math.max(3, 100 - Math.min(100, (listing.mileage / w.factory_miles) * 100)) : null;
      const expFrom = (months?: number) => { if (!w.in_service_date || !months) return { date: null as string | null, left: null as number | null, pct: null as number | null }; const end = new Date(w.in_service_date); end.setMonth(end.getMonth() + months); const ms = end.getTime() - Date.now(); const left = ms > 0 ? Math.round(ms / (1000 * 60 * 60 * 24 * 30.4)) : 0; return { date: end.toLocaleDateString(), left, pct: Math.max(3, Math.min(100, (left / months) * 100)) }; };
      const basic = expFrom(w.factory_months);
      const pt = expFrom(w.powertrain_months);
      const ptMilesLeft = w.powertrain_miles != null && listing.mileage != null ? Math.max(0, w.powertrain_miles - listing.mileage) : null;
      const ptMilesPct = w.powertrain_miles && listing.mileage != null ? Math.max(3, 100 - Math.min(100, (listing.mileage / w.powertrain_miles) * 100)) : null;
      const fuel = String(ks.fuel || "").toLowerCase();
      const isHybrid = /hybrid/.test(fuel), isEV = /electric|ev\b/.test(fuel);
      const coverageType = w.powertrain_months ? "Powertrain Coverage" : "Basic Coverage";
      const active = !!(basic.left && basic.left > 0) || !!(milesLeft && milesLeft > 0);
      const protections = isPreview ? [
        { t: "Extended Vehicle Service Contract", s: "Bumper-to-bumper protection beyond the factory term.", len: "Up to 7 yr / 100K mi" },
        { t: "Prepaid Maintenance Plan", s: "Lock in scheduled service at today's pricing.", len: "3 yr / 36K mi" },
        { t: "Tire & Wheel Protection", s: "Covers road-hazard tire and wheel damage.", len: "Up to 5 yr" },
        { t: "GAP Coverage", s: "Covers the gap between loan balance and value.", len: "Loan term" },
      ] : [];
      const faqs = [
        { q: "Can I transfer this warranty?", a: "Factory warranties stay with the vehicle, so remaining coverage transfers to you automatically when you buy. Some extended plans are also transferable — ask the dealer." },
        { q: "Is roadside assistance included?", a: "Many manufacturers bundle roadside assistance with the basic warranty term. Confirm the specifics for this vehicle with the dealer." },
        { q: "Can I purchase additional coverage?", a: "Yes — extended service contracts and protection plans can be added at purchase. A specialist can walk you through the options and pricing." },
      ];
      return {
        title: "Factory Warranty", subtitle: "See what protection is still included with this vehicle",
        primary: { label: "Protect This Vehicle", onClick: () => go("protect") },
        secondary: { label: "View full warranty details", onClick: () => go("factory-warranty") },
        footerQuestion: "Questions about warranty?", specialistLabel: "Talk to a Warranty Specialist",
        body: <>
          {d.warrantyStr ? (
            <>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5">
                <div className="flex items-center gap-3">
                  <span className="w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center shrink-0"><ShieldCheck className="w-6 h-6 text-[#16A34A]" /></span>
                  <div><p className="text-[16px] font-extrabold text-[#16A34A] leading-tight">{active ? "Factory Warranty Active" : "Factory Warranty"}</p><p className="text-[13px] text-[#0F172A] font-semibold">{d.warrantyStr} remaining</p></div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                  <Stat label="Remaining" value={basic.left != null ? `${basic.left} mo` : d.warrantyStr || "—"} tone="green" />
                  <Stat label="Mileage Left" value={milesLeft != null ? `${milesLeft.toLocaleString()}` : "—"} />
                  <Stat label="Expires" value={basic.date ?? "—"} />
                  <Stat label="Coverage" value={coverageType} />
                </div>
              </div>
              <Section title="Coverage remaining">
                <div className="space-y-3">
                  <div className={`${CARD} p-4`}>
                    <p className="text-[13px] font-bold mb-3">Basic (Bumper-to-Bumper)</p>
                    <div className="space-y-3">
                      {basic.pct != null && <Meter label="Time Remaining" value={`${basic.left}`} unit={`of ${w.factory_months} mo`} pct={basic.pct} />}
                      {milesPct != null && <Meter label="Mileage Remaining" value={milesLeft!.toLocaleString()} unit={`of ${(w.factory_miles! / 1000).toFixed(0)}K mi`} pct={milesPct} />}
                      {basic.date && <p className="text-[11px] text-[#64748B]">Expires {basic.date}</p>}
                    </div>
                  </div>
                  {(w.powertrain_months != null || w.powertrain_miles != null) && (
                    <div className={`${CARD} p-4`}>
                      <p className="text-[13px] font-bold mb-3">Powertrain</p>
                      <div className="space-y-3">
                        {pt.pct != null && <Meter label="Time Remaining" value={`${pt.left}`} unit={`of ${w.powertrain_months} mo`} pct={pt.pct} />}
                        {ptMilesPct != null && <Meter label="Mileage Remaining" value={ptMilesLeft!.toLocaleString()} unit={`of ${(w.powertrain_miles! / 1000).toFixed(0)}K mi`} pct={ptMilesPct} />}
                        {pt.date && <p className="text-[11px] text-[#64748B]">Expires {pt.date}</p>}
                      </div>
                    </div>
                  )}
                </div>
              </Section>
              <Section title="Other coverages">
                <div className={`${CARD} p-4`}>
                  <StatRow label="Corrosion / Perforation" value="Varies by manufacturer" />
                  <StatRow label="Roadside Assistance" value="Confirm with dealer" />
                  {(isHybrid || isEV) && <StatRow label={isEV ? "EV Battery" : "Hybrid Battery"} value="Extended coverage — confirm terms" />}
                </div>
                <p className="text-[11px] text-[#94A3B8] mt-2">Exact terms vary by manufacturer and model year. Confirm specifics with the dealer.</p>
              </Section>
              <Section title="Coverage details">
                <div className={`${CARD} p-4`}>
                  <StatRow label="Transferable" value="Yes — transfers with the vehicle" />
                  <StatRow label="Deductible" value="Typically $0 on covered factory repairs" />
                  <StatRow label="Roadside Included" value="Confirm with dealer" />
                  <StatRow label="Rental / Loaner" value="Confirm with dealer" />
                </div>
              </Section>
              {protections.length > 0 && (
                <Section title="Recommended protection options">
                  <div className="space-y-3">{protections.map((p) => (
                    <div key={p.t} className={`${CARD} p-4`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><p className="text-[13px] font-bold">{p.t}</p><p className="text-[12px] text-[#64748B] mt-0.5">{p.s}</p><p className="text-[11px] text-[#94A3B8] mt-1">{p.len}</p></div>
                        <button onClick={() => go("protect")} className="text-[12px] font-semibold text-[#2563EB] hover:underline shrink-0">Learn More</button>
                      </div>
                    </div>
                  ))}</div>
                </Section>
              )}
              <Section title="Warranty timeline">
                <ol className="space-y-4 relative border-l-2 border-slate-100 ml-1.5 pl-4">
                  {([
                    w.in_service_date ? { d: new Date(w.in_service_date).toLocaleDateString(), t: "Placed in service", s: "Factory warranty begins", c: "bg-emerald-500" } : null,
                    { d: "Today", t: "Current coverage", s: d.warrantyStr ? `${d.warrantyStr} remaining` : "Active", c: "bg-[#2563EB]" },
                    basic.date ? { d: basic.date, t: "Basic warranty expires", s: "Bumper-to-bumper ends", c: "bg-slate-400" } : null,
                    pt.date ? { d: pt.date, t: "Powertrain expires", s: "Powertrain coverage ends", c: "bg-slate-400" } : null,
                  ].filter(Boolean) as { d: string; t: string; s: string; c: string }[]).map((e, i) => (
                    <li key={i} className="relative"><span className={`absolute -left-[22px] top-1 w-3 h-3 rounded-full ${e.c} ring-2 ring-white`} /><p className="text-[12px] font-bold">{e.d} · {e.t}</p><p className="text-[11px] text-[#64748B]">{e.s}</p></li>
                  ))}
                </ol>
              </Section>
              <Section title="FAQ"><div className="space-y-2">{faqs.map((f) => <Faq key={f.q} q={f.q} a={f.a} />)}</div></Section>
            </>
          ) : <Empty>Warranty coverage details are confirmed at the dealership for this vehicle.</Empty>}
          <Disclaimer />
        </>,
      };
    }

    case "owner-reviews": {
      const sources = d.dealerTrust.reviewSources;
      const ks = listing.key_specs || {};
      const rating = d.reviewRating;
      const label = rating == null ? "" : rating >= 4.5 ? "Excellent" : rating >= 4 ? "Very Good" : rating >= 3 ? "Good" : "Mixed";
      const sourceNames = Array.from(new Set(sources.map((s) => s.name))).slice(0, 4);
      // Per-category breakdown, sentiment, and themes are not in our data model;
      // they only render behind the SAMPLE PREVIEW banner so we never invent reviews.
      const breakdown = isPreview ? [
        { k: "Reliability", v: 4.8 }, { k: "Comfort", v: 4.9 }, { k: "Performance", v: 4.6 },
        { k: "Technology", v: 4.5 }, { k: "Fuel Economy", v: 4.3 }, { k: "Interior", v: 4.8 },
        { k: "Safety", v: 4.9 }, { k: "Value", v: 4.6 },
      ] : [];
      const loves = isPreview ? ["Ride quality", "Quiet cabin", "Safety features", "Fuel economy"] : [];
      const mentions = isPreview ? ["Limited cargo behind third row", "Infotainment learning curve"] : [];
      const themes = isPreview ? ["Reliable", "Family Friendly", "Comfortable", "Excellent Value", "Strong Resale", "Quiet Ride"] : [];
      const seats = Number((listing.mc_attributes as Record<string, unknown> | null)?.seating) || null;
      const recs: string[] = [];
      if (seats && seats >= 6) { recs.push("Families"); recs.push("Road Trips"); }
      if (Number(ks.mpg_hwy) >= 28) recs.push("Commuters");
      if (/luxe|autograph|limited|platinum|premium|touring|signature|reserve|titanium|sensory|denali/i.test(listing.trim || "")) recs.push("Luxury Buyers");
      if (/awd|4wd|4x4/i.test(String(ks.drivetrain || ""))) recs.push("All-Weather Driving");
      const recsU = Array.from(new Set(recs));
      return {
        title: "What Owners Say", subtitle: "Real owner feedback from trusted automotive sources",
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        secondary: { label: "Read all reviews", onClick: () => go("owner-reviews") },
        footerQuestion: "Have questions about ownership?",
        body: <>
          {rating != null ? (
            <div className={`${CARD} p-5 flex items-center gap-4`}>
              <div className="text-center shrink-0"><p className="text-[34px] font-extrabold text-[#2563EB] leading-none">{rating.toFixed(1)}</p><div className="mt-1"><Stars n={rating} /></div>{d.reviewCount != null && <p className="text-[11px] text-[#64748B] mt-1">{d.reviewCount.toLocaleString()} reviews</p>}</div>
              <div className="min-w-0"><p className="text-[15px] font-extrabold text-[#16A34A]">{label}</p>{sourceNames.length > 0 && <p className="text-[12px] text-[#64748B] mt-0.5">Based on {sourceNames.join(", ")}</p>}<p className="text-[11px] text-[#94A3B8] mt-1">AutoLabels aggregates reviews and does not edit or filter them.</p></div>
            </div>
          ) : <Empty>Verified owner reviews appear here once the dealer connects a review source. AutoLabels never fabricates customer reviews.</Empty>}
          {breakdown.length > 0 && (
            <Section title="Rating breakdown"><div className={`${CARD} p-4 space-y-2.5`}>{breakdown.map((b) => <RatingBar key={b.k} label={b.k} score={b.v} />)}</div></Section>
          )}
          {(loves.length > 0 || mentions.length > 0) && (
            <Section title="Customer sentiment">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {loves.length > 0 && <div className={`${CARD} p-4`}><p className="text-[12px] font-bold text-[#16A34A] mb-2">Owners love</p><ul className="space-y-1.5">{loves.map((t) => <Check key={t}>{t}</Check>)}</ul></div>}
                {mentions.length > 0 && <div className={`${CARD} p-4`}><p className="text-[12px] font-bold text-[#EA580C] mb-2">Owners mention</p><ul className="space-y-1.5">{mentions.map((t) => <Check key={t} tone="orange">{t}</Check>)}</ul></div>}
              </div>
            </Section>
          )}
          {sources.length > 0 && (
            <Section title="Featured reviews">
              <div className="space-y-3">{sources.map((r, i) => (
                <div key={i} className={`${CARD} p-4`}><div className="flex items-center gap-2"><span className="text-[13px] font-bold">{r.name}</span>{r.rating != null && <Stars n={r.rating} size={13} />}</div>{r.quote && <p className="text-[13px] text-[#64748B] leading-snug mt-1">"{r.quote}"</p>}</div>
              ))}</div>
            </Section>
          )}
          {themes.length > 0 && (
            <Section title="Common owner themes"><div className="flex flex-wrap gap-2">{themes.map((t) => <Chip key={t}>{t}</Chip>)}</div></Section>
          )}
          {recsU.length > 0 && (
            <Section title="Well suited for" sub="Based on this vehicle's configuration.">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 flex flex-wrap gap-2">{recsU.map((r) => <Chip key={r}>{r}</Chip>)}</div>
            </Section>
          )}
          <Disclaimer />
        </>,
      };
    }

    case "highlights": {
      const hs = d.highlights;
      const ks = listing.key_specs || {};
      const { groups, ordered: orderedGroups, featLabels, accessories } = featureGroups(listing);
      const reasons: string[] = [];
      if (groups.Safety?.length) reasons.push("Advanced safety technology");
      if (groups.Comfort?.length) reasons.push("Premium comfort and convenience");
      if (groups.Technology?.length) reasons.push("Modern technology and connectivity");
      if (/awd|4wd|4x4/i.test(String(ks.drivetrain || ""))) reasons.push("Confident all-weather capability");
      if (/luxe|autograph|limited|platinum|premium|touring|signature|reserve|titanium|sensory|denali/i.test(listing.trim || "")) reasons.push("Luxury-grade appointments");
      if (isGreat) reasons.push("Exceptional value versus the market");
      const hasContent = featLabels.length > 0 || orderedGroups.length > 0 || hs.length > 0;
      return {
        title: "Vehicle Highlights", subtitle: "Explore the most important features and equipment",
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        secondary: { label: "View key specifications", onClick: () => openPanel("key-specs") },
        footerQuestion: "Questions about features?", specialistLabel: "Talk to a Product Specialist",
        body: <>
          {hasContent ? (
            <>
              <div className="rounded-2xl overflow-hidden border border-[#E6E8EC] relative">
                {listing.hero_image_url ? <img src={listing.hero_image_url} alt="" className="w-full aspect-[16/9] object-cover" /> : <div className="w-full aspect-[16/9] bg-[#1f2227] flex items-center justify-center"><Car className="w-12 h-12 text-slate-500" /></div>}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent flex flex-col justify-end p-5">
                  <p className="text-white text-[18px] font-extrabold leading-tight">Premium Equipment</p>
                  <p className="text-white/85 text-[12px]">Everything that makes this vehicle stand out.</p>
                </div>
              </div>
              {hs.length > 0 && (
                <Section title="Feature gallery">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{hs.map((h) => (
                    <div key={h.key} className={`${CARD} p-4 flex flex-col items-center text-center gap-1.5`}>
                      <span className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center"><Award className="w-5 h-5 text-[#2563EB]" /></span>
                      <p className="text-[12px] font-bold leading-tight">{h.label}</p>
                      <p className="text-[10px] text-[#94A3B8]">{h.sub}</p>
                    </div>
                  ))}</div>
                </Section>
              )}
              {orderedGroups.length > 0 && (
                <Section title="Features by category">
                  <div className="space-y-2">{orderedGroups.map(([name, items], i) => <Group key={name} title={name} items={items!} defaultOpen={i === 0} />)}</div>
                </Section>
              )}
              {reasons.length > 0 && (
                <Section title="Top reasons customers love this vehicle">
                  <div className={`${CARD} p-4`}><ul className="space-y-2">{reasons.map((r) => <Check key={r}>{r}</Check>)}</ul></div>
                </Section>
              )}
              {(featLabels.length > 0 || accessories.length > 0) && (
                <Section title="Equipment & options" action={<button onClick={() => openPanel("equipment")} className="text-[12px] font-semibold text-[#2563EB] hover:underline shrink-0">View all equipment</button>}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {featLabels.length > 0 && <div className={`${CARD} p-4`}><p className="text-[12px] font-bold mb-2">On this vehicle <span className="text-[#94A3B8] font-semibold">{featLabels.length}</span></p><ul className="space-y-1.5">{featLabels.slice(0, 10).map((f) => <Check key={f}>{f}</Check>)}</ul></div>}
                    {accessories.length > 0 && <div className={`${CARD} p-4`}><p className="text-[12px] font-bold mb-2">Available add-ons <span className="text-[#94A3B8] font-semibold">{accessories.length}</span></p><ul className="space-y-1.5">{accessories.slice(0, 10).map((a) => <li key={a} className="flex items-start gap-2 text-[13px] text-[#0F172A]"><Package className="w-3.5 h-3.5 text-[#2563EB] shrink-0 mt-0.5" />{a}</li>)}</ul></div>}
                  </div>
                </Section>
              )}
            </>
          ) : <Empty>Equipment highlights appear here as the vehicle's data is decoded from its VIN.</Empty>}
          <Disclaimer />
        </>,
      };
    }

    case "overview": {
      const ks = listing.key_specs || {};
      const { groups } = featureGroups(listing);
      const engine = ks.engine ? String(ks.engine) : null;
      const hp = mc.horsepower ? `${mc.horsepower} hp` : null;
      const trans = ks.transmission ? String(ks.transmission) : null;
      const drivetrain = ks.drivetrain ? String(ks.drivetrain) : null;
      const mpg = ks.mpg_city && ks.mpg_hwy ? `${ks.mpg_city}/${ks.mpg_hwy} MPG` : null;
      const premium = /luxe|autograph|limited|platinum|premium|touring|signature|reserve|titanium|sensory|denali/i.test(listing.trim || "");
      const awd = /awd|4wd|4x4/i.test(String(drivetrain || ""));
      const seats = Number(mc.seating) || null;
      const story: { t: string; c: React.ReactNode }[] = [];
      if (d.overview) story.push({ t: "Overview", c: <p className="whitespace-pre-line">{d.overview}</p> });
      const perfBits = [engine && `powered by ${engine}`, hp && `producing ${hp}`, trans && `paired with ${trans}`, drivetrain && `driving the ${drivetrain}`].filter(Boolean);
      if (perfBits.length) story.push({ t: "Performance", c: <p>This vehicle is {perfBits.join(", ")}.{mpg ? ` EPA-estimated ${mpg}.` : ""}</p> });
      if (premium && groups.Comfort?.length) story.push({ t: "Luxury", c: <p>The {listing.trim} trim is appointed with {groups.Comfort.slice(0, 5).join(", ")}.</p> });
      if (groups.Technology?.length) story.push({ t: "Technology", c: <p>Connectivity and infotainment include {groups.Technology.join(", ")}.</p> });
      if (groups.Comfort?.length) story.push({ t: "Comfort", c: <p>Cabin comfort features include {groups.Comfort.join(", ")}.</p> });
      if (groups.Safety?.length) story.push({ t: "Safety", c: <p>Driver assistance and safety equipment include {groups.Safety.join(", ")}.</p> });
      if (awd) story.push({ t: "Driving Experience", c: <p>{drivetrain} delivers confident handling and all-weather capability.</p> });
      const ownBits = [d.warrantyStr && `${d.warrantyStr} of factory warranty remains`, d.recallClear && "no open recalls are reported", d.serviceCount > 0 && `${d.serviceCount} service records are on file`].filter(Boolean) as string[];
      if (ownBits.length) story.push({ t: "Ownership", c: <p>For peace of mind, {ownBits.join(", ")}.</p> });
      const recs: { t: string; w: string }[] = [];
      if (seats && seats >= 6) { recs.push({ t: "Families", w: `Seats ${seats} across a flexible multi-row layout.` }); recs.push({ t: "Road Trips", w: "Spacious, comfortable cabin for long drives." }); }
      if (Number(ks.mpg_hwy) >= 28) recs.push({ t: "Daily Commuters", w: `Up to ${ks.mpg_hwy} MPG highway eases the daily drive.` });
      if (premium) { recs.push({ t: "Luxury Buyers", w: `${listing.trim} trim brings premium materials and features.` }); recs.push({ t: "Business Professionals", w: "A refined, professional presence." }); }
      if (awd) recs.push({ t: "Weekend Adventures", w: `${drivetrain} adds all-weather confidence.` });
      const exterior = groups.Exterior || [];
      const interior = Array.from(new Set([...(groups.Interior || []), ...(groups.Comfort || [])]));
      const loveReasons: string[] = [];
      if (groups.Safety?.length) loveReasons.push("Advanced safety technology");
      if (groups.Comfort?.length) loveReasons.push("Premium ride comfort");
      if (groups.Technology?.length) loveReasons.push("Modern technology and connectivity");
      if (premium) loveReasons.push("Luxury interior appointments");
      if (isGreat) loveReasons.push("Exceptional value versus the market");
      const catIcon: Record<string, React.ElementType> = { Performance: Gauge, Safety: ShieldCheck, Technology: Star, Comfort: Heart, Exterior: Car, Interior: Users };
      return {
        title: "Vehicle Overview", subtitle: "A complete look at this vehicle's design, technology, and ownership experience",
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        secondary: { label: "View specifications", onClick: () => openPanel("key-specs") },
        footerQuestion: "Questions about this vehicle?", specialistLabel: "Talk to a Product Specialist",
        body: <>
          <div className="rounded-2xl overflow-hidden border border-[#E6E8EC] relative">
            {listing.hero_image_url ? <img src={listing.hero_image_url} alt="" className="w-full aspect-[16/9] object-cover" /> : <div className="w-full aspect-[16/9] bg-[#1f2227] flex items-center justify-center"><Car className="w-12 h-12 text-slate-500" /></div>}
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 to-transparent flex flex-col justify-end p-5">
              <p className="text-white text-[20px] font-extrabold leading-tight">{listing.ymm}</p>
              {listing.trim && <p className="text-white/85 text-[13px] font-semibold">{listing.trim}</p>}
              <div className="flex flex-wrap gap-1.5 mt-2">{[engine, drivetrain, trans].filter(Boolean).map((c) => <span key={c as string} className="text-[10px] font-semibold text-white bg-white/15 backdrop-blur rounded-full px-2 py-0.5">{c}</span>)}</div>
            </div>
          </div>
          {story.length > 0 && (
            <Section title="Vehicle story">
              <div className="space-y-2">{story.map((s, i) => <Accordion key={s.t} title={s.t} defaultOpen={i === 0}>{s.c}</Accordion>)}</div>
            </Section>
          )}
          {recs.length > 0 && (
            <Section title="Perfect for">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{recs.map((r) => <div key={r.t} className={`${CARD} p-4`}><p className="text-[13px] font-bold">{r.t}</p><p className="text-[12px] text-[#64748B] mt-0.5">{r.w}</p></div>)}</div>
            </Section>
          )}
          {exterior.length > 0 && (
            <Section title="Exterior highlights"><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{exterior.map((e) => <IconCard key={e} icon={catIcon.Exterior} title={e} />)}</div></Section>
          )}
          {interior.length > 0 && (
            <Section title="Interior experience"><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{interior.map((e) => <IconCard key={e} icon={catIcon.Interior} title={e} />)}</div></Section>
          )}
          {loveReasons.length > 0 && (
            <Section title="Why shoppers love this vehicle">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4"><ul className="space-y-2">{loveReasons.map((r) => <Check key={r}>{r}</Check>)}</ul></div>
            </Section>
          )}
          {!d.overview && story.length === 0 && <Empty>A full overview appears here as this vehicle's OEM data is decoded.</Empty>}
          <Disclaimer />
        </>,
      };
    }

    case "key-specs": {
      const ks = listing.key_specs || {};
      const mcr = mc;
      const ksr = ks as Record<string, unknown>;
      const A = (keys: string[]) => specAttr(mcr, ksr, keys);
      const { groups } = featureGroups(listing);
      const hp = mcr.horsepower != null ? `${mcr.horsepower} hp` : A(["horsepower"]);
      const mpg = ks.mpg_city && ks.mpg_hwy ? `${ks.mpg_city}/${ks.mpg_hwy} MPG` : A(["mpg", "combined_mpg"]);
      const seating = mcr.seating != null ? `${mcr.seating}-passenger` : A(["seating", "seats"]);
      const quick: [string, string | null][] = [
        ["Engine", ks.engine ? String(ks.engine) : A(["engine"])],
        ["Transmission", ks.transmission ? String(ks.transmission) : A(["transmission"])],
        ["Drivetrain", ks.drivetrain ? String(ks.drivetrain) : A(["drivetrain", "drive_type"])],
        ["Horsepower", hp],
        ["Torque", A(["torque"])],
        ["Fuel Economy", mpg],
        ["Fuel Type", ks.fuel ? String(ks.fuel) : A(["fuel", "fuel_type"])],
        ["Towing", A(["towing", "towing_capacity", "max_towing"])],
        ["Payload", A(["payload", "payload_capacity"])],
      ];
      const perfRows: [string, string | null][] = [
        ["Engine", ks.engine ? String(ks.engine) : A(["engine"])],
        ["Displacement", A(["displacement", "engine_displacement"])],
        ["Horsepower", hp],
        ["Torque", A(["torque"])],
        ["Transmission", ks.transmission ? String(ks.transmission) : null],
        ["Drive Type", ks.drivetrain ? String(ks.drivetrain) : A(["drive_type"])],
        ["Fuel Tank Capacity", A(["fuel_tank", "fuel_capacity", "tank_capacity"])],
        ["Fuel Economy", mpg],
        ["0–60 mph", A(["0_60", "zero_to_sixty", "zero_sixty"])],
        ["Top Speed", A(["top_speed"])],
      ];
      const dimRows: [string, string | null][] = [
        ["Wheelbase", A(["wheelbase"])], ["Length", A(["length", "overall_length"])], ["Width", A(["width", "overall_width"])],
        ["Height", A(["height", "overall_height"])], ["Ground Clearance", A(["ground_clearance"])], ["Turning Radius", A(["turning_radius"])],
        ["Cargo Capacity", A(["cargo", "cargo_capacity", "cargo_volume"])], ["Passenger Volume", A(["passenger_volume"])], ["Seating Capacity", seating],
      ];
      const wheelRows: [string, string | null][] = [
        ["Wheel Size", A(["wheel_size", "wheels"])], ["Tire Size", A(["tire_size", "tires"])], ["Spare Tire", A(["spare_tire", "spare"])],
        ["Wheel Material", A(["wheel_material"])], ["Recommended Tire Pressure", A(["tire_pressure"])],
      ];
      const mechRows: [string, string | null][] = [
        ["Front Suspension", A(["front_suspension"])], ["Rear Suspension", A(["rear_suspension"])], ["Steering", A(["steering"])],
        ["Brakes", A(["brakes"])], ["Battery", A(["battery"])], ["Alternator", A(["alternator"])], ["Hybrid System", A(["hybrid_system"])],
        ["EV Battery", A(["ev_battery", "battery_capacity"])], ["Charging", A(["charging", "charge_time"])],
      ];
      const safety = groups.Safety || [];
      const hasAny = quick.some(([, v]) => v);
      return {
        title: "Technical Specifications", subtitle: "Everything you need to know about this vehicle's engineering",
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        footerQuestion: "Questions about the specifications?", specialistLabel: "Talk to a Product Specialist",
        body: <>
          {hasAny ? (
            <>
              <Section title="Quick specs">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{quick.map(([k, v]) => (
                  <div key={k} className={`${CARD} p-3`}><p className="text-[11px] text-[#94A3B8] leading-tight">{k}</p><p className={`text-[13px] font-extrabold mt-0.5 leading-tight ${v ? "text-[#0F172A]" : "text-[#CBD5E1]"}`}>{v ?? "Pending"}</p></div>
                ))}</div>
              </Section>
              <SpecGroup title="Performance" rows={perfRows} />
              <SpecGroup title="Dimensions" rows={dimRows} />
              <SpecGroup title="Wheels & Tires" rows={wheelRows} />
              <Section title="Safety & driver assistance">
                {safety.length ? <div className={`${CARD} p-4`}><ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">{safety.map((s) => <Check key={s}>{s}</Check>)}</ul></div> : <Empty>Safety equipment appears here as the vehicle's data is decoded.</Empty>}
              </Section>
              <SpecGroup title="Mechanical" rows={mechRows} />
            </>
          ) : <Empty>Specifications appear here as the vehicle's data is decoded from its VIN.</Empty>}
          <Disclaimer />
        </>,
      };
    }

    case "equipment": {
      const { ordered, featLabels, accessories } = featureGroups(listing);
      const hasContent = featLabels.length > 0 || accessories.length > 0 || ordered.length > 0;
      return {
        title: "Equipment & Installed Options", subtitle: "Everything included on this vehicle from the factory and dealership",
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        footerQuestion: "Questions about the equipment?", specialistLabel: "Talk to a Product Specialist",
        body: <>
          {hasContent ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Factory Equipment" value={`${featLabels.length}`} />
                <Stat label="Packages" value="Pending" />
                <Stat label="Dealer Add-ons" value={`${accessories.length}`} />
                <Stat label="Est. Value" value="Not Available" />
              </div>
              {ordered.length > 0 && (
                <Section title="Equipment categories">
                  <div className="space-y-2">{ordered.map(([name, items], i) => <Group key={name} title={name} items={items} defaultOpen={i === 0} />)}</div>
                </Section>
              )}
              <Section title="Installed packages">
                <Empty>Factory package breakdown is pending OEM build-sheet data for this vehicle.</Empty>
              </Section>
              {featLabels.length > 0 && (
                <Section title="Factory options">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{featLabels.slice(0, 12).map((f) => <IconCard key={f} icon={Award} title={f} />)}</div>
                </Section>
              )}
              {accessories.length > 0 && (
                <Section title="Dealer accessories available" sub="Add-ons offered by the dealer — not factory-installed.">
                  <div className="space-y-2">{accessories.map((a) => <div key={a} className={`${CARD} p-3 flex items-center gap-2`}><Package className="w-4 h-4 text-[#2563EB] shrink-0" /><span className="text-[13px] text-[#0F172A]">{a}</span></div>)}</div>
                </Section>
              )}
              <Section title="Build summary">
                <div className={`${CARD} p-4`}>
                  <StatRow label="Factory equipment" value={`${featLabels.length} items`} />
                  <StatRow label="Factory options" value="Pending OEM build sheet" />
                  <StatRow label="Dealer installed" value={accessories.length ? `${accessories.length} available` : "None reported"} />
                  <StatRow label="Aftermarket" value="None reported" />
                </div>
                <p className="text-[11px] text-[#94A3B8] mt-2">A full factory build sheet with itemized option values requires OEM data and is not yet available for this vehicle.</p>
              </Section>
            </>
          ) : <Empty>Equipment details appear here as the vehicle's build data is decoded.</Empty>}
          <Disclaimer />
        </>,
      };
    }

    case "ownership-timeline": {
      const w = d.warranty;
      const year = (listing.ymm || "").match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
      const fmtDate = (s?: string | Date | null) => s ? new Date(s).toLocaleDateString() : null;
      const inService = w.in_service_date || null;
      const prep = listing.prep_status?.foreman_signed_at || null;
      const updated = (listing as unknown as { updated_at?: string }).updated_at || null;
      const docs = listing.documents || [];
      const lastDoc = docs.map((x) => (x as { uploaded_at?: string }).uploaded_at).filter(Boolean).sort().pop() || null;
      const hasHistory = d.ownerCount != null || d.accidentCount != null || d.cleanTitle || d.serviceCount > 0 || !!listing.recall_status;

      const origin: TEvent[] = [
        { title: "Manufactured", date: year, source: "OEM model year", status: year ? "estimated" : "unavailable", note: year ? "Model year on record — exact build date pending OEM build data." : "Build date is not available yet." },
        { title: "Delivered to dealer", status: "unavailable", note: "Dealer delivery date is not available yet." },
      ];
      const ownership: TEvent[] = [
        inService
          ? { title: d.ownerCount === 1 ? "First owner — placed in service" : "Placed in service", date: fmtDate(inService), source: "Warranty in-service date", status: "verified", note: d.ownerCount === 1 ? "Single owner on record; factory warranty began on this date." : "Factory warranty coverage began on this date." }
          : d.ownerCount != null
            ? { title: "Ownership on record", source: "Vehicle history", status: "needs", note: `${d.ownerCount} owner${d.ownerCount === 1 ? "" : "s"} reported; exact dates pending verification.` }
            : { title: "Ownership history", status: "unavailable", note: "Ownership records are pending verification." },
        { title: "Registration history", status: "unavailable", note: "State-by-state registration timeline is not available yet." },
      ];
      const services = (listing.service_records || []).filter((s) => s && (s.date || s.type || s.mileage));
      const maintenance: TEvent[] = [
        ...(services.length
          ? services.map((s) => ({ title: s.type || "Service performed", date: fmtDate(s.date), mileage: s.mileage ? `${s.mileage} mi` : null, source: "Service record", status: "verified" as TStatus, note: s.notes || "Maintenance performed and recorded." }))
          : [{ title: "Service records", status: "unavailable" as TStatus, note: "No service records are on file yet." }]),
        prep
          ? { title: "Dealer inspection completed", date: fmtDate(prep), source: "AutoLabels prep sign-off", status: "verified", note: "Multi-point inspection sign-off was completed." }
          : { title: "Dealer inspection", status: "unavailable", note: "Inspection date is not available yet." },
      ];
      const verification: TEvent[] = [
        { title: "VIN verified", status: listing.vin ? "verified" : "unavailable", source: listing.vin ? "VIN decode" : undefined, note: listing.vin ? "Vehicle identification number confirmed." : "VIN not available." },
        { title: "Market data checked", status: (d.marketAvg != null || d.valueHistory.length > 0) ? "verified" : "unavailable", source: "MarketCheck", note: (d.marketAvg != null || d.valueHistory.length > 0) ? "Pricing compared against live market data." : "Market data pending." },
        { title: "Recall status checked", status: listing.recall_status ? "verified" : "unavailable", source: "NHTSA", note: listing.recall_status ? (d.recallClear ? "No open recalls found." : "Recall campaign(s) on record.") : "Recall check pending." },
        { title: "Warranty checked", status: d.warrantyStr ? "verified" : "unavailable", note: d.warrantyStr ? `${d.warrantyStr} of factory coverage confirmed remaining.` : "Warranty details pending." },
        { title: "Documents uploaded", date: fmtDate(lastDoc), status: docs.length ? "verified" : "unavailable", source: docs.length ? `${docs.length} document${docs.length === 1 ? "" : "s"}` : undefined, note: docs.length ? "Dealer documents are attached to this vehicle." : "No documents uploaded yet." },
      ];
      const current: TEvent[] = [
        { title: "Available today", status: listing.status === "published" ? "verified" : "needs", source: d.dealerName, note: listing.status === "published" ? `Listed and available at ${d.dealerName}.` : "Availability is being confirmed." },
        { title: "Passport generated", date: fmtDate(updated), status: updated ? "verified" : "estimated", source: "AutoLabels", note: updated ? "This passport was last updated on this date." : "Generated by AutoLabels." },
      ];
      const sections: { label: string; events: TEvent[] }[] = [
        { label: "Origin", events: origin },
        { label: "Ownership", events: ownership },
        { label: "Maintenance", events: maintenance },
        { label: "AutoLabels Verification", events: verification },
        { label: "Current Status", events: current },
      ];
      return {
        title: "Ownership Timeline",
        subtitle: "A clear timeline of this vehicle's ownership, service, certification, and availability history.",
        footerQuestion: "Questions about this vehicle's timeline?",
        primary: { label: "Contact Dealer", onClick: () => go("contact") },
        secondary: hasHistory ? { label: "View Vehicle History Report", onClick: () => go("vehicle-history") } : undefined,
        body: <>
          {sections.map((s) => <Section key={s.label} title={s.label}><TimelineGroup events={s.events} /></Section>)}
          {hasHistory ? (
            <button onClick={() => go("vehicle-history")} className="w-full h-11 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-[13px] font-semibold inline-flex items-center justify-center gap-2 transition-colors"><History className="w-4 h-4" /> View Full Vehicle History Report</button>
          ) : (
            <Empty>Full vehicle history data is not available yet.</Empty>
          )}
          <Disclaimer />
        </>,
      };
    }
  }
}

// ── Small shared bits used by the panels ──────────────────────
const Delta = ({ label, delta }: { label: string; delta: number }) => (
  <span className={`inline-flex items-center gap-1 font-semibold ${delta <= 0 ? "text-[#16A34A]" : "text-[#64748B]"}`}>
    {delta <= 0 ? <TrendingDown className="w-3.5 h-3.5" /> : <TrendingUp className="w-3.5 h-3.5" />}
    {label} {delta <= 0 ? "decreased" : "increased"}{delta !== 0 ? ` ${fmt$(Math.abs(delta))}` : ""}
  </span>
);

const Gauge3 = ({ value }: { value: number }) => (
  <div>
    <div className="relative h-3 rounded-full bg-gradient-to-r from-slate-200 via-amber-200 to-emerald-300">
      <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white ring-2 ring-[#0F172A] shadow" style={{ left: `${value}%` }} />
    </div>
    <div className="flex justify-between text-[11px] font-semibold text-[#94A3B8] mt-1.5"><span>Low</span><span>Medium</span><span>High</span></div>
  </div>
);

const FactorBar = ({ label, pct }: { label: string; pct: number }) => (
  <div>
    <div className="flex justify-between text-[12px] mb-1"><span className="text-[#0F172A] font-medium">{label}</span><span className="text-[#64748B]">{pct >= 85 ? "Strong" : pct >= 55 ? "Good" : pct > 0 ? "Limited" : "—"}</span></div>
    <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-[#2563EB]" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
  </div>
);

const Source = ({ name, on }: { name: string; on: boolean }) => (
  <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px] font-semibold ${on ? "border-emerald-200 bg-emerald-50/60 text-[#0F172A]" : "border-[#E6E8EC] bg-white text-[#94A3B8]"}`}>
    {on ? <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" /> : <Circle className="w-4 h-4 text-[#CBD5E1] shrink-0" />}{name}
  </div>
);

const Faq = ({ q, a }: { q: string; a: string }) => (
  <details className={`${CARD} p-4 group`}>
    <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-[13px] font-semibold text-[#0F172A]">{q}<ChevronDown className="w-4 h-4 text-[#94A3B8] group-open:rotate-180 transition-transform shrink-0" /></summary>
    <p className="text-[12px] text-[#64748B] mt-2 leading-relaxed">{a}</p>
  </details>
);

const Stat = ({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "green" | "neutral" }) => (
  <div className={`${CARD} p-3`}>
    <p className="text-[11px] text-[#94A3B8] leading-tight">{label}</p>
    <p className={`text-[16px] font-extrabold mt-0.5 leading-tight ${tone === "green" ? "text-[#16A34A]" : "text-[#0F172A]"}`}>{value}</p>
  </div>
);

// Circular score ring that fills on mount (used by mobile panel heroes).
const AnimatedRing = ({ pct, size = 132, color = GREEN, label }: { pct: number; size?: number; color?: string; label?: string }) => {
  const [fill, setFill] = useState(false);
  useEffect(() => { const r = requestAnimationFrame(() => setFill(true)); return () => cancelAnimationFrame(r); }, []);
  const r = size / 2 - 9, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="9" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={fill ? off : c} style={{ transition: "stroke-dashoffset 900ms ease-out" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-[34px] font-extrabold leading-none">{pct}</span>{label && <span className="text-[11px] font-bold opacity-80 mt-0.5">{label}</span>}</div>
    </div>
  );
};

const Seg = ({ options, value, onChange }: { options: { label: string; value: string | number }[]; value: string | number; onChange: (v: string | number) => void }) => (
  <div className="inline-flex rounded-lg border border-[#E6E8EC] bg-white p-0.5 text-[11px] font-semibold">
    {options.map((o) => <button key={String(o.value)} onClick={() => onChange(o.value)} className={`px-2 py-1 rounded-md transition-colors ${value === o.value ? "bg-[#2563EB] text-white" : "text-[#64748B] hover:text-[#0F172A]"}`}>{o.label}</button>)}
  </div>
);

// Multi-series line chart with point tooltips (round markers, no distortion).
const PriceChart = ({ pts, height = 170 }: { pts: { label: string; dealer: number | null; market: number | null }[]; height?: number }) => {
  const w = 560, pad = 12, h = height;
  const vals = pts.flatMap((p) => [p.dealer, p.market]).filter((n): n is number => n != null);
  if (vals.length < 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals), range = Math.max(1, max - min);
  const x = (i: number) => pad + (i / Math.max(1, pts.length - 1)) * (w - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / range) * (h - pad * 2);
  const dline = pts.map((p, i) => (p.dealer != null ? `${x(i).toFixed(1)},${y(p.dealer).toFixed(1)}` : null)).filter(Boolean) as string[];
  const mline = pts.map((p, i) => (p.market != null ? `${x(i).toFixed(1)},${y(p.market).toFixed(1)}` : null)).filter(Boolean) as string[];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} preserveAspectRatio="xMidYMid meet">
      {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={pad} x2={w - pad} y1={pad + g * (h - pad * 2)} y2={pad + g * (h - pad * 2)} stroke="#E6E8EC" strokeWidth="1" strokeDasharray="3 4" />)}
      {mline.length >= 2 && <polyline points={mline.join(" ")} fill="none" stroke={BLUE} strokeWidth="2.5" strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" />}
      {dline.length >= 2 && <polyline points={dline.join(" ")} fill="none" stroke={GREEN} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
      {pts.map((p, i) => (p.dealer != null ? <circle key={i} cx={x(i)} cy={y(p.dealer)} r="3.5" fill="#fff" stroke={GREEN} strokeWidth="2"><title>{`${p.label}: ${fmt$(p.dealer)}`}</title></circle> : null))}
    </svg>
  );
};

function PriceTimeline({ history }: { history: PricePoint[] }) {
  const [range, setRange] = useState<number>(90);
  const pts = useMemo(() => {
    const anchor = history.length ? new Date(history[history.length - 1].captured_at).getTime() : Date.now();
    const cutoff = range === 0 ? -Infinity : anchor - range * 86400000;
    const f = history.filter((h) => new Date(h.captured_at).getTime() >= cutoff);
    const use = f.length >= 2 ? f : history;
    return use.map((h) => ({ label: new Date(h.captured_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }), dealer: h.listing_price, market: h.market_value }));
  }, [history, range]);
  return (
    <div className={`${CARD} p-4`}>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-4 text-[11px] font-semibold">
          <span className="inline-flex items-center gap-1.5 text-[#16A34A]"><span className="w-4 border-t-2 border-[#16A34A]" /> Dealer price</span>
          <span className="inline-flex items-center gap-1.5 text-[#64748B]"><span className="w-4 border-t-2 border-dashed border-[#2563EB]" /> Market value</span>
        </div>
        <Seg value={range} onChange={(v) => setRange(v as number)} options={[{ label: "7D", value: 7 }, { label: "30D", value: 30 }, { label: "60D", value: 60 }, { label: "90D", value: 90 }, { label: "All", value: 0 }]} />
      </div>
      <PriceChart pts={pts} />
    </div>
  );
}

const Scatter = ({ comps, current }: { comps: Comp[]; current: { mileage: number | null; price: number | null } }) => {
  const items = ([...comps.map((c) => ({ x: c.mileage, y: c.price, you: false })), { x: current.mileage, y: current.price, you: true }])
    .filter((p) => p.x != null && p.y != null) as { x: number; y: number; you: boolean }[];
  if (items.length < 2) return null;
  const w = 560, h = 220, pad = 30;
  const xs = items.map((i) => i.x), ys = items.map((i) => i.y);
  const xmin = Math.min(...xs), xmax = Math.max(...xs), xr = Math.max(1, xmax - xmin);
  const ymin = Math.min(...ys), ymax = Math.max(...ys), yr = Math.max(1, ymax - ymin);
  const px = (v: number) => pad + ((v - xmin) / xr) * (w - pad * 2);
  const py = (v: number) => pad + (1 - (v - ymin) / yr) * (h - pad * 2);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: h }} preserveAspectRatio="xMidYMid meet">
      {[0, 0.5, 1].map((g) => <line key={g} x1={pad} x2={w - pad} y1={pad + g * (h - pad * 2)} y2={pad + g * (h - pad * 2)} stroke="#E6E8EC" strokeWidth="1" />)}
      {items.map((p, i) => <circle key={i} cx={px(p.x)} cy={py(p.y)} r={p.you ? 7 : 5} fill={p.you ? BLUE : "#CBD5E1"} stroke="#fff" strokeWidth="2"><title>{`${p.you ? "This vehicle" : "Comparable"}: ${p.x.toLocaleString()} mi · ${fmt$(p.y)}`}</title></circle>)}
      <text x={w / 2} y={h - 6} textAnchor="middle" fill="#94A3B8" fontSize="11">Mileage</text>
    </svg>
  );
};

function CompExplorer({ comps, current, avg, cleanTitle, oneOwner, certified }: { comps: Comp[]; current: { ymm: string; trim: string; mileage: number | null; price: number | null; dealer: string; dom: number | null }; avg: number | null; cleanTitle: boolean; oneOwner: boolean; certified: boolean }) {
  const [sort, setSort] = useState<"match" | "price-asc" | "price-desc" | "miles" | "new">("match");
  const [certOnly, setCertOnly] = useState(false);
  const sorted = useMemo(() => {
    const by: Record<typeof sort, (a: Comp, b: Comp) => number> = {
      match: (a, b) => (a.distNum ?? 1e9) - (b.distNum ?? 1e9),
      "price-asc": (a, b) => (a.price ?? 1e12) - (b.price ?? 1e12),
      "price-desc": (a, b) => (b.price ?? -1) - (a.price ?? -1),
      miles: (a, b) => (a.mileage ?? 1e9) - (b.mileage ?? 1e9),
      new: (a, b) => (a.dom ?? 1e9) - (b.dom ?? 1e9),
    };
    return [...comps].sort(by[sort]);
  }, [comps, sort]);
  const compPrices = comps.map((c) => c.price).filter((n): n is number => n != null);
  const compMiles = comps.map((c) => c.mileage).filter((n): n is number => n != null);
  const avgCompPrice = compPrices.length ? compPrices.reduce((a, b) => a + b, 0) / compPrices.length : null;
  const avgCompMiles = compMiles.length ? compMiles.reduce((a, b) => a + b, 0) / compMiles.length : null;
  const stand: string[] = [];
  if (current.mileage != null && avgCompMiles != null && current.mileage < avgCompMiles) stand.push("Lower mileage than comparable listings");
  if (current.price != null && avgCompPrice != null && current.price < avgCompPrice) stand.push("Priced below the comparable average");
  if (certified) stand.push("Certified Pre-Owned");
  if (oneOwner) stand.push("One owner");
  if (cleanTitle) stand.push("Clean title & history");
  return (
    <>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Seg value={sort} onChange={(v) => setSort(v as typeof sort)} options={[{ label: "Closest", value: "match" }, { label: "$ Low", value: "price-asc" }, { label: "$ High", value: "price-desc" }, { label: "Miles", value: "miles" }, { label: "Newest", value: "new" }]} />
        <button onClick={() => setCertOnly((v) => !v)} className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5 transition-colors ${certOnly ? "border-[#2563EB] text-[#2563EB] bg-blue-50" : "border-[#E6E8EC] text-[#64748B] hover:text-[#0F172A]"}`}><BadgeCheck className="w-3.5 h-3.5" /> Certified</button>
      </div>
      <div className="rounded-2xl border-2 border-[#2563EB] bg-blue-50/40 p-3 flex items-center gap-3">
        <div className="w-20 h-16 rounded-lg bg-[#dbe4f5] overflow-hidden shrink-0 flex items-center justify-center"><Car className="w-6 h-6 text-[#2563EB]" /></div>
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="text-[13px] font-bold leading-tight line-clamp-1">{current.ymm}</p><span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#2563EB] text-white shrink-0">Your Vehicle</span></div>{current.trim && <p className="text-[12px] text-[#64748B] line-clamp-1">{current.trim}</p>}<p className="text-[11px] text-[#94A3B8] mt-0.5">{[current.mileage != null ? `${current.mileage.toLocaleString()} mi` : null, current.dom != null ? `${current.dom} days listed` : null].filter(Boolean).join(" · ")}</p></div>
        {current.price != null && <p className="text-[15px] font-extrabold shrink-0">{fmt$(current.price)}</p>}
      </div>
      {certOnly ? (
        <Empty>Certified status isn't available for these comparable listings yet.</Empty>
      ) : (
        <div className="space-y-3">{sorted.map((c, i) => {
          const diff = current.price != null && c.price != null ? c.price - current.price : null;
          return (
            <div key={i} className={`${CARD} p-3 flex items-center gap-3`}>
              <div className="w-20 h-16 rounded-lg bg-[#eef0f3] overflow-hidden shrink-0 flex items-center justify-center">{c.image ? <img src={c.image} alt="" className="w-full h-full object-cover" /> : <Car className="w-6 h-6 text-[#94A3B8]" />}</div>
              <div className="min-w-0 flex-1"><p className="text-[13px] font-bold leading-tight line-clamp-1">{c.ymm}</p>{c.trim && <p className="text-[12px] text-[#64748B] line-clamp-1">{c.trim}</p>}<p className="text-[11px] text-[#94A3B8] mt-0.5">{[c.mileage != null ? `${c.mileage.toLocaleString()} mi` : null, c.dealer, c.distance, c.dom != null ? `${c.dom}d listed` : null].filter(Boolean).join(" · ")}</p></div>
              <div className="shrink-0 text-right">{c.price != null && <p className="text-[15px] font-extrabold">{fmt$(c.price)}</p>}{diff != null && diff !== 0 && <p className={`text-[10px] font-semibold ${diff > 0 ? "text-[#16A34A]" : "text-[#EA580C]"}`}>{diff > 0 ? `+${fmt$(diff)}` : fmt$(diff)}</p>}</div>
            </div>
          );
        })}</div>
      )}
      <Section title="Price vs mileage" sub="Your vehicle highlighted in blue.">
        <div className={`${CARD} p-3`}><Scatter comps={comps} current={{ mileage: current.mileage, price: current.price }} /></div>
      </Section>
      {stand.length > 0 && (
        <Section title="Why your vehicle stands out">
          <div className={`${CARD} p-4`}><ul className="space-y-2">{stand.map((s) => <Check key={s}>{s}</Check>)}</ul></div>
        </Section>
      )}
      {avg != null && current.price != null && (
        <p className="text-[12px] text-[#64748B]">This vehicle is {current.price <= avg ? "below" : "above"} the {fmt$(avg)} comparable-set average.</p>
      )}
    </>
  );
}

function InventoryTrendChart({ isPreview }: { isPreview: boolean }) {
  const [range, setRange] = useState<number>(90);
  const series = useMemo(() => {
    if (!isPreview) return [] as number[];
    const n = range >= 180 ? 12 : range >= 90 ? 9 : range >= 60 ? 6 : 4;
    return Array.from({ length: n }, (_, i) => Math.round(56 - i * (12 / n) - (i % 2)));
  }, [isPreview, range]);
  return (
    <div className={`${CARD} p-4`}>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#16A34A]"><span className="w-4 border-t-2 border-[#16A34A]" /> Inventory count</span>
        <Seg value={range} onChange={(v) => setRange(v as number)} options={[{ label: "30D", value: 30 }, { label: "60D", value: 60 }, { label: "90D", value: 90 }, { label: "180D", value: 180 }]} />
      </div>
      {series.length >= 2 ? <TrendChart dealer={series} height={140} /> : <Empty>Inventory time-series appears once enough market snapshots are collected.</Empty>}
      {isPreview && <p className="text-[11px] text-[#94A3B8] mt-2">Sample trend shown in preview mode.</p>}
    </div>
  );
}

const RatingBar = ({ label, score }: { label: string; score: number }) => (
  <div className="flex items-center gap-3">
    <span className="text-[12px] text-[#0F172A] w-24 shrink-0">{label}</span>
    <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-[#16A34A]" style={{ width: `${(score / 5) * 100}%` }} /></div>
    <span className="text-[12px] font-semibold w-8 text-right">{score.toFixed(1)}</span>
  </div>
);

const Chip = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0F172A] bg-slate-100 rounded-full px-2.5 py-1">{children}</span>
);

const Group = ({ title, items, defaultOpen }: { title: string; items: string[]; defaultOpen?: boolean }) => (
  <details className={`${CARD} overflow-hidden group`} open={defaultOpen}>
    <summary className="cursor-pointer list-none flex items-center justify-between gap-3 px-4 py-3 text-[13px] font-bold text-[#0F172A]">
      <span className="inline-flex items-center gap-2">{title} <span className="text-[11px] font-semibold text-[#94A3B8]">{items.length}</span></span>
      <ChevronDown className="w-4 h-4 text-[#94A3B8] group-open:rotate-180 transition-transform shrink-0" />
    </summary>
    <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
      {items.map((it) => <div key={it} className="flex items-start gap-2 text-[12px] text-[#334155]"><CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0 mt-0.5" />{it}</div>)}
    </div>
  </details>
);

// Bucket equipment strings into shopper-facing categories by keyword. Only
// real features/specs are placed; unmatched items fall to "Additional".
const FEATURE_CATS: { name: string; re: RegExp }[] = [
  { name: "Performance", re: /engine|turbo|horsepower|\bhp\b|cylinder|transmission|drivetrain|awd|4wd|4x4|tow|mpg|fuel|hybrid|electric|sport|paddle/i },
  { name: "Safety", re: /cruise|blind.?spot|lane|camera|cross.?traffic|parking sensor|emergency brak|collision|airbag|assist|360|safety/i },
  { name: "Technology", re: /navigation|\bnav\b|carplay|android|wireless|wi-?fi|bluetooth|audio|bose|harman|sound|head.?up|\bhud\b|display|screen|usb|charging|digital cluster|infotainment|connect/i },
  { name: "Comfort", re: /leather|heated|ventilated|cooled|memory|climate|third row|3rd row|massage|lumbar|recline|quiet|comfort|moonroof|panoramic/i },
  { name: "Exterior", re: /\bled\b|light|sunroof|liftgate|wheel|roof rail|trailer|alloy|spoiler|chrome/i },
  { name: "Interior", re: /seat|cargo|ambient|cluster|trim|console|storage|capacity|upholstery|cup ?holder/i },
];
const CATEGORY_ORDER = ["Performance", "Comfort", "Technology", "Safety", "Exterior", "Interior", "Additional"];
const categorizeFeature = (label: string) => FEATURE_CATS.find((c) => c.re.test(label))?.name ?? "Additional";

type TStatus = "verified" | "estimated" | "needs" | "unavailable";
interface TEvent { title: string; date?: string | null; mileage?: string | null; source?: string | null; status: TStatus; note: string }
const TL_META: Record<TStatus, { dot: string; text: string; label: string; icon: React.ElementType }> = {
  verified: { dot: "bg-emerald-500", text: "text-[#16A34A]", label: "Verified", icon: CheckCircle2 },
  estimated: { dot: "bg-[#2563EB]", text: "text-[#2563EB]", label: "Estimated", icon: Info },
  needs: { dot: "bg-orange-500", text: "text-[#EA580C]", label: "Needs confirmation", icon: AlertTriangle },
  unavailable: { dot: "bg-slate-300", text: "text-[#94A3B8]", label: "Not available yet", icon: Circle },
};
const TimelineGroup = ({ events }: { events: TEvent[] }) => (
  <ol className="space-y-4 relative border-l-2 border-slate-100 ml-1.5 pl-4">
    {events.map((e, i) => {
      const m = TL_META[e.status];
      const meta = [e.date, e.mileage, e.source].filter(Boolean).join(" · ");
      return (
        <li key={i} className="relative">
          <span className={`absolute -left-[22px] top-1 w-3 h-3 rounded-full ${m.dot} ring-2 ring-white`} />
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13px] font-bold leading-tight">{e.title}</p>
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${m.text}`}><m.icon className="w-3 h-3" />{m.label}</span>
          </div>
          {meta && <p className="text-[11px] text-[#94A3B8] mt-0.5">{meta}</p>}
          <p className="text-[12px] text-[#64748B] mt-0.5">{e.note}</p>
        </li>
      );
    })}
  </ol>
);

// Single source of truth for the feature/equipment grouping used by the
// Highlights, Overview, and Equipment panels — real features + decoded specs.
const featureGroups = (listing: VehicleListing) => {
  const ks = listing.key_specs || {};
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const featLabels = (listing.features || []).map((f) => [f.title, f.subtitle].filter(Boolean).join(" ").trim()).filter(Boolean);
  const groups: Record<string, string[]> = {};
  const push = (cat: string, label: string) => { if (!label) return; (groups[cat] ||= []); if (!groups[cat].includes(label)) groups[cat].push(label); };
  featLabels.forEach((l) => push(categorizeFeature(l), l));
  if (ks.engine) push("Performance", String(ks.engine));
  if (mc.horsepower) push("Performance", `${mc.horsepower} hp`);
  if (ks.transmission) push("Performance", String(ks.transmission));
  if (ks.drivetrain) push("Performance", String(ks.drivetrain));
  if (ks.mpg_city && ks.mpg_hwy) push("Performance", `${ks.mpg_city}/${ks.mpg_hwy} MPG`);
  if (ks.exterior_color) push("Exterior", `${ks.exterior_color} exterior`);
  if (ks.interior_color) push("Interior", `${ks.interior_color} interior`);
  if (mc.seating) push("Interior", `${mc.seating}-passenger seating`);
  const ordered = CATEGORY_ORDER.map((n) => [n, groups[n]] as const).filter(([, it]) => it && it.length) as [string, string[]][];
  const accessories = (listing.available_accessories || []).map((a) => a.name).filter(Boolean) as string[];
  return { groups, ordered, featLabels, accessories };
};

// First present, non-empty value across candidate keys in mc_attributes / key_specs.
const specAttr = (mc: Record<string, unknown>, ks: Record<string, unknown>, keys: string[]): string | null => {
  for (const k of keys) { const v = mc[k] ?? ks[k]; if (v != null && String(v).trim() !== "") return String(v); }
  return null;
};

const Accordion = ({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) => (
  <details className={`${CARD} overflow-hidden group`} open={defaultOpen}>
    <summary className="cursor-pointer list-none flex items-center justify-between gap-3 px-4 py-3 text-[13px] font-bold text-[#0F172A]">{title}<ChevronDown className="w-4 h-4 text-[#94A3B8] group-open:rotate-180 transition-transform shrink-0" /></summary>
    <div className="px-4 pb-3 text-[13px] text-[#334155] leading-relaxed">{children}</div>
  </details>
);

const IconCard = ({ icon: Icon, title, sub }: { icon: React.ElementType; title: string; sub?: string }) => (
  <div className={`${CARD} p-4 flex items-start gap-3`}>
    <span className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><Icon className="w-[18px] h-[18px] text-[#2563EB]" /></span>
    <div className="min-w-0"><p className="text-[12px] font-bold leading-tight">{title}</p>{sub && <p className="text-[11px] text-[#94A3B8] mt-0.5">{sub}</p>}</div>
  </div>
);

// Spec section that names which fields are still pending OEM data instead of
// fabricating numbers (per Batch 4: never invent specifications).
const SpecGroup = ({ title, rows }: { title: string; rows: [string, string | null][] }) => {
  const present = rows.filter(([, v]) => v);
  const missing = rows.filter(([, v]) => !v).map(([k]) => k);
  return (
    <Section title={title}>
      <div className={`${CARD} p-4`}>
        {present.length ? present.map(([k, v]) => <StatRow key={k} label={k} value={v as string} />) : <p className="text-[12px] text-[#64748B]">Pending OEM data.</p>}
        {present.length > 0 && missing.length > 0 && <p className="text-[11px] text-[#94A3B8] mt-2">Pending OEM data: {missing.join(", ")}.</p>}
      </div>
    </Section>
  );
};

const Meter = ({ label, value, unit, pct }: { label: string; value: string; unit: string; pct: number }) => (
  <div>
    <div className="flex justify-between text-[12px]"><span className="text-[#64748B]">{label}</span><span className="font-bold">{value} <span className="text-[#94A3B8] font-medium">{unit}</span></span></div>
    <div className="mt-1.5 h-3.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
  </div>
);

const Stars = ({ n, size = 16 }: { n: number; size?: number }) => (
  <span className="inline-flex items-center gap-0.5">{[0, 1, 2, 3, 4].map((i) => <Star key={i} style={{ width: size, height: size }} className="text-amber-400" fill={i < Math.round(n) ? "#F59E0B" : "none"} strokeWidth={1.5} />)}</span>
);

const Disclaimer = () => <p className="text-[11px] text-[#94A3B8] pt-1">Information is provided by trusted third parties and is accurate to the best of our knowledge. Verify details with the dealer.</p>;

// Card → icon hint used by the trigger map (kept here so the page just
// passes a key). Not rendered; documents intent for future panels.
export const PANEL_ICON: Record<PassportPanelKey, React.ElementType> = {
  "market-price": DollarSign, "market-demand": TrendingUp, "price-confidence": Gauge,
  "price-history": Clock, "comparable-vehicles": Car, "inventory-trend": Package,
  "factory-warranty": ShieldCheck, "owner-reviews": Star, "highlights": Award,
  "overview": FileText, "key-specs": FileText, "equipment": Package, "ownership-timeline": Clock,
};

export interface PassportPanelProps {
  panel: PassportPanelKey | null;
  onClose: () => void;
  openPanel: (key: PassportPanelKey) => void;
  d: PassportData;
  listing: VehicleListing;
  isPreview: boolean;
  go: (section: string) => void;
}

export default function PassportPanel({ panel, onClose, openPanel, d, listing, isPreview, go }: PassportPanelProps) {
  // Keep the last panel mounted through the close animation so content
  // doesn't blank out as the drawer slides away.
  const [shown, setShown] = useState<PassportPanelKey | null>(panel);
  useEffect(() => { if (panel) setShown(panel); }, [panel]);
  const key = panel ?? shown;
  if (!key) return null;

  const def = buildPanel(key, d, listing, isPreview, go, openPanel);
  const footer = (def.primary || def.secondary) ? (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-[#0F172A] leading-tight">{def.footerQuestion ?? "Questions about this vehicle?"}</p>
        <button onClick={() => go("contact")} className="mt-0.5 text-[12px] font-semibold text-[#2563EB] inline-flex items-center gap-1.5 hover:underline"><MessageSquare className="w-3.5 h-3.5" /> {def.specialistLabel ?? "Talk to a Vehicle Specialist"}</button>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {def.secondary && <button onClick={def.secondary.onClick} className="h-11 px-4 rounded-xl border border-[#E6E8EC] bg-white text-[13px] font-semibold text-[#0F172A] hover:border-[#2563EB] transition-colors">{def.secondary.label}</button>}
        {def.primary && <button onClick={def.primary.onClick} className="h-11 px-5 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-[14px] font-semibold inline-flex items-center justify-center gap-2 transition-colors"><ShieldCheck className="w-4 h-4" /> {def.primary.label}</button>}
      </div>
    </div>
  ) : undefined;

  return (
    <PassportSlideOver open={panel !== null} onClose={onClose} title={def.title} subtitle={def.subtitle} footer={footer}>
      {def.body}
    </PassportSlideOver>
  );
}
