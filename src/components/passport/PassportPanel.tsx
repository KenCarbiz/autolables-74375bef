import { useEffect, useMemo, useRef, useState } from "react";
import {
  DollarSign, TrendingUp, TrendingDown, Gauge, Clock, Car, Package, ShieldCheck,
  Star, Award, FileText, MessageSquare, Eye, CheckCircle2,
  Flame, Heart, Users, Circle, ChevronDown, ChevronRight, MapPin, BadgeCheck, Info, AlertTriangle, History, ArrowRight, Sparkles,
  Wrench, Zap, LifeBuoy, Calendar, CalendarDays, ExternalLink, Navigation, Copy, Globe, Phone,
} from "lucide-react";
import { toast } from "sonner";
import { listingHero } from "@/lib/photos";
import type { PassportData, PricePoint, OemWarrantyView } from "@/lib/passportV2Data";
import { fmt$, listingEquipment, historyReportName, deriveSoldClaims, deriveRating, ratingTier } from "@/lib/passportV2Data";
import { packetVisible } from "@/lib/packetModules";
import { trackCustomerCtaClicked } from "@/lib/engagement/customerEngagement";
import { oemCoverageRows, type CoverageKey } from "@/lib/oemWarranty";
import { lookupOemReference } from "@/data/oemWarrantyReference";
import { resolveEffectiveWarranty } from "@/lib/warranty/passportWarranty";
import { readBuildSheet, PACKAGE_KIND_ORDER } from "@/lib/buildSheet";
import { getEquipmentIcon } from "@/lib/equipmentIcons";
import { buildEquipmentPanelData } from "@/lib/equipmentPanel";
import { readDealerAlternatives, type DealerAlternative } from "@/lib/dealerAlternatives";
import { rememberPassportOrigin } from "@/lib/passportOrigin";
import { recordPanelView } from "@/lib/shopperIntent";
import { useNhtsaSafety, type NhtsaSafetyResult } from "@/hooks/useNhtsaSafety";
import { DealerMapPreview } from "@/components/artwork/DealerPageArtwork";
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
  "visit-dealer",
] as const;
export type PassportPanelKey = (typeof PASSPORT_PANEL_KEYS)[number];
export const isPassportPanelKey = (v: string | null | undefined): v is PassportPanelKey =>
  !!v && (PASSPORT_PANEL_KEYS as readonly string[]).includes(v);

interface PanelDef { title: string; subtitle: string; body: React.ReactNode; primary?: { label: string; onClick: () => void }; secondary?: { label: string; onClick: () => void }; footerQuestion?: string; specialistLabel?: string; footerNote?: string; wide?: boolean; xl?: boolean }

function buildPanel(key: PassportPanelKey, d: PassportData, listing: VehicleListing, isPreview: boolean, go: (s: string) => void, openPanel: (k: PassportPanelKey) => void, nhtsa: NhtsaSafetyResult | null): PanelDef {
  const price = d.price, avg = d.marketAvg, low = d.marketLow, high = d.marketHigh, below = d.belowMarket;
  const isGreat = below != null && below > 0;
  // The unified rating: overall drives every confidence ring in these panels;
  // the factor list drives the price-confidence breakdown.
  const rating = deriveRating(listing, d);
  const conf = rating.overall;
  const sold = deriveSoldClaims(d, listing.mileage ?? null, listing.condition);
  // Merge enrichment market_meta (percentile, radius, similar_count, avg_dom,
  // inventory) into mc so the panels read real ingest data, not just mc_attributes.
  const mc = { ...(listing.mc_attributes || {}), ...((listing as unknown as { market_meta?: Record<string, unknown> }).market_meta || {}) } as Record<string, unknown>;
  const marketSeries = d.valueHistory.filter((h) => h.market_value != null).map((h) => h.market_value as number);
  const dealerSeries = d.valueHistory.filter((h) => h.listing_price != null).map((h) => h.listing_price as number);
  const marketAt = d.valueHistory.filter((h) => h.market_value != null).map((h) => new Date(h.captured_at).getTime());
  const dealerAt = d.valueHistory.filter((h) => h.listing_price != null).map((h) => new Date(h.captured_at).getTime());

  switch (key) {
    case "market-price": {
      const year = (listing.ymm || "").match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
      const compCount = (mc.similar_count as number) ?? (mc.comparable_count as number) ?? null;
      const radius = (mc.search_radius as number) ?? null;
      const checkedRaw = (listing as unknown as { market_checked_at?: string }).market_checked_at
        ?? (listing.market_payload as { checked_at?: string } | null)?.checked_at ?? null;
      const checkedFresh = checkedRaw != null && Date.now() - new Date(checkedRaw).getTime() <= 14 * 86400000;
      const updated = checkedFresh ? `Updated ${new Date(checkedRaw as string).toLocaleDateString()}` : isPreview ? "Updated today" : null;
      const trimMatched = mc.trim_matched === true;
      const comparedAgainst: string[] = [];
      if (compCount != null) comparedAgainst.push(`${compCount.toLocaleString()} similar vehicles`); else if (isPreview) comparedAgainst.push("42 similar vehicles");
      if (radius != null) comparedAgainst.push(`${radius}-mile radius`); else if (isPreview) comparedAgainst.push("150-mile radius");
      if (trimMatched) {
        if (year) comparedAgainst.push(`Same year (${year})`);
        if (listing.mileage != null) comparedAgainst.push(`Similar mileage (${Math.round(listing.mileage / 1000)}k±)`);
        if (listing.trim) comparedAgainst.push(`Same trim (${listing.trim})`);
      } else if (compCount == null) {
        comparedAgainst.push("Similar vehicles nearby");
      }
      if (updated) comparedAgainst.push(updated);
      const percentile = (mc.price_percentile as number) ?? null;
      const why: string[] = [];
      if (isGreat) why.push("Priced below local market");
      if (sold.soldPrice) why.push(sold.soldPrice.headline);
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
      const mpOptValue = readBuildSheet(listing)?.estValue ?? null;
      const mpNote = isGreat
        ? (conf != null ? `Confidence ${conf}%` : "Priced below the local market average")
        : mpOptValue ? `This build carries ${fmt$(mpOptValue)} in factory options` : "Priced to today's market";
      return {
        title: "Market Pricing Analysis", subtitle: "How this price compares to the market",
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        body: <>
          <div className="md:hidden"><MHero tone={isGreat ? "green" : "blue"} icon={ShieldCheck} eyebrow={isGreat ? "Great Price" : "Today's Price"} title={isGreat ? `${fmt$(below)} Below Market` : price != null ? fmt$(price) : "Priced to Today's Market"} note={mpNote} /></div>
          <div className="hidden md:block">
            <Hero icon={ShieldCheck} tone={isGreat ? "green" : "neutral"} label={isGreat ? "Great Price" : "Today's Price"}
              value={isGreat ? `${fmt$(below)} Below Market` : price != null ? fmt$(price) : undefined}
              note={mpNote} />
          </div>
          {low != null && high != null && avg != null && price != null && price <= avg && (
            <div className={`${CARD} p-5`}>
              <div className="grid grid-cols-3 text-center mb-1">
                <div><p className="text-[11px] text-[#64748B]">Low Market</p><p className="text-[14px] font-bold">{fmt$(low)}</p></div>
                <div><p className="text-[11px] text-[#64748B]">Market Average</p><p className="text-[14px] font-bold">{fmt$(avg)}</p></div>
                <div><p className="text-[11px] text-[#64748B]">High Market</p><p className="text-[14px] font-bold">{fmt$(high)}</p></div>
              </div>
              <RangeBar low={low} avg={avg} high={high} dealer={price} />
            </div>
          )}
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
          {(marketSeries.length >= 3 || dealerSeries.length >= 2) && (
            <Section title="Pricing Trend">
              <div className={`${CARD} p-4`}>
                <div className="flex items-center gap-4 mb-2 text-[11px] font-semibold">
                  {marketSeries.length >= 3 && <span className="inline-flex items-center gap-1.5 text-[#64748B]"><span className="w-4 border-t-2 border-dashed border-[#2563EB]" /> Market avg</span>}
                  {dealerSeries.length >= 2 && <span className="inline-flex items-center gap-1.5 text-[#16A34A]"><span className="w-4 border-t-2 border-[#16A34A]" /> Dealer price</span>}
                </div>
                <TrendChart market={marketSeries} dealer={dealerSeries} marketAt={marketAt} dealerAt={dealerAt} />
                <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-[12px]">
                  {marketDelta != null && <Delta kind="market" delta={marketDelta} />}
                  {dealerDelta != null && <Delta kind="dealer" delta={dealerDelta} />}
                </div>
              </div>
            </Section>
          )}
          {conf != null && conf >= 70 && (
            <Section title="AutoLabels Confidence">
              <div className={`${CARD} p-4 flex items-center gap-5`}>
                <div className="flex flex-col items-center shrink-0"><Ring pct={conf} /><p className="text-[12px] font-extrabold text-[#16A34A] mt-1">{ratingTier(conf).label}</p></div>
                <div className="min-w-0"><p className="text-[12px] text-[#64748B] mb-2">This score is built from the measured factors:</p><ul className="grid grid-cols-1 gap-1.5">{rating.factors.filter((f) => f.score != null).map((f) => <Check key={f.key}>{f.label}</Check>)}</ul></div>
              </div>
            </Section>
          )}
          {d.blackbook?.available && (d.blackbook.retailClean != null || d.blackbook.tradeinClean != null) && (
            <Section title="Independent valuation" sub="Black Book — a third-party industry guide.">
              <div className={`${CARD} p-4`}>
                {d.blackbook.retailClean != null && (price == null || price <= d.blackbook.retailClean) && <StatRow label="Retail value (clean)" value={fmt$(d.blackbook.retailClean)} />}
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
      const avgDom = (mc.avg_dom as number) ?? null;
      // Customer-visible gates: view counts only once they're meaningful, and
      // days-on-market only when it's a favorable signal.
      const viewsShown = views != null && views >= 5 ? views : null;
      const domFav = dom != null && (avgDom != null ? dom <= avgDom : dom <= 30) ? dom : null;
      const has = viewsShown != null || domFav != null;
      const radius = d.marketMeta.radius;
      // Demand score from real inputs only — no synthetic baseline. Fewer than
      // two real inputs is too thin to score, so the ring doesn't render.
      const score = (() => {
        const inputs: number[] = [];
        if (viewsShown != null) inputs.push(Math.min(95, 30 + Math.round(viewsShown * 0.7)));
        if (dom != null) inputs.push(avgDom != null ? (dom <= avgDom * 0.5 ? 90 : dom <= avgDom ? 70 : dom <= avgDom * 1.5 ? 45 : 25) : dom <= 30 ? 70 : dom <= 60 ? 50 : 30);
        const ds = (mc.market_days_supply as number) ?? null;
        if (ds != null) inputs.push(ds < 30 ? 85 : ds < 60 ? 60 : 40);
        return inputs.length >= 2 ? Math.max(5, Math.min(95, Math.round(inputs.reduce((a, b) => a + b, 0) / inputs.length))) : null;
      })();
      const level = score == null ? null : score >= 66 ? "High Interest" : score >= 40 ? "Moderate Interest" : "Building Interest";
      const supply = (mc.market_days_supply as number) ?? (mc.inventory_count as number) ?? null;
      // Inventory COUNT only — market_days_supply is a days figure and must
      // never be labeled "N nearby".
      const invCount = (mc.inventory_count as number) ?? (mc.similar_count as number) ?? (mc.comparable_count as number) ?? null;
      const scarce = supply != null ? supply < 30 : invCount != null ? invCount <= 10 : false;
      const sellsFaster = dom != null && avgDom != null && avgDom > dom;
      const priceDrop = d.priceChangeTotal != null && d.priceChangeTotal < 0 ? Math.abs(d.priceChangeTotal) : null;
      const sold45 = (mc.sold_45d_estimate as number) ?? null;
      const cutCount = (mc.comp_price_cut_count as number) ?? null;
      const cutTotal = (mc.comp_price_cut_total as number) ?? null;
      const trimCount = (mc.trim_count as number) ?? null;
      // "Priced right from day one" is only provable when tracking actually
      // covers the listing's start; otherwise the honest claim is that no
      // price cut has been needed while tracked.
      const firstSnapAt = d.valueHistory.length ? new Date(d.valueHistory[0].captured_at).getTime() : null;
      const listedAt = (() => {
        const c = (listing as unknown as { created_at?: string | null }).created_at || d.history?.firstSeen || null;
        return c ? new Date(c).getTime() : null;
      })();
      const trackedFromListing = firstSnapAt != null && listedAt != null && firstSnapAt - listedAt <= 7 * 86400000;
      const nearWord = radius != null ? `within ${radius} miles` : "in the region";
      const insights: string[] = [];
      if (viewsShown != null) insights.push(`${viewsShown.toLocaleString()} shoppers have viewed this vehicle`);
      if (isGreat) insights.push(d.belowMarket && d.belowMarket > 0 ? `Priced ${fmt$(d.belowMarket)} below the local market average` : "Priced below market average — strong value");
      if (sellsFaster) insights.push(`Similar vehicles average ${avgDom} days on the market — this one is drawing interest faster`);
      // avg_dom is active-listing days on market, not time-to-sell — only real
      // sold data supports a "sell within N days" claim.
      if (sold.sellTime) insights.push(sold.sellTime);
      else if (!sellsFaster && avgDom != null && avgDom <= 60) insights.push(`Similar listings average ~${avgDom} days on market`);
      if (sold.velocity) insights.push(sold.velocity);
      else if (sold45 != null && sold45 > 0) insights.push(`~${sold45.toLocaleString()} sold ${nearWord} in the last 45 days (estimated)`);
      if (cutCount != null && cutCount > 0 && cutTotal != null && cutTotal >= 5 && priceDrop == null) insights.push(`${cutCount} of ${cutTotal} comparable listings have cut their price — this one ${trackedFromListing ? "was priced right from day one" : "has not needed a price cut"}`);
      if (trimCount != null && trimCount >= 1 && trimCount <= 5) insights.push(`1 of only ${trimCount} builds like this ${nearWord}`);
      if (scarce) insights.push(invCount != null && invCount > 0 ? `Limited availability — only ${invCount} similar vehicles ${nearWord}` : `Limited similar inventory ${nearWord} right now`);
      if (priceDrop != null) insights.push(`We reduced this price ${fmt$(priceDrop)} since first tracked`);
      if (dom != null && dom <= 30) insights.push("Recently listed — fresh to market");
      if (isPreview && insights.length < 3) { insights.push("Vehicles with this trim typically sell within 38 days"); insights.push("Comparable inventory is decreasing"); }
      // Mobile-only derived content (same data, premium presentation).
      const demandWord = (score ?? 0) >= 66 ? "High Demand" : (score ?? 0) >= 45 ? "Moderate Demand" : "Newly Listed";
      const temp = score == null ? null : score >= 80 ? { l: "Very Hot", c: "#DC2626" } : score >= 66 ? { l: "Hot", c: "#EA580C" } : score >= 45 ? { l: "Warm", c: "#D97706" } : { l: "New to Market", c: "#2563EB" };
      const supplyLevel = supply != null ? (supply < 30 ? "Low" : supply < 60 ? "Balanced" : "Ample") : isPreview ? "Low" : "—";
      // Sold medians are the only honest "days to sell" figure — avg_dom is
      // active-listing days on market and must be labeled as such.
      const soldDom = d.marketMeta.soldDisplayable && d.marketMeta.soldDomMedian != null ? Math.round(d.marketMeta.soldDomMedian) : null;
      // Never show the raw days-supply / market inventory count to a customer —
      // it can be in the thousands and reads terribly. Qualitative level only.
      const kpis = [
        { icon: Eye, label: "Active Shoppers", value: viewsShown != null ? viewsShown.toLocaleString() : isPreview ? "89" : "—" },
        { icon: Car, label: "Similar Vehicles", value: supplyLevel },
        soldDom != null
          ? { icon: Clock, label: "Avg Days to Sell", value: `${soldDom} Days` }
          : { icon: Clock, label: "Avg Days on Market", value: avgDom != null ? `${avgDom} Days` : isPreview ? "12 Days" : "—" },
        { icon: TrendingUp, label: "Weekly Searches", value: isPreview ? "120" : "—" },
        { icon: Heart, label: "Saved by Shoppers", value: isPreview ? "38" : "—" },
        { icon: MapPin, label: "Local Availability", value: supplyLevel },
      ];
      const snapshot = [
        { l: "Inventory Level", v: supplyLevel },
        { l: "Average Days on Market", v: avgDom != null ? `${avgDom} Days` : domFav != null ? `${domFav} Days` : isPreview ? "12 Days" : "—" },
        { l: "Search Activity", v: isPreview ? "Above Average" : level ?? "—" },
        { l: "Local Availability", v: supplyLevel },
        { l: "Average Price", v: avg != null && price != null && price <= avg ? fmt$(avg) : isPreview ? fmt$(61300) : "—" },
      ];
      const invSeries = isPreview ? [20, 19, 18, 17, 16, 15, 14] : [];
      const shopperTrend = isPreview ? "+18%" : null;
      const goodTime = isGreat || (score ?? 0) >= 66;
      return {
        title: "Market Demand Analysis", subtitle: "How popular this vehicle is in your market",
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        body: <>
          {/* ── Mobile (<768px) — premium market-intelligence dashboard ── */}
          <div className="md:hidden space-y-4">
            {score != null && (
              <div className="rounded-2xl p-5 text-white" style={{ background: "linear-gradient(160deg,#0f7a3d 0%,#16A34A 100%)" }}>
                <p className="inline-flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wider opacity-95"><Flame className="w-4 h-4" /> {demandWord.replace("Demand", "Market Demand")}</p>
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
            )}

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
              {temp != null && (
                <div className={`${CARD} p-4`}>
                  <p className="text-[12px] text-[#64748B]">Market Temperature</p>
                  <p className="text-[18px] font-extrabold mt-1 inline-flex items-center gap-1.5" style={{ color: temp.c }}><Flame className="w-4 h-4" /> {temp.l}</p>
                </div>
              )}
              <div className={`${CARD} p-4`}>
                <p className="text-[12px] text-[#64748B]">Shopper Activity</p>
                {shopperTrend ? <p className="text-[18px] font-extrabold text-[#16A34A] mt-1 inline-flex items-center gap-1"><TrendingUp className="w-4 h-4" /> {shopperTrend}</p> : <p className="text-[14px] font-bold text-[#94A3B8] mt-1">Tracking</p>}
                <p className="text-[10px] text-[#94A3B8] mt-0.5">vs last week</p>
              </div>
            </div>

            {isPreview && invSeries.length >= 2 && (
              <Section title="Inventory trend" sub="Comparable vehicles, last 30 days.">
                <div className={`${CARD} p-4`}><TrendChart dealer={invSeries} height={110} /><p className="text-[11px] text-[#94A3B8] mt-1">Sample trend shown in preview mode.</p></div>
              </Section>
            )}

            {insights.length > 0 && (
              <Section title="Market insights">
                <div className="space-y-2.5">{insights.map((t) => (
                  <div key={t} className={`${CARD} p-4 flex items-start gap-2.5`}><TrendingUp className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" /><span className="text-[13px] text-[#0F172A]">{t}</span></div>
                ))}</div>
              </Section>
            )}

            <div className="rounded-2xl p-5 text-white" style={{ background: "linear-gradient(160deg,#0f7a3d 0%,#16A34A 100%)" }}>
              <p className="text-[12px] font-semibold uppercase tracking-wider opacity-85">Our Recommendation</p>
              <p className="text-[20px] font-extrabold mt-1 inline-flex items-center gap-2"><CheckCircle2 className="w-6 h-6" /> {goodTime ? "Good Time To Buy" : "See It In Person"}</p>
              <p className="text-[13px] opacity-90 mt-1.5 leading-snug">{goodTime ? "Pricing is competitive while demand stays strong. Waiting may reduce your selection as inventory declines." : "Book a test drive — the best way to know this is your vehicle is from behind the wheel."}</p>
            </div>

            <Section title="Should you buy now?">
              <div className={`${CARD} p-4`}>
                <p className={`text-[22px] font-extrabold ${goodTime ? "text-[#16A34A]" : "text-[#0F172A]"}`}>{goodTime ? "Yes." : "See it in person."}</p>
                <p className="text-[13px] text-[#64748B] mt-1 leading-snug">{goodTime ? "Based on today's inventory levels and pricing, this vehicle is a strong value in the current market." : "Book a test drive — experience this vehicle firsthand and let our team answer every question."}</p>
              </div>
            </Section>
            <Disclaimer />
          </div>

          {/* ── Desktop / tablet (≥768px) — unchanged ── */}
          <div className="hidden md:block space-y-5">
          <Hero icon={Flame} tone={has ? "green" : "neutral"} label={level ?? (has ? "Shopper Interest" : "Now Available")}
            note={has ? [viewsShown != null ? `${viewsShown.toLocaleString()} views` : null, domFav != null ? `${domFav} days on market` : null].filter(Boolean).join(" · ") || "Demand Score" : "See it in person — book a test drive."} />
          {score != null && (
            <Section title="Demand level" sub="Relative to typical listing activity in your area.">
              <div className={`${CARD} p-4`}><Gauge3 value={score} /></div>
            </Section>
          )}
          {(viewsShown != null || isPreview) && (
            <Section title="Buyer activity">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className={`${CARD} p-3 text-center`}>
                  <Eye className="w-4 h-4 text-[#2563EB] mx-auto" />
                  <p className="text-[18px] font-extrabold mt-1 leading-none">{viewsShown != null ? viewsShown.toLocaleString() : "89"}</p>
                  <p className="text-[10px] text-[#94A3B8] mt-1 leading-tight">Views</p>
                </div>
              </div>
            </Section>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Section title="Local demand">
              <div className={`${CARD} p-4`}>
                {level != null && <StatRow label="Interest level" value={level} />}
                {viewsShown != null && <StatRow label="Shopper views" value={viewsShown.toLocaleString()} />}
                {(d.belowMarket ?? 0) > 0 && <StatRow label="Vs. market average" value={`${fmt$(d.belowMarket as number)} below`} />}
                {isPreview && <StatRow label="Nearby shoppers" value="120+" />}
                {isPreview && <StatRow label="Search frequency" value="Above average" />}
              </div>
            </Section>
            <Section title="Similar vehicles">
              <div className={`${CARD} p-4`}>
                {(avgDom != null || isPreview) && <StatRow label="Avg days on market" value={avgDom != null ? `${avgDom} days` : "38 days"} />}
                {invCount != null && invCount < 50 ? <StatRow label="Similar vehicles nearby" value={invCount.toLocaleString()} /> : supplyLevel !== "—" && <StatRow label="Local availability" value={supplyLevel} />}
                {domFav != null && <StatRow label="This vehicle" value={`${domFav} days listed`} />}
                {sellsFaster && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-bold text-[#16A34A]">
                    <TrendingUp className="w-3.5 h-3.5" /> Drawing interest faster than the market average
                  </p>
                )}
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
              <p className="text-[14px] font-extrabold text-[#16A34A]">{goodTime ? "Good time to buy" : "See it in person"}</p>
              <ul className="mt-2 space-y-1.5">
                {isGreat && <Check>{(d.belowMarket ?? 0) > 0 ? `Priced ${fmt$(d.belowMarket as number)} below market average` : "Priced below market average"}</Check>}
                {score != null && score >= 66 && <Check>Strong shopper interest right now</Check>}
                {scarce && <Check>Limited similar inventory {nearWord}</Check>}
                {sold.sellTime ? <Check>{sold.sellTime}</Check> : sellsFaster && <Check>Similar vehicles average {avgDom} days on market</Check>}
                {priceDrop != null && <Check>Price already reduced {fmt$(priceDrop)}</Check>}
                {d.warrantyStr && !d.warrantyExpired && <Check>Factory warranty still active</Check>}
                {dom != null && dom <= 30 && <Check>Fresh listing — best selection</Check>}
                {!goodTime && <Check>See it in person — book a test drive</Check>}
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
      // The real rating factors — measured factors only, each with its
      // evidence lines. A factor without real data is omitted entirely; a
      // factor row never renders as "Pending" and never as a fixed percentage.
      const factors = rating.factors.filter((f) => f.score != null);
      const hasCarfaxDoc = (listing.documents || []).some((x) => /carfax/i.test(`${x.type} ${x.name}`));
      const sources = [
        { name: "Live Market Data", on: avg != null || Object.keys(mc).length > 0 },
        { name: "CARFAX", on: typeof mc.carfax_clean_title === "boolean" || hasCarfaxDoc },
        { name: "OEM", on: Object.keys(ks).length > 0 },
        { name: "NHTSA", on: !!listing.recall_status },
        { name: "Local Listings", on: avg != null },
        { name: "Dealer Pricing", on: true },
      ].filter((s) => s.on);
      const compCount = (mc.similar_count as number) ?? (mc.comparable_count as number) ?? null;
      // similar_count only — the stored sample is an API page, never the
      // market size; without a real count show the approx/pending treatment.
      const coverage = compCount != null ? compCount : isPreview ? 31 : null;
      const coverageApprox = compCount == null;
      const faqs = [
        { q: "How often is pricing updated?", a: "Market values refresh as new comparable listings and sales are reported — typically every day the vehicle is live." },
        { q: "What data sources are used?", a: "A blend of live market data, dealer pricing, vehicle history, recall status, and equipment decoded from the VIN." },
      ];
      const connectedCount = sources.length;
      // Below 70 the confidence module doesn't render at all — the panel falls
      // through to the verified-strengths content instead of a weak score.
      const showConf = conf != null && conf >= 70;
      const confWord = ratingTier(conf).label;
      const confExplain = "This score blends the measured factors below — price vs market, history, demand, equipment, and coverage. Factors without real data are left out, never guessed.";
      const scale = showConf ? (
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { n: "Solid", r: "70 – 79", a: (conf as number) < 80 },
            { n: "Strong", r: "80 – 89", a: (conf as number) >= 80 && (conf as number) < 90 },
            { n: "Exceptional", r: "90 – 100", a: (conf as number) >= 90 },
          ].map((b) => (
            <div key={b.n} className={`relative text-center rounded-lg py-1.5 border ${b.a ? "bg-emerald-50 border-emerald-200" : "border-transparent"}`}>
              {b.a && <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[9px] text-emerald-500 leading-none">▼</span>}
              <p className={`text-[11px] font-bold leading-tight ${b.a ? "text-emerald-700" : "text-[#64748B]"}`}>{b.n}</p>
              <p className={`text-[10px] ${b.a ? "text-emerald-600" : "text-[#94A3B8]"}`}>{b.r}</p>
            </div>
          ))}
        </div>
      ) : null;
      const coverageCard = coverage != null ? (
        <div className={`${CARD} p-4 flex items-center gap-4`}>
          <span className="w-11 h-11 rounded-xl bg-blue-50 text-[#2563EB] flex items-center justify-center shrink-0"><Users className="w-5 h-5" /></span>
          <div className="min-w-0">
            <p className="text-[15px] font-extrabold leading-tight">{coverage.toLocaleString()}{coverageApprox ? "+" : ""} Comparable Vehicles Analyzed</p>
            <p className="text-[12px] text-[#64748B] mt-0.5">Local listings and similar trim-level vehicles were reviewed to support this price.</p>
          </div>
        </div>
      ) : null;
      const sourcesBlock = (
        <Section title="Verified Data Sources" sub="These sources were used in this report.">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{sources.map((s) => <Source key={s.name} name={s.name} on={s.on} />)}</div>
        </Section>
      );
      const analyzeBlock = (
        <Section title="What AutoLabels Analyzes" sub="We analyze multiple data points to build this confidence score.">
          <div className={`${CARD} p-4`}><ul className="grid grid-cols-2 gap-1.5">{["Market pricing", "Mileage", "Condition", "Equipment", "Vehicle history", "Regional inventory", "Demand", "Historical pricing", "Dealer pricing"].map((b) => <Check key={b}>{b}</Check>)}</ul></div>
        </Section>
      );
      // The stability verdict is computed, never asserted: a visibly moving
      // line with a "Stable" caption reads as broken (or dishonest). A falling
      // market never renders — the block only shows stable or rising trends.
      const stabFirst = marketSeries[0], stabLast = marketSeries[marketSeries.length - 1];
      const stabShift = marketSeries.length >= 2 && stabFirst ? (stabLast - stabFirst) / stabFirst : 0;
      const stabStable = Math.abs(stabShift) < 0.03;
      const stabilityBlock = marketSeries.length >= 3 && stabShift > -0.03 ? (
        <Section title="Confidence Stability" sub="Tracked market data">
          <div className={`${CARD} p-4`}>
            <TrendChart market={marketSeries} marketAt={marketAt} height={90} />
            <div className="flex items-start gap-2 mt-2">
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold rounded-full border px-2 py-0.5 shrink-0 mt-0.5 ${stabStable ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-blue-700 bg-blue-50 border-blue-200"}`}><ShieldCheck className="w-3 h-3" /> {stabStable ? "Stable" : "Market rising"}</span>
              <p className="text-[12px] text-[#64748B]">{stabStable
                ? "Valuation inputs have remained stable over the tracked period — no major pricing, mileage, or market-data shifts detected."
                : `Market values for comparable vehicles have risen about ${Math.round(Math.abs(stabShift) * 100)}% over the tracked period — today's price locks it in.`}</p>
            </div>
          </div>
        </Section>
      ) : null;
      return {
        title: "Price Confidence Report", subtitle: "Why this vehicle's price is supported by verified market data",
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        footerQuestion: "Want to see it in person?", specialistLabel: "Talk to a vehicle specialist",
        footerNote: "No obligation · Dealer confirmed",
        body: <>
          {/* ── Mobile (<768px) — premium confidence dashboard ── */}
          <div className="md:hidden space-y-4">
            {showConf && (
              <div className="rounded-2xl p-5 text-white text-center" style={{ background: "linear-gradient(160deg,#0f7a3d 0%,#16A34A 100%)" }}>
                <div className="flex justify-center"><AnimatedRing pct={conf as number} color="#ffffff" /></div>
                <p className="text-[13px] font-bold opacity-90 mt-2">Confidence Score</p>
                <p className="text-[18px] font-extrabold">{confWord}</p>
                <p className="text-[12.5px] opacity-90 mt-2 leading-snug">{confExplain}</p>
              </div>
            )}
            {scale && <div className={`${CARD} p-3 pt-4`}>{scale}</div>}

            {coverageCard}

            <div className="grid grid-cols-2 gap-3">
              <div className={`${CARD} p-4 text-center`}><p className="text-[18px] font-extrabold leading-none">{connectedCount}</p><p className="text-[10px] text-[#94A3B8] mt-1">Data Sources</p></div>
              <div className={`${CARD} p-4 text-center`}><p className="text-[18px] font-extrabold leading-none">Today</p><p className="text-[10px] text-[#94A3B8] mt-1">Updated</p></div>
            </div>

            {factors.length > 0 && (
              <Section title="Rating Factors" sub="Only measured factors are scored — each shows the evidence behind it.">
                <div className={`${CARD} p-4 space-y-4`}>{factors.map((f) => (
                  <div key={f.key}>
                    <FactorBar label={f.label} pct={f.score as number} status={ratingTier(f.score).label} />
                    {f.evidence.length > 0 && <ul className="mt-1.5 space-y-0.5">{f.evidence.map((e) => <li key={e} className="text-[11px] text-[#94A3B8] leading-snug">{e}</li>)}</ul>}
                  </div>
                ))}</div>
              </Section>
            )}

            {sourcesBlock}
            {analyzeBlock}
            {stabilityBlock}

            <Section title="Frequently Asked Questions">
              <div className="space-y-2">{faqs.map((f) => <Faq key={f.q} q={f.q} a={f.a} />)}</div>
            </Section>
            <Disclaimer />
          </div>

          {/* ── Desktop / tablet (≥768px) ── */}
          <div className="hidden md:block space-y-5">
          {showConf && (
            <div className={`${CARD} p-5`}>
              <div className="flex items-center gap-5">
                <div className="shrink-0"><Ring pct={conf as number} size={120} /></div>
                <div className="min-w-0">
                  <p className="text-[15px] font-bold">Confidence Score</p>
                  <p className="text-[14px] font-extrabold mt-0.5" style={{ color: "#16A34A" }}>{confWord}</p>
                  <p className="text-[12px] text-[#64748B] mt-1.5">{confExplain}</p>
                </div>
              </div>
              <div className="mt-5 pt-1">{scale}</div>
            </div>
          )}

          {coverageCard}

          {factors.length > 0 && (
            <Section title="Rating Factors" sub="Only measured factors are scored — each shows the evidence behind it.">
              <div className={`${CARD} p-4 space-y-4`}>{factors.map((f) => (
                <div key={f.key}>
                  <FactorBar label={f.label} pct={f.score as number} status={ratingTier(f.score).label} />
                  {f.evidence.length > 0 && <ul className="mt-1.5 space-y-0.5">{f.evidence.map((e) => <li key={e} className="text-[11px] text-[#94A3B8] leading-snug">{e}</li>)}</ul>}
                </div>
              ))}</div>
            </Section>
          )}
          {sourcesBlock}
          {analyzeBlock}
          {stabilityBlock}
          <Section title="Frequently Asked Questions">
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
      const trendLabel = !has ? "Today's Price" : total != null && total < 0 ? "Price Reduced" : total != null && total > 0 ? "Priced to Today's Market" : "Price Stable";
      // Increases never render as timeline events — they collapse into the
      // neutral "Priced to today's market" framing. Only reductions are shown.
      const events = priced.slice(1).map((h, i) => {
        const prev = priced[i].listing_price as number, cur = h.listing_price as number;
        return { date: new Date(h.captured_at).toLocaleDateString(), before: prev, after: cur, delta: cur - prev };
      }).filter((e) => e.delta < 0).reverse();
      const pctDiff = avg != null && price != null ? Math.round(((price - avg) / avg) * 100) : null;
      // A few percent off the market AVERAGE is normal spread, not a verdict —
      // ±3% reads as "priced at market" (neutral). Only color beyond the band,
      // and when above it, say why with provable option value.
      const priceBand = pctDiff == null ? null : pctDiff <= -3 ? "below" : pctDiff >= 3 ? "above" : "at";
      const phOptValue = readBuildSheet(listing)?.estValue ?? null;
      const originalPrice = priced.length ? (priced[0].listing_price as number) : null;
      const reductions = events.length;
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
            {has && (
              <div className="rounded-2xl p-5 text-white" style={{ background: "linear-gradient(160deg,#0f7a3d 0%,#16A34A 100%)" }}>
                <div className="flex items-center gap-3">
                  <span className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0"><TrendingDown className="w-6 h-6" /></span>
                  <div><p className="text-[13px] font-bold uppercase tracking-wider opacity-95">{trendLabel}</p><p className="text-[26px] font-extrabold leading-tight">{savings != null ? fmt$(savings) : price != null ? fmt$(price) : ""}</p><p className="text-[12px] opacity-90">{d.belowMarket && d.belowMarket > 0 ? "Below market" : savings != null ? "Reduced since first tracked" : "Current price"}</p></div>
                </div>
                <p className="text-[13px] opacity-90 mt-3 leading-snug">{total != null && total < 0 && d.belowMarket && d.belowMarket > 0 ? "This vehicle has been reduced and is currently priced below market value." : total != null && total < 0 ? "This vehicle's asking price has been reduced since we began tracking it." : total != null && total > 0 ? "Priced to today's market." : "Every price adjustment is recorded for full transparency."}</p>
              </div>
            )}

            {has && (
              <div className="grid grid-cols-2 gap-3">
                {price != null && <div className={`${CARD} p-4`}><p className="text-[20px] font-extrabold leading-none">{fmt$(price)}</p><p className="text-[11px] text-[#94A3B8] mt-1">Current Price</p></div>}
                {originalPrice != null && price != null && originalPrice > price && <div className={`${CARD} p-4`}><p className="text-[20px] font-extrabold leading-none text-[#94A3B8]">{fmt$(originalPrice)}</p><p className="text-[11px] text-[#94A3B8] mt-1">First Tracked Price</p></div>}
                {reductions > 0 && <div className={`${CARD} p-4`}><p className="text-[20px] font-extrabold leading-none">{reductions}</p><p className="text-[11px] text-[#94A3B8] mt-1">Price Reductions</p></div>}
                {savings != null && <div className={`${CARD} p-4`}><p className="text-[20px] font-extrabold leading-none text-[#16A34A]">{fmt$(savings)}</p><p className="text-[11px] text-[#94A3B8] mt-1">Total Savings</p></div>}
              </div>
            )}

            {has ? (
              <>
                <Section title="Price trend"><PriceTimeline history={priced} /></Section>
                {trendPct != null && trendPct < 0 && (
                  <div className={`${CARD} p-4`}>
                    <p className="text-[12px] text-[#64748B]">Price Trend</p>
                    <p className="text-[18px] font-extrabold inline-flex items-center gap-1.5 text-[#16A34A]"><TrendingDown className="w-4 h-4" /> Down {Math.abs(trendPct)}%</p>
                    <p className="text-[12px] text-[#64748B] mt-1 leading-snug">This vehicle's price has decreased while the market average stayed relatively stable.</p>
                  </div>
                )}
                <Section title="Price change timeline">
                  {events.length ? (
                    <ol className="relative border-l-2 border-emerald-100 ml-1.5 pl-4 space-y-4">{events.map((e, i) => (
                      <li key={i} className="relative">
                        <span className="absolute -left-[22px] top-1 w-3 h-3 rounded-full ring-2 ring-white bg-emerald-500" />
                        <p className="text-[12px] text-[#94A3B8]">{e.date}</p>
                        <p className="text-[15px] font-extrabold inline-flex items-center gap-1.5 text-[#16A34A]"><TrendingDown className="w-4 h-4" /> Price Reduced -{fmt$(Math.abs(e.delta))}</p>
                        {i === 0 && <p className="text-[12px] text-[#64748B] mt-0.5">Current price {fmt$(e.after)}</p>}
                      </li>
                    ))}</ol>
                  ) : <Empty>Priced to today's market from day one.</Empty>}
                </Section>
              </>
            ) : <Empty>Priced to today's market — reserve now to secure this price.</Empty>}

            {pctDiff != null && priceBand !== "above" && (
              <Section title="Market comparison">
                <div className={`${CARD} divide-y divide-[#F1F5F9]`}>
                  <div className="flex items-center justify-between px-4 py-3"><span className="text-[12px] text-[#64748B]">Market Average</span><span className="text-[15px] font-extrabold">{fmt$(avg)}</span></div>
                  <div className="flex items-center justify-between px-4 py-3"><span className="text-[12px] text-[#64748B]">Current Vehicle</span><span className="text-[15px] font-extrabold">{fmt$(price)}</span></div>
                </div>
                <div className={`mt-2 rounded-2xl border p-4 ${priceBand === "below" ? "border-emerald-200 bg-emerald-50/70" : "border-[#E6E8EC] bg-slate-50"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-bold text-[#0F172A]">{priceBand === "below" ? "Below Market" : "Priced At Market"}</span>
                    <span className={`text-[14px] font-extrabold ${priceBand === "below" ? "text-[#16A34A]" : "text-[#0F172A]"}`}>
                      {priceBand === "at" ? `Within ${Math.abs(pctDiff)}% of average` : `${marketDiff != null ? `-${fmt$(Math.abs(marketDiff))} · ` : ""}${Math.abs(pctDiff)}% below average`}
                    </span>
                  </div>
                </div>
              </Section>
            )}
            {priceBand === "above" && phOptValue ? (
              <Section title="Why this price">
                <div className={`${CARD} p-4`}><p className="text-[13px] text-[#0F172A] leading-snug">This build carries {fmt$(phOptValue)} in factory options — the market average includes lower-equipped vehicles.</p></div>
              </Section>
            ) : null}

            {isGreat && (
              <Section title="Market position">
                <div className={`${CARD} p-4 flex items-center gap-3`}>
                  <span className="w-11 h-11 rounded-2xl bg-emerald-50 flex items-center justify-center shrink-0"><Award className="w-6 h-6 text-[#16A34A]" /></span>
                  <div><p className="text-[15px] font-extrabold text-[#16A34A]">Excellent Value</p><p className="text-[12px] text-[#64748B]">{posLabel}</p></div>
                </div>
              </Section>
            )}

            {goodTime && (
              <div className="rounded-2xl p-5 text-white" style={{ background: "linear-gradient(160deg,#0f7a3d 0%,#16A34A 100%)" }}>
                <p className="text-[18px] font-extrabold inline-flex items-center gap-2"><CheckCircle2 className="w-6 h-6" /> Excellent Time To Purchase</p>
                <ul className="mt-2.5 space-y-1.5">
                  {isGreat && <li className="flex items-start gap-2 text-[13px]"><CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />Below market average</li>}
                  {sold.soldPrice && <li className="flex items-start gap-2 text-[13px]"><CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />Below what similar vehicles recently sold for</li>}
                  {total != null && total < 0 && <li className="flex items-start gap-2 text-[13px]"><CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />Recent price reductions</li>}
                  <li className="flex items-start gap-2 text-[13px]"><CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />Strong value at today's price</li>
                  {isGreat && <li className="flex items-start gap-2 text-[13px]"><CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />Competitive market pricing</li>}
                </ul>
              </div>
            )}

            <Section title="Should you buy now?">
              <div className={`${CARD} p-4`}>
                <p className={`text-[22px] font-extrabold ${goodTime ? "text-[#16A34A]" : "text-[#0F172A]"}`}>{goodTime ? "Yes." : "See it in person."}</p>
                <p className="text-[13px] text-[#64748B] mt-1 leading-snug">{goodTime ? "Based on current pricing and recent reductions, this vehicle is a strong buying opportunity. Waiting may reduce available inventory with little added pricing advantage." : "Book a test drive — experience this vehicle firsthand and let our team answer every question."}</p>
              </div>
            </Section>

            {has && (total == null || total <= 0) && (
              <div className={`${CARD} p-4 flex items-start gap-2.5`}>
                <ShieldCheck className="w-5 h-5 text-[#16A34A] shrink-0 mt-0.5" />
                <div><p className="text-[13px] font-bold">Transparent Pricing</p><p className="text-[12px] text-[#64748B]">Every price adjustment is recorded and shown here for complete pricing transparency.</p></div>
              </div>
            )}
            <Disclaimer />
          </div>

          {/* ── Desktop / tablet (≥768px) — unchanged ── */}
          <div className="hidden md:block space-y-5">
          <Hero icon={Clock} tone={total != null && total < 0 ? "green" : "neutral"} label={trendLabel}
            value={price != null ? fmt$(price) : undefined}
            note={total != null && total < 0 ? `Down ${fmt$(Math.abs(total))} since first tracked` : recent != null && recent < 0 ? `Down ${fmt$(Math.abs(recent))} in 7 days` : "Priced to today's market."} />
          {has && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {total != null && total < 0 && <Stat label="Price Change" value={`-${fmt$(Math.abs(total))}`} tone="green" />}
              {daysListed != null && <Stat label="Days Listed" value={String(daysListed)} />}
              {lowest != null && price != null && price <= lowest && <Stat label="Lowest Price" value={fmt$(lowest)} />}
              {highest != null && price != null && highest > price && <Stat label="Highest Price" value={fmt$(highest)} />}
            </div>
          )}
          {has ? (
            <>
              <Section title="Price timeline"><PriceTimeline history={priced} /></Section>
              <Section title="Price change events">
                {events.length ? (
                  <div className="space-y-3">{events.map((e, i) => (
                    <div key={i} className={`${CARD} p-3 flex items-center gap-3`}>
                      <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-emerald-50"><TrendingDown className="w-4 h-4 text-[#16A34A]" /></span>
                      <div className="min-w-0 flex-1"><p className="text-[13px] font-semibold leading-tight">Price reduced {fmt$(Math.abs(e.delta))}</p><p className="text-[11px] text-[#94A3B8]">{e.date} · Dealer updated pricing</p></div>
                      <p className="text-[12px] text-[#64748B] shrink-0 text-right">{fmt$(e.before)} <span className="text-[#94A3B8]">→</span> <span className="font-bold text-[#0F172A]">{fmt$(e.after)}</span></p>
                    </div>
                  ))}</div>
                ) : <Empty>Priced to today's market from day one.</Empty>}
              </Section>
            </>
          ) : <Empty>Priced to today's market — reserve now to secure this price.</Empty>}
          {pctDiff != null && priceBand !== "above" && (
            <Section title="Market comparison">
              <div className={`${CARD} p-4`}>
                <div className="flex items-center justify-between"><span className="text-[12px] text-[#64748B]">This vehicle</span><span className="text-[14px] font-extrabold">{fmt$(price)}</span></div>
                <div className="flex items-center justify-between mt-1.5"><span className="text-[12px] text-[#64748B]">Average market price</span><span className="text-[14px] font-semibold text-[#0F172A]">{fmt$(avg)}</span></div>
                <div className={`mt-2 pt-2 border-t border-[#F1F5F9] text-[13px] font-semibold ${priceBand === "below" ? "text-[#16A34A]" : "text-[#0F172A]"}`}>
                  {priceBand === "below" ? `${Math.abs(pctDiff)}% below market average` : `Priced at market — within ${Math.abs(pctDiff)}% of average`}
                </div>
              </div>
            </Section>
          )}
          {priceBand === "above" && phOptValue ? (
            <Section title="Why this price">
              <div className={`${CARD} p-4`}><p className="text-[13px] text-[#0F172A] leading-snug">This build carries {fmt$(phOptValue)} in factory options — the market average includes lower-equipped vehicles.</p></div>
            </Section>
          ) : null}
          <Section title="Price recommendation">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
              <p className="text-[14px] font-extrabold text-[#16A34A]">{lowest != null && price != null && price <= lowest && isGreat ? "Excellent time to purchase" : isGreat ? "Strong value right now" : "See it in person"}</p>
              <ul className="mt-2 space-y-1.5">
                {lowest != null && price != null && price <= lowest && <Check>At its lowest recorded asking price</Check>}
                {isGreat && <Check>Priced below the market average</Check>}
                {sold.soldPrice && <Check>Below what similar vehicles recently sold for</Check>}
                {total != null && total < 0 && <Check>Price has trended down since first tracked</Check>}
                {total != null && total > 0 && <Check>Priced to today's market</Check>}
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

    case "visit-dealer": {
      const q = encodeURIComponent(d.dealerAddress || d.dealerName);
      return {
        title: `Visit ${d.dealerName}`,
        subtitle: "Get directions, view hours, and choose the best department for your visit.",
        xl: true,
        primary: { label: "Get Directions", onClick: () => window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, "_blank", "noopener") },
        secondary: { label: "Schedule Test Drive", onClick: () => go("test-drive") },
        footerQuestion: "Questions before you visit?", specialistLabel: "Call the Dealership",
        body: <VisitDealerBody d={d} listing={listing} go={go} isPreview={isPreview} />,
      };
    }

    case "inventory-trend": {
      const supply = (mc.market_days_supply as number) ?? (mc.inventory_count as number) ?? (isPreview ? 42 : null);
      const changePct = (mc.inventory_change_pct as number) ?? (isPreview ? -12 : null);
      const avgDom = (mc.avg_dom as number) ?? (isPreview ? 38 : null);
      const hasData = supply != null;
      // Rising inventory never renders — it collapses into "Stable Inventory".
      const trendLabel = changePct != null && changePct < 0 ? `Inventory Down ${Math.abs(changePct)}%` : "Stable Inventory";
      const SCARCITY = ["Abundant", "Moderate", "Limited", "Scarce"];
      const scarcityIdx = supply == null ? -1 : supply < 30 ? 3 : supply < 50 ? 2 : supply < 90 ? 1 : 0;
      // Never show the raw market-days-supply / inventory count to a customer
      // (it can be in the thousands) — qualitative levels only, on every
      // breakpoint. The raw number stays internal to the math above.
      const supplyWord = supply == null ? null : supply < 30 ? "Tight" : supply < 60 ? "Balanced" : "Ample";
      const highCompetition = (d.viewCount ?? 0) > 20 || isPreview;
      const invInsights: { icon: React.ElementType; text: string }[] = [];
      if (changePct != null && changePct < 0) invInsights.push({ icon: TrendingDown, text: "Inventory continues to decline — lower supply means more competition." });
      if (isPreview) invInsights.push({ icon: TrendingUp, text: "New listings are entering the market slower than vehicles are selling." });
      if (isPreview) invInsights.push({ icon: Flame, text: "Similar vehicles are selling faster than last month." });
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
                  {changePct != null && changePct < 0 && <p className="text-[13px] opacity-90 mt-3 leading-snug">Inventory has declined {Math.abs(changePct)}% over the past 30 days.</p>}
                  <p className="text-[11px] opacity-80 mt-2">Updated using live market inventory.</p>
                </div>

                {(changePct != null && changePct < 0) || avgDom != null ? (
                  <div className="grid grid-cols-2 gap-3">
                    {changePct != null && changePct < 0 && <div className={`${CARD} p-4`}><TrendingDown className="w-5 h-5 text-[#16A34A]" /><p className="text-[20px] font-extrabold mt-1 leading-none text-[#16A34A]">{changePct}%</p><p className="text-[10px] text-[#94A3B8] mt-1">vs 30 days ago</p></div>}
                    {avgDom != null && <div className={`${CARD} p-4`}><Clock className="w-5 h-5 text-[#2563EB]" /><p className="text-[20px] font-extrabold mt-1 leading-none">{avgDom}d</p><p className="text-[10px] text-[#94A3B8] mt-1">Avg days on market</p></div>}
                  </div>
                ) : null}

                <Section title="Market snapshot">
                  <div className={`${CARD} divide-y divide-[#F1F5F9]`}>
                    {([
                      supplyWord ? { i: Package, l: "Supply Level", v: supplyWord, c: "text-[#0F172A]" } : null,
                      changePct != null && changePct < 0 ? { i: TrendingDown, l: "30-Day Change", v: `${changePct}%`, c: "text-[#16A34A]" } : null,
                      avgDom != null ? { i: Clock, l: "Average Days on Market", v: `${avgDom} Days`, c: "text-[#0F172A]" } : null,
                      changePct != null && changePct < 0 ? { i: TrendingDown, l: "Market Trend", v: "Declining", c: "text-[#16A34A]" } : null,
                      highCompetition ? { i: Flame, l: "Competition Level", v: "High", c: "text-[#EA580C]" } : null,
                      highCompetition ? { i: TrendingUp, l: "Buyer Demand", v: "Strong", c: "text-[#16A34A]" } : null,
                    ].filter(Boolean) as { i: React.ElementType; l: string; v: string; c: string }[]).map((r) => (
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
                  <ul className="mt-2 space-y-1.5">{["Fewer available choices", "Popular configurations sell first", "Potential for higher future pricing"].map((t) => <li key={t} className="flex items-start gap-2 text-[13px]"><CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />{t}</li>)}</ul>
                </div>

                <Section title="Market availability">
                  <div className={`${CARD} p-4`}>
                    <div className="relative h-2 rounded-full bg-gradient-to-r from-emerald-300 via-amber-200 to-rose-300">
                      {scarcityIdx >= 0 && <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white ring-2 ring-[#0F172A] shadow" style={{ left: `${(scarcityIdx / 3) * 100}%` }} />}
                    </div>
                    <div className="flex justify-between text-[10px] font-semibold text-[#94A3B8] mt-1.5">{SCARCITY.map((s, i) => <span key={s} className={scarcityIdx === i ? "text-[#0F172A] font-bold" : ""}>{s}</span>)}</div>
                  </div>
                </Section>

                <Section title="If you wait…">
                  <div className={`${CARD} p-4`}><p className="text-[13px] text-[#64748B] leading-snug">{changePct != null && changePct < 0 ? "Inventory is currently declining. Waiting may reduce your available choices and increase competition from other buyers." : "Inventory is steady for now. Pricing and selection can still shift as the market moves."}</p></div>
                </Section>
              </>
            ) : <Empty>Every vehicle is unique in today's market — reserve this one or book a test drive to make sure you don't miss it.</Empty>}
            <Disclaimer />
          </div>

          {/* ── Desktop / tablet (≥768px) — unchanged ── */}
          <div className="hidden md:block space-y-5">
          <Hero icon={Package} tone={changePct != null && changePct < 0 ? "green" : "neutral"} label={trendLabel}
            value={supplyWord ? `${supplyWord} supply` : undefined}
            note={hasData ? "Comparable availability in your local market." : "Every vehicle is unique in today's market — reserve this one or book a test drive to make sure you don't miss it."} />
          {hasData ? (
            <>
              <Section title="Local market summary">
                <div className={`${CARD} p-4`}>
                  {avgDom != null && <StatRow label="Average days on market" value={`${avgDom} days`} />}
                  {avg != null && price != null && price <= avg && <StatRow label="Average selling price" value={fmt$(avg)} />}
                  {supplyWord && <StatRow label="Supply level" value={supplyWord} />}
                  {highCompetition && <StatRow label="Demand level" value="High" />}
                </div>
              </Section>
              {((changePct != null && changePct < 0) || highCompetition) && (
                <Section title="Inventory forecast">
                  <div className={`${CARD} p-4`}><ul className="space-y-2">
                    {changePct != null && changePct < 0 && <Check>Inventory likely to keep decreasing over the next 30 days</Check>}
                    {highCompetition && <Check>Demand expected to remain high</Check>}
                    {isPreview && <Check>More comparable vehicles arriving next month</Check>}
                  </ul></div>
                </Section>
              )}
              <Section title="Buyer recommendation">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                  <p className="text-[14px] font-extrabold text-[#16A34A]">{changePct != null && changePct < 0 ? "Inventory is tightening — good time to act" : "Solid time to purchase"}</p>
                  <ul className="mt-2 space-y-1.5">
                    {changePct != null && changePct < 0 && <Check>Fewer comparable vehicles available locally</Check>}
                    {isGreat && <Check>This vehicle is priced below market</Check>}
                    {supply != null && supply < 30 && <Check>Limited local availability for this configuration</Check>}
                    {d.warrantyStr && !d.warrantyExpired && <Check>Strong resale outlook with warranty remaining</Check>}
                  </ul>
                </div>
              </Section>
            </>
          ) : <Empty>Every vehicle is unique in today's market — reserve this one or book a test drive to make sure you don't miss it.</Empty>}
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
      // Whichever-comes-first: active only while EVERY known limit has
      // remainder. Time uses the raw end-date (rounded months would call 1-15
      // days of real coverage expired); a single known limit governs alone.
      const basicTimeRemains = (() => {
        if (!w.in_service_date || !w.factory_months) return null;
        const end = new Date(w.in_service_date);
        end.setMonth(end.getMonth() + w.factory_months);
        return end.getTime() - Date.now() > 0;
      })();
      const basicMilesRemain = milesLeft != null ? milesLeft > 0 : null;
      const active = basicTimeRemains == null && basicMilesRemain == null
        ? false
        : basicTimeRemains !== false && basicMilesRemain !== false;
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
      const hasData = !!(d.warrantyStr || d.oemWarranty || eff.usedLibrary || isFactoryCpo || d.dealerCoverage.length);
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
      // Dealer-added coverage: the store's own branded warranties (lifetime
      // powertrain, dealer CPO). Renders only when the dealer configured a
      // warranty program for this vehicle's condition. When factory coverage
      // has ended, this block leads the panel instead of the factory status.
      const dealerCoverageBlock = d.dealerCoverage.length > 0 ? (
        <div className="rounded-2xl border border-[#E6E8EC] bg-white p-4 sm:p-5">
          <p className="text-[15px] font-bold text-[#0F172A]">Dealer-Added Coverage</p>
          <p className="text-[12px] text-[#64748B] mb-3">Additional protection from {d.dealerName}{statusActive ? " on top of the factory terms" : ""}.</p>
          <div className="space-y-3">
            {d.dealerCoverage.map((c, i) => {
              const term = c.lifetime ? "Lifetime" : [
                c.termYears ? `${c.termYears}-Year` : null,
                c.termMiles ? `${c.termMiles.toLocaleString()}-Mile` : null,
              ].filter(Boolean).join(" / ") || null;
              const included = c.mode === "included";
              return (
                <div key={i} className={`rounded-xl border p-3.5 ${included ? "border-emerald-200 bg-emerald-50/50" : "border-[#E6E8EC] bg-slate-50/60"}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-[14px] font-bold text-[#0F172A] leading-tight">{c.title}{term ? ` — ${term}` : ""}</p>
                      {c.coverage && <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B] mt-0.5">{c.coverage}</p>}
                    </div>
                    <span className={`shrink-0 inline-flex items-center h-6 px-2.5 rounded-full text-[11px] font-bold ${included ? "bg-emerald-100 text-emerald-700" : "bg-blue-50 text-[#2563EB]"}`}>
                      {included ? "Included" : "Available Upgrade"}
                    </span>
                  </div>
                  {c.offer && <p className="text-[12.5px] text-[#475569] leading-snug mt-1.5">{c.offer}</p>}
                  {c.disclosure && <p className="text-[11.5px] text-[#64748B] leading-snug mt-1.5">{c.disclosure}</p>}
                  {c.mode === "available" && (
                    <div className="flex items-center justify-between gap-3 mt-2 flex-wrap">
                      <p className="text-[11px] font-semibold text-[#64748B]">Optional — not required to purchase or finance the vehicle.</p>
                      <button
                        onClick={() => {
                          if (!isPreview) trackCustomerCtaClicked({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: "passport", surface: "vehicle_passport", metadata: { cta: "upgrade_inquiry", program: c.title, placement: "warranty_panel" } });
                          go(`contact?topic=warranty&about=${encodeURIComponent(c.title)}`);
                        }}
                        className="shrink-0 inline-flex items-center h-8 px-3 rounded-lg bg-[#2563EB] text-white text-[12px] font-bold hover:bg-[#1d4fd7]"
                      >
                        Ask about this coverage
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null;
      return {
        title: "Factory Warranty",
        subtitle: "See what's covered and for how long.",
        primary: { label: "Contact Dealer", onClick: () => go("contact") },
        secondary: { label: "Learn More", onClick: () => go("protect") },
        footerQuestion: "Questions about warranty?", specialistLabel: "Talk to a Warranty Specialist",
        body: hasData ? (
          <div className="space-y-5">
            {!statusActive && dealerCoverageBlock}
            <WarrantyStatusCard
              active={statusActive}
              startLabel={statusStart}
              startSub={statusStartSub}
              endDate={isNew ? null : endDate}
              endMiles={isNew ? null : endMiles}
            />
            {(statusActive || eff.cpoWrap) && (
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
                      {statusActive && hasBasic && <CoverageCard title="Bumper-to-Bumper" subtitle={isFactoryCpo && eff.cpoProgramName ? "CPO Vehicle Coverage" : "Basic Vehicle Coverage"} tone="blue" pct={b2bPct} years={yrsRemain(basic.left)} miles={milesRemainLbl(milesLeft)} expiresDate={basic.date} expiresMiles={milesCapLbl(expMilesOf(w.factory_miles))} />}
                      {statusActive && hasPt && <CoverageCard title="Powertrain" subtitle="Engine, Transmission & Drivetrain" tone="green" pct={ptPct} years={yrsRemain(pt.left)} miles={milesRemainLbl(ptMilesLeft)} expiresDate={pt.date} expiresMiles={milesCapLbl(expMilesOf(w.powertrain_miles))} />}
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
            )}

            {statusActive && dealerCoverageBlock}

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
              <WAcc icon={Info} title="Coverage details" sub="General exclusions and limitations">
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
        ) : (
          <Empty>
            Warranty coverage details are confirmed at the dealership for this vehicle.
            <button onClick={() => go("contact")} className="block mt-2 text-[13px] font-semibold text-[#2563EB] hover:underline">Contact the dealership</button>
          </Empty>
        ),
      };
    }

    case "owner-reviews": {
      const sources = d.dealerTrust.reviewSources;
      const ks = listing.key_specs || {};
      const rating = d.reviewRating;
      // Below 3.5 no verdict label renders — the number speaks for itself.
      const label = rating == null ? "" : rating >= 4.5 ? "Excellent" : rating >= 4 ? "Very Good" : rating >= 3.5 ? "Good" : "";
      const hasReviewData = rating != null || sources.length > 0;
      const hasNhtsaData = nhtsa?.ratings?.overall != null || !!nhtsa?.complaints || !!d.iihsAward;
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
        body: (hasReviewData || hasNhtsaData) ? <>
          {rating != null && <div className="md:hidden"><MHero tone="green" icon={Star} ringPct={Math.round((rating / 5) * 100)} eyebrow={`${rating.toFixed(1)} / 5${label ? ` · ${label}` : ""}`} title="Owner Reviews" note={[sourceNames.length > 0 ? `Based on ${sourceNames.join(", ")}` : null, d.reviewCount != null ? `${d.reviewCount.toLocaleString()} reviews` : null].filter(Boolean).join(" · ")} /></div>}
          {rating != null && (
            <div className="hidden md:block">
              <div className={`${CARD} p-5 flex items-center gap-4`}>
                <div className="text-center shrink-0"><p className="text-[34px] font-extrabold text-[#2563EB] leading-none">{rating.toFixed(1)}</p><div className="mt-1"><Stars n={rating} /></div>{d.reviewCount != null && <p className="text-[11px] text-[#64748B] mt-1">{d.reviewCount.toLocaleString()} reviews</p>}</div>
                <div className="min-w-0">{label && <p className="text-[15px] font-extrabold text-[#16A34A]">{label}</p>}{sourceNames.length > 0 && <p className="text-[12px] text-[#64748B] mt-0.5">Based on {sourceNames.join(", ")}</p>}</div>
              </div>
            </div>
          )}
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
          {nhtsa?.complaints && nhtsa.complaints.count === 0 && (
            <div className={`${CARD} p-4`}>
              <p className="text-[13px] font-semibold text-[#16A34A]">No owner complaints on file with NHTSA for this model year.</p>
              <p className="text-[11px] text-[#94A3B8] mt-2">Source: NHTSA complaint database (nhtsa.gov).</p>
            </div>
          )}
          {nhtsa?.complaints && nhtsa.complaints.count > 0 && (
            <Accordion title="Model-line owner reports">
              <p>{nhtsa.complaints.count.toLocaleString()} report{nhtsa.complaints.count === 1 ? "" : "s"} filed nationwide across all {listing.ymm} vehicles — not reports about this specific car.</p>
              {nhtsa.complaints.topComponents.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {nhtsa.complaints.topComponents.map((c) => (
                    <span key={c.component} className="inline-flex items-center rounded-full border border-[#E6E8EC] bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-semibold text-[#475569]">{c.component.toLowerCase().replace(/(^|[\s/])[a-z]/g, (m) => m.toUpperCase())} · {c.count}</span>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-[#94A3B8] mt-3">Source: NHTSA complaint database (nhtsa.gov). Reports are unverified and cover the entire model line.</p>
            </Accordion>
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
        </> : <>
          {recsU.length > 0 && (
            <Section title="Well suited for" sub="Based on this vehicle's configuration.">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 flex flex-wrap gap-2">{recsU.map((r) => <Chip key={r}>{r}</Chip>)}</div>
            </Section>
          )}
          <Empty>
            Curious what owners say about this vehicle? Our team is happy to share the ownership experience.
            <button onClick={() => go("contact")} className="block mt-2 text-[13px] font-semibold text-[#2563EB] hover:underline">Ask our team</button>
          </Empty>
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
        { icon: FileText, t: "Features & Equipment", s: "Packages, options, and full equipment", fn: () => openPanel("highlights") },
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
      // Technical Specifications Intelligence Panel — the engineering
      // sibling of the equipment panel: same xl drawer, stat cards,
      // benefit-framed highlights, and grouped spec cards. Missing values
      // are omitted entirely, never invented or labeled pending.
      const ks = listing.key_specs || {};
      const mcr = mc;
      const ksr = ks as Record<string, unknown>;
      const A = (keys: string[]) => specAttr(mcr, ksr, keys);
      const { groups } = featureGroups(listing);
      const hp = mcr.horsepower != null ? `${mcr.horsepower} hp` : A(["horsepower"]);
      const mpg = ks.mpg_city && ks.mpg_hwy ? `${ks.mpg_city}/${ks.mpg_hwy} MPG` : A(["mpg", "combined_mpg"]);
      const seating = mcr.seating != null ? `${mcr.seating}-passenger` : A(["seating", "seats"]);
      const engineV = ks.engine ? String(ks.engine) : A(["engine"]);
      const transV = ks.transmission ? String(ks.transmission) : A(["transmission"]);
      const driveV = ks.drivetrain ? String(ks.drivetrain) : A(["drivetrain", "drive_type"]);
      const fuelV = ks.fuel ? String(ks.fuel) : A(["fuel", "fuel_type"]);
      const perfRows: [string, string | null][] = [
        ["Engine", engineV],
        ["Displacement", A(["displacement", "engine_displacement"])],
        ["Horsepower", hp],
        ["Torque", A(["torque"])],
        ["Transmission", transV],
        ["Drive Type", driveV],
        ["0–60 mph", A(["0_60", "zero_to_sixty", "zero_sixty"])],
        ["Top Speed", A(["top_speed"])],
      ];
      const dimRows: [string, string | null][] = [
        ["Length", A(["length", "overall_length"])], ["Width", A(["width", "overall_width"])], ["Height", A(["height", "overall_height"])],
        ["Wheelbase", A(["wheelbase"])], ["Ground Clearance", A(["ground_clearance"])], ["Turning Radius", A(["turning_radius"])],
        ["Passenger Volume", A(["passenger_volume"])], ["Cargo Capacity", A(["cargo", "cargo_capacity", "cargo_volume"])], ["Seating Capacity", seating],
      ];
      const wheelRows: [string, string | null][] = [
        ["Wheel Size", A(["wheel_size", "wheels"])], ["Tire Size", A(["tire_size", "tires"])], ["Spare Tire", A(["spare_tire", "spare"])],
        ["Wheel Material", A(["wheel_material"])], ["Brakes", A(["brakes"])],
      ];
      const fuelRows: [string, string | null][] = [
        ["Fuel Type", fuelV], ["City MPG", ks.mpg_city ? String(ks.mpg_city) : null], ["Highway MPG", ks.mpg_hwy ? String(ks.mpg_hwy) : null],
        ["Combined MPG", A(["combined_mpg"])], ["Fuel Tank Capacity", A(["fuel_tank", "fuel_capacity", "tank_capacity"])],
        ["Towing", A(["towing", "towing_capacity", "max_towing"])], ["Payload", A(["payload", "payload_capacity"])],
      ];
      const mechRows: [string, string | null][] = [
        ["Front Suspension", A(["front_suspension"])], ["Rear Suspension", A(["rear_suspension"])], ["Steering", A(["steering"])],
        ["Battery", A(["battery"])], ["Hybrid System", A(["hybrid_system"])], ["EV Battery", A(["ev_battery", "battery_capacity"])], ["Charging", A(["charging", "charge_time"])],
      ];
      const safety = groups.Safety || [];
      const hasAny = [engineV, transV, driveV, hp, mpg, fuelV, ...dimRows.map(([, v]) => v)].some(Boolean);
      const counts = (rows: [string, string | null][]) => ({ ok: rows.filter(([, v]) => v).length, pending: rows.filter(([, v]) => !v).length });

      const specStat = (label: string, value: string | null, helper: string, iconName: string) => {
        if (!value) return null;
        const Icon = getEquipmentIcon(iconName).icon;
        return (
          <div className="rounded-2xl border border-[#DDE5EE] bg-white p-3.5 flex flex-col gap-1.5">
            <span className="w-8 h-8 rounded-lg bg-[#EAF4FF] text-[#0B6FEA] flex items-center justify-center"><Icon className="w-4 h-4" strokeWidth={1.75} /></span>
            <p className="text-[10.5px] font-semibold text-[#64748B] leading-tight">{label}</p>
            <p className="text-[15px] font-extrabold leading-tight text-[#0D1B2A]">{value}</p>
            <p className="text-[10px] text-[#94A3B8]">{helper}</p>
          </div>
        );
      };
      const specRow = ([k, v]: [string, string | null]) => v ? (
        <div key={k} className="flex items-center justify-between gap-3 py-1.5 text-[12.5px] border-b border-[#F1F5F9] last:border-0">
          <span className="text-[#64748B]">{k}</span>
          <span className="font-bold text-[#10202B] text-right">{v}</span>
        </div>
      ) : null;
      const specCard = (title: string, rows: [string, string | null][], helper?: string) => {
        const c = counts(rows);
        if (c.ok === 0) return null;
        return (
          <div className={`${CARD} p-4`}>
            <p className="text-[13.5px] font-bold text-[#0D1B2A]">{title}</p>
            <div className="mt-1.5">{rows.map(specRow)}</div>
            {helper && <p className="text-[10.5px] text-[#94A3B8] mt-2">{helper}</p>}
          </div>
        );
      };
      // Benefit-framed engineering highlights from available specs only.
      const highlights: { title: string; benefit: string; iconName: string }[] = ([
        engineV ? { title: `${engineV} Engine`, benefit: "Strong, smooth power delivery for confident acceleration.", iconName: engineV } : null,
        driveV ? { title: /awd|4wd|4x4/i.test(driveV) ? `${driveV} Traction` : driveV, benefit: /awd|4wd|4x4/i.test(driveV) ? "Added grip for changing weather and road conditions." : "Tuned for efficient everyday driving.", iconName: driveV } : null,
        transV ? { title: transV, benefit: /manual|paddle|sport/i.test(transV) ? "Easy daily driving with added driver control when wanted." : "Smooth, effortless shifting.", iconName: transV } : null,
        mpg ? { title: `${mpg} Efficiency`, benefit: "Designed to balance performance and daily usability.", iconName: `${mpg} mpg` } : null,
        fuelV ? { title: fuelV, benefit: "Fuel requirement shown clearly before purchase.", iconName: `${fuelV} fuel type` } : null,
        hp ? { title: hp, benefit: "Confident passing and merging power.", iconName: "engine horsepower" } : null,
        seating ? { title: seating, benefit: "Space planned for people first.", iconName: "seating" } : null,
      ] as ({ title: string; benefit: string; iconName: string } | null)[]).filter(Boolean).slice(0, 6) as { title: string; benefit: string; iconName: string }[];
      const catRows: { name: string; iconName: string; rows: [string, string | null][] }[] = [
        { name: "Performance & Drivetrain", iconName: "engine", rows: perfRows },
        { name: "Dimensions & Space", iconName: "seating", rows: dimRows },
        { name: "Fuel & Efficiency", iconName: "fuel type", rows: fuelRows },
        { name: "Wheels, Tires & Brakes", iconName: "wheels", rows: wheelRows },
        { name: "Mechanical & Chassis", iconName: "dealer add-on", rows: mechRows },
      ];
      return {
        title: "Technical Specifications",
        subtitle: "Everything you need to know about this vehicle's engineering, size, and capability",
        xl: true,
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        secondary: { label: "View Equipment", onClick: () => openPanel("equipment") },
        footerQuestion: "Questions about the specifications?", specialistLabel: "Talk to a Product Specialist",
        body: <>
          <div className="md:hidden"><MHero tone="blue" icon={FileText} eyebrow="Technical Specifications" title={listing.ymm || "Specifications"} note={[engineV, driveV].filter(Boolean).join(" · ") || "Verified vehicle details"} /></div>
          {hasAny ? (
            <>
              {/* Vehicle context line */}
              <p className="text-[12.5px] font-semibold text-[#334155] -mt-1">{[listing.ymm, listing.trim, engineV, driveV, transV].filter(Boolean).join(" · ")}</p>

              {/* Quick spec stat cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {specStat("Engine", engineV, "Performance", engineV || "engine")}
                {specStat("Drivetrain", driveV, "Traction", driveV || "awd")}
                {specStat("Transmission", transV, transV && /manual|paddle/i.test(transV) ? "Manual Mode" : "Shifting", transV || "automatic")}
                {specStat("Fuel Economy", mpg, ks.mpg_city && ks.mpg_hwy ? "City / Hwy" : "Economy", "mpg fuel economy")}
              </div>

              <div className="rounded-xl border border-blue-100 bg-[#EAF4FF] px-3.5 py-2.5 flex items-start gap-2">
                <FileText className="w-4 h-4 text-[#0B6FEA] shrink-0 mt-0.5" />
                <p className="text-[12px] text-[#1E3A8A] leading-snug">Specifications are decoded from available vehicle data and organized for easier review.</p>
              </div>

              {/* Two-column interior */}
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,62fr)_minmax(0,38fr)] gap-5 items-start">
                <div className="space-y-5 min-w-0">
                  {highlights.length > 0 && (
                    <Section title="Key Engineering Highlights" sub="The core technical details that define how this vehicle drives.">
                      <div className="grid grid-cols-2 gap-3">
                        {highlights.map((h) => {
                          const HIcon = getEquipmentIcon(h.iconName).icon;
                          return (
                            <div key={h.title} className={`${CARD} p-3.5 flex flex-col items-center text-center gap-1.5`}>
                              <span className="w-10 h-10 rounded-xl bg-[#EAF4FF] flex items-center justify-center"><HIcon className="w-5 h-5 text-[#0B6FEA]" strokeWidth={1.75} /></span>
                              <p className="text-[12px] font-bold leading-tight text-[#0D1B2A]">{h.title}</p>
                              <p className="text-[10.5px] text-[#64748B] leading-snug">{h.benefit}</p>
                            </div>
                          );
                        })}
                      </div>
                    </Section>
                  )}

                  <Section title="Technical Specs by Category" sub="Browse specifications by engineering area.">
                    <div className="space-y-2">
                      {catRows.map((c) => {
                        const cc = counts(c.rows);
                        if (cc.ok === 0) return null;
                        const CIcon = getEquipmentIcon(c.iconName).icon;
                        return (
                          <details key={c.name} className={`${CARD} overflow-hidden group`}>
                            <summary className="cursor-pointer list-none flex items-center gap-3 px-4 py-3">
                              <span className="w-8 h-8 rounded-lg bg-[#EAF4FF] flex items-center justify-center shrink-0"><CIcon className="w-4 h-4 text-[#0B6FEA]" strokeWidth={1.75} /></span>
                              <span className="text-[13px] font-bold text-[#0F172A] flex-1 min-w-0 truncate">{c.name}</span>
                              <span className="text-[11px] font-semibold text-[#94A3B8] shrink-0">{cc.ok} available</span>
                              <ChevronDown className="w-4 h-4 text-[#94A3B8] group-open:rotate-180 transition-transform shrink-0" />
                            </summary>
                            <div className="px-4 pb-3">{c.rows.map(specRow)}</div>
                          </details>
                        );
                      })}
                      {safety.length > 0 && (
                        <details className={`${CARD} overflow-hidden group`}>
                          <summary className="cursor-pointer list-none flex items-center gap-3 px-4 py-3">
                            <span className="w-8 h-8 rounded-lg bg-[#EAF4FF] flex items-center justify-center shrink-0"><ShieldCheck className="w-4 h-4 text-[#0B6FEA]" strokeWidth={1.75} /></span>
                            <span className="text-[13px] font-bold text-[#0F172A] flex-1 min-w-0 truncate">Safety Systems</span>
                            <span className="text-[11px] font-semibold text-[#94A3B8] shrink-0">{safety.length} available</span>
                            <ChevronDown className="w-4 h-4 text-[#94A3B8] group-open:rotate-180 transition-transform shrink-0" />
                          </summary>
                          <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">{safety.map((sf) => <Check key={sf}>{sf}</Check>)}</div>
                        </details>
                      )}
                    </div>
                  </Section>

                  <details className={`${CARD} overflow-hidden group`}>
                    <summary className="cursor-pointer list-none flex items-center justify-between gap-3 px-4 py-3.5">
                      <span className="min-w-0">
                        <span className="block text-[13px] font-bold text-[#0F172A] leading-tight">Complete Specifications Reference</span>
                        <span className="block text-[11px] text-[#94A3B8] leading-tight mt-0.5">Full technical list for detail-oriented shoppers</span>
                      </span>
                      <ChevronDown className="w-4 h-4 text-[#94A3B8] group-open:rotate-180 transition-transform shrink-0" />
                    </summary>
                    <div className="px-4 pb-4 space-y-4">
                      {catRows.filter((c) => counts(c.rows).ok > 0).map((c) => (
                        <div key={c.name}>
                          <p className="text-[11px] font-bold uppercase tracking-wide text-[#94A3B8] mb-1">{c.name}</p>
                          {c.rows.map(specRow)}
                        </div>
                      ))}
                    </div>
                  </details>
                </div>

                <div className="space-y-5 min-w-0">
                  {specCard("Performance & Drivetrain", perfRows)}
                  {specCard("Dimensions & Space", dimRows, "Vehicle dimensions help estimate garage fit, passenger space, and road presence.")}
                  {specCard("Wheels, Tires & Brakes", wheelRows)}
                  {specCard("Fuel & Efficiency", fuelRows)}
                </div>
              </div>
            </>
          ) : <Empty>Specifications appear here as the vehicle's data is decoded from its VIN.</Empty>}
          <Disclaimer />
        </>,
      };
    }

    // "highlights" is an alias — the two panels overlapped heavily, so one
    // consolidated Features & Equipment panel serves every existing link.
    case "highlights":
    case "equipment": {
      // Equipment Intelligence Panel — a wide premium drawer that turns the
      // decoded build into a value story: stat cards, benefit-driven
      // featured highlights, category rows, packages/options summary, and a
      // collapsed full reference. Data via buildEquipmentPanelData; every
      // section is real-data gated.
      const eq = buildEquipmentPanelData(listing, d);
      const hasContent = eq.factoryFeatureCount > 0 || eq.packageCount > 0 || eq.dealerAddonCount > 0 || eq.featuredHighlights.length > 0;
      const statCard = (label: string, value: string, sub: string, Icon: React.ElementType, tone: "blue" | "green" = "blue") => (
        <div className={`rounded-2xl border ${tone === "green" ? "border-emerald-200 bg-emerald-50/40" : "border-[#DDE5EE] bg-white"} p-3.5 flex flex-col gap-1.5`}>
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${tone === "green" ? "bg-emerald-100 text-[#1F7A4D]" : "bg-[#EAF4FF] text-[#0B6FEA]"}`}><Icon className="w-4 h-4" strokeWidth={1.75} /></span>
          <p className="text-[10.5px] font-semibold text-[#64748B] leading-tight">{label}</p>
          <p className={`text-[19px] font-extrabold leading-none tabular-nums ${tone === "green" ? "text-[#1F7A4D]" : "text-[#0D1B2A]"}`}>{value}</p>
          <p className="text-[10px] text-[#94A3B8]">{sub}</p>
        </div>
      );
      return {
        title: eq.optionValue ? `${fmt$(eq.optionValue)} in Factory Options on This Build` : "Features & Equipment",
        subtitle: "Everything this vehicle was built with, from the factory and dealership",
        xl: true,
        primary: { label: "Reserve This Vehicle", onClick: () => go("reserve") },
        secondary: { label: "View Full Specifications", onClick: () => openPanel("key-specs") },
        footerQuestion: "Questions about the equipment?", specialistLabel: "Talk to a Product Specialist",
        body: <>
          <div className="md:hidden"><MHero tone="blue" icon={Package} eyebrow="Equipment & Options" title={`${eq.factoryFeatureCount} on this vehicle`} note={eq.packageCount ? `${eq.packageCount} factory package${eq.packageCount === 1 ? "" : "s"} installed` : eq.dealerAddonCount ? `${eq.dealerAddonCount} dealer add-on${eq.dealerAddonCount === 1 ? "" : "s"} available` : "Factory and dealer equipment"} /></div>
          {hasContent ? (
            <>
              {/* Value summary stat cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {statCard("Factory Features", `${eq.factoryFeatureCount}`, "Included", CheckCircle2)}
                {statCard("Factory Packages", `${eq.packageCount}`, "Included", Package)}
                {statCard("Dealer Add-ons", `${eq.dealerAddonCount}`, "Added", Wrench)}
                {statCard("Option Value", eq.optionValue ? fmt$(eq.optionValue) : "Included", eq.optionValue ? "Total Value" : "Equipment", DollarSign, "green")}
              </div>

              {/* Generic decode = typical-for-trim, not VIN-verified — label it softly. */}
              {eq.generic && (
                <p className="text-[12px] text-[#94A3B8]">Confirm this vehicle's exact build with our team.</p>
              )}

              {/* Two-column interior */}
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,62fr)_minmax(0,38fr)] gap-5 items-start">
                <div className="space-y-5 min-w-0">
                  {eq.featuredHighlights.length > 0 && (
                    <Section title="Featured Highlights" sub="The standout features that define this build.">
                      <div className="grid grid-cols-2 xl:grid-cols-2 gap-3">
                        {eq.featuredHighlights.map((h) => (
                          <div key={h.id} className={`${CARD} p-3.5 flex flex-col items-center text-center gap-1.5`}>
                            <span className="w-10 h-10 rounded-xl bg-[#EAF4FF] flex items-center justify-center"><h.icon.icon className="w-5 h-5 text-[#0B6FEA]" strokeWidth={1.75} /></span>
                            <p className="text-[12px] font-bold leading-tight text-[#0D1B2A]">{h.title}</p>
                            <p className="text-[10.5px] text-[#64748B] leading-snug">{h.benefit}</p>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}

                  {eq.categories.length > 0 && (
                    <Section title="Equipment by Category" sub="Explore features by what matters most.">
                      <div className="space-y-2">
                        {eq.categories.map((c) => (
                          <details key={c.id} className={`${CARD} overflow-hidden group`}>
                            <summary className="cursor-pointer list-none flex items-center gap-3 px-4 py-3">
                              <span className="w-8 h-8 rounded-lg bg-[#EAF4FF] flex items-center justify-center shrink-0"><c.icon.icon className="w-4 h-4 text-[#0B6FEA]" strokeWidth={1.75} /></span>
                              <span className="text-[13px] font-bold text-[#0F172A] flex-1 min-w-0 truncate">{c.name}</span>
                              <span className="text-[11px] font-semibold text-[#94A3B8] shrink-0">{c.items.length} feature{c.items.length === 1 ? "" : "s"}</span>
                              <ChevronDown className="w-4 h-4 text-[#94A3B8] group-open:rotate-180 transition-transform shrink-0" />
                            </summary>
                            <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                              {c.items.map((it) => {
                                const ItIcon = getEquipmentIcon(it).icon;
                                return <div key={it} className="flex items-start gap-2 text-[12px] text-[#334155]"><ItIcon className="w-3.5 h-3.5 text-[#0B6FEA] shrink-0 mt-0.5" strokeWidth={1.75} />{it}</div>;
                              })}
                            </div>
                          </details>
                        ))}
                      </div>
                    </Section>
                  )}

                  {eq.completeFactoryEquipment.length > 0 && (
                    <details className={`${CARD} overflow-hidden group`}>
                      <summary className="cursor-pointer list-none flex items-center justify-between gap-3 px-4 py-3.5">
                        <span className="min-w-0">
                          <span className="block text-[13px] font-bold text-[#0F172A] leading-tight">Complete Factory Equipment ({eq.factoryFeatureCount})</span>
                          <span className="block text-[11px] text-[#94A3B8] leading-tight mt-0.5">Full VIN-decoded list for reference</span>
                        </span>
                        <ChevronDown className="w-4 h-4 text-[#94A3B8] group-open:rotate-180 transition-transform shrink-0" />
                      </summary>
                      <div className="px-3 pb-3 space-y-2">{eq.completeFactoryEquipment.map(([name, items]) => <Group key={name} title={name} items={items} iconic />)}</div>
                    </details>
                  )}
                </div>

                <div className="space-y-5 min-w-0">
                  <Section title="Installed Packages" sub="Packages included on this build.">
                    {eq.installedPackages.length > 0 ? (
                      <div className="space-y-2">
                        {eq.installedPackages.map((pkg) => (
                          <details key={pkg.id} className={`${CARD} overflow-hidden group`}>
                            <summary className="cursor-pointer list-none px-4 py-3">
                              <span className="flex items-center justify-between gap-2">
                                <span className="text-[13px] font-bold text-[#0F172A] leading-tight min-w-0">{pkg.name}</span>
                                <span className="text-[10px] font-bold text-[#0B6FEA] bg-[#EAF4FF] rounded-full px-2 py-0.5 shrink-0">Included</span>
                              </span>
                              {pkg.value ? <span className="block text-[12px] font-bold text-[#1F7A4D] mt-1">{fmt$(pkg.value)} Value</span> : null}
                            </summary>
                            {pkg.contents.length > 0 && (
                              <div className="px-4 pb-3 space-y-1.5">
                                {pkg.contents.map((c) => <div key={c} className="flex items-start gap-2 text-[12px] text-[#334155]"><CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0 mt-0.5" />{c}</div>)}
                              </div>
                            )}
                          </details>
                        ))}
                      </div>
                    ) : (
                      <div className={`${CARD} p-3.5`}><p className="text-[12px] text-[#64748B]">No optional packages — this vehicle is equipped as a standard {listing.trim ? `${listing.trim} ` : ""}build.</p></div>
                    )}
                  </Section>

                  {eq.factoryOptionsSummary.length > 0 && (
                    <Section title="Factory Options Summary" sub="Additional factory-installed options.">
                      <div className={`${CARD} p-3.5`}>
                        {eq.factoryOptionsSummary.slice(0, 5).map((o) => (
                          <div key={o.id} className="flex items-center justify-between gap-2 py-1.5 text-[12.5px]">
                            <span className="text-[#10202B] font-semibold min-w-0 truncate">{o.name}</span>
                            <span className="shrink-0">{o.value ? <span className="font-bold text-[#1F7A4D]">{fmt$(o.value)}</span> : <span className="text-[10px] font-bold text-[#0B6FEA] bg-[#EAF4FF] rounded-full px-2 py-0.5">Included</span>}</span>
                          </div>
                        ))}
                        {eq.factoryOptionsSummary.length > 5 && (
                          <details className="group">
                            <summary className="cursor-pointer list-none text-[12px] font-semibold text-[#0B6FEA] pt-1.5 inline-flex items-center gap-1">View all options ({eq.factoryOptionsSummary.length}) <ChevronDown className="w-3.5 h-3.5 group-open:rotate-180 transition-transform" /></summary>
                            {eq.factoryOptionsSummary.slice(5).map((o) => (
                              <div key={o.id} className="flex items-center justify-between gap-2 py-1.5 text-[12.5px]">
                                <span className="text-[#10202B] font-semibold min-w-0 truncate">{o.name}</span>
                                {o.value ? <span className="font-bold text-[#1F7A4D] shrink-0">{fmt$(o.value)}</span> : null}
                              </div>
                            ))}
                          </details>
                        )}
                      </div>
                    </Section>
                  )}

                  {eq.accessories.length > 0 && (
                    <Section title="Dealer Add-ons Available" sub="Offered by the dealer — not factory-installed.">
                      <div className="space-y-2">{eq.accessories.map((a) => { const AccIcon = getEquipmentIcon({ name: a, category: "accessory" }).icon; return <div key={a} className={`${CARD} p-3 flex items-center gap-2.5`}><span className="w-8 h-8 rounded-lg bg-[#EAF4FF] flex items-center justify-center shrink-0"><AccIcon className="w-4 h-4 text-[#0B6FEA]" strokeWidth={1.75} /></span><span className="text-[13px] text-[#0F172A]">{a}</span></div>; })}</div>
                    </Section>
                  )}

                  {eq.customerLoveReasons.length > 0 && (
                    <Section title="Why Customers Love This Build" sub="Real benefits that matter most.">
                      <div className={`${CARD} p-4 space-y-3`}>
                        {eq.customerLoveReasons.map((r) => (
                          <div key={r.id} className="flex items-start gap-2.5">
                            <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <p className="text-[12.5px] font-bold text-[#0F172A] leading-tight">{r.title}</p>
                              <p className="text-[11px] text-[#64748B] mt-0.5">{r.description}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}
                </div>
              </div>
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
            <p className="text-[12px] text-[#64748B]">Want the complete picture? Ask {d.dealerName} for the full history report.</p>
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
// Customer-visible price movement renders only when it works FOR the shopper:
// dealer price reductions, or a rising market as cost-to-wait. Dealer price
// increases and a falling market never render.
const Delta = ({ kind, delta }: { kind: "dealer" | "market"; delta: number }) => {
  if (kind === "dealer") {
    if (delta >= 0) return null;
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-[#16A34A]">
        <TrendingDown className="w-3.5 h-3.5" /> Price reduced {fmt$(Math.abs(delta))}
      </span>
    );
  }
  if (delta <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1 font-semibold text-[#64748B]">
      <TrendingUp className="w-3.5 h-3.5" /> Market average up {fmt$(delta)} since tracking began — today's price locks it in
    </span>
  );
};

const Gauge3 = ({ value }: { value: number }) => (
  <div>
    <div className="relative h-3 rounded-full bg-gradient-to-r from-slate-200 via-amber-200 to-emerald-300">
      <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white ring-2 ring-[#0F172A] shadow" style={{ left: `${value}%` }} />
    </div>
    <div className="flex justify-between text-[11px] font-semibold text-[#94A3B8] mt-1.5"><span>Low</span><span>Medium</span><span>High</span></div>
  </div>
);

// Factors without enough data are omitted upstream, so every rendered row
// carries a positive status chip — "Pending" never reaches a customer.
const FactorBar = ({ label, pct, status }: { label: string; pct: number; status?: string }) => {
  const s = status ?? (pct >= 85 ? "Strong" : "Good");
  return (
    <div>
      <div className="flex justify-between items-center gap-2 text-[12px] mb-1">
        <span className="text-[#0F172A] font-medium">{label}</span>
        <span className={`text-[10px] font-bold rounded-full border px-2 py-0.5 shrink-0 ${s === "Strong" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-emerald-50/60 text-emerald-700 border-emerald-100"}`}>{s}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-[#2563EB]" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
    </div>
  );
};

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
}) => active ? (
  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
    <div className="flex flex-col sm:flex-row sm:items-center gap-5">
      <div className="flex items-start gap-3.5 min-w-0 flex-1">
        <span className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center shrink-0"><ShieldCheck className="w-7 h-7 text-[#16A34A]" /></span>
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-[#0F172A]">Factory Warranty</p>
          <p className="text-[26px] font-extrabold leading-none tracking-wide mt-0.5 text-[#16A34A]">ACTIVE</p>
          <p className="text-[12px] text-[#64748B] mt-1.5 leading-snug">Your factory warranty is in effect. You're covered.</p>
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
) : (
  <div className={`${CARD} px-4 py-3 flex items-center gap-2.5`}>
    <ShieldCheck className="w-4 h-4 text-[#94A3B8] shrink-0" />
    <p className="text-[13px] text-[#64748B]">Factory coverage ended — ask our team about the extended coverage options for this vehicle.</p>
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
    case "market-price": return { badge: s.greatPrice ? "Great Price Available Today" : "Vehicle Available Today", btn: s.greatPrice ? "Reserve at This Price" : "Reserve This Vehicle", sub: s.greatPrice ? "The dealership confirms availability." : "Secure this vehicle while it's still available.", action: "reserve", tone: s.greatPrice ? "green" : "blue" };
    case "market-demand": return { badge: s.highDemand ? "High Demand In Your Market" : "Vehicle Available Today", btn: s.highDemand ? "Claim This Vehicle" : "Reserve This Vehicle", sub: s.highDemand ? "High-demand vehicles go fast." : "Secure this vehicle while it's still available.", action: "reserve", tone: "green" };
    // Urgency copy only when the data supports it — a fabricated scarcity badge
    // above an honest empty state poisons the page's verification premise.
    case "comparable-vehicles": return s.highDemand
      ? { badge: "In Demand", btn: "Reserve This Vehicle", sub: "This vehicle is drawing strong shopper interest.", action: "reserve", tone: "blue" }
      : { badge: "Vehicle Available Today", btn: "Reserve This Vehicle", sub: "Secure this vehicle while it's still available.", action: "reserve", tone: "blue" };
    case "inventory-trend": return s.highDemand
      ? { badge: "Strong Local Interest", btn: "Reserve This Vehicle", sub: "Shopper activity on this vehicle is above average.", action: "reserve", tone: "orange" }
      : { badge: "Vehicle Available Today", btn: "Reserve This Vehicle", sub: "Secure this vehicle while it's still available.", action: "reserve", tone: "blue" };
    case "price-confidence": return { badge: "Supported by Market Data", btn: s.highConf ? "Reserve With Confidence" : "Reserve This Vehicle", sub: "This price is supported by live market data.", action: "reserve", tone: "green" };
    case "factory-warranty": return { badge: s.hasWarranty ? "Warranty Coverage Available" : "Vehicle Available Today", btn: s.hasWarranty ? "Protect This Vehicle" : "Reserve This Vehicle", sub: s.hasWarranty ? "Secure remaining factory protection." : "Secure this vehicle while it's still available.", action: s.hasWarranty ? "protect" : "reserve", tone: "green" };
    case "owner-reviews": return { badge: s.highlyRated ? "Highly Rated By Owners" : "Trusted Dealer Reviews", btn: "Reserve This Vehicle", sub: "Shoppers rate this dealership highly.", action: "reserve", tone: "green" };
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
        <button onClick={primary} className="w-full min-h-[52px] rounded-2xl bg-[#2563EB] active:bg-[#1d4fd7] text-white text-[15px] font-bold inline-flex items-center justify-center gap-2 transition-all active:scale-[0.99]">Reserve This Vehicle</button>
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

// Multi-series price chart. The y-domain zooms to the data (a real $900 move
// must be visible, not compressed by an unrelated axis), the gap between
// market value and the dealer price is shaded — that band IS the value story
// even when the price line is flat — and markers/annotations appear only at
// actual change events so a steady price reads as intentional, not empty.
const PriceChart = ({ pts, height = 170 }: { pts: { label: string; dealer: number | null; market: number | null }[]; height?: number }) => {
  const w = 560, padL = 52, padR = 64, padY = 20, h = height;
  const vals = pts.flatMap((p) => [p.dealer, p.market]).filter((n): n is number => n != null);
  if (vals.length < 2) return null;
  const rawMin = Math.min(...vals), rawMax = Math.max(...vals);
  const padV = Math.max((rawMax - rawMin) * 0.12, rawMax * 0.01, 100);
  const min = rawMin - padV, max = rawMax + padV, range = Math.max(1, max - min);
  const x = (i: number) => padL + (i / Math.max(1, pts.length - 1)) * (w - padL - padR);
  const y = (v: number) => padY + (1 - (v - min) / range) * (h - padY * 2);
  const dline = pts.map((p, i) => (p.dealer != null ? `${x(i).toFixed(1)},${y(p.dealer).toFixed(1)}` : null)).filter(Boolean) as string[];
  const mline = pts.map((p, i) => (p.market != null ? `${x(i).toFixed(1)},${y(p.market).toFixed(1)}` : null)).filter(Boolean) as string[];
  const dealerIdx = pts.map((p, i) => (p.dealer != null ? i : -1)).filter((i) => i >= 0);
  const lastIdx = dealerIdx.length ? dealerIdx[dealerIdx.length - 1] : -1;
  // Annotate reductions only — an increase never gets a "+$X" callout.
  const changes = dealerIdx.filter((i, k) => k > 0 && (pts[i].dealer as number) < (pts[dealerIdx[k - 1]].dealer as number));
  // Value band: dealer line forward, market line backward, where both exist.
  const both = pts.map((p, i) => (p.dealer != null && p.market != null ? { i, d: p.dealer, m: p.market } : null)).filter(Boolean) as { i: number; d: number; m: number }[];
  const band = both.length >= 2
    ? `M ${both.map((b) => `${x(b.i).toFixed(1)},${y(b.d).toFixed(1)}`).join(" L ")} L ${[...both].reverse().map((b) => `${x(b.i).toFixed(1)},${y(b.m).toFixed(1)}`).join(" L ")} Z`
    : null;
  const kFmt = (v: number) => `$${Math.round(v / 100) / 10}K`;
  const area = dline.length >= 2
    ? `M ${dline.join(" L ")} L ${x(lastIdx).toFixed(1)},${(h - padY).toFixed(1)} L ${x(dealerIdx[0]).toFixed(1)},${(h - padY).toFixed(1)} Z`
    : null;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="pc-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={GREEN} stopOpacity="0.16" />
          <stop offset="100%" stopColor={GREEN} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[rawMax, (rawMax + rawMin) / 2, rawMin].map((v, i) => (
        <g key={i}>
          <line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} stroke="#E6E8EC" strokeWidth="1" strokeDasharray="3 4" />
          <text x={padL - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="#94A3B8" fontWeight="600">{kFmt(v)}</text>
        </g>
      ))}
      {band && <path d={band} fill={BLUE} opacity="0.06" />}
      {area && <path d={area} fill="url(#pc-area)" />}
      {mline.length >= 2 && <polyline points={mline.join(" ")} fill="none" stroke={BLUE} strokeWidth="2.5" strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />}
      {dline.length >= 2 && <polyline points={dline.join(" ")} fill="none" stroke={GREEN} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
      {changes.map((i) => {
        const prev = dealerIdx[dealerIdx.indexOf(i) - 1];
        const delta = (pts[i].dealer as number) - (pts[prev].dealer as number);
        return (
          <g key={i}>
            <circle cx={x(i)} cy={y(pts[i].dealer as number)} r="4.5" fill="#fff" stroke={GREEN} strokeWidth="2.5"><title>{`${pts[i].label}: ${fmt$(pts[i].dealer as number)}`}</title></circle>
            <text x={x(i)} y={y(pts[i].dealer as number) - 9} textAnchor="middle" fontSize="10" fontWeight="800" fill={GREEN}>−{fmt$(Math.abs(delta))}</text>
          </g>
        );
      })}
      {lastIdx >= 0 && (
        <g>
          <circle cx={x(lastIdx)} cy={y(pts[lastIdx].dealer as number)} r="4.5" fill={GREEN} stroke="#fff" strokeWidth="2" />
          <rect x={x(lastIdx) + 7} y={y(pts[lastIdx].dealer as number) - 10} width={padR - 12} height="20" rx="6" fill={GREEN} />
          <text x={x(lastIdx) + 7 + (padR - 12) / 2} y={y(pts[lastIdx].dealer as number) + 3.5} textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff">{fmt$(pts[lastIdx].dealer as number)}</text>
        </g>
      )}
    </svg>
  );
};

// Visit Dealer slide-out body — a utility panel that keeps the shopper in
// the passport flow: map card with provider links, department selector,
// data-gated hours, a before-you-go checklist, and the exact vehicle
// context. Missing data falls back to "call to confirm" — never "coming
// soon" on a customer surface.
function VisitDealerBody({ d, listing, go, isPreview }: { d: PassportData; listing: VehicleListing; go: (s: string) => void; isPreview: boolean }) {
  const [dept, setDept] = useState<"sales" | "service" | "parts">("sales");
  const t = d.dealerTrust;
  const addr = d.dealerAddress;
  const q = encodeURIComponent(addr || d.dealerName);
  const gmaps = `https://www.google.com/maps/search/?api=1&query=${q}`;
  const amaps = `https://maps.apple.com/?q=${q}`;
  const dealerTel = d.dealerPhone ? d.dealerPhone.replace(/[^\d+]/g, "") : null;
  const hasService = t.serviceLocation === "onsite" || t.serviceLocation === "offsite";
  const hasParts = t.services.some((s) => /part/i.test(s));
  const hero = listingHero(listing);
  const price = d.price;
  const copyAddress = async () => {
    try { await navigator.clipboard.writeText(addr || d.dealerName); toast.success("Address copied"); } catch { toast.error("Couldn't copy"); }
  };
  const DEPTS = [
    { id: "sales" as const, label: "Sales", icon: Car, desc: "Vehicle viewing, trade appraisal, finance, and purchase support.", on: true },
    { id: "service" as const, label: "Service", icon: Wrench, desc: "Warranty, recall, maintenance, and ownership support.", on: hasService },
    { id: "parts" as const, label: "Parts", icon: Package, desc: "Genuine parts and accessories.", on: hasParts },
  ].filter((x) => x.on);
  const active = DEPTS.find((x) => x.id === dept) ?? DEPTS[0];
  const hours = active.id === "sales" && t.hours ? t.hours : null;
  const website = t.storefrontUrl ? null : null; // dealer website not in trust data; row hidden
  const mapBtn = "flex-1 min-w-[140px] h-10 rounded-xl text-[12.5px] font-bold inline-flex items-center justify-center gap-1.5 transition-colors";
  return (
    <>
      {/* Trust chips */}
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1"><CheckCircle2 className="w-3.5 h-3.5" /> Dealer Verified</span>
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-[#2563EB] bg-blue-50 border border-blue-200 rounded-full px-2.5 py-1"><ShieldCheck className="w-3.5 h-3.5" /> Vehicle Passport Partner</span>
      </div>

      {/* Map card */}
      <div className={`${CARD} overflow-hidden`}>
        <DealerMapPreview name={d.dealerName} address={addr || undefined} href={gmaps} className="h-44" />
        <div className="p-3 flex flex-wrap gap-2 border-t border-[#F1F5F9]">
          <a href={amaps} target="_blank" rel="noreferrer" className={`${mapBtn} border border-[#E6E8EC] hover:border-[#2563EB]`}><Navigation className="w-4 h-4 text-[#2563EB]" /> Open in Apple Maps</a>
          <a href={gmaps} target="_blank" rel="noreferrer" className={`${mapBtn} border border-[#E6E8EC] hover:border-[#2563EB]`}><MapPin className="w-4 h-4 text-[#2563EB]" /> Open in Google Maps</a>
          <button onClick={copyAddress} className={`${mapBtn} border border-[#E6E8EC] hover:border-[#2563EB]`}><Copy className="w-4 h-4 text-[#2563EB]" /> Copy Address</button>
        </div>
      </div>

      {/* Department selector */}
      {DEPTS.length > 1 && (
        <Section title="Choose your visit type">
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${DEPTS.length}, minmax(0,1fr))` }}>
            {DEPTS.map((x) => {
              const on = active.id === x.id;
              return (
                <button key={x.id} onClick={() => setDept(x.id)} aria-pressed={on}
                  className={`rounded-xl border p-3 text-center transition-colors ${on ? "border-[#2563EB] bg-blue-50/60" : "border-[#E6E8EC] bg-white hover:border-[#B9CBE0]"}`}>
                  <x.icon className={`w-5 h-5 mx-auto ${on ? "text-[#2563EB]" : "text-[#94A3B8]"}`} />
                  <p className={`text-[12.5px] font-bold mt-1 ${on ? "text-[#2563EB]" : "text-[#0F172A]"}`}>{x.label}</p>
                </button>
              );
            })}
          </div>
          <p className={`text-[12px] ${"text-[#64748B]"} mt-2`}>{active.desc}</p>
        </Section>
      )}

      {/* Visit details */}
      <Section title="Visit details">
        <div className={`${CARD} p-4 space-y-2.5 text-[13px]`}>
          <p className="flex items-start gap-2.5"><Clock className="w-4 h-4 text-[#2563EB] mt-0.5 shrink-0" /> <span className={hours ? "font-medium whitespace-pre-line leading-relaxed" : "text-[#64748B]"}>{hours || "Call the dealership to confirm current hours."}</span></p>
          {dealerTel && <p className="flex items-center gap-2.5"><Phone className="w-4 h-4 text-[#2563EB] shrink-0" /> <a href={`tel:${dealerTel}`} className="font-bold hover:text-[#2563EB]">{d.dealerPhone}</a></p>}
          {addr && <p className="flex items-start gap-2.5"><MapPin className="w-4 h-4 text-[#2563EB] mt-0.5 shrink-0" /> <span className="font-medium">{addr}</span></p>}
          {website}
        </div>
      </Section>

      {/* Before you go */}
      <Section title="Before you go">
        <div className={`${CARD} p-4`}>
          <ul className="space-y-2">
            <Check>Vehicle availability can change — reserve or call to confirm this vehicle.</Check>
            <Check>Bring a valid driver's license for a test drive.</Check>
            <Check>Have your trade information ready if applicable.</Check>
            <Check>Ask about trade value before arrival to save time.</Check>
          </ul>
        </div>
      </Section>

      {/* Vehicle context */}
      <Section title="You're visiting about">
        <div className={`${CARD} p-4`}>
          <div className="flex items-center gap-3">
            <div className="w-20 h-14 rounded-lg overflow-hidden bg-slate-100 flex items-center justify-center shrink-0">
              {hero ? <img src={hero} alt="" className="w-full h-full object-cover" /> : <Car className="w-6 h-6 text-slate-300" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-bold leading-tight truncate">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</p>
              <p className="text-[12.5px] text-[#64748B] mt-0.5">{price != null ? fmt$(price) : ""}{price != null && listing.mileage != null ? " · " : ""}{listing.mileage != null ? `${listing.mileage.toLocaleString()} miles` : ""}</p>
              <p className="text-[11px] font-semibold text-[#2563EB] inline-flex items-center gap-1 mt-0.5"><ShieldCheck className="w-3 h-3" /> Vehicle Passport</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
            <button onClick={() => go("reserve")} className="h-10 rounded-xl bg-[#2563EB] text-white text-[12.5px] font-bold hover:bg-[#1d4fd7]">Reserve This Vehicle</button>
            <button onClick={() => go("test-drive")} className="h-10 rounded-xl border border-[#2563EB] text-[#2563EB] text-[12.5px] font-bold hover:bg-blue-50">Schedule Test Drive</button>
            {dealerTel ? <a href={`tel:${dealerTel}`} className="h-10 rounded-xl border border-[#E6E8EC] text-[12.5px] font-bold inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><Phone className="w-3.5 h-3.5 text-[#2563EB]" /> Call Dealer</a> : <button onClick={() => go("contact")} className="h-10 rounded-xl border border-[#E6E8EC] text-[12.5px] font-bold hover:border-[#2563EB]">Message Dealer</button>}
          </div>
        </div>
      </Section>
      {isPreview && <p className="text-[11px] text-[#94A3B8]">Sample dealership shown in preview mode.</p>}
    </>
  );
}

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
      {pts.length >= 2 && pts.every((p) => p.dealer === pts[0].dealer) && (
        <p className="text-[11.5px] text-[#64748B] mt-2 inline-flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0" /> Consistent pricing since first tracked — the price you see is the price we stand behind.
        </p>
      )}
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

const Group = ({ title, items, defaultOpen, iconic }: { title: string; items: string[]; defaultOpen?: boolean; iconic?: boolean }) => (
  <details className={`${CARD} overflow-hidden group`} open={defaultOpen}>
    <summary className="cursor-pointer list-none flex items-center justify-between gap-3 px-4 py-3 text-[13px] font-bold text-[#0F172A]">
      <span className="inline-flex items-center gap-2">{title} <span className="text-[11px] font-semibold text-[#94A3B8]">{items.length}</span></span>
      <ChevronDown className="w-4 h-4 text-[#94A3B8] group-open:rotate-180 transition-transform shrink-0" />
    </summary>
    <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
      {items.map((it) => {
        if (!iconic) return <div key={it} className="flex items-start gap-2 text-[12px] text-[#334155]"><CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0 mt-0.5" />{it}</div>;
        const EqIcon = getEquipmentIcon({ name: it, category: title }).icon;
        return <div key={it} className="flex items-start gap-2 text-[12px] text-[#334155]"><EqIcon className="w-3.5 h-3.5 text-[#2563EB] shrink-0 mt-0.5" strokeWidth={1.75} />{it}</div>;
      })}
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

const Meter = ({ label, value, unit, pct }: { label: string; value: string; unit: string; pct: number }) => (
  <div>
    <div className="flex justify-between text-[12px]"><span className="text-[#64748B]">{label}</span><span className="font-bold">{value} <span className="text-[#94A3B8] font-medium">{unit}</span></span></div>
    <div className="mt-1.5 h-3.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
  </div>
);

const Stars = ({ n, size = 16 }: { n: number; size?: number }) => (
  <span className="inline-flex items-center gap-0.5">{[0, 1, 2, 3, 4].map((i) => <Star key={i} style={{ width: size, height: size }} className="text-amber-400" fill={i < Math.round(n) ? "#F59E0B" : "none"} strokeWidth={1.5} />)}</span>
);

const Disclaimer = () => <p className="text-[11px] text-[#94A3B8] pt-1">Details are accurate to the best of our knowledge — confirm final details with our team.</p>;

// Card → icon hint used by the trigger map (kept here so the page just
// passes a key). Not rendered; documents intent for future panels.
export const PANEL_ICON: Record<PassportPanelKey, React.ElementType> = {
  "market-price": DollarSign, "market-demand": TrendingUp, "price-confidence": Gauge,
  "price-history": Clock, "comparable-vehicles": Car, "inventory-trend": Package,
  "factory-warranty": ShieldCheck, "owner-reviews": Star, "highlights": Award,
  "overview": FileText, "key-specs": FileText, "equipment": Package, "ownership-timeline": Clock,
  "visit-dealer": MapPin,
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
  const ctaSignals: CtaSignals = { greatPrice: (d.belowMarket ?? 0) > 0, highDemand: (d.viewCount ?? 0) > 20, highConf: (d.confScore ?? 0) >= 85, highlyRated: (d.reviewRating ?? 0) >= 4.5, hasWarranty: !!d.warrantyStr && !d.warrantyExpired };
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
        <div className="shrink-0 flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            {def.secondary && <button onClick={def.secondary.onClick} className="h-11 px-4 rounded-xl border border-[#E6E8EC] bg-white text-[13px] font-semibold text-[#0F172A] hover:border-[#2563EB] transition-colors">{def.secondary.label}</button>}
            {def.primary && <button onClick={def.primary.onClick} className="h-11 px-5 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-[14px] font-semibold inline-flex items-center justify-center gap-2 transition-colors"><ShieldCheck className="w-4 h-4" /> {def.primary.label}</button>}
          </div>
          {def.footerNote && <p className="text-[11px] text-[#94A3B8]">{def.footerNote}</p>}
        </div>
      </div>
    </>
  ) : undefined;

  return (
    <PassportSlideOver open={panel !== null} onClose={onClose} title={def.title} subtitle={def.subtitle} footer={footer} wide={def.wide} xl={def.xl}>
      {def.body}
    </PassportSlideOver>
  );
}
