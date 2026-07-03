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
const HeroChip = ({ iconKey, children, tone = "light" }: { iconKey: DealerPageIconKey; children: React.ReactNode; tone?: "light" | "green" }) => (
  <span className={`inline-flex items-center gap-1.5 text-[12px] font-bold rounded-full px-3 py-1.5 backdrop-blur-sm ${tone === "green" ? "bg-emerald-500/25 border border-emerald-300/50 text-emerald-50" : "bg-white/15 border border-white/30 text-white"}`}>
    <DealerPageIcon iconKey={iconKey} size={14} color="currentColor" className="shrink-0" /> {children}
  </span>
);

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

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-[#F6F7F9]"><div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" /></div>;
  if (notFound || !listing || !d) return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[#F6F7F9]"><div className="text-center"><Building2 className="w-12 h-12 text-slate-300 mx-auto mb-4" /><h1 className="text-xl font-bold">Dealer profile unavailable</h1><p className="text-sm text-slate-500 mt-2">This listing may have been sold or unpublished.</p></div></div>
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

  // Franchise heuristic: factory certifications on file mean this store is an
  // authorized retailer for the vehicle's make; independents get the generic
  // ownership-expertise module instead. Never claim OEM status without data.
  const make = (listing.ymm || "").trim().split(/\s+/)[1] || "";
  const franchised = t.certifications.length > 0 && !!make;
  const brandKey = resolveOemBrand(make);
  const brand = brandKey ? oemDisplayName(brandKey) : make.toUpperCase();
  const copy = oemDealerPageCopy(franchised ? brandKey : null);

  const hasLoaners = [...t.services, ...t.amenities].some((s) => /loaner/i.test(s));
  const hasPickup = /pickup|valet/i.test([t.delivery, ...t.services, ...t.amenities].join(" "));
  const hasService = t.serviceLocation === "onsite" || t.serviceLocation === "offsite";

  type HeroStat = { iconKey: DealerPageIconKey; l1: string; l2: string };
  const heroStats: HeroStat[] = [
    hasYears ? { iconKey: "schedule-test-drive" as const, l1: `Serving ${stateName}`, l2: `for over ${years} years` } : null,
    t.familyOwned ? { iconKey: "customer-satisfaction" as const, l1: "Family-Owned", l2: founded ? `Since ${founded}` : "Dealership" } : null,
    t.certifications.length > 0 ? { iconKey: "certified-pre-owned-support" as const, l1: "Factory", l2: "Authorized Store" } : null,
  ].filter(Boolean) as HeroStat[];
  // Backfill so the stat row never looks thin when tenant data is sparse.
  const fallbackStats: HeroStat[] = [
    { iconKey: "dealer-verified", l1: "Dealer", l2: "Verified" },
    { iconKey: "factory-trained-staff", l1: "Factory-Trained", l2: "Staff" },
    { iconKey: "transparent-pricing", l1: "Transparent", l2: "Up-Front Pricing" },
    { iconKey: "customer-first", l1: "Customer-First", l2: "Experience" },
    { iconKey: "vehicle-passport-partner", l1: "Vehicle Passport", l2: "Partner" },
  ];
  for (const f of fallbackStats) { if (heroStats.length >= 4) break; if (!heroStats.some((s) => s.iconKey === f.iconKey)) heroStats.push(f); }

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
        { iconKey: "certified-service", label: "Multi-Point Vehicle Inspections" },
        { iconKey: "complete-vehicle-disclosure", label: "Complete Vehicle Disclosure" },
        { iconKey: "warranty-support", label: "Warranty Guidance" },
        { iconKey: "recall-service-support", label: "Recall & Service Support" },
        { iconKey: "loaner-vehicles", label: "Every Make Welcome" },
        { iconKey: "customer-satisfaction", label: "Ownership Support After the Sale" },
      ];

  const heroBtn = "h-11 px-5 rounded-xl text-[13.5px] font-bold inline-flex items-center gap-2 transition-transform hover:-translate-y-0.5";

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#0F172A]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
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
        {/* 1. HERO — storefront photo or drawn dealership facade, chips + headline + proof + CTAs on the image */}
        <DealerHeroImage src={t.storefrontUrl || null} alt={d.dealerName} className="min-h-[380px] sm:min-h-[420px]">
          <div className="relative flex-1 flex flex-col justify-between p-5 sm:p-8 text-white">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <HeroChip iconKey="dealer-verified" tone="green">Dealer Verified</HeroChip>
                <HeroChip iconKey="vehicle-passport-partner">Vehicle Passport Partner</HeroChip>
              </div>
              {make && (
                <OemAuthorizedBadge brand={brandKey ?? make} label={franchised ? undefined : "Vehicle Brand Specialist"} className="hidden sm:inline-flex shrink-0" />
              )}
            </div>

            <div className="mt-8">
              <h1 className="text-[32px] sm:text-[42px] font-extrabold tracking-tight leading-[1.05] max-w-xl">Why Buy From<br />{d.dealerName}</h1>
              <p className="text-[14.5px] text-white/85 mt-2.5 max-w-md">A transparent, customer-first experience built around this exact vehicle.</p>

              {hasRating && (
                <div className="flex items-center gap-2.5 mt-4 flex-wrap">
                  <Stars n={rating} size={18} className="text-amber-400" />
                  <span className="text-[17px] font-extrabold">{rating.toFixed(1)}</span>
                  {hasCount && <span className="text-[13px] text-white/80 border-l border-white/30 pl-2.5">{count.toLocaleString()} Google Reviews</span>}
                </div>
              )}

              {heroStats.length > 0 && (
                <div className="flex flex-wrap items-stretch gap-x-5 gap-y-2 mt-5">
                  {heroStats.map((s, i) => (
                    <div key={s.l1} className={`flex items-center gap-2.5 ${i > 0 ? "sm:border-l sm:border-white/25 sm:pl-5" : ""}`}>
                      <DealerPageIcon iconKey={s.iconKey} size={20} color="rgba(255,255,255,0.8)" className="shrink-0" />
                      <span className="text-[12px] leading-tight font-semibold text-white/90">{s.l1}<br />{s.l2}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-2.5 mt-6">
                <button onClick={() => go("reserve")} className={`${heroBtn} bg-[#2563EB] hover:bg-[#1d4fd7] text-white shadow-lg`}><DealerPageIcon iconKey="reserve-vehicle" size={16} color="currentColor" /> Reserve This Vehicle</button>
                <button onClick={() => go("test-drive")} className={`${heroBtn} bg-white/95 text-[#0F172A] hover:bg-white`}><DealerPageIcon iconKey="schedule-test-drive" size={16} color="#2563EB" /> Schedule Test Drive</button>
                <a href={mapsUrl} target="_blank" rel="noreferrer" className={`${heroBtn} bg-white/10 border border-white/40 text-white hover:bg-white/20`}><DealerPageIcon iconKey="get-directions" size={16} color="currentColor" /> Get Directions</a>
              </div>
            </div>
          </div>
        </DealerHeroImage>

        {/* 2. Trust at a Glance */}
        <section>
          <SectionTitle>Trust at a Glance</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <TrustCard iconKey="dealer-verified" tone="green" title="Dealer Verified" sub="This vehicle is reviewed and verified by our team." />
            <TrustCard iconKey="vehicle-passport-partner" title="Vehicle Passport Enabled" sub="One transparent record for this exact VIN." />
            <TrustCard iconKey="up-front-pricing" tone="green" title="Up-Front Pricing" sub="Clear pricing with all installed equipment disclosed." />
            <TrustCard iconKey="secure-reservation" title="Secure Reservation" sub="Your information is secure and never shared." />
          </div>
        </section>

        {/* 3. Why choose us + brand expertise */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
          <div className={`${CARD} p-6`}>
            <h2 className="text-[18px] font-extrabold tracking-tight text-center mb-5">Why Customers Choose Us</h2>
            <div className="space-y-4.5 space-y-5">
              <ChooseRow iconKey="transparent-pricing" title="Transparent, Up-Front Pricing" sub="No hidden fees. All installed equipment and costs are clearly disclosed up front." />
              <ChooseRow iconKey="no-pressure" title="No Pressure Experience" sub="Our team is here to help, answer questions, and earn your business the right way." />
              <ChooseRow iconKey="complete-vehicle-disclosure" title="Complete Vehicle Disclosure" sub="We show you the facts, photos, service history, and everything you need to decide with confidence." />
              <ChooseRow iconKey="prompt-communication" title="Prompt, Professional Communication" sub="We respond quickly and keep you informed at every step." />
              <ChooseRow iconKey="customer-first" title="Customer-First Approach" sub="Your time, trust, and satisfaction are our top priorities." />
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
            {([
              { iconKey: "transparent-pricing", l: "Transparent, Up-Front Pricing" },
              { iconKey: "complete-disclosure", l: "Complete Vehicle Disclosure" },
              { iconKey: "factory-trained-staff", l: "Factory-Trained Staff" },
              { iconKey: "respectful-experience", l: "A Respectful, No-Pressure Experience" },
              { iconKey: "prompt-communication", l: "Professional, Prompt Communication" },
              { iconKey: "customer-first", l: "A Customer-First Approach" },
            ] as { iconKey: DealerPageIconKey; l: string }[]).map((c, i) => (
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
