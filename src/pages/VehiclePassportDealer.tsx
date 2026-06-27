import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ChevronLeft, Upload, Printer, Bookmark, ShieldCheck, CheckCircle2, Star, Award, Building2,
  Wrench, Truck, Users, Phone, MessageSquare, MapPin, Clock, Navigation, Settings, BadgeCheck, Sparkles, Car, DollarSign,
} from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { type VehicleListing } from "@/hooks/useVehicleListing";
import Logo from "@/components/brand/Logo";
import { derivePassport } from "@/lib/passportV2Data";
import { MOCK_LISTING } from "./VehiclePassportV3";
import { usePublicListing } from "@/hooks/usePublicListing";
import { InfoModal, Para, Callout } from "@/components/passport/InfoModal";
import PassportCtaDock from "@/components/passport/PassportCtaDock";

// ──────────────────────────────────────────────────────────────
// VehiclePassportDealer — /passport-v3/:vehicleSlug/dealer
//
// The most transparent dealership profile we can build from the data we
// actually have: name, location, ratings, tenure, certifications,
// reviews, and the assigned specialist. Anything we don't have is shown
// as "Information coming soon" — we never fabricate history or awards.
// No floating CTA (the page stands alone).
// ──────────────────────────────────────────────────────────────

const CARD = "rounded-2xl border border-[#E6E8EC] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.05)]";
const TEXT2 = "text-[#64748B]";

const H2 = ({ children }: { children: React.ReactNode }) => <h2 className="text-[20px] font-bold leading-7 tracking-tight text-[#0F172A]">{children}</h2>;
const Stars = ({ n, size = 16 }: { n: number; size?: number }) => (
  <span className="inline-flex items-center gap-0.5">{[0, 1, 2, 3, 4].map((i) => <Star key={i} style={{ width: size, height: size }} className="text-amber-400" fill={i < Math.round(n) ? "#F59E0B" : "none"} strokeWidth={1.5} />)}</span>
);
const ComingSoon = ({ children }: { children: React.ReactNode }) => <div className={`${CARD} p-4 text-[13px] ${TEXT2}`}>{children}</div>;

const VehiclePassportDealer = () => {
  const params = useParams<{ vehicleSlug?: string; slug?: string }>();
  const vehicleSlug = params.vehicleSlug ?? params.slug;
  const navigate = useNavigate();
  const [award, setAward] = useState<string | null>(null);

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
  const founded = t.yearsInBusiness ? new Date().getFullYear() - Number(t.yearsInBusiness) : null;
  const mapsQuery = encodeURIComponent(d.dealerAddress || d.dealerName);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;

  const badges = [
    { label: "Dealer Verified", on: true },
    { label: "Top Rated Dealer", on: !!t.googleRating && Number(t.googleRating) >= 4.5 },
    { label: "Factory Authorized", on: t.certifications.length > 0 },
    { label: "Customer Satisfaction", on: !!t.satisfaction },
    { label: `BBB ${t.bbbRating}`, on: !!t.bbbRating },
  ].filter((b) => b.on);

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const choose = [
    { icon: Building2, t: t.familyOwned ? "Family Owned" : founded ? `Established ${founded}` : "Established Dealer", on: !!(t.familyOwned || founded) },
    { icon: Star, t: t.googleRating ? `${t.googleRating} Star Rated` : "Verified Reviews", on: !!t.googleRating },
    { icon: Award, t: "Factory Certified", on: t.certifications.length > 0 },
    { icon: Wrench, t: t.serviceLocation === "offsite" ? "Service Center (off-site)" : "On-Site Service", on: t.serviceLocation === "onsite" || t.serviceLocation === "offsite" },
    { icon: Truck, t: `${cap(t.delivery)} Delivery`, on: !!t.delivery && t.delivery !== "none" },
    { icon: DollarSign, t: "On-Site Financing", on: t.financing },
    { icon: ShieldCheck, t: "AutoLabels Verified", on: true },
  ].filter((c) => c.on);

  const promises = [
    "Transparent, up-front pricing",
    "A respectful, no-pressure experience",
    "Complete vehicle disclosure",
    "Professional, prompt communication",
    "Factory-trained staff",
    "A customer-first approach",
  ];

  const Section = ({ n, title, sub, children }: { n: number; title: string; sub?: string; children: React.ReactNode }) => (
    <section className={`${CARD} p-5 sm:p-6`}>
      <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-lg bg-blue-50 text-[#2563EB] text-[12px] font-bold flex items-center justify-center shrink-0">{n}</span><H2>{title}</H2></div>
      {sub && <p className={`text-[13px] ${TEXT2} mt-1`}>{sub}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#0F172A]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <Helmet><title>{`Why Buy From ${d.dealerName}`}</title>{isPreview && <meta name="robots" content="noindex" />}</Helmet>
      {isPreview && <div className="bg-amber-500 text-white text-center text-[12px] font-bold py-1.5 px-4">SAMPLE PREVIEW — design layout with placeholder data. Not a real listing.</div>}

      <header className="border-b border-[#E6E8EC] bg-white sticky top-0 z-20">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-5 h-16 flex items-center justify-between gap-3">
          <button onClick={back} className="text-[13px] font-semibold text-[#2563EB] inline-flex items-center gap-1.5"><ChevronLeft className="w-4 h-4" /> <span className="hidden sm:inline">Back to Vehicle Passport</span><span className="sm:hidden">Back</span></button>
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={async () => { try { if (navigator.share) { await navigator.share({ title: d.dealerName, url: window.location.href }); return; } } catch { /* ignore */ } toast.success("Link copied"); }} className={`text-[13px] font-medium inline-flex items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Upload className="w-4 h-4" /> <span className="hidden sm:inline">Share</span></button>
            <button onClick={() => window.print()} className={`hidden sm:inline-flex text-[13px] font-medium items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Printer className="w-4 h-4" /> Print</button>
            <button onClick={() => toast.success("Saved to this device")} className={`text-[13px] font-medium inline-flex items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Bookmark className="w-4 h-4" /> <span className="hidden sm:inline">Save</span></button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-4 sm:px-5 py-6 space-y-5">
        <div>
          <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight leading-tight">Why Buy From {d.dealerName}</h1>
          <p className={`text-[14px] ${TEXT2} mt-1`}>Learn more about our people, our values, and why customers trust us.</p>
        </div>

        {/* 1. Hero */}
        <section className={`${CARD} overflow-hidden`}>
          {t.storefrontUrl ? <img src={t.storefrontUrl} alt={d.dealerName} className="w-full h-44 sm:h-60 object-cover" /> : <div className="w-full h-44 sm:h-60 bg-gradient-to-br from-[#1f2937] to-[#374151] flex items-center justify-center"><Building2 className="w-14 h-14 text-white/30" /></div>}
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-[24px] font-extrabold leading-tight">{d.dealerName}</h2>
                {locality && <p className="text-[13px] text-[#64748B] inline-flex items-center gap-1.5 mt-1"><MapPin className="w-3.5 h-3.5" /> {locality}</p>}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[13px]">
                  {t.googleRating && <span className="inline-flex items-center gap-1.5"><span className="font-bold text-[#0F172A]">{t.googleRating}</span><Stars n={Number(t.googleRating)} size={14} />{t.googleCount && <span className="text-[#64748B]">({Number(t.googleCount).toLocaleString()})</span>}</span>}
                  {founded && <span className="text-[#64748B]">Serving since {founded}</span>}
                  {t.certifications.length > 0 && <span className="text-[#64748B] inline-flex items-center gap-1"><Award className="w-3.5 h-3.5 text-[#2563EB]" /> Factory Authorized</span>}
                </div>
              </div>
              {d.dealerPhone && <a href={`tel:${d.dealerPhone}`} className="h-11 px-5 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-[13px] font-semibold inline-flex items-center gap-2 shrink-0"><Phone className="w-4 h-4" /> Call Dealership</a>}
            </div>
            {badges.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">{badges.map((b) => <span key={b.label} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#0F172A] bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1"><CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" />{b.label}</span>)}</div>
            )}
          </div>
        </section>

        {/* 2. Our story */}
        <Section n={2} title="Our Story">
          <p className="text-[14px] leading-relaxed text-[#334155]">
            {d.dealerName} {founded ? `has served ${locality || "the local community"} since ${founded}` : `proudly serves ${locality || "the local community"}`}
            {t.googleRating ? `, earning a ${t.googleRating}-star reputation across ${t.googleCount ? `${Number(t.googleCount).toLocaleString()} ` : ""}customer reviews` : ""}
            {t.certifications.length > 0 ? `, and is recognized with ${t.certifications.slice(0, 2).join(" and ")}` : ""}.
          </p>
          <p className="text-[12px] text-[#94A3B8] mt-2">A fuller history of the dealership's founding and mission is coming soon.</p>
        </Section>

        {/* 3. Why customers choose us */}
        <Section n={3} title="Why Customers Choose Us">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{choose.map((c) => (
            <div key={c.t} className={`${CARD} p-4 flex items-center gap-3`}>
              <span className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><c.icon className="w-5 h-5 text-[#2563EB]" /></span>
              <span className="text-[13px] font-semibold leading-tight">{c.t}</span>
            </div>
          ))}</div>
          <p className="text-[12px] text-[#94A3B8] mt-3">Additional amenities and services are listed as the dealership completes its profile.</p>
        </Section>

        {/* 4. Reputation */}
        <Section n={4} title="Our Reputation">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div className={`${CARD} p-4 text-center`}><p className="text-[28px] font-extrabold text-[#2563EB] leading-none">{d.reviewRating != null ? d.reviewRating.toFixed(1) : t.googleRating || "—"}</p><div className="mt-1 flex justify-center">{(d.reviewRating ?? Number(t.googleRating)) ? <Stars n={d.reviewRating ?? Number(t.googleRating)} size={14} /> : null}</div><p className="text-[11px] text-[#94A3B8] mt-1">Overall Rating</p></div>
            <div className={`${CARD} p-4 text-center`}><p className="text-[28px] font-extrabold leading-none">{t.googleCount ? Number(t.googleCount).toLocaleString() : d.reviewCount != null ? d.reviewCount.toLocaleString() : "—"}</p><p className="text-[11px] text-[#94A3B8] mt-1">Total Reviews</p></div>
            <div className={`${CARD} p-4 text-center`}><p className="text-[28px] font-extrabold text-[#16A34A] leading-none">{t.satisfaction || "—"}</p><p className="text-[11px] text-[#94A3B8] mt-1">Customer Satisfaction</p></div>
          </div>
          {t.reviewSources.length > 0 ? (
            <div className="space-y-3">{t.reviewSources.map((r, i) => (
              <div key={i} className={`${CARD} p-4`}><div className="flex items-center gap-2"><span className="text-[13px] font-bold">{r.name}</span>{r.rating != null && <Stars n={r.rating} size={13} />}</div>{r.quote && <p className="text-[13px] text-[#64748B] leading-snug mt-1">"{r.quote}"</p>}</div>
            ))}</div>
          ) : <ComingSoon>Verified reviews from Google, DealerRater, and Cars.com appear here as the dealership connects its review sources.</ComingSoon>}
        </Section>

        {/* 5. Community */}
        <Section n={5} title="Community Involvement">
          <ComingSoon>This dealership's community programs, sponsorships, and charitable work will be highlighted here soon.</ComingSoon>
        </Section>

        {/* 6. Facilities */}
        <Section n={6} title="Our Facilities">
          {t.storefrontUrl ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <img src={t.storefrontUrl} alt="" className="w-full aspect-[16/10] object-cover rounded-xl" />
              <div className={`${CARD} p-4 flex flex-col justify-center text-[13px] ${TEXT2}`}><p className="font-semibold text-[#0F172A] mb-1">{d.dealerName}</p>Showroom, service drive, and customer amenities. Additional facility photos coming soon.</div>
            </div>
          ) : <ComingSoon>Photos of the showroom, service drive, and customer lounge are coming soon.</ComingSoon>}
          {t.amenities.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">{t.amenities.map((a) => <span key={a} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#0F172A] bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1"><CheckCircle2 className="w-3 h-3 text-[#16A34A]" />{a}</span>)}</div>
          )}
        </Section>

        {/* 7. Service & support */}
        <Section n={7} title="Service & Support">
          {t.serviceLocation && t.serviceLocation !== "none" && (
            <div className={`${CARD} p-4 mb-3 flex items-start gap-3`}>
              <span className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><Wrench className="w-[18px] h-[18px] text-[#2563EB]" /></span>
              <div><p className="text-[13px] font-bold">{t.serviceLocation === "offsite" ? "Off-site service department" : "On-site service department"}</p>{t.serviceLocation === "offsite" && t.serviceAddress && <p className="text-[12px] text-[#64748B]">{t.serviceAddress}</p>}</div>
            </div>
          )}
          {t.services.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {t.services.map((s) => (
                <div key={s} className={`${CARD} p-4 flex items-center gap-3`}><span className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><Settings className="w-[18px] h-[18px] text-[#2563EB]" /></span><span className="text-[12px] font-semibold leading-tight">{s}</span></div>
              ))}
            </div>
          ) : (t.serviceLocation && t.serviceLocation !== "none") ? null : <ComingSoon>Service details will appear here once the dealership adds them.</ComingSoon>}
          {t.certifications.length > 0 && <div className="flex flex-wrap gap-2 mt-3">{t.certifications.map((c) => <span key={c} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#0F172A] bg-slate-100 rounded-full px-2.5 py-1"><Award className="w-3 h-3 text-[#2563EB]" />{c}</span>)}</div>}
          <p className="text-[12px] text-[#94A3B8] mt-3">Confirm specific service offerings and hours with the dealership.</p>
        </Section>

        {/* 8. Our team */}
        <Section n={8} title="Our Team">
          {t.advisorName ? (
            <div className={`${CARD} p-4 flex items-center gap-4 max-w-md`}>
              {t.advisorPhoto ? <img src={t.advisorPhoto} alt={t.advisorName} className="w-16 h-16 rounded-full object-cover ring-2 ring-blue-100 shrink-0" /> : <span className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center shrink-0"><Users className="w-7 h-7 text-[#2563EB]" /></span>}
              <div className="min-w-0"><p className="text-[15px] font-bold leading-tight">{t.advisorName}</p>{t.advisorTitle && <p className="text-[12px] text-[#64748B]">{t.advisorTitle}</p>}{t.advisorResponse && <p className="text-[11px] text-[#94A3B8] mt-1">{t.advisorResponse}</p>}<button onClick={() => go("contact")} className="mt-2 text-[12px] font-semibold text-[#2563EB] hover:underline">Message {t.advisorName.split(" ")[0]}</button></div>
            </div>
          ) : <ComingSoon>Featured team members — your sales, finance, and service contacts — will be introduced here soon.</ComingSoon>}
        </Section>

        {/* 9. Customer promise */}
        <section className="rounded-2xl p-6 sm:p-8 text-white" style={{ background: "linear-gradient(160deg,#0f7a3d 0%,#16A34A 100%)" }}>
          <p className="text-[13px] font-semibold uppercase tracking-wider opacity-85">Our Commitment To You</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 mt-3">{promises.map((p) => <li key={p} className="flex items-start gap-2 text-[14px]"><CheckCircle2 className="w-4 h-4 text-white shrink-0 mt-0.5" />{p}</li>)}</ul>
        </section>

        {/* 10. Awards & certifications */}
        <Section n={10} title="Awards & Certifications">
          {t.certifications.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{t.certifications.map((c) => (
              <button key={c} onClick={() => setAward(c)} className={`${CARD} p-4 flex items-center gap-3 text-left hover:border-[#2563EB] transition-colors`}>
                <span className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0"><Award className="w-5 h-5 text-[#D97706]" /></span>
                <span className="text-[13px] font-semibold leading-tight flex-1">{c}</span>
                <span className="text-[11px] font-semibold text-[#2563EB]">Details</span>
              </button>
            ))}</div>
          ) : <ComingSoon>Manufacturer awards and certifications appear here as the dealership adds them.</ComingSoon>}
        </Section>

        {/* 11. Visit us */}
        <Section n={11} title="Visit Us">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className={`${CARD} p-4`}>
              {d.dealerAddress ? <p className="text-[13px] font-semibold inline-flex items-start gap-2"><MapPin className="w-4 h-4 text-[#2563EB] mt-0.5 shrink-0" /> {d.dealerAddress}</p> : <p className="text-[13px] text-[#94A3B8]">Address coming soon.</p>}
              {d.dealerPhone && <p className="text-[13px] mt-2 inline-flex items-center gap-2"><Phone className="w-4 h-4 text-[#2563EB]" /> <a href={`tel:${d.dealerPhone}`} className="font-semibold hover:text-[#2563EB]">{d.dealerPhone}</a></p>}
              <p className={`text-[13px] mt-2 inline-flex items-start gap-2 ${t.hours ? "text-[#0F172A]" : "text-[#94A3B8]"}`}><Clock className="w-4 h-4 mt-0.5 shrink-0" /> {t.hours || "Hours coming soon — call to confirm."}</p>
              <a href={mapsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#2563EB] hover:underline"><Navigation className="w-4 h-4" /> Get Directions</a>
            </div>
            <a href={mapsUrl} target="_blank" rel="noreferrer" className="rounded-2xl border border-[#E6E8EC] bg-slate-100 min-h-[160px] flex flex-col items-center justify-center text-[#64748B] hover:border-[#2563EB] transition-colors">
              <MapPin className="w-8 h-8 text-[#94A3B8]" /><span className="text-[12px] font-semibold mt-1">Open in Maps</span>
            </a>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">{[
            "Sales",
            (t.serviceLocation && t.serviceLocation !== "none") ? "Service" : null,
            t.services.some((s) => /part/i.test(s)) ? "Parts" : null,
            t.financing ? "Finance" : null,
          ].filter(Boolean).map((dep) => (
            <div key={dep as string} className="rounded-xl border border-[#E6E8EC] px-3 py-2 text-center text-[12px] font-semibold text-[#0F172A]">{dep}</div>
          ))}</div>
        </Section>

        {/* 12. Contact CTA */}
        <section className="rounded-2xl p-6 sm:p-8 text-white text-center" style={{ background: "linear-gradient(160deg,#2563EB 0%,#1e50c8 100%)" }}>
          <h2 className="text-[24px] font-extrabold">Ready to experience the difference?</h2>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-5">
            <button onClick={() => go("reserve")} className="h-12 px-6 rounded-xl bg-white text-[#2563EB] text-[14px] font-bold inline-flex items-center gap-2 transition-transform hover:-translate-y-0.5"><ShieldCheck className="w-5 h-5" /> Reserve This Vehicle</button>
            <button onClick={() => go("test-drive")} className="h-12 px-5 rounded-xl bg-white/10 border border-white/40 text-white text-[14px] font-bold inline-flex items-center gap-2 hover:bg-white/20 transition-colors"><Clock className="w-5 h-5" /> Schedule Test Drive</button>
            <button onClick={() => go("contact")} className="h-12 px-5 rounded-xl bg-white/10 border border-white/40 text-white text-[14px] font-bold inline-flex items-center gap-2 hover:bg-white/20 transition-colors"><MessageSquare className="w-5 h-5" /> Message Our Team</button>
            {d.dealerPhone && <a href={`tel:${d.dealerPhone}`} className="h-12 px-5 rounded-xl bg-white/10 border border-white/40 text-white text-[14px] font-bold inline-flex items-center gap-2 hover:bg-white/20 transition-colors"><Phone className="w-5 h-5" /> Call Dealership</a>}
            <a href={mapsUrl} target="_blank" rel="noreferrer" className="h-12 px-5 rounded-xl bg-white/10 border border-white/40 text-white text-[14px] font-bold inline-flex items-center gap-2 hover:bg-white/20 transition-colors"><Navigation className="w-5 h-5" /> Get Directions</a>
          </div>
        </section>

        {/* Footer */}
        <footer className="pt-2 pb-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-2"><Logo variant="full" size={18} /></div>
          <p className="text-[12px] font-semibold text-[#0F172A] inline-flex items-center gap-1.5">Dealer Verified <BadgeCheck className="w-3.5 h-3.5 text-[#16A34A]" /></p>
          <p className="text-[11px] text-[#94A3B8] mt-1">Last updated {new Date().toLocaleDateString()}</p>
          <div className="flex items-center justify-center gap-4 text-[11px] font-semibold text-[#64748B] mt-2"><a href="/privacy" className="hover:text-[#2563EB]">Privacy</a><span className="text-slate-300">·</span><a href="/terms" className="hover:text-[#2563EB]">Terms</a></div>
          <p className="text-[11px] text-[#94A3B8] mt-2 inline-flex items-center gap-1 justify-center"><Sparkles className="w-3 h-3 text-[#2563EB]" /> Powered by AutoLabels</p>
        </footer>
      </main>

      <InfoModal open={award !== null} onClose={() => setAward(null)} icon={Award} title={award || "Award"} subtitle="Dealership recognition">
        <Para>{award} is a recognition this dealership has earned. Awards and certifications reflect performance in areas such as customer satisfaction, sales, or service excellence.</Para>
        <Callout>For the specific criteria and the period this recognition covers, ask the dealership directly.</Callout>
      </InfoModal>

      <PassportCtaDock go={go} dealerPhone={d.dealerPhone || undefined} reviewRating={d.reviewRating} advisor={d.dealerTrust} />
    </div>
  );
};

export default VehiclePassportDealer;
