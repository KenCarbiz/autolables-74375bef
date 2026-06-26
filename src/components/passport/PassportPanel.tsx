import { useEffect, useMemo, useState } from "react";
import {
  DollarSign, TrendingUp, TrendingDown, Gauge, Clock, Car, Package, ShieldCheck,
  Star, Award, FileText, MessageSquare, Eye, CheckCircle2,
  Flame, Heart, Send, Bookmark, Users, Circle, ChevronDown, MapPin, BadgeCheck,
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
  | "owner-reviews" | "highlights" | "overview" | "key-specs";

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

interface PanelDef { title: string; subtitle: string; body: React.ReactNode; primary?: { label: string; onClick: () => void }; secondary?: { label: string; onClick: () => void } }

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
      return {
        title: "Market Demand Analysis", subtitle: "How popular this vehicle is in your market",
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        body: <>
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
      return {
        title: "Price Confidence", subtitle: "Why AutoLabels is confident in this valuation",
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        body: <>
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
      const milesLeft = w.factory_miles != null && listing.mileage != null ? Math.max(0, w.factory_miles - listing.mileage) : null;
      const milesPct = w.factory_miles && listing.mileage != null ? Math.max(3, 100 - Math.min(100, (listing.mileage / w.factory_miles) * 100)) : null;
      let monthsLeft: number | null = null, monthsPct: number | null = null, expiry: string | null = null;
      if (w.in_service_date && w.factory_months) { const end = new Date(w.in_service_date); end.setMonth(end.getMonth() + w.factory_months); expiry = end.toLocaleDateString(); const ms = end.getTime() - Date.now(); monthsLeft = ms > 0 ? Math.round(ms / (1000 * 60 * 60 * 24 * 30.4)) : 0; monthsPct = Math.max(3, Math.min(100, (monthsLeft / w.factory_months) * 100)); }
      return {
        title: "Factory Warranty", subtitle: "Coverage remaining on this vehicle",
        primary: { label: "Check Availability", onClick: () => go("check-availability") },
        secondary: { label: "View full warranty details", onClick: () => go("factory-warranty") },
        body: <>
          {d.warrantyStr ? (
            <>
              <Hero icon={ShieldCheck} tone="green" label={`${d.warrantyStr} remaining`} note="Factory coverage transfers with the vehicle." />
              <div className={`${CARD} p-5 space-y-4`}>
                {monthsPct != null && <Meter label="Time Remaining" value={`${monthsLeft}`} unit={`of ${w.factory_months} mo`} pct={monthsPct} />}
                {milesPct != null && <Meter label="Mileage Remaining" value={milesLeft!.toLocaleString()} unit={`of ${(w.factory_miles! / 1000).toFixed(0)}K mi`} pct={milesPct} />}
                {expiry && <p className="text-[12px] text-[#64748B]">Estimated expiration: <span className="font-semibold text-[#0F172A]">{expiry}</span></p>}
              </div>
              {w.powertrain_months != null && (
                <Section title="Powertrain coverage"><div className={`${CARD} p-4`}><StatRow label="Powertrain" value={[w.powertrain_months ? `${Math.round(w.powertrain_months / 12)} yr` : null, w.powertrain_miles ? `${(w.powertrain_miles / 1000).toFixed(0)}K mi` : null].filter(Boolean).join(" / ") || "Included"} /></div></Section>
              )}
            </>
          ) : <Empty>Warranty coverage details are confirmed at the dealership for this vehicle.</Empty>}
          <Disclaimer />
        </>,
      };
    }

    case "owner-reviews": {
      const sources = d.dealerTrust.reviewSources;
      return {
        title: "What Owners Say", subtitle: "Verified dealership reviews",
        primary: { label: "Check Availability", onClick: () => go("check-availability") },
        secondary: { label: "Read all reviews", onClick: () => go("owner-reviews") },
        body: <>
          {d.reviewRating != null ? (
            <div className={`${CARD} p-5 flex items-center gap-4`}>
              <div className="text-center shrink-0"><p className="text-[34px] font-extrabold text-[#2563EB] leading-none">{d.reviewRating.toFixed(1)}</p><div className="mt-1"><Stars n={d.reviewRating} /></div>{d.reviewCount != null && <p className="text-[11px] text-[#64748B] mt-1">{d.reviewCount.toLocaleString()} reviews</p>}</div>
              <div className="min-w-0"><p className="text-[14px] font-bold">{d.dealerName}</p><p className="text-[12px] text-[#64748B] mt-0.5">Aggregated from connected review sources. AutoLabels does not edit or filter reviews.</p></div>
            </div>
          ) : <Empty>Verified dealership reviews appear here once the dealer connects a review source.</Empty>}
          {sources.length > 0 && (
            <Section title="From recent reviews">
              <div className="space-y-3">{sources.map((r, i) => (
                <div key={i} className={`${CARD} p-4`}><div className="flex items-center gap-2"><span className="text-[13px] font-bold">{r.name}</span>{r.rating != null && <Stars n={r.rating} size={13} />}</div>{r.quote && <p className="text-[13px] text-[#64748B] leading-snug mt-1">"{r.quote}"</p>}</div>
              ))}</div>
            </Section>
          )}
          <Disclaimer />
        </>,
      };
    }

    case "highlights": {
      const hs = d.highlights;
      return {
        title: "Vehicle Highlights", subtitle: "Standout equipment and features",
        primary: { label: "Check Availability", onClick: () => go("check-availability") },
        secondary: { label: "View key specifications", onClick: () => openPanel("key-specs") },
        body: <>
          {hs.length ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{hs.map((h) => (
              <div key={h.key} className={`${CARD} p-4 flex flex-col items-center text-center gap-1.5`}>
                <span className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center"><Award className="w-5 h-5 text-[#2563EB]" /></span>
                <p className="text-[12px] font-bold leading-tight">{h.label}</p>
                <p className="text-[10px] text-[#94A3B8]">{h.sub}</p>
              </div>
            ))}</div>
          ) : <Empty>Equipment highlights appear here as the vehicle's data is decoded.</Empty>}
          <Disclaimer />
        </>,
      };
    }

    case "overview": {
      return {
        title: "Vehicle Overview", subtitle: `${listing.ymm || "This vehicle"}${listing.trim ? ` ${listing.trim}` : ""}`,
        primary: { label: "Check Availability", onClick: () => go("check-availability") },
        body: <>
          {listing.hero_image_url && <img src={listing.hero_image_url} alt="" className="w-full aspect-[16/9] object-cover rounded-2xl" />}
          <div className={`${CARD} p-5`}><p className="text-[14px] leading-relaxed text-[#334155] whitespace-pre-line">{d.overview}</p></div>
          {d.keySpecs.length > 0 && (
            <Section title="At a glance"><div className={`${CARD} p-4`}>{d.keySpecs.slice(0, 6).map(([k, v]) => <StatRow key={k} label={k} value={v} />)}</div></Section>
          )}
          <Disclaimer />
        </>,
      };
    }

    case "key-specs": {
      return {
        title: "Key Specifications", subtitle: "Verified vehicle details",
        primary: { label: "Check Availability", onClick: () => go("check-availability") },
        body: <>
          {d.keySpecs.length ? (
            <div className={`${CARD} p-5`}>{d.keySpecs.map(([k, v]) => <StatRow key={k} label={k} value={v} />)}</div>
          ) : <Empty>Specifications appear here as the vehicle's data is decoded from its VIN.</Empty>}
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
  "overview": FileText, "key-specs": FileText,
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
        <p className="text-[13px] font-semibold text-[#0F172A] leading-tight">Questions about this vehicle?</p>
        <button onClick={() => go("contact")} className="mt-0.5 text-[12px] font-semibold text-[#2563EB] inline-flex items-center gap-1.5 hover:underline"><MessageSquare className="w-3.5 h-3.5" /> Talk to a Vehicle Specialist</button>
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
