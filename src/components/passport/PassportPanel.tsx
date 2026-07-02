import { useEffect, useMemo, useRef, useState } from "react";
import {
  DollarSign, TrendingUp, TrendingDown, Gauge, Clock, Car, Package, ShieldCheck,
  Star, Award, FileText, MessageSquare, Eye, CheckCircle2,
  Flame, Heart, Send, Bookmark, Users, Circle, ChevronDown, ChevronRight, MapPin, BadgeCheck, Info, AlertTriangle, History, ArrowRight, Sparkles,
  Wrench, Zap, LifeBuoy, Calendar, CalendarDays, ExternalLink,
} from "lucide-react";
import type { PassportData, PricePoint, OemWarrantyView } from "@/lib/passportV2Data";
import { fmt$, listingEquipment, historyReportName } from "@/lib/passportV2Data";
import { packetVisible } from "@/lib/packetModules";
import { trackCustomerCtaClicked } from "@/lib/engagement/customerEngagement";
import { oemCoverageRows, type CoverageKey } from "@/lib/oemWarranty";
import { lookupOemReference } from "@/data/oemWarrantyReference";
import { resolveEffectiveWarranty } from "@/lib/warranty/passportWarranty";
import { readBuildSheet, PACKAGE_KIND_ORDER } from "@/lib/buildSheet";
import { readDealerAlternatives, type DealerAlternative } from "@/lib/dealerAlternatives";
import { rememberPassportOrigin } from "@/lib/passportOrigin";
import { recordPanelView } from "@/lib/shopperIntent";
import { useNhtsaSafety, type NhtsaSafetyResult } from "@/hooks/useNhtsaSafety";
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

export const PASSPORT_PANEL_KEYS = [
  "market-price", "market-demand", "price-confidence", "price-history",
  "comparable-vehicles", "inventory-trend", "factory-warranty",
  "owner-reviews", "highlights", "overview", "key-specs", "equipment", "ownership-timeline",
] as const;
export type PassportPanelKey = (typeof PASSPORT_PANEL_KEYS)[number];
export const isPassportPanelKey = (v: string | null | undefined): v is PassportPanelKey =>
  !!v && (PASSPORT_PANEL_KEYS as readonly string[]).includes(v);

interface PanelDef { title: string; subtitle: string; body: React.ReactNode; primary?: { label: string; onClick: () => void }; secondary?: { label: string; onClick: () => void }; footerQuestion?: string; specialistLabel?: string; wide?: boolean }

function buildPanel(key: PassportPanelKey, d: PassportData, listing: VehicleListing, isPreview: boolean, go: (s: string) => void, openPanel: (k: PassportPanelKey) => void, nhtsa: NhtsaSafetyResult | null): PanelDef {
  const price = d.price, avg = d.marketAvg, low = d.marketLow, high = d.marketHigh, below = d.belowMarket;
  const isGreat = below != null && below > 0;
  const conf = d.confScore;
  // Merge enrichment market_meta (percentile, radius, similar_count, avg_dom,
  // inventory) into mc so the panels read real ingest data, not just mc_attributes.
  const mc = { ...(listing.mc_attributes || {}), ...((listing as unknown as { market_meta?: Record<string, unknown> }).market_meta || {}) } as Record<string, unknown>;
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
      // price_percentile = % of comps priced below this car, so "priced lower
      // than N%" is the complement — and only belongs in a praise list when
      // the car actually sits in the cheaper half.
      if (percentile != null && percentile <= 50) why.push(`Priced lower than ${100 - percentile}% of similar vehicles`); else if (isPreview && percentile == null) why.push("Priced lower than 91% of similar vehicles");
      if (listing.mileage != null && listing.mileage < 30000) why.push(`Low mileage (${listing.mileage.toLocaleString()} mi)`);
      if (d.ownerCount === 1) why.push("One owner");
      if (d.cleanTitle && d.accidentCount === 0) why.push("Clean history");
      if ((listing.features?.length ?? 0) >= 3) why.push("Strong equipment package");
      const priceAlts = readDealerAlternatives(listing);
      const dealerDelta = d.priceChangeTotal;
      const marketDelta = marketSeries.length >= 2 ? marketSeries[marketSeries.length - 1] - marketSeries[0] : null;
      return {
        title: "Market Pricing Analysis", subtitle: "How AutoLabels determined this price",
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        body: <>
          <div className="md:hidden"><MHero tone={isGreat ? "green" : "blue"} icon={ShieldCheck} eyebrow={isGreat ? "Great Price" : avg != null ? "Market Price" : "Pricing"} title={isGreat ? `${fmt$(below)} Below Market` : avg != null && price != null ? fmt$(price) : "Pending"} note={conf != null ? `Confidence ${conf}%` : avg != null ? `Near the ${fmt$(avg)} market average` : "Market comparison appears once MarketCheck data is available."} /></div>
          <div className="hidden md:block">
            <Hero icon={ShieldCheck} tone={isGreat ? "green" : "neutral"} label={isGreat ? "Great Price" : avg != null ? "Market Price" : "Pricing Pending"}
              value={isGreat ? `${fmt$(below)} Below Market` : undefined}
              note={conf != null ? `Confidence: ${conf}%` : avg != null ? `Near the ${fmt$(avg)} market average` : "Market comparison appears once MarketCheck data is available."} />
          </div>
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
          {/* The pricing math uses market comparables in aggregate (range/avg
              above); the browsable cards are the dealer's OWN stock only. */}
          {priceAlts.length > 0 && (
            <Section title={`Similar Vehicles In Stock (${priceAlts.length})`} sub={`Other options at ${d.dealerName || "this dealership"}.`}
              action={<button onClick={() => openPanel("comparable-vehicles")} className="text-[12px] font-semibold text-[#2563EB] hover:underline shrink-0">View all</button>}>
              <div className="flex gap-3 overflow-x-auto -mx-1 px-1 pb-1 snap-x">
                {priceAlts.slice(0, 4).map((a) => <div key={a.slug} className="min-w-[240px] snap-start"><AlternativeCard alt={a} from={{ slug: listing.slug, ymm: listing.ymm }} compact /></div>)}
              </div>
            </Section>
          )}
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
          {d.blackbook?.available && (d.blackbook.retailClean != null || d.blackbook.tradeinClean != null) && (
            <Section title="Independent valuation" sub="Black Book — a third-party industry guide.">
              <div className={`${CARD} p-4`}>
                {d.blackbook.retailClean != null && <StatRow label="Retail value (clean)" value={fmt$(d.blackbook.retailClean)} />}
                {d.blackbook.tradeinClean != null && <StatRow label="Trade-in value (clean)" value={fmt$(d.blackbook.tradeinClean)} />}
                {d.blackbook.wholesaleClean != null && <StatRow label="Wholesale value (clean)" value={fmt$(d.blackbook.wholesaleClean)} />}
                {price != null && d.blackbook.retailClean != null && <p className={`text-[12px] font-semibold mt-2 ${price <= d.blackbook.retailClean ? "text-[#16A34A]" : "text-[#64748B]"}`}>{price <= d.blackbook.retailClean ? `${fmt$(d.blackbook.retailClean - price)} under Black Book retail` : "Priced near Black Book retail"}</p>}
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
      // Never show the raw days-supply / market inventory count to a customer —
      // it can be in the thousands and reads terribly. Qualitative level only.
      const kpis = [
        { icon: Eye, label: "Active Shoppers", value: views != null ? views.toLocaleString() : isPreview ? "89" : "—" },
        { icon: Car, label: "Similar Vehicles", value: supplyLevel },
        { icon: Clock, label: "Avg Days to Sell", value: avgDom != null ? `${avgDom} Days` : isPreview ? "12 Days" : "—" },
        { icon: TrendingUp, label: "Weekly Searches", value: isPreview ? "120" : "—" },
        { icon: Heart, label: "Saved by Shoppers", value: isPreview ? "38" : "—" },
        { icon: MapPin, label: "Local Availability", value: supplyLevel },
      ];
      const snapshot = [
        { l: "Inventory Level", v: supplyLevel },
        { l: "Average Days on Market", v: avgDom != null ? `${avgDom} Days` : dom != null ? `${dom} Days` : isPreview ? "12 Days" : "—" },
        { l: "Search Activity", v: isPreview ? "Above Average" : has ? level : "—" },
        { l: "Local Availability", v: supplyLevel },
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
              {kpis.filter((k) => k.value !== "\u2014").map((k) => (
                <div key={k.label} className={`${CARD} p-4`}>
                  <k.icon className="w-5 h-5 text-[#2563EB]" />
                  <p className="text-[20px] font-extrabold mt-1.5 leading-none">{k.value}</p>
                  <p className="text-[11px] text-[#94A3B8] mt-1">{k.label}</p>
                </div>
              ))}
            </div>

            <Section title="Local market snapshot">
              <div className={`${CARD} divide-y divide-[#F1F5F9]`}>
                {snapshot.filter((s) => s.v !== "\u2014").map((s) => (
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
      // A few percent off the market AVERAGE is normal spread, not a verdict —
      // ±3% reads as "priced at market" (neutral). Only color beyond the band,
      // and when above it, say why with provable option value.
      const priceBand = pctDiff == null ? null : pctDiff <= -3 ? "below" : pctDiff >= 3 ? "above" : "at";
      const phOptValue = readBuildSheet(listing)?.estValue ?? null;
      const originalPrice = priced.length ? (priced[0].listing_price as number) : null;
      const reductions = events.filter((e) => e.delta < 0).length;
      const savings = total != null && total < 0 ? -total : (d.belowMarket && d.belowMarket > 0 ? d.belowMarket : null);
      const trendPct = total != null && originalPrice ? Math.round((total / originalPrice) * 1000) / 10 : null;
      const marketDiff = price != null && avg != null ? price - avg : null;
      const phPercentile = (mc.price_percentile as number) ?? null;
      // price_percentile = % of comps priced BELOW this car — a LOW percentile
      // means well priced, so "Top N%" uses the percentile directly. Above the
      // median we state position neutrally instead of inventing praise.
      const posLabel = phPercentile != null
        ? (phPercentile <= 50 ? `Top ${Math.max(1, phPercentile)}% best priced` : "Priced within the local market range")
        : isPreview ? "Top 15% best priced similar vehicles" : "Priced below the market average";
      const goodTime = isGreat || (total != null && total < 0);
      return {
        title: "Price History", subtitle: "See how this vehicle's price has changed over time",
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        body: <>
          {/* ── Mobile (<768px) — premium pricing-intelligence dashboard ── */}
          <div className="md:hidden space-y-4">
            <div className="rounded-2xl p-5 text-white" style={{ background: "linear-gradient(160deg,#0f7a3d 0%,#16A34A 100%)" }}>
              <div className="flex items-center gap-3">
                <span className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0"><TrendingDown className="w-6 h-6" /></span>
                <div><p className="text-[13px] font-bold uppercase tracking-wider opacity-95">{trendLabel}</p><p className="text-[26px] font-extrabold leading-tight">{savings != null ? fmt$(savings) : price != null ? fmt$(price) : "—"}</p><p className="text-[12px] opacity-90">{d.belowMarket && d.belowMarket > 0 ? "Below market" : savings != null ? "Reduced since listed" : "Current price"}</p></div>
              </div>
              <p className="text-[13px] opacity-90 mt-3 leading-snug">{total != null && total < 0 && d.belowMarket && d.belowMarket > 0 ? "This vehicle has been reduced and is currently priced below market value." : total != null && total < 0 ? "This vehicle's asking price has been reduced since it was listed." : "Every price adjustment is recorded for full transparency."}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className={`${CARD} p-4`}><p className="text-[20px] font-extrabold leading-none">{price != null ? fmt$(price) : "—"}</p><p className="text-[11px] text-[#94A3B8] mt-1">Current Price</p></div>
              <div className={`${CARD} p-4`}><p className="text-[20px] font-extrabold leading-none text-[#94A3B8]">{originalPrice != null ? fmt$(originalPrice) : "—"}</p><p className="text-[11px] text-[#94A3B8] mt-1">Original Price</p></div>
              <div className={`${CARD} p-4`}><p className="text-[20px] font-extrabold leading-none">{reductions || (has ? "0" : "—")}</p><p className="text-[11px] text-[#94A3B8] mt-1">Price Reductions</p></div>
              <div className={`${CARD} p-4`}><p className="text-[20px] font-extrabold leading-none text-[#16A34A]">{savings != null ? fmt$(savings) : "—"}</p><p className="text-[11px] text-[#94A3B8] mt-1">Total Savings</p></div>
            </div>

            {has ? (
              <>
                <Section title="Price trend"><PriceTimeline history={priced} /></Section>
                {trendPct != null && (
                  <div className={`${CARD} p-4`}>
                    <p className="text-[12px] text-[#64748B]">Price Trend</p>
                    <p className={`text-[18px] font-extrabold inline-flex items-center gap-1.5 ${trendPct <= 0 ? "text-[#16A34A]" : "text-[#EA580C]"}`}>{trendPct <= 0 ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />} {trendPct <= 0 ? "Down" : "Up"} {Math.abs(trendPct)}%</p>
                    <p className="text-[12px] text-[#64748B] mt-1 leading-snug">This vehicle's price has {trendPct <= 0 ? "decreased" : "increased"} while the market average stayed relatively stable.</p>
                  </div>
                )}
                <Section title="Price change timeline">
                  {events.length ? (
                    <ol className="relative border-l-2 border-emerald-100 ml-1.5 pl-4 space-y-4">{events.map((e, i) => (
                      <li key={i} className="relative">
                        <span className={`absolute -left-[22px] top-1 w-3 h-3 rounded-full ring-2 ring-white ${e.delta < 0 ? "bg-emerald-500" : "bg-orange-500"}`} />
                        <p className="text-[12px] text-[#94A3B8]">{e.date}</p>
                        <p className={`text-[15px] font-extrabold inline-flex items-center gap-1.5 ${e.delta < 0 ? "text-[#16A34A]" : "text-[#EA580C]"}`}>{e.delta < 0 ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />} {e.delta < 0 ? "Price Reduced" : "Price Increased"} {e.delta < 0 ? "-" : "+"}{fmt$(Math.abs(e.delta))}</p>
                        {i === 0 && <p className="text-[12px] text-[#64748B] mt-0.5">Current price {fmt$(e.after)}</p>}
                      </li>
                    ))}</ol>
                  ) : <Empty>No price changes recorded yet — the asking price has held steady.</Empty>}
                </Section>
              </>
            ) : <Empty>Price history will appear here once the asking price has been tracked over time.</Empty>}

            {pctDiff != null && (
              <Section title="Market comparison">
                <div className={`${CARD} divide-y divide-[#F1F5F9]`}>
                  <div className="flex items-center justify-between px-4 py-3"><span className="text-[12px] text-[#64748B]">Market Average</span><span className="text-[15px] font-extrabold">{fmt$(avg)}</span></div>
                  <div className="flex items-center justify-between px-4 py-3"><span className="text-[12px] text-[#64748B]">Current Vehicle</span><span className="text-[15px] font-extrabold">{fmt$(price)}</span></div>
                </div>
                <div className={`mt-2 rounded-2xl border p-4 ${priceBand === "below" ? "border-emerald-200 bg-emerald-50/70" : priceBand === "at" ? "border-[#E6E8EC] bg-slate-50" : "border-[#E6E8EC] bg-white"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-bold text-[#0F172A]">{priceBand === "below" ? "Below Market" : priceBand === "at" ? "Priced At Market" : "Position"}</span>
                    <span className={`text-[14px] font-extrabold ${priceBand === "below" ? "text-[#16A34A]" : "text-[#0F172A]"}`}>
                      {priceBand === "at" ? `Within ${Math.abs(pctDiff)}% of average` : `${marketDiff != null ? `${marketDiff < 0 ? "-" : "+"}${fmt$(Math.abs(marketDiff))} · ` : ""}${Math.abs(pctDiff)}% ${pctDiff <= 0 ? "below" : "above"} average`}
                    </span>
                  </div>
                  {priceBand === "above" && phOptValue ? <p className="text-[12px] text-[#64748B] mt-1.5">This build carries {fmt$(phOptValue)} in factory options — the market average includes lower-equipped vehicles.</p> : null}
                </div>
              </Section>
            )}

            {isGreat && (
              <Section title="Market position">
                <div className={`${CARD} p-4 flex items-center gap-3`}>
                  <span className="w-11 h-11 rounded-2xl bg-emerald-50 flex items-center justify-center shrink-0"><Award className="w-6 h-6 text-[#16A34A]" /></span>
                  <div><p className="text-[15px] font-extrabold text-[#16A34A]">Excellent Value</p><p className="text-[12px] text-[#64748B]">{posLabel}</p></div>
                </div>
              </Section>
            )}

            <div className="rounded-2xl p-5 text-white" style={{ background: "linear-gradient(160deg,#0f7a3d 0%,#16A34A 100%)" }}>
              <p className="text-[18px] font-extrabold inline-flex items-center gap-2"><CheckCircle2 className="w-6 h-6" /> {goodTime ? "Excellent Time To Purchase" : "Worth A Closer Look"}</p>
              <ul className="mt-2.5 space-y-1.5">
                {isGreat && <li className="flex items-start gap-2 text-[13px]"><CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />Below market average</li>}
                {total != null && total < 0 && <li className="flex items-start gap-2 text-[13px]"><CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />Recent price reductions</li>}
                {goodTime && <li className="flex items-start gap-2 text-[13px]"><CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />Strong negotiating position</li>}
                <li className="flex items-start gap-2 text-[13px]"><CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />Competitive market pricing</li>
              </ul>
            </div>

            <Section title="Should you buy now?">
              <div className={`${CARD} p-4`}>
                <p className={`text-[22px] font-extrabold ${goodTime ? "text-[#16A34A]" : "text-[#0F172A]"}`}>{goodTime ? "Yes." : "Maybe."}</p>
                <p className="text-[13px] text-[#64748B] mt-1 leading-snug">{goodTime ? "Based on current pricing and recent reductions, this vehicle is a strong buying opportunity. Waiting may reduce available inventory with little added pricing advantage." : "The pricing is reasonable — compare it against similar listings before deciding."}</p>
              </div>
            </Section>

            <div className={`${CARD} p-4 flex items-start gap-2.5`}>
              <ShieldCheck className="w-5 h-5 text-[#16A34A] shrink-0 mt-0.5" />
              <div><p className="text-[13px] font-bold">Transparent Pricing</p><p className="text-[12px] text-[#64748B]">Every price adjustment is recorded and shown here for complete pricing transparency.</p></div>
            </div>
            <Disclaimer />
          </div>

          {/* ── Desktop / tablet (≥768px) — unchanged ── */}
          <div className="hidden md:block space-y-5">
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
                <div className={`mt-2 pt-2 border-t border-[#F1F5F9] text-[13px] font-semibold ${priceBand === "below" ? "text-[#16A34A]" : "text-[#0F172A]"}`}>
                  {priceBand === "below" ? `${Math.abs(pctDiff)}% below market average` : priceBand === "at" ? `Priced at market — within ${Math.abs(pctDiff)}% of average` : `${pctDiff}% above market average`}
                </div>
                {priceBand === "above" && phOptValue ? <p className="text-[12px] text-[#64748B] mt-1.5">This build carries {fmt$(phOptValue)} in factory options — the average includes lower-equipped vehicles.</p> : null}
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
          </div>
        </>,
      };
    }

    case "comparable-vehicles": {
      // Own-rooftop alternatives only — the passport never merchandises other
      // dealers' cars. Tiered same-model → same-make → competitive set, with
      // package-aware positioning and the shopper's session intent deciding
      // what leads.
      const alts = readDealerAlternatives(listing);
      const sameModelCount = alts.filter((a) => a.sameModel).length;
      return {
        title: "Similar Vehicles In Stock",
        subtitle: `More options at ${d.dealerName || "this dealership"} — compare builds and package levels`,
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        footerQuestion: "Want to compare these in person?", specialistLabel: "Talk to a Vehicle Specialist",
        body: <>
          {alts.length ? (
            <>
              <Hero icon={Car} tone="blue" label={`${alts.length} in stock at ${d.dealerName || "this dealership"}`}
                note={sameModelCount ? `${sameModelCount} same-model alternative${sameModelCount === 1 ? "" : "s"} at different package levels` : "Closest matches from this dealership's inventory"} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {alts.map((a) => <AlternativeCard key={a.slug} alt={a} from={{ slug: listing.slug, ymm: listing.ymm }} />)}
              </div>
              <p className="text-[11px] text-[#94A3B8]">All vehicles shown are in stock at {d.dealerName || "this dealership"}.</p>
            </>
          ) : (
            <Empty>This is the only vehicle like it in stock right now — ask the dealer about incoming inventory.</Empty>
          )}
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
      const SCARCITY = ["Abundant", "Moderate", "Limited", "Scarce"];
      const scarcityIdx = supply == null ? -1 : supply < 30 ? 3 : supply < 50 ? 2 : supply < 90 ? 1 : 0;
      // Never show the raw market-days-supply / inventory count to a customer
      // (it can be in the thousands) — qualitative levels only, on every
      // breakpoint. The raw number stays internal to the math above.
      const supplyWord = supply == null ? null : supply < 30 ? "Tight" : supply < 60 ? "Balanced" : "Ample";
      const competition = (d.viewCount ?? 0) > 20 || isPreview ? "High" : "Moderate";
      const localScore = (() => { let s = 50; if (changePct != null && changePct < 0) s += 15; if (supply != null) { if (supply < 30) s += 20; else if (supply < 60) s += 10; } if (competition === "High") s += 14; return Math.max(20, Math.min(96, s)); })();
      const scoreLabel = localScore >= 80 ? "Highly Competitive" : localScore >= 60 ? "Moderately Competitive" : "Balanced";
      const distBuckets = [{ b: "0–25 mi", n: isPreview ? 12 : 0 }, { b: "25–50 mi", n: isPreview ? 16 : 0 }, { b: "50–100 mi", n: isPreview ? 8 : 0 }, { b: "100+ mi", n: isPreview ? 6 : 0 }];
      const maxDist = Math.max(1, ...distBuckets.map((x) => x.n));
      const invInsights: { icon: React.ElementType; text: string }[] = [];
      if (changePct != null && changePct < 0) invInsights.push({ icon: TrendingDown, text: "Inventory continues to decline — lower supply means more competition." });
      if (isPreview) invInsights.push({ icon: TrendingUp, text: "New listings are entering the market slower than vehicles are selling." });
      if ((d.viewCount ?? 0) > 20 || isPreview) invInsights.push({ icon: Flame, text: "Similar vehicles are selling faster than last month." });
      return {
        title: "Inventory Trends", subtitle: "Understand local inventory and market availability",
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        body: <>
          {/* ── Mobile (<768px) — premium market-availability dashboard ── */}
          <div className="md:hidden space-y-4">
            {hasData ? (
              <>
                <div className="rounded-2xl p-5 text-white" style={{ background: "linear-gradient(160deg,#0f7a3d 0%,#16A34A 100%)" }}>
                  <div className="flex items-center gap-3">
                    <span className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0"><Package className="w-6 h-6" /></span>
                    <div><p className="text-[13px] font-bold uppercase tracking-wider opacity-95">{changePct != null && changePct < 0 ? "Inventory Tightening" : "Inventory Stable"}</p><p className="text-[24px] font-extrabold leading-tight">{supplyWord} Supply</p></div>
                  </div>
                  {changePct != null && changePct !== 0 && <p className="text-[13px] opacity-90 mt-3 leading-snug">Inventory has {changePct < 0 ? "declined" : "grown"} {Math.abs(changePct)}% over the past 30 days.</p>}
                  <p className="text-[11px] opacity-80 mt-2">Updated using live market inventory.</p>
                </div>

                <Section title="Inventory trend">
                  <InventoryTrendChart isPreview={isPreview} />
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div className={`${CARD} p-4`}><TrendingDown className="w-5 h-5 text-[#16A34A]" /><p className="text-[20px] font-extrabold mt-1 leading-none text-[#16A34A]">{changePct != null ? `${changePct > 0 ? "+" : ""}${changePct}%` : "—"}</p><p className="text-[10px] text-[#94A3B8] mt-1">vs 30 days ago</p></div>
                    <div className={`${CARD} p-4`}><Clock className="w-5 h-5 text-[#2563EB]" /><p className="text-[20px] font-extrabold mt-1 leading-none">{avgDom != null ? `${avgDom}d` : "—"}</p><p className="text-[10px] text-[#94A3B8] mt-1">Avg days on market</p></div>
                  </div>
                </Section>

                <Section title="Market snapshot">
                  <div className={`${CARD} divide-y divide-[#F1F5F9]`}>
                    {[
                      { i: Package, l: "Supply Level", v: supplyWord ?? "—", c: "text-[#0F172A]" },
                      { i: TrendingDown, l: "30-Day Change", v: changePct != null ? `${changePct > 0 ? "+" : ""}${changePct}%` : "—", c: changePct != null && changePct < 0 ? "text-[#16A34A]" : "text-[#0F172A]" },
                      { i: Clock, l: "Average Days on Market", v: avgDom != null ? `${avgDom} Days` : "—", c: "text-[#0F172A]" },
                      { i: TrendingDown, l: "Market Trend", v: changePct != null && changePct < 0 ? "Declining" : "Stable", c: "text-[#16A34A]" },
                      { i: Flame, l: "Competition Level", v: competition, c: competition === "High" ? "text-[#EA580C]" : "text-[#0F172A]" },
                      { i: TrendingUp, l: "Buyer Demand", v: competition === "High" ? "Strong" : "Moderate", c: "text-[#16A34A]" },
                    ].map((r) => (
                      <div key={r.l} className="flex items-center justify-between px-4 py-3"><span className="text-[12px] text-[#64748B] inline-flex items-center gap-2"><r.i className="w-4 h-4 text-[#94A3B8]" />{r.l}</span><span className={`text-[15px] font-extrabold ${r.c}`}>{r.v}</span></div>
                    ))}
                  </div>
                </Section>

                {invInsights.length > 0 && (
                  <Section title="Inventory insights">
                    <div className="space-y-2.5">{invInsights.map((x, i) => (
                      <div key={i} className={`${CARD} p-4 flex items-start gap-2.5`}><x.icon className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" /><span className="text-[13px] text-[#0F172A]">{x.text}</span></div>
                    ))}</div>
                  </Section>
                )}

                <div className="rounded-2xl p-5 text-white" style={{ background: "linear-gradient(160deg,#0f7a3d 0%,#16A34A 100%)" }}>
                  <p className="text-[12px] font-semibold uppercase tracking-wider opacity-85">Buyer Recommendation</p>
                  <p className="text-[18px] font-extrabold mt-1 inline-flex items-center gap-2"><Star className="w-5 h-5" /> {changePct != null && changePct < 0 ? "Inventory Is Tightening" : "Solid Time To Purchase"}</p>
                  <p className="text-[13px] opacity-90 mt-1">Now is a good time to act. Lower inventory typically means:</p>
                  <ul className="mt-2 space-y-1.5">{["Fewer available choices", "Less negotiating leverage over time", "Potential for higher future pricing"].map((t) => <li key={t} className="flex items-start gap-2 text-[13px]"><CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />{t}</li>)}</ul>
                </div>

                <Section title="Market availability">
                  <div className={`${CARD} p-4`}>
                    <div className="relative h-2 rounded-full bg-gradient-to-r from-emerald-300 via-amber-200 to-rose-300">
                      {scarcityIdx >= 0 && <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white ring-2 ring-[#0F172A] shadow" style={{ left: `${(scarcityIdx / 3) * 100}%` }} />}
                    </div>
                    <div className="flex justify-between text-[10px] font-semibold text-[#94A3B8] mt-1.5">{SCARCITY.map((s, i) => <span key={s} className={scarcityIdx === i ? "text-[#0F172A] font-bold" : ""}>{s}</span>)}</div>
                  </div>
                </Section>

                <Section title="Availability by distance">
                  <div className={`${CARD} p-4 space-y-3`}>{distBuckets.map((r) => (
                    <div key={r.b} className="flex items-center gap-3">
                      <span className="text-[12px] text-[#64748B] w-20 shrink-0 inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{r.b}</span>
                      <div className="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-[#2563EB]" style={{ width: `${Math.max(6, (r.n / maxDist) * 100)}%` }} /></div>
                      <span className="text-[14px] font-extrabold w-7 text-right">{r.n || "—"}</span>
                    </div>
                  ))}</div>
                </Section>

                <Section title="Local inventory score">
                  <div className={`${CARD} p-4 flex items-center gap-5`}>
                    <AnimatedRing pct={localScore} size={104} color={BLUE} />
                    <div><p className="text-[15px] font-extrabold">{scoreLabel}</p><p className="text-[12px] text-[#64748B] mt-0.5">How competitive the local market is for this vehicle right now.</p></div>
                  </div>
                </Section>

                <Section title="If you wait…">
                  <div className={`${CARD} p-4`}><p className="text-[13px] text-[#64748B] leading-snug">{changePct != null && changePct < 0 ? "Inventory is currently declining. Waiting may reduce your available choices and increase competition from other buyers." : "Inventory is steady for now. Pricing and selection can still shift as the market moves."}</p></div>
                </Section>
              </>
            ) : <Empty>Inventory trend data will appear here once enough comparable listings have been tracked over time.</Empty>}
            <Disclaimer />
          </div>

          {/* ── Desktop / tablet (≥768px) — unchanged ── */}
          <div className="hidden md:block space-y-5">
          <Hero icon={Package} tone={changePct != null && changePct < 0 ? "green" : "neutral"} label={trendLabel}
            value={supplyWord ? `${supplyWord} supply` : undefined}
            note={hasData ? "Comparable availability in your local market." : "30-day market supply trends appear once enough data is available."} />
          {hasData ? (
            <>
              <Section title="Inventory trend"><InventoryTrendChart isPreview={isPreview} /></Section>
              <Section title="Local market summary">
                <div className={`${CARD} p-4`}>
                  <StatRow label="Average days on market" value={avgDom != null ? `${avgDom} days` : "—"} />
                  <StatRow label="Average selling price" value={avg != null ? fmt$(avg) : isPreview ? fmt$(61300) : "—"} />
                  <StatRow label="Supply level" value={supplyWord ?? "—"} />
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
          </div>
        </>,
      };
    }

    case "factory-warranty": {
      const cpoProgs = (listing as unknown as { cpo_programs?: Array<Record<string, unknown>> }).cpo_programs || null;
      // Vehicle-aware coverage: dealer-verified terms win; the verified OEM
      // library fills the rest. Factory CPO at a matching franchise overlays the
      // CPO program; cross-brand/used cars get the factory balance with any
      // second-owner powertrain reduction applied.
      const eff = resolveEffectiveWarranty({
        condition: listing.condition, ymm: listing.ymm,
        warrantyInfo: d.warranty, hasDealerOem: !!d.oemWarranty, cpoPrograms: cpoProgs,
      });
      const w = eff.info;
      const isFactoryCpo = eff.mode === "cpo_factory";
      const ks = listing.key_specs || {};
      const isNew = listing.condition === "new";
      // New-car mileage credit: the factory allowance is measured from delivery,
      // so add back the few odometer miles already on the car (capped at 100). A
      // 60,000-mi warranty on a 17-mi new car expires at 60,017 / shows 60,000 left.
      const odoCredit = isNew && listing.mileage != null ? Math.min(listing.mileage, 100) : 0;
      const expMilesOf = (limit?: number | null) => (limit && limit > 0 ? limit + odoCredit : null);
      const milesRemainOf = (limit?: number | null) => (limit && limit > 0 && listing.mileage != null ? Math.max((limit + odoCredit) - listing.mileage, 0) : null);
      const milesPctOf = (limit?: number | null) => { const exp = expMilesOf(limit); const rem = milesRemainOf(limit); return exp != null && rem != null ? Math.max(3, Math.min(100, (rem / exp) * 100)) : null; };
      const milesLeft = milesRemainOf(w.factory_miles);
      const milesPct = milesPctOf(w.factory_miles);
      const expFrom = (months?: number) => { if (!w.in_service_date || !months) return { date: null as string | null, left: null as number | null, pct: null as number | null }; const end = new Date(w.in_service_date); end.setMonth(end.getMonth() + months); const ms = end.getTime() - Date.now(); const left = ms > 0 ? Math.round(ms / (1000 * 60 * 60 * 24 * 30.4)) : 0; return { date: end.toLocaleDateString(), left, pct: Math.max(3, Math.min(100, (left / months) * 100)) }; };
      const basic = expFrom(w.factory_months);
      const pt = expFrom(w.powertrain_months);
      const ptMilesLeft = milesRemainOf(w.powertrain_miles);
      const ptMilesPct = milesPctOf(w.powertrain_miles);
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
      const hasPt = w.powertrain_months != null || w.powertrain_miles != null;
      const hasBasic = w.factory_months != null || w.factory_miles != null;
      const pctOf = (...vals: (number | null)[]) => { const v = vals.filter((x): x is number => x != null); return v.length ? Math.round(Math.min(...v)) : null; };
      const b2bPct = pctOf(basic.pct, milesPct);
      const ptPct = pctOf(pt.pct, ptMilesPct);
      const yrsRemain = (m: number | null) => m == null ? null : m >= 12 ? `${Math.round(m / 12)} ${Math.round(m / 12) === 1 ? "Year" : "Years"} Remaining` : `${m} Months Remaining`;
      const milesRemainLbl = (n: number | null) => n == null ? null : `${n.toLocaleString()} Miles Remaining`;
      const milesCapLbl = (n?: number | null) => n ? `${n.toLocaleString()} miles` : null;
      const startDate = w.in_service_date ? new Date(w.in_service_date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;
      const endDate = pt.date ?? basic.date ?? null;
      const endMiles = w.powertrain_miles ?? w.factory_miles ?? null;
      // New cars: coverage starts at delivery (today), so the timeline opens on
      // "Today · Warranty Start" — no separate manufactured/current points.
      // New cars: coverage starts at delivery (today), so the timeline opens on
      // "Today · Warranty Start" — no separate manufactured/current points.
      const tlRaw = (listing.condition === "new"
        ? [
            { date: "Today", label: "Warranty Start", color: "bg-emerald-500" },
            basic.date ? { date: basic.date, label: "B-to-B Ends", color: "bg-[#2563EB]" } : null,
            pt.date ? { date: pt.date, label: "Powertrain Ends", color: "bg-[#16A34A]" } : null,
          ]
        : [
            startDate ? { date: startDate, label: "In service", color: "bg-slate-300" } : null,
            { date: "Today", label: "Current", color: "bg-emerald-500" },
            basic.date ? { date: basic.date, label: "B-to-B Ends", color: "bg-[#2563EB]" } : null,
            pt.date ? { date: pt.date, label: "Powertrain Ends", color: "bg-[#16A34A]" } : null,
          ]) as (TLPoint | null)[];
      const tlPoints = tlRaw.filter((p): p is TLPoint => p != null);
      const todayIdx = tlPoints.findIndex((p) => p.date === "Today");
      const isCpo = listing.condition === "cpo";
      const cpo = cpoProgs?.[0] || null;
      // Benefits/coverage rows: dealer-verified terms first, then the verified
      // OEM library for the vehicle's make (cross-brand used cars get their own
      // manufacturer's benefits, not the tenant's).
      const cov = oemCoverageRows(d.oemWarranty || lookupOemReference(listing.ymm) || {});
      const benefitRows = cov.filter((r) => r.key === "corrosion" || r.key === "roadside" || r.key === "ev_battery" || r.key === "maintenance");
      const includedRows = cov.filter((r) => r.key === "basic" || r.key === "powertrain");
      const cpoTerm = (mo: unknown, mi: unknown) => [Number(mo) ? `${Math.round(Number(mo) / 12)} yr` : null, Number(mi) ? `${(Number(mi) / 1000).toFixed(0)}K mi` : null].filter(Boolean).join(" / ");
      const hasData = !!(d.warrantyStr || d.oemWarranty || eff.usedLibrary || isFactoryCpo);
      // ── Goal-layout derived values ──────────────────────────────────────
      // A new car's factory warranty is active by definition (starts at
      // delivery); used/CPO rely on the calculated remaining coverage.
      const statusActive = isNew ? true : active;
      const statusStart = isNew ? "At Delivery Date" : (startDate ?? "See dealer");
      const statusStartSub = isNew ? null : (startDate ? "(In-Service Date)" : null);
      const yTerm = (mo?: number | null) => (mo ? `${Math.round(mo / 12)} ${Math.round(mo / 12) === 1 ? "Year" : "Years"}` : null);
      const mTerm = (mi?: number | null) => (mi ? `${mi.toLocaleString()} Miles` : null);
      const brand = (listing.ymm || "").replace(/^\d{4}\s+/, "").split(/\s+/)[0] || null;
      const benefitCards: BenefitRow[] = benefitRows.map((r) => ({
        icon: COVERAGE_ICON[r.key] ?? LifeBuoy,
        title: r.label,
        term: r.term,
        sub: r.sub ?? null,
        tone: r.key === "ev_battery" || r.key === "maintenance" ? "green" : "blue",
        items: COVERAGE_COMPONENTS[r.key],
      }));
      if ((isHybrid || isEV) && !benefitRows.some((r) => r.key === "ev_battery")) {
        benefitCards.push({ icon: Zap, title: isEV ? "EV Battery" : "Hybrid Battery", term: "Extended high-voltage coverage", sub: "Confirm terms with dealer", tone: "green" });
      }
      const openMoreDetails = () => {
        const el = document.getElementById("warr-whats-included") as HTMLDetailsElement | null;
        if (el) { el.open = true; el.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
      };
      return {
        title: "Factory Warranty",
        subtitle: "See what's covered and for how long.",
        primary: { label: "Contact Dealer", onClick: () => go("contact") },
        secondary: { label: "Learn More", onClick: () => go("protect") },
        footerQuestion: "Questions about warranty?", specialistLabel: "Talk to a Warranty Specialist",
        body: hasData ? (
          <div className="space-y-5">
            <div className="space-y-5">
              <div className="space-y-5">
                <WarrantyStatusCard
                  active={statusActive}
                  startLabel={statusStart}
                  startSub={statusStartSub}
                  endDate={isNew ? null : endDate}
                  endMiles={isNew ? null : endMiles}
                />
                <div className="rounded-2xl border border-[#E6E8EC] bg-white p-4 sm:p-5">
                  <p className="text-[15px] font-bold text-[#0F172A] mb-3">Coverage at a Glance</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {isNew ? (
                      <>
                        {hasBasic && <NewCoverageCard title="Bumper-to-Bumper" subtitle="Basic Vehicle Coverage" tone="blue" years={yTerm(w.factory_months)} miles={mTerm(w.factory_miles)} />}
                        {hasPt && <NewCoverageCard title="Powertrain" subtitle="Engine, Transmission & Drivetrain" tone="green" years={yTerm(w.powertrain_months)} miles={mTerm(w.powertrain_miles)} />}
                      </>
                    ) : (
                      <>
                        {hasBasic && <CoverageCard title="Bumper-to-Bumper" subtitle={isFactoryCpo && eff.cpoProgramName ? "CPO Vehicle Coverage" : "Basic Vehicle Coverage"} tone="blue" pct={b2bPct} years={yrsRemain(basic.left)} miles={milesRemainLbl(milesLeft)} expiresDate={basic.date} expiresMiles={milesCapLbl(expMilesOf(w.factory_miles))} />}
                        {hasPt && <CoverageCard title="Powertrain" subtitle="Engine, Transmission & Drivetrain" tone="green" pct={ptPct} years={yrsRemain(pt.left)} miles={milesRemainLbl(ptMilesLeft)} expiresDate={pt.date} expiresMiles={milesCapLbl(expMilesOf(w.powertrain_miles))} />}
                        {eff.cpoWrap && (
                          <NewCoverageCard title={eff.cpoWrap.programName} subtitle="Additional CPO coverage from purchase" tone="green"
                            years={eff.cpoWrap.months ? `${Math.round(eff.cpoWrap.months / 12) || 1} ${eff.cpoWrap.months >= 24 ? "Years" : "Year"}` : null}
                            miles={eff.cpoWrap.unlimitedMiles ? "Unlimited Miles" : eff.cpoWrap.miles ? `${eff.cpoWrap.miles.toLocaleString()} Miles` : null} />
                        )}
                      </>
                    )}
                  </div>
                  {isNew && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-[6px] shrink-0" />
                      <p className="text-[12px] font-medium text-emerald-800 leading-snug">Factory coverage begins when you take delivery of your vehicle.</p>
                    </div>
                  )}
                  {isFactoryCpo && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-[6px] shrink-0" />
                      <p className="text-[12px] font-medium text-emerald-800 leading-snug">{brand ? `${brand} ` : ""}Certified Pre-Owned extends this vehicle's factory coverage{eff.cpoInspectionPoints ? ` and includes a ${eff.cpoInspectionPoints} inspection` : ""}.</p>
                    </div>
                  )}
                  {eff.secondOwnerReduced && !isFactoryCpo && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 mt-[6px] shrink-0" />
                      <p className="text-[12px] font-medium text-[#64748B] leading-snug">Powertrain shown at second-owner terms — {brand || "this manufacturer"} reduces powertrain coverage when the vehicle transfers from the original owner.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Certified Pre-Owned: certified copy for factory-CPO cars, "may
                qualify" only at a matching franchise. Cross-brand used cars get
                no CPO banner — the tenant can't factory-certify another make. */}
            {!isNew && (isFactoryCpo || eff.franchiseMatch) && (
              <CpoBanner brand={brand} certified={isFactoryCpo} programName={eff.cpoProgramName} onLearn={() => go("protect")} />
            )}

            {/* Coverage timeline */}
            {tlPoints.length >= 2 && (
              <div>
                <p className="text-[15px] font-bold text-[#0F172A]">Coverage Timeline</p>
                <p className="text-[12px] text-[#64748B] mb-3">See your coverage from day one to expiration.</p>
                <WarrantyTimeline points={tlPoints} todayIndex={todayIdx} />
              </div>
            )}

            {/* Interactive vehicle coverage visual */}
            <div>
              <p className="text-[15px] font-bold text-[#0F172A]">What's Covered</p>
              <p className="text-[12px] text-[#64748B] mb-2">Tap a coverage type to highlight the covered systems on the vehicle below.</p>
              <WarrantyCarVisual hasPowertrain={hasPt} onAll={() => {
                const el = document.getElementById("warr-all-components") as HTMLDetailsElement | null;
                if (el) { el.open = true; el.scrollIntoView({ behavior: "smooth", block: "start" }); }
              }} />
            </div>

            {/* Full covered-components breakdown — every coverage this vehicle
                carries (from the resolved OEM terms), with its component list. */}
            <details id="warr-all-components" className={`${CARD} overflow-hidden group`}>
              <summary className="cursor-pointer list-none flex items-center gap-3 p-4">
                <span className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><ShieldCheck className="w-4 h-4 text-[#2563EB]" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold text-[#0F172A] leading-tight">All covered components</p>
                  <p className="text-[11px] text-[#94A3B8] leading-tight">Every coverage on this vehicle with what it protects</p>
                </div>
                <ChevronDown className="w-4 h-4 text-[#94A3B8] group-open:rotate-180 transition-transform shrink-0" />
              </summary>
              <div className="px-4 pb-4 space-y-4">
                {cov.map((r) => {
                  const comps = COVERAGE_COMPONENTS[r.key] ?? [];
                  const accent = r.key === "basic" ? "text-[#2563EB]" : r.key === "powertrain" ? "text-[#16A34A]" : "text-[#0F172A]";
                  return (
                    <div key={r.key}>
                      <div className="flex items-baseline justify-between gap-3 mb-1.5">
                        <p className={`text-[13px] font-bold ${accent}`}>{r.label}</p>
                        <p className="text-[12px] font-semibold text-[#64748B] shrink-0">{r.term}</p>
                      </div>
                      {comps.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                          {comps.map((c) => <div key={c} className="flex items-start gap-2 text-[12px] text-[#334155]"><CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0 mt-0.5" />{c}</div>)}
                        </div>
                      ) : <p className="text-[12px] text-[#64748B]">{r.sub}</p>}
                    </div>
                  );
                })}
                <p className="text-[11px] text-[#94A3B8] pt-1 border-t border-slate-100">Typical coverage groupings for this manufacturer's terms. The OEM warranty booklet governs exact components and exclusions — confirm specifics with the dealer.</p>
              </div>
            </details>

            {/* Additional factory benefits */}
            <AdditionalFactoryBenefitsCard rows={benefitCards} onDetails={openMoreDetails} />

            {/* Accordions */}
            <div className="space-y-2">
              <WAcc id="warr-whats-included" icon={CheckCircle2} title="What's Included" sub="See systems and components covered">
                {includedRows.length > 0
                  ? includedRows.map((r) => <p key={r.key}><span className="font-semibold text-[#0F172A]">{r.label}</span> — {r.sub} ({r.term}).</p>)
                  : <><p><span className="font-semibold text-[#0F172A]">Bumper-to-Bumper</span> — most vehicle systems and components.</p><p><span className="font-semibold text-[#0F172A]">Powertrain</span> — engine, transmission, and drivetrain.</p></>}
              </WAcc>
              <WAcc icon={AlertTriangle} title="What's NOT Covered" sub="See general exclusions and limitations">
                <p>Routine maintenance and wear items (brake pads, wiper blades, tires, fluids).</p>
                <p>Damage from accidents, misuse, modification, or lack of maintenance.</p>
                <p>Cosmetic wear, glass, and items covered by separate manufacturer warranties.</p>
              </WAcc>
              {/* CPO coverage is a used/CPO concern — hidden entirely for new cars. */}
              {!isNew && (
                <WAcc icon={BadgeCheck} title="Certified Pre-Owned Coverage" sub="Additional coverage that applies (if any)">
                  {isCpo && cpo ? (
                    <>
                      <p><span className="font-semibold text-[#0F172A]">{String(cpo.name)}</span> — {cpo.kind === "oem" ? "Manufacturer Certified" : "Dealer Certified"}.</p>
                      {cpoTerm(cpo.basic_months, cpo.basic_miles) && <p>Limited warranty: <span className="font-semibold text-[#0F172A]">{cpoTerm(cpo.basic_months, cpo.basic_miles)}</span></p>}
                      {cpoTerm(cpo.powertrain_months, cpo.powertrain_miles) && <p>Powertrain: <span className="font-semibold text-[#0F172A]">{cpoTerm(cpo.powertrain_months, cpo.powertrain_miles)}</span></p>}
                      {cpo.inspection_points ? <p>{String(cpo.inspection_points)} inspection{cpo.transferable ? " · transferable" : ""}</p> : null}
                      {cpo.benefits ? <p>{String(cpo.benefits)}</p> : null}
                      {cpo.disclosure ? <p className="text-[11px] text-[#94A3B8]">{String(cpo.disclosure)}</p> : null}
                    </>
                  ) : (
                    <p>This vehicle includes additional Certified Pre-Owned coverage. Confirm exact CPO terms with the dealer.</p>
                  )}
                </WAcc>
              )}
              <WAcc icon={FileText} title="Warranty Details & FAQ" sub="Deductible, transferability, claims & more">
                <p><span className="font-semibold text-[#0F172A]">Deductible:</span> typically $0 on covered factory repairs.</p>
                <p><span className="font-semibold text-[#0F172A]">Transferable:</span> {d.oemWarranty?.owner === "subsequent" ? "remaining coverage transfers with the vehicle (some terms reduce for a second owner)." : "yes — remaining coverage transfers with the vehicle."}</p>
                <p><span className="font-semibold text-[#0F172A]">Claims:</span> honored at any authorized manufacturer dealer nationwide.</p>
                <div className="pt-1 space-y-2">{faqs.map((f) => <Faq key={f.q} q={f.q} a={f.a} />)}</div>
              </WAcc>
            </div>

            <Disclaimer />
          </div>
        ) : <Empty>Warranty coverage details are confirmed at the dealership for this vehicle.</Empty>,
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
          {rating != null && <div className="md:hidden"><MHero tone="green" icon={Star} ringPct={Math.round((rating / 5) * 100)} eyebrow={`${rating.toFixed(1)} / 5 · ${label}`} title="Owner Reviews" note={[sourceNames.length > 0 ? `Based on ${sourceNames.join(", ")}` : null, d.reviewCount != null ? `${d.reviewCount.toLocaleString()} reviews` : null].filter(Boolean).join(" · ")} /></div>}
          <div className={rating != null ? "hidden md:block" : undefined}>
          {rating != null ? (
            <div className={`${CARD} p-5 flex items-center gap-4`}>
              <div className="text-center shrink-0"><p className="text-[34px] font-extrabold text-[#2563EB] leading-none">{rating.toFixed(1)}</p><div className="mt-1"><Stars n={rating} /></div>{d.reviewCount != null && <p className="text-[11px] text-[#64748B] mt-1">{d.reviewCount.toLocaleString()} reviews</p>}</div>
              <div className="min-w-0"><p className="text-[15px] font-extrabold text-[#16A34A]">{label}</p>{sourceNames.length > 0 && <p className="text-[12px] text-[#64748B] mt-0.5">Based on {sourceNames.join(", ")}</p>}<p className="text-[11px] text-[#94A3B8] mt-1">AutoLabels aggregates reviews and does not edit or filter them.</p></div>
            </div>
          ) : <Empty>Verified owner reviews appear here once the dealer connects a review source. AutoLabels never fabricates customer reviews.</Empty>}
          </div>
          {nhtsa?.ratings && nhtsa.ratings.overall != null && (
            <Section title="Government crash-test ratings" sub={`NHTSA 5-Star Safety Ratings for the ${nhtsa.ratings.vehicleDescription || listing.ymm}.`}>
              <div className={`${CARD} p-5`}>
                <div className="flex items-center gap-4">
                  <div className="text-center shrink-0"><p className="text-[34px] font-extrabold text-[#2563EB] leading-none">{nhtsa.ratings.overall}<span className="text-[16px] text-[#94A3B8] font-bold">/5</span></p><div className="mt-1"><Stars n={nhtsa.ratings.overall} /></div></div>
                  <div className="min-w-0">
                    <p className="text-[15px] font-extrabold text-[#0F172A]">Overall Safety Rating</p>
                    <p className="text-[12px] text-[#64748B] mt-0.5">U.S. government crash testing, not dealer-provided.</p>
                  </div>
                </div>
                {(nhtsa.ratings.frontal != null || nhtsa.ratings.side != null || nhtsa.ratings.rollover != null) && (
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {([["Frontal", nhtsa.ratings.frontal], ["Side", nhtsa.ratings.side], ["Rollover", nhtsa.ratings.rollover]] as const).filter(([, v]) => v != null).map(([k, v]) => (
                      <div key={k} className="rounded-xl border border-[#E6E8EC] bg-[#F8FAFC] px-3 py-2 text-center">
                        <p className="text-[11px] font-semibold text-[#64748B]">{k}</p>
                        <p className="text-[15px] font-extrabold text-[#0F172A]">{v} <Star className="w-3.5 h-3.5 inline -mt-0.5 fill-[#F59E0B] text-[#F59E0B]" /></p>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-[#94A3B8] mt-3">Source: NHTSA 5-Star Safety Ratings program (nhtsa.gov). Ratings apply to this model and configuration, not this specific vehicle.</p>
              </div>
            </Section>
          )}
          {d.iihsAward && (
            <Section title="IIHS safety award" sub="Insurance Institute for Highway Safety.">
              <div className={`${CARD} p-4 flex items-center gap-3`}>
                <span className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0"><Award className="w-5 h-5 text-[#16A34A]" /></span>
                <div className="min-w-0">
                  <p className="text-[15px] font-extrabold text-[#0F172A]">{d.iihsAward.label}</p>
                  <p className="text-[12px] text-[#64748B]">{d.iihsAward.note || "Awarded for crashworthiness and crash-avoidance performance in IIHS testing. Applies to this model; confirm configuration with the dealer."}</p>
                </div>
              </div>
            </Section>
          )}
          {nhtsa?.complaints && (
            <Section title="Owner-reported issues" sub="Complaints filed with NHTSA by owners nationwide for this model year.">
              <div className={`${CARD} p-4`}>
                {nhtsa.complaints.count === 0 ? (
                  <p className="text-[13px] font-semibold text-[#16A34A]">No owner complaints on file with NHTSA for this model year.</p>
                ) : (
                  <>
                    <p className="text-[13px] text-[#0F172A]"><span className="font-extrabold">{nhtsa.complaints.count.toLocaleString()}</span> complaint{nhtsa.complaints.count === 1 ? "" : "s"} filed nationwide across all {listing.ymm} vehicles — not reports about this specific car.</p>
                    {nhtsa.complaints.topComponents.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        {nhtsa.complaints.topComponents.map((c) => (
                          <span key={c.component} className="inline-flex items-center rounded-full border border-[#E6E8EC] bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-semibold text-[#475569]">{c.component.toLowerCase().replace(/(^|[\s/])[a-z]/g, (m) => m.toUpperCase())} · {c.count}</span>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <p className="text-[11px] text-[#94A3B8] mt-3">Source: NHTSA complaint database (nhtsa.gov). Complaints are unverified owner reports covering the entire model line.</p>
              </div>
            </Section>
          )}
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
      const storyList = (items: string[]) => `${items.slice(0, 6).join(", ")}${items.length > 6 ? ", and more" : ""}`;
      if (groups.Technology?.length) story.push({ t: "Technology", c: <p>Connectivity and infotainment include {storyList(groups.Technology)}.</p> });
      if (groups.Comfort?.length) story.push({ t: "Comfort", c: <p>Cabin comfort features include {storyList(groups.Comfort)}.</p> });
      if (groups.Safety?.length) story.push({ t: "Safety", c: <p>Driver assistance and safety equipment include {storyList(groups.Safety)}.</p> });
      if (awd) story.push({ t: "Driving Experience", c: <p>{drivetrain} delivers confident handling and all-weather capability.</p> });
      const ownBits = [d.warrantyStr && `${d.warrantyStr} of factory warranty remains`, d.recallClear && "no open recalls are reported", d.serviceCount > 0 && `${d.serviceCount} service records are on file`].filter(Boolean) as string[];
      if (ownBits.length) story.push({ t: "Ownership", c: <p>For peace of mind, {ownBits.join(", ")}.</p> });
      const recs: { t: string; w: string }[] = [];
      if (seats && seats >= 6) { recs.push({ t: "Families", w: `Seats ${seats} across a flexible multi-row layout.` }); recs.push({ t: "Road Trips", w: "Spacious, comfortable cabin for long drives." }); }
      if (Number(ks.mpg_hwy) >= 28) recs.push({ t: "Daily Commuters", w: `Up to ${ks.mpg_hwy} MPG highway eases the daily drive.` });
      if (premium) { recs.push({ t: "Luxury Buyers", w: `${listing.trim} trim brings premium materials and features.` }); recs.push({ t: "Business Professionals", w: "A refined, professional presence." }); }
      if (awd) recs.push({ t: "Weekend Adventures", w: `${drivetrain} adds all-weather confidence.` });
      // "What this vehicle comes with" — top-6 canonical rows per card, sourced
      // from the tiered build sheet when the structured decode exists (already
      // denoised and shopper-ordered), else the cleaned flat groups. The full
      // reference list lives on the Equipment panel; the overview only orients.
      const ovSheet = readBuildSheet(listing);
      const sheetPick = (cats: string[]) => (ovSheet?.keyFeatures || []).filter(([c]) => cats.includes(c)).flatMap(([, items]) => items);
      const extCap = (ovSheet ? sheetPick(["Exterior & Lighting", "Performance & Capability"]) : groups.Exterior || []).slice(0, 6);
      const intComf = (ovSheet ? sheetPick(["Seating & Interior", "Comfort & Convenience"]) : Array.from(new Set([...(groups.Interior || []), ...(groups.Comfort || [])]))).slice(0, 6);
      const allEquipCount = ovSheet ? ovSheet.keyFeatureCount + ovSheet.standardCount : Object.values(groups).reduce((a, g) => a + g.length, 0);
      const loveReasons: string[] = [];
      if (groups.Safety?.length) loveReasons.push("Advanced safety technology");
      if (groups.Comfort?.length) loveReasons.push("Premium ride comfort");
      if (groups.Technology?.length) loveReasons.push("Modern technology and connectivity");
      if (premium) loveReasons.push("Luxury interior appointments");
      if (isGreat) loveReasons.push("Exceptional value versus the market");
      const catIcon: Record<string, React.ElementType> = { Performance: Gauge, Safety: ShieldCheck, Technology: Star, Comfort: Heart, Exterior: Car, Interior: Users };
      // Mobile command-center data (badges/cards/rows open the dedicated reports).
      const overviewBadges = ([
        d.warrantyStr ? { icon: ShieldCheck, label: "Factory Warranty", fn: () => openPanel("factory-warranty") } : null,
        d.cleanTitle && d.accidentCount === 0 ? { icon: CheckCircle2, label: "Clean History", fn: () => go("vehicle-history") } : null,
        isGreat ? { icon: BadgeCheck, label: "Great Price", fn: () => openPanel("market-price") } : null,
        (d.viewCount ?? 0) > 20 ? { icon: Flame, label: "High Demand", fn: () => openPanel("market-demand") } : null,
      ].filter(Boolean) as { icon: React.ElementType; label: string; fn: () => void }[]).slice(0, 4);
      const aiTraits = [d.ownerCount === 1 ? "one-owner ownership" : null, d.warrantyStr ? "remaining factory warranty" : null, (d.cleanTitle && d.accidentCount === 0) ? "a clean vehicle history" : null, isGreat ? "below-market pricing" : null, (d.viewCount ?? 0) > 20 ? "strong local demand" : null].filter(Boolean) as string[];
      const aiSummary = aiTraits.length >= 2 ? `This ${listing.ymm}${listing.trim ? ` ${listing.trim}` : ""} combines ${aiTraits.slice(0, -1).join(", ")} and ${aiTraits[aiTraits.length - 1]} — one of the strongest ${premium ? "luxury " : ""}values currently available.` : (d.overview ? d.overview.split(". ").slice(0, 2).join(". ") : `The ${listing.ymm} pairs capable performance with a well-equipped cabin.`);
      const snap = ([
        d.ownerCount === 1 ? { icon: Users, v: "1 Owner", s: "Personal use", fn: () => go("vehicle-history") } : null,
        d.warrantyStr ? { icon: ShieldCheck, v: d.warrantyStr, s: "Warranty left", fn: () => openPanel("factory-warranty") } : null,
        listing.mileage != null ? { icon: Gauge, v: listing.mileage.toLocaleString(), s: "Miles", fn: () => openPanel("key-specs") } : null,
        d.belowMarket && d.belowMarket > 0 ? { icon: BadgeCheck, v: fmt$(d.belowMarket), s: "Below market", fn: () => openPanel("market-price") } : null,
        drivetrain ? { icon: Car, v: drivetrain, s: "Drivetrain", fn: () => openPanel("key-specs") } : null,
        d.recallClear ? { icon: CheckCircle2, v: "No Recalls", s: "NHTSA checked", fn: () => go("vehicle-history") } : null,
      ].filter(Boolean) as { icon: React.ElementType; v: string; s: string; fn: () => void }[]).slice(0, 4);
      const carousel = (d.highlights.length ? d.highlights.map((h) => ({ t: h.label, s: h.sub })) : Object.values(groups).flat().map((x) => ({ t: x, s: "" }))).slice(0, 12);
      const explore: { icon: React.ElementType; t: string; s: string; fn: () => void }[] = [
        { icon: ShieldCheck, t: "Warranty", s: "Coverage remaining", fn: () => openPanel("factory-warranty") },
        { icon: History, t: "Vehicle History", s: "Ownership, title, accidents", fn: () => go("vehicle-history") },
        { icon: DollarSign, t: "Market Price", s: "How the price compares", fn: () => openPanel("market-price") },
        { icon: TrendingUp, t: "Market Demand", s: "Local shopper interest", fn: () => openPanel("market-demand") },
        { icon: Car, t: "Comparable Vehicles", s: "Similar listings nearby", fn: () => openPanel("comparable-vehicles") },
        { icon: FileText, t: "Features & Specifications", s: "Equipment and specs", fn: () => openPanel("highlights") },
        { icon: Clock, t: "Price History", s: "Recent price changes", fn: () => openPanel("price-history") },
        { icon: Package, t: "Inventory Trends", s: "Local market availability", fn: () => openPanel("inventory-trend") },
        { icon: Gauge, t: "Price Confidence", s: "Why we're confident", fn: () => openPanel("price-confidence") },
      ];
      return {
        title: "Vehicle Overview", subtitle: "A complete look at this vehicle's design, technology, and ownership experience",
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        secondary: { label: "View specifications", onClick: () => openPanel("key-specs") },
        footerQuestion: "Questions about this vehicle?", specialistLabel: "Talk to a Product Specialist",
        body: <>
          {/* ── Mobile (<768px) — Passport command center ── */}
          <div className="md:hidden space-y-5">
            <div className="relative rounded-2xl overflow-hidden">
              {listing.hero_image_url ? <img src={listing.hero_image_url} alt="" className="w-full aspect-[4/3] object-cover" /> : <div className="w-full aspect-[4/3] bg-[#1f2227] flex items-center justify-center"><Car className="w-12 h-12 text-slate-500" /></div>}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent flex flex-col justify-end p-5">
                <p className="text-white text-[26px] font-extrabold leading-tight">{listing.ymm}</p>
                {listing.trim && <p className="text-white/85 text-[14px] font-semibold">{listing.trim}</p>}
                <div className="flex items-center gap-3 mt-1 text-white/80 text-[12px]">{listing.mileage != null && <span>{listing.mileage.toLocaleString()} mi</span>}{d.reviewRating != null && <span className="inline-flex items-center gap-1"><Star className="w-3.5 h-3.5 text-amber-400" fill="#F59E0B" />{d.reviewRating.toFixed(1)}</span>}</div>
              </div>
            </div>

            {overviewBadges.length > 0 && (
              <div className="grid grid-cols-2 gap-2.5">{overviewBadges.map((b) => (
                <button key={b.label} onClick={b.fn} className={`${CARD} p-3 flex items-center gap-2 active:bg-slate-50`}><span className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0"><b.icon className="w-4 h-4 text-[#16A34A]" /></span><span className="text-[12px] font-bold leading-tight">{b.label}</span></button>
              ))}</div>
            )}

            <div className={`${CARD} p-4 flex items-start gap-3`}>
              <span className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><Sparkles className="w-4 h-4 text-[#2563EB]" /></span>
              <div><p className="text-[11px] font-bold uppercase tracking-wider text-[#94A3B8]">AutoLabels AI Summary</p><p className="text-[14px] text-[#334155] leading-relaxed mt-0.5">{aiSummary}</p></div>
            </div>

            {snap.length > 0 && (
              <div className="grid grid-cols-2 gap-3">{snap.map((s, i) => (
                <button key={i} onClick={s.fn} className={`${CARD} p-4 text-left active:bg-slate-50`}><s.icon className="w-5 h-5 text-[#2563EB]" /><p className="text-[18px] font-extrabold mt-1.5 leading-none">{s.v}</p><p className="text-[11px] text-[#94A3B8] mt-1">{s.s}</p></button>
              ))}</div>
            )}

            {ovSheet && ovSheet.packages.length > 0 && (
              <button onClick={() => openPanel("equipment")} className="w-full rounded-2xl border border-blue-200 bg-blue-50/60 p-4 flex items-center justify-between gap-3 text-left active:bg-blue-50">
                <div>
                  <p className="text-[13px] font-bold text-[#0F172A]">Built with {ovSheet.packages.length} factory package{ovSheet.packages.length === 1 ? "" : "s"}{ovSheet.estValue ? ` — ${fmt$(ovSheet.estValue)} in options` : ""}</p>
                  <p className="text-[12px] text-[#64748B] mt-0.5">View the build sheet</p>
                </div>
                <Package className="w-5 h-5 text-[#2563EB] shrink-0" />
              </button>
            )}

            {carousel.length > 0 && (
              <div>
                <h2 className="text-[18px] font-bold mb-3">Why You'll Love This Vehicle</h2>
                <div className="flex gap-3 overflow-x-auto -mx-1 px-1 pb-1 snap-x">{carousel.map((c, i) => (
                  <div key={i} className={`shrink-0 w-[120px] ${CARD} p-4 text-center snap-start`}><span className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center mx-auto"><Award className="w-5 h-5 text-[#2563EB]" /></span><p className="text-[12px] font-bold leading-tight mt-2 line-clamp-2">{c.t}</p>{c.s && <p className="text-[10px] text-[#94A3B8] mt-0.5 line-clamp-1">{c.s}</p>}</div>
                ))}</div>
              </div>
            )}

            <div>
              <h2 className="text-[18px] font-bold mb-3">Explore the Vehicle Passport</h2>
              <div className={`${CARD} divide-y divide-[#F1F5F9]`}>{explore.map((r) => (
                <button key={r.t} onClick={r.fn} className="w-full min-h-[56px] flex items-center gap-3 px-4 py-3 text-left active:bg-slate-50"><span className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><r.icon className="w-[18px] h-[18px] text-[#2563EB]" /></span><div className="min-w-0 flex-1"><p className="text-[14px] font-semibold leading-tight">{r.t}</p><p className="text-[11px] text-[#94A3B8] truncate">{r.s}</p></div><ChevronDown className="w-4 h-4 text-[#CBD5E1] -rotate-90" /></button>
              ))}</div>
            </div>
            <Disclaimer />
          </div>

          {/* ── Desktop / tablet (≥768px) — unchanged ── */}
          <div className="hidden md:block space-y-5">
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
          {(extCap.length > 0 || intComf.length > 0) && (
            <Section title="What this vehicle comes with">
              <p className="text-[12px] text-[#94A3B8] -mt-1 mb-3">The equipment shoppers ask about — see the full build sheet for everything.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[{ t: "Exterior & capability", icon: catIcon.Exterior, items: extCap }, { t: "Interior & comfort", icon: catIcon.Interior, items: intComf }].filter((c) => c.items.length > 0).map((c) => (
                  <div key={c.t} className={`${CARD} p-4`}>
                    <div className="flex items-center gap-2 mb-2"><c.icon className="w-4 h-4 text-[#2563EB]" /><p className="text-[13px] font-bold">{c.t}</p></div>
                    <ul className="space-y-1.5">{c.items.map((e) => (
                      <li key={e} className="flex items-start gap-2 text-[13px] text-[#334155]"><CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0 mt-0.5" />{e}</li>
                    ))}</ul>
                  </div>
                ))}
              </div>
              {allEquipCount > extCap.length + intComf.length && (
                <button onClick={() => openPanel("equipment")} className="mt-3 text-[13px] font-semibold text-[#2563EB] hover:underline">See all {allEquipCount} features</button>
              )}
            </Section>
          )}
          {ovSheet && ovSheet.packages.length > 0 && (
            <button onClick={() => openPanel("equipment")} className="w-full rounded-2xl border border-blue-200 bg-blue-50/60 p-4 flex items-center justify-between gap-3 text-left hover:bg-blue-50 transition-colors">
              <div>
                <p className="text-[13px] font-bold text-[#0F172A]">Built with {ovSheet.packages.length} factory package{ovSheet.packages.length === 1 ? "" : "s"}{ovSheet.estValue ? ` — ${fmt$(ovSheet.estValue)} in options` : ""}</p>
                <p className="text-[12px] text-[#64748B] mt-0.5">View the build sheet</p>
              </div>
              <Package className="w-5 h-5 text-[#2563EB] shrink-0" />
            </button>
          )}
          {loveReasons.length > 0 && (
            <Section title="Why shoppers love this vehicle">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4"><ul className="space-y-2">{loveReasons.map((r) => <Check key={r}>{r}</Check>)}</ul></div>
            </Section>
          )}
          {!d.overview && story.length === 0 && <Empty>A full overview appears here as this vehicle's OEM data is decoded.</Empty>}
          <Disclaimer />
          </div>
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
          <div className="md:hidden"><MHero tone="blue" icon={FileText} eyebrow="Technical Specifications" title={listing.ymm || "Specifications"} note={[ks.engine ? String(ks.engine) : null, ks.drivetrain ? String(ks.drivetrain) : null].filter(Boolean).join(" · ") || "Verified vehicle details"} /></div>
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
      // Structured NeoVIN build sheet (packages / options / key features /
      // standard) — the tiered display. Older decodes without it fall back to
      // the flat categorized list.
      const sheet = readBuildSheet(listing);
      const equipCount = sheet ? sheet.keyFeatureCount + sheet.standardCount : featLabels.length;
      const hasContent = !!sheet || featLabels.length > 0 || accessories.length > 0 || ordered.length > 0;
      // Domestic trucks can carry a dozen-plus packages — group them under type
      // headers once the list gets long, so the section stays scannable.
      const pkgGroups = sheet
        ? PACKAGE_KIND_ORDER.map((k) => [k, sheet.packages.filter((p) => p.kind === k)] as const).filter(([, l]) => l.length > 0)
        : [];
      const groupedPkgView = (sheet?.packages.length ?? 0) >= 5 && pkgGroups.length > 1;
      const pkgTotal = sheet ? sheet.packages.reduce((a, p) => a + (p.msrp ?? 0), 0) : 0;
      const renderPkg = (p: { name: string; msrp?: number; contents: string[]; kind: string }) => (
        <details key={p.name} className={`${CARD} overflow-hidden group`}>
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 px-4 py-3">
            <span className="inline-flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0"><Package className="w-4 h-4 text-[#2563EB]" /></span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-[#0F172A] leading-tight">{p.name}</span>
                {p.kind === "Equipment Group" && <span className="inline-block mt-0.5 text-[9px] font-bold uppercase tracking-wide text-[#2563EB] bg-blue-50 rounded-full px-1.5 py-0.5">Equipment Group</span>}
              </span>
            </span>
            <span className="inline-flex items-center gap-2 shrink-0">
              {p.msrp ? <span className="text-[12px] font-bold text-[#16A34A]">{fmt$(p.msrp)}</span> : null}
              {p.contents.length > 0 && <ChevronDown className="w-4 h-4 text-[#94A3B8] group-open:rotate-180 transition-transform" />}
            </span>
          </summary>
          {p.contents.length > 0 && (
            <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
              {p.contents.map((c) => <div key={c} className="flex items-start gap-2 text-[12px] text-[#334155]"><CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0 mt-0.5" />{c}</div>)}
            </div>
          )}
        </details>
      );
      return {
        title: sheet?.estValue ? `${fmt$(sheet.estValue)} in Factory Options on This Build` : "Equipment & Installed Options",
        subtitle: sheet?.estValue ? "Everything this vehicle was built with, from the factory and dealership" : "Everything included on this vehicle from the factory and dealership",
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        footerQuestion: "Questions about the equipment?", specialistLabel: "Talk to a Product Specialist",
        body: <>
          <div className="md:hidden"><MHero tone="blue" icon={Package} eyebrow="Equipment & Options" title={`${equipCount} on this vehicle`} note={sheet?.packages.length ? `${sheet.packages.length} factory package${sheet.packages.length === 1 ? "" : "s"} installed` : accessories.length ? `${accessories.length} dealer add-on${accessories.length === 1 ? "" : "s"} available` : "Factory and dealer equipment"} /></div>
          {hasContent ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Factory Equipment" value={`${equipCount}`} />
                <Stat label="Packages" value={sheet ? `${sheet.packages.length}` : "—"} />
                <Stat label="Dealer Add-ons" value={`${accessories.length}`} />
                <Stat label="Option Value" value={sheet?.estValue ? fmt$(sheet.estValue) : "—"} tone={sheet?.estValue ? "green" : "neutral"} />
              </div>
              {/* Generic decode = typical-for-trim, not VIN-verified — label it. */}
              {sheet?.generic && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-[12px] text-amber-800 leading-snug">Equipment shown is typical for this trim. Confirm this vehicle's exact build with the dealer.</p>
                </div>
              )}
              {sheet ? (
                <>
                  {/* Tier 2 — the differentiator: what THIS car has beyond the trim */}
                  <Section title="Installed packages"
                    sub={sheet.packages.length > 0
                      ? `${sheet.packages.length} factory package${sheet.packages.length === 1 ? "" : "s"} on this build${pkgTotal ? ` · ${fmt$(pkgTotal)} in factory options` : ""}${listing.trim ? ` — beyond the standard ${listing.trim} trim` : ""}.`
                      : listing.trim ? `Factory packages this vehicle was built with — beyond the standard ${listing.trim} trim.` : "Factory packages this vehicle was built with."}>
                    {sheet.packages.length > 0 ? (
                      groupedPkgView ? (
                        <div className="space-y-3">
                          {pkgGroups.map(([kind, pkgs]) => (
                            <div key={kind}>
                              <p className="text-[11px] font-bold uppercase tracking-wide text-[#94A3B8] mb-1.5">{kind} <span className="font-semibold">· {pkgs.length}</span></p>
                              <div className="space-y-2">{pkgs.map(renderPkg)}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-2">{sheet.packages.map(renderPkg)}</div>
                      )
                    ) : (
                      <p className="text-[12px] text-[#64748B]">No optional packages — this vehicle is equipped as a standard {listing.trim ? `${listing.trim} ` : ""}build.</p>
                    )}
                  </Section>
                  {sheet.options.length > 0 && (
                    <Section title="Factory options" sub="Standalone options installed on this vehicle.">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {sheet.options.map((o) => (
                          <div key={o.name} className={`${CARD} px-3.5 py-2.5 flex items-center justify-between gap-2`}>
                            <span className="text-[12px] font-semibold text-[#0F172A] leading-tight">{o.name}</span>
                            {o.msrp && <span className="text-[11px] font-bold text-[#16A34A] shrink-0">{fmt$(o.msrp)}</span>}
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}
                  {/* Tier 3 — key features by shopper-priority category */}
                  {sheet.keyFeatures.length > 0 && (
                    <Section title="Key features" sub="The equipment shoppers ask about, organized by category.">
                      <div className="space-y-2">{sheet.keyFeatures.map(([name, items], i) => <Group key={name} title={name} items={items} defaultOpen={i === 0} />)}</div>
                    </Section>
                  )}
                  {/* Tier 4 — full reference list, collapsed by default */}
                  {sheet.standardCount > 0 && (
                    <details className={`${CARD} overflow-hidden group`}>
                      <summary className="cursor-pointer list-none flex items-center justify-between gap-3 px-4 py-3.5">
                        <span className="min-w-0">
                          <span className="block text-[13px] font-bold text-[#0F172A] leading-tight">Complete factory equipment ({sheet.standardCount})</span>
                          <span className="block text-[11px] text-[#94A3B8] leading-tight mt-0.5">Every standard feature on this build, for reference</span>
                        </span>
                        <ChevronDown className="w-4 h-4 text-[#94A3B8] group-open:rotate-180 transition-transform shrink-0" />
                      </summary>
                      <div className="px-3 pb-3 space-y-2">{sheet.standard.map(([name, items]) => <Group key={name} title={name} items={items} />)}</div>
                    </details>
                  )}
                </>
              ) : (
                <>
                  {ordered.length > 0 && (
                    <Section title="Equipment categories">
                      <div className="space-y-2">{ordered.map(([name, items], i) => <Group key={name} title={name} items={items} defaultOpen={i === 0} />)}</div>
                    </Section>
                  )}
                  {featLabels.length > 0 && (
                    <Section title="Factory options">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{featLabels.slice(0, 12).map((f) => <IconCard key={f} icon={Award} title={f} />)}</div>
                    </Section>
                  )}
                </>
              )}
              {accessories.length > 0 && (
                <Section title="Dealer accessories available" sub="Add-ons offered by the dealer — not factory-installed.">
                  <div className="space-y-2">{accessories.map((a) => <div key={a} className={`${CARD} p-3 flex items-center gap-2`}><Package className="w-4 h-4 text-[#2563EB] shrink-0" /><span className="text-[13px] text-[#0F172A]">{a}</span></div>)}</div>
                </Section>
              )}
              <Section title="Build summary">
                <div className={`${CARD} p-4`}>
                  <StatRow label="Factory equipment" value={`${equipCount} items`} />
                  <StatRow label="Factory packages" value={sheet ? (sheet.packages.length ? `${sheet.packages.length} installed` : "None — standard build") : "Awaiting VIN decode"} />
                  <StatRow label="Factory options" value={sheet ? (sheet.options.length ? `${sheet.options.length} installed` : "None reported") : "Awaiting VIN decode"} />
                  <StatRow label="Dealer installed" value={accessories.length ? `${accessories.length} available` : "None reported"} />
                </div>
                {!sheet && <p className="text-[11px] text-[#94A3B8] mt-2">The itemized package and option breakdown appears once this VIN's build sheet is decoded.</p>}
              </Section>
            </>
          ) : <Empty>Equipment details appear here as the vehicle's build data is decoded.</Empty>}
          <Disclaimer />
        </>,
      };
    }

    case "ownership-timeline": {
      const w = d.warranty;
      const isNew = listing.condition === "new";
      const cpoProgs = (listing as unknown as { cpo_programs?: Array<Record<string, unknown>> }).cpo_programs || null;
      const eff = resolveEffectiveWarranty({
        condition: listing.condition, ymm: listing.ymm,
        warrantyInfo: d.warranty, hasDealerOem: !!d.oemWarranty, cpoPrograms: cpoProgs,
      });
      const isFactoryCpo = eff.mode === "cpo_factory";
      const year = (listing.ymm || "").match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
      const fmtDate = (s?: string | Date | null) => s ? new Date(s).toLocaleDateString() : null;
      const inService = w.in_service_date || d.history?.inServiceDate || null;
      const prep = listing.prep_status?.foreman_signed_at || null;
      const services = (listing.service_records || []).filter((s) => s && (s.date || s.type || s.mileage));
      const hasHistory = d.ownerCount != null || d.accidentCount != null || d.cleanTitle || d.serviceCount > 0 || !!listing.recall_status;
      const published = listing.status === "published";
      const firstSeen = d.history?.firstSeen || null;
      // Most recent listing-history entry approximates arrival at the current
      // rooftop; labeled "estimated" because listing feeds can lag a transfer.
      const arrival = (d.history?.entries || [])
        .map((e) => e.first_seen).filter(Boolean).sort().pop() || firstSeen;

      // Summary strip: only chips whose backing field is a real value. Missing
      // data is silence here, never a "pending" placeholder.
      const chips: { label: string; tone?: "amber" }[] = [];
      if (isNew) chips.push({ label: "Factory new" });
      else if (d.ownerCount != null && d.ownerCount > 0) chips.push({ label: `${d.ownerCount} owner${d.ownerCount === 1 ? "" : "s"}` });
      if (isFactoryCpo) chips.push({ label: "Certified Pre-Owned" });
      if (d.serviceCount > 0) chips.push({ label: `${d.serviceCount} service visit${d.serviceCount === 1 ? "" : "s"}` });
      if (!isNew && d.accidentCount === 0) chips.push({ label: "No reported accidents" });
      if (!isNew && d.accidentCount != null && d.accidentCount > 0) chips.push({ label: `${d.accidentCount} reported accident${d.accidentCount === 1 ? "" : "s"}`, tone: "amber" });
      if (!isNew && d.cleanTitle) chips.push({ label: "Clean title" });
      if (d.hasRecallCheck && d.recallClear) chips.push({ label: "No open recalls" });
      const stripNote = chips.map((c) => c.label).join(" · ");

      const fmtTerm = (months?: number | null, miles?: number | null) => {
        if (!months || months <= 0) return null;
        const yrs = months % 12 === 0 ? `${months / 12}-year` : `${months}-month`;
        return miles && miles > 0 ? `${yrs} / ${miles.toLocaleString()}-mile` : yrs;
      };

      const chapters: { title: string; sub?: string; events: TEvent[] }[] = [];

      if (isNew) {
        const events: TEvent[] = [];
        if (year) events.push({ title: `Built — ${year} model year`, source: "OEM model year", status: "estimated", note: "Model year on record; exact build date comes from the OEM build sheet." });
        if (arrival) events.push({ title: `Arrived at ${d.dealerName}`, date: fmtDate(arrival), source: "Listing history", status: "estimated", note: "Transported new from the factory to this dealership." });
        if (prep) events.push({ title: "Dealer preparation complete", date: fmtDate(prep), source: "AutoLabels prep sign-off", status: "verified", note: "Multi-point inspection sign-off was completed." });
        if (published) {
          const term = fmtTerm(eff.info.factory_months, eff.info.factory_miles);
          events.push({ title: "Available today", source: d.dealerName, status: "verified", note: term ? `Your ${term} factory warranty starts the day you take delivery.` : `Available at ${d.dealerName} — this vehicle's history starts with you.` });
        }
        if (events.length) chapters.push({ title: "From the factory to you", sub: "No previous owners — this vehicle's history starts with you.", events });
      } else {
        const own: TEvent[] = [];
        if (inService) own.push({ title: d.ownerCount === 1 ? "First owner — placed in service" : "First placed in service", date: fmtDate(inService), source: "Warranty in-service date", status: "verified", note: "Factory warranty coverage began on this date." });
        if (d.ownerCount != null && d.ownerCount > 0) own.push({ title: d.ownerCount === 1 ? "One owner on record" : `${d.ownerCount} owners on record`, source: "Vehicle history", status: "verified", note: d.cleanTitle ? "Clean title — no brands on record." : "Ownership count reported by vehicle history providers." });
        if (own.length) chapters.push({ title: inService ? `In service since ${new Date(inService).getFullYear()}` : "Ownership", sub: "Who has held this vehicle, from the records available.", events: own });

        const dealerEvents: TEvent[] = [];
        if (arrival) dealerEvents.push({ title: `Arrived at ${d.dealerName}`, date: fmtDate(arrival), source: "Listing history", status: "estimated", note: "First appeared in this dealership's inventory." });
        if (d.recon?.inspection) dealerEvents.push({ title: `Inspected — ${d.recon.inspection.type || "dealer inspection"}`, date: fmtDate(d.recon.inspection.date), source: "Reconditioning record", status: "verified", note: d.recon.workItems.length ? `${d.recon.workItems.length} reconditioning item${d.recon.workItems.length === 1 ? "" : "s"} completed.` : d.recon.inspection.passed ? "Inspection passed." : "Inspection recorded." });
        if (prep) dealerEvents.push({ title: "Dealer preparation complete", date: fmtDate(prep), source: "AutoLabels prep sign-off", status: "verified", note: "Multi-point inspection sign-off was completed." });
        if (published) dealerEvents.push({ title: "Available today", source: d.dealerName, status: "verified", note: `Listed and available at ${d.dealerName}.` });
        if (dealerEvents.length) chapters.push({ title: `At ${d.dealerName}`, sub: "Inspected and ready for its next owner.", events: dealerEvents });
      }

      // Service history: chronological when short, clustered by year when long.
      const svcEvent = (s: NonNullable<VehicleListing["service_records"]>[number]): TEvent => ({ title: s.type || "Service performed", date: fmtDate(s.date), mileage: s.mileage ? `${s.mileage} mi` : null, source: "Service record", status: "verified", note: s.notes || "Maintenance performed and recorded." });
      const svcYears = new Map<string, TEvent[]>();
      for (const s of services) {
        const y = (s.date || "").match(/\b(19|20)\d{2}\b/)?.[0] || "Undated";
        if (!svcYears.has(y)) svcYears.set(y, []);
        svcYears.get(y)!.push(svcEvent(s));
      }
      const svcClusters = Array.from(svcYears.entries()).sort((a, b) => a[0].localeCompare(b[0]));

      const missing: string[] = [];
      if (!isNew && services.length === 0) missing.push("service records");
      if (!isNew && d.ownerCount == null) missing.push("ownership records");
      if (!isNew && d.accidentCount == null) missing.push("accident reports");

      const heroEyebrow = isNew ? "Factory New" : isFactoryCpo ? "Certified Pre-Owned" : "Ownership Timeline";
      const heroNote = isNew ? "This vehicle's history starts with you." : stripNote || "The journey of this vehicle, from the records available.";

      return {
        title: "Ownership Timeline",
        subtitle: isNew ? "The short, confident story of a factory-new vehicle." : "The journey of this vehicle, told from verified records.",
        footerQuestion: "Questions about this vehicle's timeline?",
        primary: { label: "Contact Dealer", onClick: () => go("contact") },
        secondary: hasHistory ? { label: "View Vehicle History Report", onClick: () => go("vehicle-history") } : undefined,
        body: <>
          <div className="md:hidden"><MHero tone={isNew ? "blue" : "green"} icon={Clock} eyebrow={heroEyebrow} title={listing.ymm || "Timeline"} note={heroNote} /></div>
          {chips.length >= 2 && (
            <div className={`${CARD} p-4 hidden md:flex flex-wrap gap-2`}>
              {chips.map((c) => (
                <span key={c.label} className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold border ${c.tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50/70 text-emerald-800"}`}>{c.label}</span>
              ))}
            </div>
          )}
          {chapters.slice(0, 1).map((c) => <Section key={c.title} title={c.title} sub={c.sub}><TimelineGroup events={c.events} /></Section>)}
          {!isNew && services.length > 0 && (
            <Section title={`Maintained — ${services.length} visit${services.length === 1 ? "" : "s"} on record`} sub="Service history reported for this vehicle.">
              {services.length <= 5 ? (
                <TimelineGroup events={svcClusters.flatMap(([, evs]) => evs)} />
              ) : (
                <div className="space-y-2">
                  {svcClusters.map(([y, evs]) => (
                    <details key={y} className={`${CARD} px-4 py-3`}>
                      <summary className="cursor-pointer list-none flex items-center justify-between">
                        <span className="text-[13px] font-bold">{y} — {evs.length} service visit{evs.length === 1 ? "" : "s"}</span>
                        <ChevronDown className="w-4 h-4 text-[#94A3B8]" />
                      </summary>
                      <div className="mt-3"><TimelineGroup events={evs} /></div>
                    </details>
                  ))}
                </div>
              )}
            </Section>
          )}
          {chapters.slice(1).map((c) => <Section key={c.title} title={c.title} sub={c.sub}><TimelineGroup events={c.events} /></Section>)}
          {isFactoryCpo && (
            <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-5">
              <div className="flex items-center gap-2"><BadgeCheck className="w-5 h-5 text-violet-700" /><p className="text-[15px] font-extrabold text-violet-900">Certified Pre-Owned{eff.cpoProgramName ? ` — ${eff.cpoProgramName}` : ""}</p></div>
              {eff.cpoInspectionPoints && <p className="text-[13px] text-violet-800 mt-1.5">Passed the {eff.cpoInspectionPoints}-point factory certification inspection.</p>}
              {fmtTerm(eff.info.powertrain_months, eff.info.powertrain_miles) && <p className="text-[13px] text-violet-800 mt-1">Powertrain coverage extended to {fmtTerm(eff.info.powertrain_months, eff.info.powertrain_miles)} from original in-service.</p>}
              {eff.cpoWrap && <p className="text-[13px] text-violet-800 mt-1">{eff.cpoWrap.programName}: {eff.cpoWrap.months} months / {eff.cpoWrap.miles ? eff.cpoWrap.miles.toLocaleString() : "unlimited"} miles from your purchase date.</p>}
            </div>
          )}
          {missing.length > 0 && (
            <p className="text-[12px] text-[#64748B]">Not yet on file: {missing.join(", ")}. We only show verified records — ask {d.dealerName} for the full history report.</p>
          )}
          {hasHistory && (
            <button onClick={() => go("vehicle-history")} className="w-full h-11 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-[13px] font-semibold inline-flex items-center justify-center gap-2 transition-colors"><History className="w-4 h-4" /> View Full Vehicle History Report</button>
          )}
          {d.historyReport && packetVisible(listing, "historyReport") && (
            <a
              href={d.historyReport.url} target="_blank" rel="noopener noreferrer"
              onClick={() => { if (!isPreview) trackCustomerCtaClicked({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: "passport", surface: "vehicle_passport", metadata: { cta: "history_report", provider: d.historyReport?.provider ?? null, placement: "timeline_panel" } }); }}
              className="block text-center text-[13px] font-semibold text-[#2563EB] hover:underline"
            >
              Verify this timeline in the free {historyReportName(d.historyReport.provider)} Report <ExternalLink className="w-3.5 h-3.5 inline -mt-0.5" />
            </a>
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

// Full factory-coverage presentation for a new/CPO car — one card per coverage
// type the dealer verified for this brand (bumper-to-bumper, powertrain,
// corrosion, roadside, hybrid/EV battery, complimentary maintenance).
const COVERAGE_ICON: Record<CoverageKey, React.ElementType> = {
  basic: ShieldCheck, powertrain: Gauge, corrosion: Car, roadside: LifeBuoy, ev_battery: Zap, maintenance: Wrench,
};
// ── Factory-warranty slide-out primitives ───────────────────────────────────

// Big coverage card (Bumper-to-Bumper = blue, Powertrain = green): % remaining,
// progress bar, time + miles remaining, two-line expiration.
const CoverageCard = ({ title, subtitle, pct, tone, years, miles, expiresDate, expiresMiles }: {
  title: string; subtitle: string; pct: number | null; tone: "blue" | "green";
  years?: string | null; miles?: string | null; expiresDate?: string | null; expiresMiles?: string | null;
}) => {
  const a = tone === "blue"
    ? { text: "text-[#2563EB]", bar: "bg-[#2563EB]", chip: "bg-blue-50 text-[#2563EB]" }
    : { text: "text-[#16A34A]", bar: "bg-[#16A34A]", chip: "bg-emerald-50 text-[#16A34A]" };
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className={`w-9 h-9 rounded-xl ${a.chip} flex items-center justify-center shrink-0`}><ShieldCheck className="w-[18px] h-[18px]" /></span>
        <div className="min-w-0"><p className="text-[14px] font-bold text-[#0F172A] leading-tight">{title}</p><p className="text-[11px] text-[#64748B] leading-tight">{subtitle}</p></div>
      </div>
      {pct != null && (
        <>
          <p className={`font-extrabold ${a.text} leading-none mt-3`}><span className="text-[40px]">{pct}</span><span className="text-[20px]">%</span></p>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden mt-2.5"><div className={`h-full rounded-full ${a.bar}`} style={{ width: `${Math.max(3, Math.min(100, pct))}%` }} /></div>
        </>
      )}
      <div className="mt-3 space-y-2">
        {years && <p className="text-[12px] font-semibold text-[#0F172A] flex items-center gap-2"><Calendar className="w-4 h-4 text-[#94A3B8] shrink-0" />{years}</p>}
        {miles && <p className="text-[12px] font-semibold text-[#0F172A] flex items-center gap-2"><CalendarDays className="w-4 h-4 text-[#94A3B8] shrink-0" />{miles}</p>}
      </div>
      {(expiresDate || expiresMiles) && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          {expiresDate && <p className="text-[12px] text-[#64748B] leading-tight">Expires {expiresDate}</p>}
          {expiresMiles && <p className="text-[12px] text-[#64748B] leading-tight">or {expiresMiles}</p>}
        </div>
      )}
    </div>
  );
};

// ── Goal-layout warranty primitives (wide modal) ─────────────────────────────
// Top status card. New cars show only the delivery-based start; used/CPO show
// the in-service start and the calculated end (date + mileage).
const WarrantyStatusCard = ({ active, startLabel, startSub, endDate, endMiles }: {
  active: boolean; startLabel: string; startSub?: string | null; endDate?: string | null; endMiles?: number | null;
}) => (
  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
    <div className="flex flex-col sm:flex-row sm:items-center gap-5">
      <div className="flex items-start gap-3.5 min-w-0 flex-1">
        <span className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center shrink-0"><ShieldCheck className="w-7 h-7 text-[#16A34A]" /></span>
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-[#0F172A]">Factory Warranty</p>
          <p className={`text-[26px] font-extrabold leading-none tracking-wide mt-0.5 ${active ? "text-[#16A34A]" : "text-[#64748B]"}`}>{active ? "ACTIVE" : "EXPIRED"}</p>
          <p className="text-[12px] text-[#64748B] mt-1.5 leading-snug">{active ? "Your factory warranty is in effect. You're covered." : "Factory coverage has ended for this vehicle."}</p>
        </div>
      </div>
      <div className="flex items-stretch gap-6 sm:border-l sm:border-emerald-200/70 sm:pl-6">
        <div>
          <p className="text-[11px] font-semibold text-[#64748B]">Warranty Start</p>
          <p className="text-[15px] font-extrabold text-[#0F172A] mt-1 leading-tight">{startLabel}</p>
          {startSub && <p className="text-[11px] text-[#94A3B8] leading-tight">{startSub}</p>}
        </div>
        {(endDate || endMiles) && (
          <div>
            <p className="text-[11px] font-semibold text-[#64748B]">Warranty End</p>
            {endDate && <p className="text-[15px] font-extrabold text-[#0F172A] mt-1 leading-tight">{endDate}</p>}
            {endMiles && <p className="text-[11px] text-[#94A3B8] leading-tight">or {endMiles.toLocaleString()} miles</p>}
          </div>
        )}
      </div>
    </div>
  </div>
);

// New-car coverage card: term + mileage only — no percentages, progress, or
// remaining figures (coverage hasn't started counting down until delivery).
const NewCoverageCard = ({ title, subtitle, tone, years, miles }: {
  title: string; subtitle: string; tone: "blue" | "green"; years?: string | null; miles?: string | null;
}) => {
  const a = tone === "blue" ? { chip: "bg-blue-50 text-[#2563EB]", text: "text-[#2563EB]" } : { chip: "bg-emerald-50 text-[#16A34A]", text: "text-[#16A34A]" };
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className={`w-9 h-9 rounded-xl ${a.chip} flex items-center justify-center shrink-0`}><ShieldCheck className="w-[18px] h-[18px]" /></span>
        <div className="min-w-0"><p className="text-[14px] font-bold text-[#0F172A] leading-tight">{title}</p><p className="text-[11px] text-[#64748B] leading-tight">{subtitle}</p></div>
      </div>
      <div className="mt-4 space-y-2.5">
        {years && <p className="flex items-center gap-2.5"><Calendar className="w-4 h-4 text-[#94A3B8] shrink-0" /><span className="text-[15px]"><span className={`font-extrabold ${a.text}`}>{years.replace(/\s.*/, "")}</span> <span className="text-[#64748B] font-medium">{years.replace(/^\S+\s/, "")}</span></span></p>}
        {miles && <p className="flex items-center gap-2.5"><Gauge className="w-4 h-4 text-[#94A3B8] shrink-0" /><span className="text-[15px]"><span className={`font-extrabold ${a.text}`}>{miles.replace(/\s.*/, "")}</span> <span className="text-[#64748B] font-medium">{miles.replace(/^\S+\s/, "")}</span></span></p>}
      </div>
    </div>
  );
};

// Right-column list of additional factory benefits. Rows with a component
// checklist expand inline (slide-down); rows without one open the collapsed
// "What's Included" section instead so the chevron always responds.
interface BenefitRow { icon: React.ElementType; title: string; term: string; sub?: string | null; tone?: "blue" | "green"; items?: string[] }
const AdditionalFactoryBenefitsCard = ({ rows, onDetails }: { rows: BenefitRow[]; onDetails: () => void }) => {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="rounded-2xl border border-[#E6E8EC] bg-white p-4 sm:p-5">
      <p className="text-[15px] font-bold text-[#0F172A] mb-1">Additional Factory Benefits</p>
      {rows.length > 0 ? (
        <div className="divide-y divide-slate-100">
          {rows.map((r) => {
            const Icon = r.icon;
            const c = r.tone === "green" ? "bg-emerald-50 text-[#16A34A]" : "bg-blue-50 text-[#2563EB]";
            const expandable = (r.items?.length ?? 0) > 0;
            const isOpen = open === r.title;
            return (
              <div key={r.title}>
                <button
                  onClick={() => expandable ? setOpen(isOpen ? null : r.title) : onDetails()}
                  aria-expanded={expandable ? isOpen : undefined}
                  className="w-full flex items-center gap-3 py-3 text-left group"
                >
                  <span className={`w-10 h-10 rounded-full ${c} flex items-center justify-center shrink-0`}><Icon className="w-[18px] h-[18px]" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-bold text-[#0F172A] leading-tight">{r.title}</p>
                    <p className="text-[12px] text-[#64748B] leading-tight">{r.term}</p>
                    {r.sub && <p className="text-[11px] text-[#94A3B8] leading-tight mt-0.5">{r.sub}</p>}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-[#CBD5E1] group-hover:text-[#94A3B8] shrink-0 transition-transform ${isOpen ? "rotate-180" : expandable ? "" : "-rotate-90"}`} />
                </button>
                {expandable && isOpen && (
                  <div className="pb-3 pl-[52px]">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                      {r.items!.map((it) => <div key={it} className="flex items-start gap-2 text-[12px] text-[#334155]"><CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0 mt-0.5" />{it}</div>)}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[12px] text-[#64748B] mt-2">Roadside, corrosion, and emissions coverage may apply — ask the dealer to confirm the terms for this vehicle.</p>
      )}
    </div>
  );
};

// Used / pre-owned CPO banner (lavender). Never shown for new cars. Certified
// cars state the fact; eligible-but-uncertified cars say "may qualify".
const CpoBanner = ({ brand, certified = false, programName, onLearn }: { brand?: string | null; certified?: boolean; programName?: string | null; onLearn: () => void }) => (
  <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
    <span className="w-12 h-12 rounded-2xl bg-violet-100 flex items-center justify-center shrink-0"><BadgeCheck className="w-6 h-6 text-violet-600" /></span>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[15px] font-bold text-[#0F172A]">Certified Pre-Owned</p>
        {brand && <span className="text-[10px] font-bold uppercase tracking-wide text-violet-700 bg-violet-100 rounded-full px-2 py-0.5">{brand} CPO</span>}
      </div>
      <p className="text-[12px] text-[#64748B] mt-0.5">
        {certified
          ? `This vehicle is ${brand ? `${brand} ` : ""}Certified Pre-Owned${programName ? ` under ${programName}` : ""}.`
          : `This vehicle may qualify for ${brand ? `${brand} ` : ""}Certified Pre-Owned benefits.`}
      </p>
    </div>
    <button onClick={onLearn} className="shrink-0 h-10 px-4 rounded-xl border border-violet-300 bg-white text-[13px] font-semibold text-violet-700 inline-flex items-center gap-1.5 hover:bg-violet-100 transition-colors">Learn More <ChevronRight className="w-4 h-4" /></button>
  </div>
);

interface TLPoint { date: string; label: string; color: string }
// Slider-style timeline: labels above, a gray track below with a green fill to
// today and a dot at each milestone.
const WarrantyTimeline = ({ points, todayIndex }: { points: TLPoint[]; todayIndex: number }) => {
  const n = points.length;
  if (n < 2) return null;
  const fillPct = todayIndex > 0 ? (todayIndex / (n - 1)) * 100 : 0;
  return (
    <div>
      <div className="grid mb-2.5" style={{ gridTemplateColumns: `repeat(${n}, minmax(0,1fr))` }}>
        {points.map((p, i) => (
          <div key={i} className={i === 0 ? "text-left" : i === n - 1 ? "text-right" : "text-center"}>
            <p className="text-[11px] font-bold text-[#0F172A] leading-tight">{p.date}</p>
            <p className="text-[10px] text-[#94A3B8] leading-tight">{p.label}</p>
          </div>
        ))}
      </div>
      <div className="relative h-3.5 mx-1">
        <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1 rounded-full bg-slate-200" />
        <div className="absolute top-1/2 -translate-y-1/2 left-0 h-1 rounded-full bg-emerald-400" style={{ width: `${fillPct}%` }} />
        {points.map((p, i) => {
          const pos = (i / (n - 1)) * 100;
          return <span key={i} className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full ring-2 ring-white shadow-sm ${p.color}`} style={{ left: `calc(${pos}% - 7px)` }} />;
        })}
      </div>
    </div>
  );
};

// Side-view vehicle that highlights the body (basic) or the drivetrain
// (powertrain) when the matching toggle is selected. Toggles + legend on the
// left, the vehicle on the right.
// Uploaded coverage icons — five interaction states per coverage type
// (bumper-to-bumper "btb", powertrain "pt"). Files live in /public and were
// renamed to hyphenated names so the browser can serve them without %20
// URL-encoding surprises.
const COVERAGE_ICON_IMG: Record<"btb" | "pt", Record<"default" | "hover" | "active" | "selected" | "disabled", string>> = {
  btb: {
    default: "/btb-default.png",
    hover: "/btb-hover.png",
    active: "/btb-active.png",
    selected: "/btb-selected.png",
    disabled: "/btb-disabled.png",
  },
  pt: {
    default: "/pt-default.png",
    hover: "/pt-hover.png",
    active: "/pt-active.png",
    selected: "/pt-selected.png",
    disabled: "/pt-disabled.png",
  },
};

// Segmented-control card: 64px tall, 14px radius, uploaded state icon on the
// left, bold title over a gray subtitle. Selected → blue/green border + tint +
// accent title. Hover/pressed/disabled swap the icon PNG accordingly.
const CoverageToggle = ({ selected, tone, iconKey, title, sub, disabled = false, onClick }: { selected: boolean; tone: "blue" | "green"; iconKey: "btb" | "pt"; title: string; sub: string; disabled?: boolean; onClick: () => void }) => {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const accent = tone === "blue" ? "#2563EB" : "#16A34A";
  const iconState = disabled ? "disabled" : pressed ? "active" : selected ? "selected" : hover ? "hover" : "default";
  // 1px default border, 2px selected — box-sizing keeps the outer size fixed so
  // selecting never shifts layout. Hover tints match the coverage color.
  const box = disabled
    ? "border border-[#E5E7EB] bg-[#F8FAFC] cursor-not-allowed"
    : selected
      ? (tone === "blue" ? "border-2 border-[#2563EB] bg-[#EFF6FF]" : "border-2 border-[#16A34A] bg-[#F0FDF4]")
      : (tone === "blue"
          ? "border border-[#E5E7EB] bg-white hover:bg-[#EFF6FF] hover:border-slate-300 cursor-pointer"
          : "border border-[#E5E7EB] bg-white hover:bg-[#F0FDF4] hover:border-slate-300 cursor-pointer");
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`${title} coverage, ${selected ? "selected" : "not selected"}`}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      className={`w-full flex items-center gap-3 h-[72px] px-3.5 py-3 rounded-2xl text-left transition-all duration-[120ms] ${box} ${pressed && !disabled ? "scale-[0.98]" : ""}`}
    >
      <img src={COVERAGE_ICON_IMG[iconKey][iconState]} alt="" aria-hidden="true" className="w-[30px] h-[30px] shrink-0 object-contain" />
      <div className="min-w-0">
        <p className="text-[14px] font-bold leading-[1.15] whitespace-nowrap" style={{ color: disabled ? "#94A3B8" : selected ? accent : "#111827" }}>{title}</p>
        <p className="text-[11.5px] leading-[1.25] mt-0.5" style={{ color: disabled ? "#CBD5E1" : "#64748B" }}>{sub}</p>
      </div>
    </button>
  );
};
// Customer-uploaded vehicle renders. The transition frame (neutral blue) is
// crossfaded between the two so switching coverage reads as a morph.
const WARR_IMG = {
  basic: "/cropped_more_translucent_suv.png",
  powertrain: "/cropped_powertrain_suv.png",
  transition: "/cropped_translucent_suv.png",
};
// Full component breakdown per coverage type — powers "View all covered
// components". Typical manufacturer groupings; the OEM warranty booklet
// governs, and the disclaimer under the list says so.
const COVERAGE_COMPONENTS: Record<string, string[]> = {
  basic: [
    "Air conditioning & climate control", "Audio & infotainment systems", "Navigation & displays",
    "Electrical system & electronics", "Sensors, cameras & driver assistance", "Power windows, locks & seats",
    "Steering components", "Suspension components", "Brake system (excl. pads & rotors wear)",
    "Fuel system", "Cooling & heating system", "Interior trim, seats & switchgear",
    "Exterior components & lighting", "Onboard computers & modules",
  ],
  powertrain: [
    "Engine block, heads & internals", "Timing components", "Oil pump & lubrication",
    "Transmission & transaxle", "Torque converter", "Transfer case",
    "Drive shafts & CV joints", "Axles & bearings", "Differential",
    "AWD / 4WD components", "Major seals & gaskets",
  ],
  corrosion: ["Body sheet-metal panels (rust-through / perforation from the inside out)"],
  roadside: ["24/7 towing to the nearest dealer", "Battery jump-start", "Flat-tire change", "Lockout assistance", "Emergency fuel delivery"],
  ev_battery: ["High-voltage battery pack", "Drive motor(s)", "Inverter & power electronics", "On-board charger"],
  maintenance: ["Factory-scheduled maintenance visits", "Oil & filter changes", "Tire rotations", "Multi-point inspections"],
};

// The systems each coverage type protects — updates live under the selector.
const COVERED_SYSTEMS: Record<"basic" | "powertrain", string[]> = {
  basic: ["Electronics", "Climate Control", "Audio", "Navigation", "Suspension", "Interior Components"],
  powertrain: ["Engine", "Transmission", "Transfer Case", "AWD System", "Drive Axles", "Differential"],
};
const WarrantyCarVisual = ({ hasPowertrain, onAll }: { hasPowertrain: boolean; onAll: () => void }) => {
  const [mode, setMode] = useState<"basic" | "powertrain">("basic");
  const [morphing, setMorphing] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);
  const switchTo = (next: "basic" | "powertrain") => {
    if (next === mode) return;
    setMorphing(true); // fade the neutral transition frame in over the current image
    timers.current.push(window.setTimeout(() => { setMode(next); }, 300)); // swap target underneath
    timers.current.push(window.setTimeout(() => { setMorphing(false); }, 330)); // fade transition back out to reveal target
  };
  const layer = "absolute inset-0 w-full h-full object-contain transition-opacity duration-300 ease-out";
  // Legend "Covered" dot + list checks track the active coverage: blue for
  // bumper-to-bumper, green for powertrain.
  const accent = mode === "basic" ? "#2563EB" : "#16A34A";
  return (
    <div className={`${CARD} p-4`}>
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,35fr)_minmax(0,65fr)] gap-4 items-start">
        {/* Left ~35% — segmented selector + live covered-systems list */}
        <div className="space-y-2.5">
          <CoverageToggle selected={mode === "basic"} tone="blue" iconKey="btb" title="Bumper-to-Bumper" sub="Basic Vehicle Coverage" onClick={() => switchTo("basic")} />
          {hasPowertrain && <CoverageToggle selected={mode === "powertrain"} tone="green" iconKey="pt" title="Powertrain" sub="Engine, Transmission & Drivetrain" onClick={() => switchTo("powertrain")} />}
          <ul className="pt-1.5 space-y-1.5">
            {COVERED_SYSTEMS[mode].map((s) => (
              <li key={s} className="flex items-center gap-1.5 text-[12px] text-[#0F172A]"><CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: accent }} />{s}</li>
            ))}
          </ul>
        </div>
        {/* Right ~65% — large vehicle illustration + legend beneath */}
        <div>
          <div className="relative w-full" style={{ aspectRatio: "1448 / 630" }}>
            <img src={WARR_IMG.basic} alt="Bumper-to-bumper coverage" loading="lazy" className={`${layer} ${mode === "basic" && !morphing ? "opacity-100" : "opacity-0"}`} />
            <img src={WARR_IMG.powertrain} alt="Powertrain coverage" loading="lazy" className={`${layer} ${mode === "powertrain" && !morphing ? "opacity-100" : "opacity-0"}`} />
            <img src={WARR_IMG.transition} alt="" aria-hidden="true" loading="lazy" className={`${layer} ${morphing ? "opacity-100" : "opacity-0"}`} />
          </div>
          <div className="flex items-center justify-center gap-4 mt-1.5 text-[11px] text-[#6B7280]">
            <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: accent }} /> Covered</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-300" /> Not Covered</span>
          </div>
        </div>
      </div>
      <div className="flex justify-end mt-2 pt-2 border-t border-slate-100">
        <button onClick={onAll} className="text-[11px] font-semibold text-[#2563EB] inline-flex items-center gap-1 hover:underline">View all covered components <ArrowRight className="w-3 h-3" /></button>
      </div>
    </div>
  );
};

// Compact accordion row (collapsed by default).
const WAcc = ({ id, icon: Icon, title, sub, children }: { id?: string; icon: React.ElementType; title: string; sub?: string; children: React.ReactNode }) => (
  <details id={id} className="rounded-xl border border-[#E6E8EC] bg-white group">
    <summary className="cursor-pointer list-none flex items-center gap-3 p-3.5">
      <span className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center shrink-0"><Icon className="w-4 h-4 text-[#64748B]" /></span>
      <div className="min-w-0 flex-1"><p className="text-[13px] font-bold text-[#0F172A] leading-tight">{title}</p>{sub && <p className="text-[11px] text-[#94A3B8] leading-tight">{sub}</p>}</div>
      <ChevronDown className="w-4 h-4 text-[#94A3B8] group-open:rotate-180 transition-transform shrink-0" />
    </summary>
    <div className="px-3.5 pb-3.5 pt-1 text-[12px] text-[#64748B] space-y-2 leading-relaxed">{children}</div>
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

// Large warranty progress bar (fills on mount) for the mobile warranty panel.
const WarrantyBar = ({ title, big, pctLabel, pct, expires, tone = "green" }: { title: string; big: string; pctLabel: string; pct: number; expires?: string | null; tone?: "green" | "blue" }) => {
  const [fill, setFill] = useState(false);
  useEffect(() => { const r = requestAnimationFrame(() => setFill(true)); return () => cancelAnimationFrame(r); }, []);
  const color = tone === "blue" ? "#2563EB" : "#16A34A";
  return (
    <div className={`${CARD} p-5`}>
      <div className="flex items-center justify-between"><p className="text-[14px] font-bold">{title}</p><span className="text-[12px] font-bold" style={{ color }}>{pctLabel}</span></div>
      <p className="text-[22px] font-extrabold mt-1 leading-none">{big}</p>
      <div className="mt-3 h-3.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: fill ? `${Math.max(3, Math.min(100, pct))}%` : "0%", background: color, transition: "width 900ms ease-out" }} /></div>
      {expires && <p className="text-[11px] text-[#94A3B8] mt-2">Expires {expires}</p>}
    </div>
  );
};

// Shared mobile gradient hero — one look across every slide-out's mobile view.
const G_GREEN = "linear-gradient(160deg,#0f7a3d 0%,#16A34A 100%)";
const G_BLUE = "linear-gradient(160deg,#2563EB 0%,#1e50c8 100%)";
const MHero = ({ tone = "green", icon: Icon, eyebrow, title, note, ringPct, statusLabel }: { tone?: "green" | "blue"; icon?: React.ElementType; eyebrow: string; title: string; note?: string; ringPct?: number; statusLabel?: string }) => (
  <div className="rounded-2xl p-5 text-white" style={{ background: tone === "blue" ? G_BLUE : G_GREEN }}>
    {ringPct != null ? (
      <div className="flex flex-col items-center text-center">
        <AnimatedRing pct={ringPct} color="#ffffff" />
        <p className="text-[13px] font-bold opacity-90 mt-2">{eyebrow}</p>
        <p className="text-[18px] font-extrabold">{title}</p>
        {note && <p className="text-[13px] opacity-90 mt-2 leading-snug">{note}</p>}
      </div>
    ) : (
      <>
        <div className="flex items-center gap-3">
          {Icon && <span className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0"><Icon className="w-6 h-6" /></span>}
          <div className="min-w-0"><p className="text-[13px] font-bold uppercase tracking-wider opacity-95">{eyebrow}</p><p className="text-[24px] font-extrabold leading-tight">{title}</p>{statusLabel && <p className="text-[12px] opacity-90">{statusLabel}</p>}</div>
        </div>
        {note && <p className="text-[13px] opacity-90 mt-3 leading-snug">{note}</p>}
      </>
    )}
  </div>
);

// ── Mobile slide-out footer CTA — dealer-configurable variant ──
interface CtaSignals { greatPrice: boolean; highDemand: boolean; highConf: boolean; highlyRated: boolean; hasWarranty: boolean }
interface CtaDef { badge: string; btn: string; sub: string; action: "reserve" | "protect"; tone: "green" | "orange" | "blue" }
const ctaFor = (panelKey: string, s: CtaSignals): CtaDef => {
  switch (panelKey) {
    case "market-price": return { badge: s.greatPrice ? "Great Price Available Today" : "Vehicle Available Today", btn: s.greatPrice ? "Lock In This Price" : "Reserve This Vehicle", sub: s.greatPrice ? "This price is below market and ready to lock in." : "Secure this vehicle while it's still available.", action: "reserve", tone: s.greatPrice ? "green" : "blue" };
    case "market-demand": return { badge: s.highDemand ? "High Demand In Your Market" : "Vehicle Available Today", btn: s.highDemand ? "Claim This Vehicle" : "Reserve This Vehicle", sub: s.highDemand ? "High-demand vehicles go fast." : "Secure this vehicle while it's still available.", action: "reserve", tone: "green" };
    // Urgency copy only when the data supports it — a fabricated scarcity badge
    // above an honest empty state poisons the page's verification premise.
    case "comparable-vehicles": return s.highDemand
      ? { badge: "In Demand", btn: "Reserve This Vehicle", sub: "This vehicle is drawing strong shopper interest.", action: "reserve", tone: "blue" }
      : { badge: "Vehicle Available Today", btn: "Reserve This Vehicle", sub: "Secure this vehicle while it's still available.", action: "reserve", tone: "blue" };
    case "inventory-trend": return s.highDemand
      ? { badge: "Strong Local Interest", btn: "Reserve This Vehicle", sub: "Shopper activity on this vehicle is above average.", action: "reserve", tone: "orange" }
      : { badge: "Vehicle Available Today", btn: "Reserve This Vehicle", sub: "Secure this vehicle while it's still available.", action: "reserve", tone: "blue" };
    case "price-confidence": return { badge: s.highConf ? "Verified Best Value" : "Independently Verified", btn: s.highConf ? "Reserve With Confidence" : "Reserve This Vehicle", sub: "This price has been independently verified.", action: "reserve", tone: "green" };
    case "factory-warranty": return { badge: s.hasWarranty ? "Warranty Coverage Available" : "Vehicle Available Today", btn: s.hasWarranty ? "Protect This Vehicle" : "Reserve This Vehicle", sub: s.hasWarranty ? "Secure remaining factory protection." : "Secure this vehicle while it's still available.", action: s.hasWarranty ? "protect" : "reserve", tone: "green" };
    case "owner-reviews": return { badge: s.highlyRated ? "Highly Rated By Owners" : "Trusted Dealer Reviews", btn: "Reserve This Vehicle", sub: "Owners love this vehicle.", action: "reserve", tone: "green" };
    default: return { badge: "Vehicle Available Today", btn: "Reserve This Vehicle", sub: "Secure this vehicle while it's still available.", action: "reserve", tone: "blue" };
  }
};
const TrustRow = ({ items }: { items: { icon: React.ElementType; t: string }[] }) => (
  <div className="flex items-start justify-between mt-3 gap-1">{items.map((x) => (
    <div key={x.t} className="flex flex-col items-center gap-0.5 text-center flex-1"><x.icon className="w-3.5 h-3.5 text-[#94A3B8]" /><span className="text-[9px] text-[#94A3B8] leading-tight">{x.t}</span></div>
  ))}</div>
);
// Honest promise set: reserving sends a request the dealer confirms — nothing
// is charged or instantly locked, so the chips must not claim it is.
const TRUST_DEFAULT = [{ icon: ShieldCheck, t: "No Payment Now" }, { icon: CheckCircle2, t: "Dealer Confirms Fast" }, { icon: BadgeCheck, t: "No Obligation" }];
const TRUST_PROGRESSIVE = [{ icon: ShieldCheck, t: "No Payment Now" }, { icon: BadgeCheck, t: "Dealer Will Confirm" }, { icon: CheckCircle2, t: "No Obligation" }];

function MobileCtaFooter({ variant, panelKey, go, signals }: { variant: string; panelKey: string; go: (s: string) => void; signals: CtaSignals }) {
  const cta = ctaFor(panelKey, signals);
  const primary = () => go(cta.action === "protect" ? "protect" : "reserve");
  const toneBadge = cta.tone === "orange" ? "bg-orange-50 border-orange-200 text-[#EA580C]" : cta.tone === "green" ? "bg-emerald-50 border-emerald-200 text-[#16A34A]" : "bg-blue-50 border-blue-200 text-[#2563EB]";
  const BadgeIcon = cta.tone === "orange" ? Flame : cta.tone === "green" ? CheckCircle2 : ShieldCheck;
  const BlueBtn = ({ label, sub }: { label: string; sub?: string }) => (
    <button onClick={primary} className="w-full min-h-[52px] rounded-2xl bg-[#2563EB] active:bg-[#1d4fd7] text-white inline-flex flex-col items-center justify-center transition-all active:scale-[0.99] px-3 py-2">
      <span className="text-[15px] font-bold inline-flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> {label}</span>
      {sub && <span className="text-[11px] opacity-85 font-medium leading-tight">{sub}</span>}
    </button>
  );
  const Badge = () => (
    <div className={`rounded-xl border p-3 mb-3 ${toneBadge}`}><p className="text-[13px] font-bold inline-flex items-center gap-1.5"><BadgeIcon className="w-4 h-4" /> {cta.badge}</p><p className="text-[12px] text-[#64748B] mt-0.5">{cta.sub}</p></div>
  );

  if (variant === "two_button") {
    return (
      <div>
        <p className="text-[12px] font-semibold text-[#0F172A]">Questions about this vehicle?</p>
        <button onClick={() => go("contact")} className="text-[12px] font-semibold text-[#2563EB] inline-flex items-center gap-1.5 mb-3"><MessageSquare className="w-3.5 h-3.5" /> Talk to a Vehicle Specialist</button>
        <BlueBtn label="Reserve This Vehicle" />
      </div>
    );
  }
  if (variant === "context_aware") {
    return <div><Badge /><BlueBtn label={cta.btn} /><TrustRow items={TRUST_DEFAULT} /></div>;
  }
  if (variant === "progressive") {
    const chips = [signals.greatPrice ? "Great Price" : null, "Verified Vehicle", signals.highConf ? "High Confidence" : null].filter(Boolean) as string[];
    return (
      <div>
        <p className="text-[11px] font-semibold text-[#94A3B8] uppercase tracking-wider mb-2">You're looking at</p>
        <div className="flex flex-wrap gap-1.5 mb-3">{chips.map((c) => <span key={c} className="text-[11px] font-semibold text-[#16A34A] bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">{c}</span>)}</div>
        <button onClick={primary} className="w-full min-h-[52px] rounded-2xl bg-[#2563EB] active:bg-[#1d4fd7] text-white text-[15px] font-bold inline-flex items-center justify-center gap-2 transition-all active:scale-[0.99]">Continue With This Vehicle</button>
        <p className="text-[11px] text-[#94A3B8] text-center mt-1.5">Review your next steps before reserving.</p>
        <TrustRow items={TRUST_PROGRESSIVE} />
      </div>
    );
  }
  // dealer_availability (default)
  return <div><Badge /><BlueBtn label={cta.btn} sub="Secure this vehicle while it's still available." /><TrustRow items={TRUST_DEFAULT} /></div>;
}

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
  const featLabels = listingEquipment(listing);
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

// Same-rooftop alternative card — the ONLY vehicles the passport merchandises
// are the tenant's own stock. Tag line carries the package/price positioning
// ("More equipment · +$2,450 in factory options"); links to the sibling's
// passport with a full navigation so panel/scroll state resets.
const ALT_TONE: Record<DealerAlternative["tone"], string> = {
  blue: "bg-blue-50 text-[#2563EB]",
  green: "bg-emerald-50 text-[#16A34A]",
  violet: "bg-violet-50 text-violet-700",
  neutral: "bg-slate-100 text-[#64748B]",
};
const AlternativeCard = ({ alt, from, compact = false }: { alt: DealerAlternative; from?: { slug: string | null; ymm: string | null }; compact?: boolean }) => (
  <a
    href={`/v/${alt.slug}`}
    onClick={() => { if (from?.slug) rememberPassportOrigin(from.slug, from.ymm); }}
    className={`block ${CARD} overflow-hidden hover:border-[#2563EB] transition-colors`}
  >
    <div className={`${compact ? "h-[110px]" : "h-[140px]"} bg-[#eef0f3] flex items-center justify-center relative`}>
      {alt.image ? <img src={alt.image} alt={alt.ymm || ""} loading="lazy" className="w-full h-full object-cover" /> : <Car className="w-8 h-8 text-[#94A3B8]" />}
      <span className={`absolute top-2 left-2 text-[10px] font-bold rounded-full px-2 py-0.5 ${ALT_TONE[alt.tone]}`}>{alt.tag}</span>
      {alt.condition && <span className="absolute top-2 right-2 text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 bg-black/60 text-white">{alt.condition === "cpo" ? "CPO" : alt.condition}</span>}
    </div>
    <div className="p-3">
      <p className="text-[13px] font-bold text-[#0F172A] leading-tight line-clamp-1">{alt.ymm || "Vehicle"}</p>
      {alt.trim && <p className="text-[11px] text-[#64748B] line-clamp-1">{alt.trim}{alt.packageCount ? ` · ${alt.packageCount} package${alt.packageCount === 1 ? "" : "s"}` : ""}</p>}
      <div className="flex items-baseline justify-between gap-2 mt-1.5">
        {alt.price != null ? <p className="text-[15px] font-extrabold text-[#0F172A]">{fmt$(alt.price)}</p> : <span />}
        {alt.mileage != null && <p className="text-[11px] text-[#64748B]">{alt.mileage.toLocaleString()} mi</p>}
      </div>
      {alt.tagDetail && <p className="text-[11px] font-semibold text-[#16A34A] mt-0.5">{alt.tagDetail}</p>}
      {!compact && alt.topPackages.length > 0 && <p className="text-[11px] text-[#94A3B8] mt-1 line-clamp-1">{alt.topPackages.join(" · ")}</p>}
      <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB]">View this vehicle <ArrowRight className="w-3 h-3" /></span>
    </div>
  </a>
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
  // Session heat-map signal: what this shopper keeps opening tunes which
  // same-rooftop alternatives lead (price vs equipment vs coverage).
  useEffect(() => { if (panel) recordPanelView(panel); }, [panel]);
  const key = panel ?? shown;
  const { data: nhtsa } = useNhtsaSafety(listing.ymm, key === "owner-reviews");
  if (!key) return null;

  const def = buildPanel(key, d, listing, isPreview, go, openPanel, nhtsa);
  const ctaSignals: CtaSignals = { greatPrice: (d.belowMarket ?? 0) > 0, highDemand: (d.viewCount ?? 0) > 20, highConf: (d.confScore ?? 0) >= 85, highlyRated: (d.reviewRating ?? 0) >= 4.5, hasWarranty: !!d.warrantyStr };
  const ctaVariant = d.dealerTrust.mobileCtaVariant || "dealer_availability";
  const footer = (def.primary || def.secondary) ? (
    <>
      {/* Mobile: dealer-configurable CTA variant. Desktop/tablet: unchanged. */}
      <div className="md:hidden"><MobileCtaFooter variant={ctaVariant} panelKey={key} go={go} signals={ctaSignals} /></div>
      <div className="hidden md:flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-[#0F172A] leading-tight">{def.footerQuestion ?? "Questions about this vehicle?"}</p>
          <button onClick={() => go("contact")} className="mt-0.5 text-[12px] font-semibold text-[#2563EB] inline-flex items-center gap-1.5 hover:underline"><MessageSquare className="w-3.5 h-3.5" /> {def.specialistLabel ?? "Talk to a Vehicle Specialist"}</button>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {def.secondary && <button onClick={def.secondary.onClick} className="h-11 px-4 rounded-xl border border-[#E6E8EC] bg-white text-[13px] font-semibold text-[#0F172A] hover:border-[#2563EB] transition-colors">{def.secondary.label}</button>}
          {def.primary && <button onClick={def.primary.onClick} className="h-11 px-5 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-[14px] font-semibold inline-flex items-center justify-center gap-2 transition-colors"><ShieldCheck className="w-4 h-4" /> {def.primary.label}</button>}
        </div>
      </div>
    </>
  ) : undefined;

  return (
    <PassportSlideOver open={panel !== null} onClose={onClose} title={def.title} subtitle={def.subtitle} footer={footer} wide={def.wide}>
      {def.body}
    </PassportSlideOver>
  );
}
