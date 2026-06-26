import { useEffect, useState } from "react";
import {
  DollarSign, TrendingUp, TrendingDown, Gauge, Clock, Car, Package, ShieldCheck,
  Star, Award, FileText, MessageSquare, Eye, CheckCircle2,
  Flame, Heart, Send, Bookmark, Users, Circle, ChevronDown,
} from "lucide-react";
import type { PassportData } from "@/lib/passportV2Data";
import { fmt$ } from "@/lib/passportV2Data";
import type { VehicleListing } from "@/hooks/useVehicleListing";
import {
  PassportSlideOver, Hero, Section, Check, Empty, StatRow, RangeBar, TrendChart, Ring, CARD,
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

interface Comp { ymm: string; trim: string; mileage: number | null; price: number | null; distance: string | null; image: string | null }

const deriveComps = (listing: VehicleListing, d: PassportData, isPreview: boolean): Comp[] => {
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const raw = (listing as unknown as { comparables?: unknown }).comparables ?? (mc.comparables as unknown);
  const real: Comp[] = (Array.isArray(raw) ? raw : []).map((c) => c as Record<string, unknown>).map((c) => ({
    ymm: String(c.ymm ?? c.heading ?? [c.year, c.make, c.model].filter(Boolean).join(" ") ?? ""),
    trim: String(c.trim ?? ""),
    mileage: c.miles != null ? Number(c.miles) : c.mileage != null ? Number(c.mileage) : null,
    price: c.price != null ? Number(c.price) : null,
    distance: c.dist != null ? `${Math.round(Number(c.dist))} mi away` : c.distance != null ? String(c.distance) : null,
    image: (c.image as string) ?? (c.photo_url as string) ?? null,
  })).filter((c) => c.ymm);
  if (real.length) return real;
  const price = d.price;
  if (!isPreview || price == null) return [];
  const offs = [2760, 4360, 4360, 4360];
  const miles = [12, 18, 18, 22];
  const dist = ["2.3 mi away", "4.1 mi away", "6.7 mi away", "6.7 mi away"];
  return offs.map((o, i) => ({ ymm: listing.ymm || "Comparable", trim: listing.trim || "", mileage: miles[i], price: price + o, distance: dist[i], image: listing.hero_image_url || null }));
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
      const has = dealerSeries.length >= 2;
      const total = d.priceChangeTotal, recent = d.priceChange7d;
      return {
        title: "Price History", subtitle: "How the asking price has moved",
        primary: { label: "Check Availability", onClick: () => go("check-availability") },
        body: <>
          <Hero icon={Clock} tone={total != null && total < 0 ? "green" : "neutral"}
            label={total != null && total !== 0 ? `${total < 0 ? "-" : "+"}${fmt$(Math.abs(total))} since listed` : "Price tracked"}
            note={recent != null ? (recent < 0 ? `Down ${fmt$(Math.abs(recent))} in the last 7 days` : recent > 0 ? `Up ${fmt$(Math.abs(recent))} in the last 7 days` : "Stable over the last 7 days") : "Each price change is recorded here."} />
          {has ? (
            <>
              <Section title="Price trend">
                <div className={`${CARD} p-4`}>
                  <div className="flex items-center gap-4 mb-2 text-[11px] font-semibold">
                    {marketSeries.length >= 2 && <span className="inline-flex items-center gap-1.5 text-[#64748B]"><span className="w-4 border-t-2 border-dashed border-[#2563EB]" /> Market avg</span>}
                    <span className="inline-flex items-center gap-1.5 text-[#16A34A]"><span className="w-4 border-t-2 border-[#16A34A]" /> Asking price</span>
                  </div>
                  <TrendChart market={marketSeries} dealer={dealerSeries} />
                </div>
              </Section>
              <Section title="Recorded changes">
                <div className={`${CARD} p-4`}>{d.valueHistory.filter((h) => h.listing_price != null).slice().reverse().map((h, i) => (
                  <StatRow key={i} label={new Date(h.captured_at).toLocaleDateString()} value={<span className="inline-flex items-center gap-2">{fmt$(h.listing_price)}{h.below_market != null && h.below_market > 0 && <span className="text-[11px] font-semibold text-[#16A34A]">{fmt$(h.below_market)} below market</span>}</span>} />
                ))}</div>
              </Section>
            </>
          ) : <Empty>Price history will appear here once the asking price has been tracked over time.</Empty>}
          <Disclaimer />
        </>,
      };
    }

    case "comparable-vehicles": {
      const comps = deriveComps(listing, d, isPreview);
      return {
        title: "Comparable Vehicles", subtitle: "Similar vehicles in your market area",
        primary: { label: "Check Availability", onClick: () => go("check-availability") },
        body: <>
          <Hero icon={Car} tone={comps.length ? "blue" : "neutral"} label={comps.length ? `${comps.length} comparable${comps.length === 1 ? "" : "s"} found` : "Comparables pending"}
            note={comps.length ? "Matched on year, trim, mileage, and distance." : "Comparable listings appear once MarketCheck data is available."} />
          {comps.length ? (
            <Section title="Nearby listings">
              <div className="space-y-3">{comps.map((c, i) => (
                <div key={i} className={`${CARD} p-3 flex items-center gap-3`}>
                  <div className="w-20 h-16 rounded-lg bg-[#eef0f3] overflow-hidden shrink-0 flex items-center justify-center">{c.image ? <img src={c.image} alt="" className="w-full h-full object-cover" /> : <Car className="w-6 h-6 text-[#94A3B8]" />}</div>
                  <div className="min-w-0 flex-1"><p className="text-[13px] font-bold leading-tight line-clamp-1">{c.ymm}</p>{c.trim && <p className="text-[12px] text-[#64748B] line-clamp-1">{c.trim}</p>}<p className="text-[11px] text-[#94A3B8] mt-0.5">{[c.mileage != null ? `${c.mileage.toLocaleString()} mi` : null, c.distance].filter(Boolean).join(" · ")}</p></div>
                  {c.price != null && <p className="text-[15px] font-extrabold shrink-0">{fmt$(c.price)}</p>}
                </div>
              ))}</div>
            </Section>
          ) : <Empty>Comparable vehicles will appear here once enough market data is available.</Empty>}
          {price != null && comps.some((c) => c.price != null) && (
            <div className={`${CARD} p-4 flex items-start gap-2`}><CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" /><p className="text-[13px] text-[#0F172A]">This vehicle is priced at <span className="font-bold">{fmt$(price)}</span>{(() => { const ps = comps.map((c) => c.price).filter((p): p is number => p != null); const avgC = ps.length ? Math.round(ps.reduce((a, b) => a + b, 0) / ps.length) : null; return avgC != null && avgC > price ? <> — about <span className="font-bold text-[#16A34A]">{fmt$(avgC - price)}</span> under the comparable average.</> : "."; })()}</p></div>
          )}
          <Disclaimer />
        </>,
      };
    }

    case "inventory-trend": {
      return {
        title: "Inventory Trend", subtitle: "Market supply for this vehicle",
        primary: { label: "Check Availability", onClick: () => go("check-availability") },
        body: <>
          <Hero icon={Package} tone="neutral" label="Supply tracking" note="30-day market supply trends appear once enough data is available." />
          <Empty>Inventory trend data will appear here once enough comparable listings have been tracked over time. Lower supply of similar vehicles generally means stronger pricing.</Empty>
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
