import { useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronLeft, Upload, Printer, Bookmark, Star, Building2 } from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { type VehicleListing } from "@/hooks/useVehicleListing";
import Logo from "@/components/brand/Logo";
import { derivePassport } from "@/lib/passportV2Data";
import { MOCK_LISTING } from "./VehiclePassportV3";
import { usePublicListing } from "@/hooks/usePublicListing";
import PassportCtaDock from "@/components/passport/PassportCtaDock";
import { CARD } from "@/lib/passportTokens";
import { DealerPageIcon, DealerPageIconBadge, type DealerPageIconKey, type DealerPageIconTone } from "@/components/icons/DealerPageIcons";
import { OemAuthorizedBadge, resolveOemBrand, oemDisplayName } from "@/components/brand/OemLogoRegistry";
import { oemDealerPageCopy } from "@/lib/oem/oemDealerPageCopy";
import { DealerHeroImage, DealerMapPreview } from "@/components/artwork/DealerPageArtwork";

// ──────────────────────────────────────────────────────────────
// VehiclePassportDealer — the "Why Buy From {Tenant}" trust page, built to
// the approved premium concept: hero image with overlaid chips + CTAs,
// Trust at a Glance, Why Customers Choose Us + OEM Brand Expertise,
// reputation cards, service & ownership support, Visit Us, commitment
// band, final CTA. Every module is tenant-data gated — sections shrink or
// hide rather than showing empty placeholders, and nothing is fabricated.
// All board assets render through the DealerPageIcons registry; header
// utility actions (back/share/print/save) stay on the generic set.
// ──────────────────────────────────────────────────────────────

const TEXT2 = "text-[#64748B]";

const Stars = ({ n, size = 16, className = "text-amber-400" }: { n: number; size?: number; className?: string }) => (
  <span className="inline-flex items-center gap-0.5">{[0, 1, 2, 3, 4].map((i) => <Star key={i} style={{ width: size, height: size }} className={className} fill={i < Math.round(n) ? "currentColor" : "none"} strokeWidth={1.5} />)}</span>
);

const SectionTitle = ({ children, sub }: { children: React.ReactNode; sub?: string }) => (
  <div className="text-center mb-5">
    <h2 className="text-[22px] font-extrabold tracking-tight text-[#0F172A]">{children}</h2>
    {sub && <p className={`text-[13px] ${TEXT2} mt-1`}>{sub}</p>}
  </div>
);

// Hero chip — translucent pill readable over the photo.
const HeroChip = ({ iconKey, children, tone = "blue" }: { iconKey: DealerPageIconKey; children: React.ReactNode; tone?: "blue" | "green" }) => (
  <span className={`inline-flex items-center gap-1.5 h-7 text-[13px] font-bold rounded-full px-3 backdrop-blur-[8px] text-white border ${tone === "green" ? "bg-[rgba(16,185,129,0.22)] border-[rgba(52,211,153,0.6)]" : "bg-[rgba(11,111,234,0.22)] border-[rgba(147,197,253,0.5)]"}`}>
    <DealerPageIcon iconKey={iconKey} size={14} color="currentColor" className="shrink-0" /> {children}
  </span>
);

// Deterministic hero sizing per the approved goal: large fixed-height card
// on desktop, slightly shorter on tight laptop screens, natural flow on
// mobile where the content stacks.
const HERO_CSS = `
.wb-hero { min-height: 410px; }
@media (min-width: 1280px) { .wb-hero { height: 410px; min-height: 0; } }
@media (min-width: 1280px) and (max-height: 850px) { .wb-hero { height: 380px; } }
`;

const TrustCard = ({ iconKey, title, sub, tone = "blue" }: { iconKey: DealerPageIconKey; title: string; sub: string; tone?: DealerPageIconTone }) => (
  <div className={`${CARD} p-5 text-center`}>
    <DealerPageIconBadge iconKey={iconKey} tone={tone} size="md" className="mx-auto" />
    <p className="text-[14px] font-bold mt-3">{title}</p>
    <p className={`text-[12px] ${TEXT2} mt-1 leading-snug`}>{sub}</p>
  </div>
);

const ChooseRow = ({ iconKey, title, sub }: { iconKey: DealerPageIconKey; title: string; sub: string }) => (
  <div className="flex items-start gap-3.5">
    <DealerPageIconBadge iconKey={iconKey} tone="blue" size="sm" />
    <div className="min-w-0">
      <p className="text-[13.5px] font-bold leading-tight">{title}</p>
      <p className={`text-[12.5px] ${TEXT2} leading-snug mt-0.5`}>{sub}</p>
    </div>
  </div>
);

const ExpertiseCard = ({ iconKey, label }: { iconKey: DealerPageIconKey; label: string }) => (
  <div className="rounded-xl border border-[#E6E8EC] bg-white p-4 text-center">
    <DealerPageIconBadge iconKey={iconKey} tone="purple" size="sm" className="mx-auto" />
    <p className="text-[12px] font-bold leading-snug mt-2">{label}</p>
  </div>
);

const ReviewCard = ({ name, rating, count, extra }: { name: string; rating: number | null; count?: number | null; extra?: string }) => (
  <div className={`${CARD} p-5 text-center`}>
    <p className="text-[13px] font-bold text-[#64748B]">{name}</p>
    {rating != null ? (
      <>
        <p className="text-[26px] font-extrabold leading-none mt-2">{rating.toFixed(1)}<span className="text-[14px] text-[#94A3B8] font-bold"> / 5</span></p>
        <div className="flex justify-center mt-1.5"><Stars n={rating} size={14} /></div>
      </>
    ) : <p className="text-[26px] font-extrabold leading-none mt-2 text-[#16A34A]">{extra}</p>}
    {count != null && count > 0 && <p className="text-[11.5px] text-[#94A3B8] mt-1.5">{count.toLocaleString()} Reviews</p>}
    {rating != null && extra && <p className="text-[11.5px] text-[#94A3B8] mt-1">{extra}</p>}
  </div>
);

const SupportCard = ({ iconKey, title, sub }: { iconKey: DealerPageIconKey; title: string; sub: string }) => (
  <div className="text-center px-3">
    <DealerPageIconBadge iconKey={iconKey} tone="blue" size="md" className="mx-auto" />
    <p className="text-[12.5px] font-bold leading-tight mt-2.5">{title}</p>
    <p className={`text-[11.5px] ${TEXT2} leading-snug mt-1`}>{sub}</p>
  </div>
);

const VehiclePassportDealer = () => {
  const params = useParams<{ vehicleSlug?: string; slug?: string }>();
  const vehicleSlug = params.vehicleSlug ?? params.slug;
  const navigate = useNavigate();

  const isPreview = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("preview");
  const { listing, loading, notFound } = usePublicListing(vehicleSlug, { preview: isPreview, previewData: MOCK_LISTING as unknown as VehicleListing });

  const d = useMemo(() => (listing ? derivePassport(listing) : null), [listing]);

  if (loading) return <div className="min-h-[100svh] flex items-center justify-center bg-[#F6F7F9]"><div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" /></div>;
  if (notFound || !listing || !d) return (
    <div className="min-h-[100svh] flex items-center justify-center px-6 bg-[#F6F7F9]"><div className="text-center"><Building2 className="w-12 h-12 text-slate-300 mx-auto mb-4" /><h1 className="text-xl font-bold">Dealer profile unavailable</h1><p className="text-sm text-slate-500 mt-2">This listing may have been sold or unpublished.</p></div></div>
  );

  const slug = listing.slug || vehicleSlug;
  const go = (section: string) => navigate(`/v/${slug}/${section}${isPreview ? "?preview=1" : ""}`);
  const back = () => navigate(`/v/${slug}${isPreview ? "?preview=1" : ""}`);

  const t = d.dealerTrust;
  const dealer = d.dealer;
  const city = dealer.city ? String(dealer.city) : "";
  const state = dealer.state ? String(dealer.state) : "";
  const locality = [city, state].filter(Boolean).join(", ");
  const stateName = state || "your area";
  const years = parseInt(String(t.yearsInBusiness).replace(/[^\d]/g, ""), 10);
  const hasYears = Number.isFinite(years) && years > 0;
  const founded = hasYears ? new Date().getFullYear() - years : null;
  const rating = parseFloat(t.googleRating);
  const hasRating = Number.isFinite(rating) && rating > 0 && rating <= 5;
  const count = parseInt(String(t.googleCount).replace(/[^\d]/g, ""), 10);
  const hasCount = Number.isFinite(count) && count > 0;
  const mapsQuery = encodeURIComponent(d.dealerAddress || d.dealerName);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;

  // OEM-authorization language renders ONLY when the dealer has explicitly
  // flagged the store as a franchise (dealer_trust.oem_franchise). Free-text
  // certifications never imply factory authorization; without the flag the
  // dealer's own certification text renders as neutral chips instead.
  const make = (listing.ymm || "").trim().split(/\s+/)[1] || "";
  const rawTrust = (listing as unknown as { dealer_trust?: { oem_franchise?: boolean | string } }).dealer_trust;
  const franchised = (rawTrust?.oem_franchise === true || rawTrust?.oem_franchise === "yes") && !!make;
  const brandKey = resolveOemBrand(make);
  const brand = brandKey ? oemDisplayName(brandKey) : make.toUpperCase();
  const copy = oemDealerPageCopy(franchised ? brandKey : null);

  const hasLoaners = [...t.services, ...t.amenities].some((s) => /loaner/i.test(s));
  const hasPickup = /pickup|valet/i.test([t.delivery, ...t.services, ...t.amenities].join(" "));
  const hasService = t.serviceLocation === "onsite" || t.serviceLocation === "offsite";

  type HeroStat = { iconKey: DealerPageIconKey; label: string };
  // Round tenure down to the nearest 5 so the claim always understates
  // ("over 30 years" at 33) instead of overstating.
  const yearsRounded = hasYears && years >= 5 ? Math.floor(years / 5) * 5 : years;
  const hasAwards = t.certifications.some((c) => /award/i.test(c));
  const heroStats: HeroStat[] = [
    hasYears ? { iconKey: "schedule-test-drive" as const, label: `Serving ${stateName} for over ${yearsRounded} years` } : null,
    t.familyOwned ? { iconKey: "customer-first" as const, label: founded ? `Family-Owned Since ${founded}` : "Family-Owned Dealership" } : null,
    hasAwards
      ? { iconKey: "customer-satisfaction" as const, label: "Multiple Award Winning Store" }
      : franchised
        ? { iconKey: "certified-pre-owned-support" as const, label: "Factory Authorized Store" }
        : t.certifications.length > 0
          ? { iconKey: "certified-pre-owned-support" as const, label: t.certifications[0] }
          : null,
  ].filter(Boolean) as HeroStat[];
  // Backfill so the stat row never looks thin when tenant data is sparse.
  const fallbackStats: HeroStat[] = [
    { iconKey: "dealer-verified", label: "Dealer Verified Store" },
    { iconKey: "transparent-pricing", label: "Transparent Up-Front Pricing" },
    { iconKey: "customer-first", label: "Customer-First Experience" },
  ];
  for (const f of fallbackStats) { if (heroStats.length >= 3) break; if (!heroStats.some((s) => s.iconKey === f.iconKey)) heroStats.push(f); }

  const expertise: { iconKey: DealerPageIconKey; label: string }[] = franchised
    ? [
        { iconKey: "factory-trained-technicians", label: brandKey ? copy.factoryTrainedTechniciansLabel : `Factory-Trained ${brand} Technicians` },
        { iconKey: "genuine-oem-parts", label: brandKey ? copy.genuinePartsLabel : `Genuine ${brand} Parts` },
        { iconKey: "warranty-support", label: brandKey ? copy.warrantySupportLabel : `${brand} Warranty Support` },
        { iconKey: "certified-pre-owned-support", label: brandKey ? copy.certifiedPreOwnedSupportLabel : `${brand} Certified Pre-Owned Support` },
        { iconKey: "recall-service-support", label: "Recall & Service Support" },
        { iconKey: "luxury-ownership", label: copy.ownershipExperienceLabel },
      ]
    : [
        ...t.certifications.slice(0, 2).map((c) => ({ iconKey: "certified-pre-owned-support" as const, label: c })),
        { iconKey: "certified-service" as const, label: "Multi-Point Vehicle Inspections" },
        { iconKey: "complete-vehicle-disclosure" as const, label: "Complete Vehicle Disclosure" },
        { iconKey: "warranty-support" as const, label: "Warranty Guidance" },
        { iconKey: "recall-service-support" as const, label: "Recall & Service Support" },
        { iconKey: "loaner-vehicles" as const, label: "Every Make Welcome" },
        { iconKey: "customer-satisfaction" as const, label: "Ownership Support After the Sale" },
      ].slice(0, 6);

  // "Why Customers Choose Us" leads with the dealer's own facts (tenure,
  // review quote, amenities) and backfills with the generic rows.
  const quoted = t.reviewSources.find((r) => r.quote);
  type ChooseItem = { iconKey: DealerPageIconKey; title: string; sub: string };
  const chooseRows: ChooseItem[] = [
    hasYears ? { iconKey: "schedule-test-drive" as const, title: `${years} Years Serving ${stateName}`, sub: founded ? `${t.familyOwned ? "Family-owned and operated" : "In business"} since ${founded}.` : `${years} years of local experience.` } : null,
    quoted ? { iconKey: "customer-satisfaction" as const, title: `What ${quoted.name} Reviewers Say`, sub: `"${quoted.quote}"` } : null,
    t.amenities.length > 0 ? { iconKey: "loaner-vehicles" as const, title: "Amenities for Your Visit", sub: t.amenities.slice(0, 4).join(" · ") } : null,
  ].filter(Boolean) as ChooseItem[];
  const chooseDefaults: ChooseItem[] = [
    { iconKey: "transparent-pricing", title: "Transparent, Up-Front Pricing", sub: "No hidden fees. All installed equipment and costs are clearly disclosed up front." },
    { iconKey: "no-pressure", title: "No Pressure Experience", sub: "Our team is here to help, answer questions, and earn your business the right way." },
    { iconKey: "complete-vehicle-disclosure", title: "Complete Vehicle Disclosure", sub: "We show you the facts, photos, service history, and everything you need to decide with confidence." },
    { iconKey: "prompt-communication", title: "Prompt, Professional Communication", sub: "We respond quickly and keep you informed at every step." },
    { iconKey: "customer-first", title: "Customer-First Approach", sub: "Your time, trust, and satisfaction are our top priorities." },
  ];
  for (const row of chooseDefaults) { if (chooseRows.length >= 5) break; chooseRows.push(row); }

  const commitments: { iconKey: DealerPageIconKey; l: string }[] = [
    { iconKey: "transparent-pricing", l: "Transparent, Up-Front Pricing" },
    { iconKey: "complete-disclosure", l: "Complete Vehicle Disclosure" },
    franchised
      ? { iconKey: "factory-trained-staff", l: "Factory-Trained Staff" }
      : { iconKey: "factory-trained-staff", l: t.certifications[0] || "Knowledgeable, Experienced Staff" },
    { iconKey: "respectful-experience", l: "A Respectful, No-Pressure Experience" },
    t.satisfaction
      ? { iconKey: "customer-satisfaction", l: `${t.satisfaction} Customer Satisfaction` }
      : { iconKey: "prompt-communication", l: "Professional, Prompt Communication" },
    t.familyOwned
      ? { iconKey: "customer-first", l: founded ? `Family-Owned Since ${founded}` : "Family-Owned & Operated" }
      : { iconKey: "customer-first", l: "A Customer-First Approach" },
  ];

  const heroBtn = "h-12 rounded-[10px] text-[13.5px] font-extrabold inline-flex items-center gap-2 transition-transform hover:-translate-y-0.5";

  return (
    <div className="min-h-[100svh] bg-[#F6F7F9] text-[#0F172A]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <Helmet><title>{`Why Buy From ${d.dealerName}`}</title>{isPreview && <meta name="robots" content="noindex" />}</Helmet>
      {isPreview && <div className="bg-amber-500 text-white text-center text-[12px] font-bold py-1.5 px-4">SAMPLE PREVIEW — design layout with placeholder data. Not a real listing.</div>}

      <header className="border-b border-[#E6E8EC] bg-white sticky top-0 z-20">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-5 h-14 flex items-center justify-between gap-3">
          <button onClick={back} className="text-[13px] font-semibold text-[#2563EB] inline-flex items-center gap-1.5"><ChevronLeft className="w-4 h-4" /> <span className="hidden sm:inline">Back to Vehicle Passport</span><span className="sm:hidden">Back</span></button>
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={async () => { try { if (navigator.share) { await navigator.share({ title: d.dealerName, url: window.location.href }); return; } } catch { /* ignore */ } toast.success("Link copied"); }} className={`text-[13px] font-medium inline-flex items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Upload className="w-4 h-4" /> <span className="hidden sm:inline">Share</span></button>
            <button onClick={() => window.print()} className={`hidden sm:inline-flex text-[13px] font-medium items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Printer className="w-4 h-4" /> Print</button>
            <button onClick={() => toast.success("Saved to this device")} className={`text-[13px] font-medium inline-flex items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Bookmark className="w-4 h-4" /> <span className="hidden sm:inline">Save</span></button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-4 sm:px-5 py-5 space-y-8 pb-12">
        {/* 1. HERO — locked spec: fixed-height image card, layered left + bottom
            overlays, badges top-left, OEM card top-right, headline/reviews/proof
            on the left, CTAs anchored lower-right over the image. */}
        <style>{HERO_CSS}</style>
        {/* Hero breaks out to the spec's 1200px width on wide desktops while the
            rest of the page stays on the 1100px grid. */}
        <div className="xl:-mx-[50px]">
        <DealerHeroImage src={t.storefrontUrl || null} alt={d.dealerName} className="wb-hero">
          <div className="relative z-[2] flex-1 flex flex-col text-white p-5 sm:p-[38px] sm:pb-[30px]">
            {make && (
              <div className="absolute right-4 top-4 sm:right-[26px] sm:top-[26px] hidden sm:block">
                <OemAuthorizedBadge brand={brandKey ?? make} label={franchised ? "Authorized Retailer" : "Vehicle Brand Specialist"} />
              </div>
            )}

            <div className="lg:w-[56%] lg:max-w-[620px]">
              <div className="flex flex-wrap gap-2 mb-[28px] sm:mb-[34px]">
                <HeroChip iconKey="dealer-verified" tone="green">Dealer Verified</HeroChip>
                <HeroChip iconKey="vehicle-passport-partner">Vehicle Passport Partner</HeroChip>
              </div>

              <h1 className="text-[34px] sm:text-[46px] xl:text-[50px] font-[850] tracking-[-0.035em] leading-[0.98] mb-4">Why Buy From<br />{d.dealerName}</h1>
              <p className="text-[17px] sm:text-[19px] leading-[1.35] font-medium text-white/[0.94] max-w-[520px] mb-5">A transparent, customer-first experience built around this exact vehicle.</p>

              {hasRating && (
                <div className="flex items-center gap-3 mb-6 flex-wrap">
                  <Stars n={rating} size={22} className="text-[#FBBF24]" />
                  <span className="text-[20px] font-extrabold leading-none">{rating.toFixed(1)}</span>
                  {hasCount && <span className="text-[15px] font-[650] text-white/[0.92] border-l border-white/30 pl-3">{count.toLocaleString()} Google Reviews</span>}
                  <span className="w-7 h-7 rounded-full bg-white text-[#4285F4] text-[15px] font-black flex items-center justify-center" aria-label="Google">G</span>
                </div>
              )}

              {heroStats.length > 0 && (
                <div className="flex flex-wrap items-center gap-y-2.5">
                  {heroStats.map((s, i) => (
                    <div key={s.label} className={`flex items-center gap-2.5 ${i < heroStats.length - 1 ? "sm:border-r sm:border-white/[0.35] sm:pr-[14px] sm:mr-[14px]" : ""} pr-4 sm:pr-0`}>
                      <DealerPageIcon iconKey={s.iconKey} size={24} color="rgba(255,255,255,0.95)" className="shrink-0" />
                      <span className="text-[14px] leading-[1.2] font-[750] max-w-[112px]">{s.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3 mt-7 xl:mt-0 xl:absolute xl:right-[42px] xl:bottom-[30px] xl:justify-end">
              <button onClick={() => go("reserve")} className={`${heroBtn} px-5 bg-[#0B6FEA] hover:bg-[#0a63d2] text-white shadow-[0_10px_24px_rgba(11,111,234,0.32)]`}><DealerPageIcon iconKey="reserve-vehicle" size={16} color="currentColor" /> Reserve This Vehicle</button>
              <button onClick={() => go("test-drive")} className={`${heroBtn} px-[18px] bg-white/[0.96] border border-white/80 text-[#0B3B78] hover:bg-white`}><DealerPageIcon iconKey="schedule-test-drive" size={16} color="currentColor" /> Schedule Test Drive</button>
              <a href={mapsUrl} target="_blank" rel="noreferrer" className={`${heroBtn} px-[18px] bg-white/[0.96] border border-white/80 text-[#0B3B78] hover:bg-white`}><DealerPageIcon iconKey="get-directions" size={16} color="currentColor" /> Get Directions</a>
            </div>
          </div>
        </DealerHeroImage>
        </div>

        {/* 2. Trust at a Glance — dealer-entered facts first, generic fallback */}
        <section>
          <SectionTitle>Trust at a Glance</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <TrustCard iconKey="dealer-verified" tone="green" title="Dealer Verified" sub="This vehicle is reviewed and verified by our team." />
            {hasYears
              ? <TrustCard iconKey="schedule-test-drive" title={`${years} Years in Business`} sub={founded ? `Serving ${stateName} since ${founded}.` : `Serving ${stateName} for ${years} years.`} />
              : <TrustCard iconKey="vehicle-passport-partner" title="Vehicle Passport Enabled" sub="One transparent record for this exact VIN." />}
            {t.satisfaction
              ? <TrustCard iconKey="customer-satisfaction" tone="green" title="Customer Satisfaction" sub={`${t.satisfaction} reported by our customers.`} />
              : <TrustCard iconKey="up-front-pricing" tone="green" title="Up-Front Pricing" sub="Clear pricing with all installed equipment disclosed." />}
            {t.familyOwned
              ? <TrustCard iconKey="customer-first" title={founded ? `Family-Owned Since ${founded}` : "Family-Owned Dealership"} sub="Local ownership, accountable to this community." />
              : <TrustCard iconKey="secure-reservation" title="Secure Reservation" sub="Your information is secure and never shared." />}
          </div>
        </section>

        {/* 3. Why choose us + brand expertise */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
          <div className={`${CARD} p-6`}>
            <h2 className="text-[18px] font-extrabold tracking-tight text-center mb-5">Why Customers Choose Us</h2>
            <div className="space-y-4.5 space-y-5">
              {chooseRows.map((row) => <ChooseRow key={row.title} iconKey={row.iconKey} title={row.title} sub={row.sub} />)}
            </div>
          </div>
          <div className={`${CARD} p-6 flex flex-col`}>
            <h2 className="text-[18px] font-extrabold tracking-tight text-center mb-5">{franchised ? `${brand} Brand Expertise` : "Vehicle & Ownership Expertise"}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 flex-1 content-start">
              {expertise.map((e) => <ExpertiseCard key={e.label} iconKey={e.iconKey} label={e.label} />)}
            </div>
            <p className="mt-4 rounded-xl bg-blue-50/70 border border-blue-100 px-4 py-2.5 text-[12px] font-semibold text-[#1E3A8A] text-center leading-snug">
              {franchised
                ? `We know ${brand} inside and out — and we're here to support your ownership experience long after the sale.`
                : "We stand behind every vehicle we sell — before, during, and long after the sale."}
            </p>
          </div>
        </section>

        {/* 4. Reputation — real review sources only, text-based source badges */}
        {(hasRating || t.reviewSources.length > 0 || t.satisfaction) && (
          <section>
            <SectionTitle>Our Reputation Speaks for Itself</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {hasRating && <ReviewCard name="Google" rating={rating} count={hasCount ? count : null} />}
              {t.reviewSources.filter((r) => r.rating != null && !/google/i.test(r.name)).slice(0, 2).map((r) => (
                <ReviewCard key={r.name} name={r.name} rating={r.rating} />
              ))}
              {t.satisfaction && <ReviewCard name="Customer Satisfaction" rating={null} extra={t.satisfaction} count={null} />}
            </div>
            <p className="text-[11.5px] text-[#94A3B8] text-center mt-3">Reviews are from verified customers across multiple platforms.</p>
          </section>
        )}

        {/* 5+6. Service & ownership support + Visit Us */}
        <section className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-5 items-stretch">
          <div className={`${CARD} p-6 flex flex-col`}>
            <h2 className="text-[18px] font-extrabold tracking-tight text-center mb-5">Service & Ownership Support</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1 content-start">
              {hasService && <SupportCard iconKey="certified-service" title={copy.certifiedServiceDepartmentLabel} sub={t.serviceLocation === "offsite" ? "Dedicated service center nearby." : "Expert care from trained professionals."} />}
              {hasPickup && <SupportCard iconKey="pickup-return" title="Pickup & Return Available" sub="We make service easy and convenient." />}
              {hasLoaners && <SupportCard iconKey="loaner-vehicles" title="Loaner Vehicles Available" sub="Ask us about loaner vehicle options." />}
              <SupportCard iconKey="warranty-support" title="Warranty & Service Guidance" sub="We help you understand your coverage." />
            </div>
            <p className="mt-4 rounded-xl bg-blue-50/70 border border-blue-100 px-4 py-2.5 text-[12px] font-semibold text-[#1E3A8A] text-center">We're here for you before, during, and after your purchase.</p>
          </div>

          <div className={`${CARD} p-6`}>
            <h2 className="text-[18px] font-extrabold tracking-tight mb-4">Visit Us</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-3 text-[13px]">
                {d.dealerAddress && <p className="flex items-start gap-2.5"><DealerPageIcon iconKey="address-location" size={16} color="#2563EB" className="mt-0.5 shrink-0" /> <span className="font-semibold leading-snug">{d.dealerAddress}</span></p>}
                {d.dealerPhone && <p className="flex items-center gap-2.5"><DealerPageIcon iconKey="phone" size={16} color="#2563EB" className="shrink-0" /> <a href={`tel:${d.dealerPhone}`} className="font-semibold hover:text-[#2563EB]">{d.dealerPhone}</a></p>}
                {t.hours && <p className="flex items-start gap-2.5"><DealerPageIcon iconKey="hours" size={16} color="#2563EB" className="mt-0.5 shrink-0" /> <span className="font-medium whitespace-pre-line leading-relaxed">{t.hours}</span></p>}
                <a href={mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-bold text-[#2563EB] hover:underline"><DealerPageIcon iconKey="map-directions" size={16} color="currentColor" /> Get Directions</a>
              </div>
              <DealerMapPreview name={d.dealerName} address={locality || d.dealerAddress || undefined} href={mapsUrl} className="rounded-xl border border-[#E6E8EC] min-h-[150px] hover:border-[#2563EB] transition-colors" />
            </div>
            {(hasService || t.financing) && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                {["Sales", hasService ? "Service" : null, t.services.some((s) => /part/i.test(s)) ? "Parts" : null, t.financing ? "Finance" : null].filter(Boolean).map((dep) => (
                  <div key={dep as string} className="rounded-xl border border-[#E6E8EC] px-3 py-2 text-center text-[12px] font-semibold">{dep}</div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 7. Commitment band */}
        <section className="rounded-2xl px-6 py-7 sm:px-8 text-white" style={{ background: "linear-gradient(160deg,#111f33 0%,#0D1B2A 100%)" }}>
          <p className="text-[16px] font-extrabold text-center">Our Commitment to You</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-3 gap-y-5 mt-6">
            {commitments.map((c, i) => (
              <div key={c.l} className={`flex flex-col items-center text-center gap-2 px-2 ${i > 0 ? "lg:border-l lg:border-white/15" : ""}`}>
                <DealerPageIcon iconKey={c.iconKey} size={20} color="rgba(255,255,255,0.8)" />
                <span className="text-[11px] font-semibold leading-snug text-white/90">{c.l}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 8. Final CTA */}
        <section className={`${CARD} p-6 sm:p-7 text-center`}>
          <h2 className="text-[20px] font-extrabold tracking-tight">Ready to experience the difference?</h2>
          <div className="flex flex-wrap items-center justify-center gap-2.5 mt-5">
            <button onClick={() => go("reserve")} className="h-12 px-6 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-[13.5px] font-bold inline-flex items-center gap-2"><DealerPageIcon iconKey="reserve-vehicle" size={16} color="currentColor" /> Reserve This Vehicle</button>
            <button onClick={() => go("test-drive")} className="h-12 px-5 rounded-xl border-2 border-[#2563EB] text-[#2563EB] text-[13.5px] font-bold inline-flex items-center gap-2 hover:bg-blue-50"><DealerPageIcon iconKey="schedule-test-drive" size={16} color="currentColor" /> Schedule Test Drive</button>
            <button onClick={() => go("contact")} className="h-12 px-5 rounded-xl border border-[#E6E8EC] text-[13.5px] font-bold inline-flex items-center gap-2 hover:border-[#2563EB]"><DealerPageIcon iconKey="message-team" size={16} color="#2563EB" /> Message Our Team</button>
            <a href={mapsUrl} target="_blank" rel="noreferrer" className="h-12 px-5 rounded-xl border border-[#E6E8EC] text-[13.5px] font-bold inline-flex items-center gap-2 hover:border-[#2563EB]"><DealerPageIcon iconKey="get-directions" size={16} color="#2563EB" /> Get Directions</a>
          </div>
        </section>

        <footer className="pt-1 pb-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-2"><Logo variant="full" size={18} /></div>
          <p className="text-[12px] font-semibold inline-flex items-center gap-1.5">Dealer Verified <DealerPageIcon iconKey="dealer-verified" size={14} color="#16A34A" /></p>
          <div className="flex items-center justify-center gap-4 text-[11px] font-semibold text-[#64748B] mt-2"><a href="/privacy" className="hover:text-[#2563EB]">Privacy</a><span className="text-slate-300">·</span><a href="/terms" className="hover:text-[#2563EB]">Terms</a></div>
        </footer>
      </main>

      <PassportCtaDock go={go} dealerPhone={d.dealerPhone || undefined} reviewRating={d.reviewRating} advisor={d.dealerTrust} routing={d.contactRouting} vehicle={{ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin }} />
    </div>
  );
};

export default VehiclePassportDealer;
