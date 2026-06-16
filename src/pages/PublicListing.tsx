import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ShieldCheck,
  CheckCircle2,
  Package,
  DollarSign,
  Play,
  Phone,
  Share2,
  Sparkles,
  Clock,
  Award,
  MessageSquare,
  X,
  Send,
  Calendar,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileText,
  Gauge,
  Fuel,
  Car as CarIcon,
  Cog,
  Palette,
  QrCode,
  Smartphone,
  BadgeCheck,
  Camera,
} from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import Logo from "@/components/brand/Logo";
import { QRCodeSVG } from "qrcode.react";
import { useVehicleListing, type VehicleListing } from "@/hooks/useVehicleListing";
import { supabase } from "@/integrations/supabase/client";
import { PublicLocaleProvider, usePublicLocale, fmt } from "@/lib/i18n/public";
import PublicLanguageToggle from "@/components/layout/PublicLanguageToggle";

// ──────────────────────────────────────────────────────────────
// PublicListing — the shopper-facing window sticker. Mounted at
// /v/:slug. This is what a customer sees when they scan the QR
// on the printed addendum, or open the link a dealer embeds on
// their VDP. Must be Supabase-backed, SEO-friendly, ADA-friendly,
// and signed-in-unnecessary.
// ──────────────────────────────────────────────────────────────

// The provider is mounted at the top with initial={null} so it is in
// place for the loading / error states (which also render localized
// chrome). Once the listing loads, its default_locale is applied as a
// soft preference: it only overrides when the shopper hasn't already
// chosen a language this session (localStorage takes precedence inside
// the provider's seed). See LocaleSeed below.
const PublicListing = () => (
  <PublicLocaleProvider initial={null}>
    <PublicListingBody />
  </PublicLocaleProvider>
);

const PublicListingBody = () => {
  const { L, setLang } = usePublicLocale();
  const { slug } = useParams<{ slug: string }>();
  const { publicUrl } = useVehicleListing("");
  // Captured during first render, before the provider's persistence
  // effect writes public_lang — true only when the shopper had an
  // explicit language choice stored from a previous visit. If they
  // did, it wins over the dealer's default_locale.
  const [hadStoredChoice] = useState(() => {
    try {
      return localStorage.getItem("public_lang") != null;
    } catch {
      return false;
    }
  });
  const [listing, setListing] = useState<VehicleListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [inquirySent, setInquirySent] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      // Rate-limited edge function handles view-count, audit event,
      // and abusive-scraper throttling server-side. Clients no longer
      // talk to the RPC directly.
      const { data, error } = await supabase.functions.invoke("public-listing-view", {
        body: { slug },
      });
      if (!mounted) return;
      if (error) {
        const status = (error as unknown as { context?: { status?: number } })?.context?.status;
        if (status === 429) setRateLimited(true);
        else setNotFound(true);
        setLoading(false);
        return;
      }
      const row = (data as { listing?: VehicleListing } | null)?.listing ?? null;
      if (!row) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setListing(row);
      setLoading(false);
      // Apply the dealer's default_locale only for first-time visitors
      // with no previously stored choice — an explicit selection always
      // wins (see hadStoredChoice).
      if (!hadStoredChoice && (row.default_locale === "es" || row.default_locale === "en")) {
        setLang(row.default_locale);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [slug, setLang, hadStoredChoice]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#1E90FF] border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-muted-foreground">{L.loading_vehicle}</p>
        </div>
      </div>
    );
  }

  if (rateLimited) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="text-center max-w-md">
          <Clock className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-foreground">{L.slow_down}</h1>
          <p className="text-sm text-muted-foreground mt-2">{L.rate_limited_body}</p>
        </div>
      </div>
    );
  }

  if (notFound || !listing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="text-center max-w-md">
          <Package className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-foreground">{L.vehicle_unavailable}</h1>
          <p className="text-sm text-muted-foreground mt-2">{L.vehicle_unavailable_body}</p>
          <p className="text-[11px] text-muted-foreground mt-3 font-mono">{slug}</p>
        </div>
      </div>
    );
  }

  const dealer = listing.dealer_snapshot || {};
  const sticker = listing.sticker_snapshot || {};
  const installed = (sticker.products_snapshot || []).filter((p) => p.badge_type === "installed");
  const optional = (sticker.products_snapshot || []).filter((p) => p.badge_type === "optional");
  const totals = sticker.totals || {};
  const viewUrl = publicUrl(listing.slug);

  const handleShare = async () => {
    const data = {
      title: `${listing.ymm || "Vehicle"} — ${dealer.name || "AutoLabels"}`,
      text: `Take a look at this ${listing.ymm || "vehicle"}`,
      url: viewUrl,
    };
    try {
      if (navigator.share) {
        await navigator.share(data);
      } else {
        await navigator.clipboard.writeText(viewUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      /* user cancelled */
    }
  };

  const pageTitle = `${listing.ymm || `Vehicle ${listing.vin.slice(-8)}`}${listing.trim ? ` ${listing.trim}` : ""} — ${dealer.name || "AutoLabels"}`;
  const pageDesc = `${listing.ymm || "Vehicle"}${listing.mileage != null ? ` · ${listing.mileage.toLocaleString()} mi` : ""}${dealer.city && dealer.state ? ` · ${dealer.city}, ${dealer.state}` : ""}. View window sticker, pricing, and disclosures.`;
  const heroImg = listing.photos?.find((p) => p.kind === "hero")?.url || listing.photos?.[0]?.url;
  const priceVal = (totals as { drive_out_price?: number; out_the_door?: number }).drive_out_price
    ?? (totals as { drive_out_price?: number; out_the_door?: number }).out_the_door;
  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: listing.ymm || `Vehicle ${listing.vin}`,
    description: pageDesc,
    sku: listing.vin,
    ...(heroImg ? { image: heroImg } : {}),
    ...(priceVal
      ? {
          offers: {
            "@type": "Offer",
            priceCurrency: "USD",
            price: priceVal,
            availability: "https://schema.org/InStock",
            url: viewUrl,
            ...(dealer.name ? { seller: { "@type": "AutoDealer", name: dealer.name } } : {}),
          },
        }
      : {}),
  };

  return (
    <div className="min-h-screen bg-white">
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDesc} />
        <link rel="canonical" href={viewUrl} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDesc} />
        <meta property="og:url" content={viewUrl} />
        <meta property="og:type" content="product" />
        {heroImg ? <meta property="og:image" content={heroImg} /> : null}
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDesc} />
        <script type="application/ld+json">{JSON.stringify(productSchema)}</script>
      </Helmet>
      {/* Slim, Tesla-style top bar: vehicle is hero, dealer is
          secondary. No ornate chrome, no branded gradients. */}
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 py-2.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            {dealer.logo_url ? (
              <img src={dealer.logo_url} alt={dealer.name || "Dealer"} className="h-6 w-auto" />
            ) : (
              <Logo variant="full" size={22} />
            )}
            <p className="text-[11px] font-semibold text-slate-700 truncate">{dealer.name || ""}</p>
          </div>
          <div className="flex items-center gap-1">
            <PublicLanguageToggle className="mr-1" />
            {/* Handoff — shopper on desktop opens this on phone, or
                sales rep hands the iPad to the customer at delivery
                and the buyer scans it to sign on their own device. */}
            <button
              onClick={() => setHandoffOpen(true)}
              className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-600"
              aria-label={L.open_on_another_device}
              title={L.open_on_another_device}
            >
              <Smartphone className="w-4 h-4" />
            </button>
            <button
              onClick={handleShare}
              className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-600"
              aria-label={copied ? L.link_copied : L.share_vehicle}
              title={copied ? L.link_copied : L.share}
            >
              <Share2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        {/* Hero — photo-first when available, gradient fallback. No
            price above the fold: the Trust Band and Price Block
            below carry the FTC-aligned "advertised = drive-out"
            story. */}
        <HeroSection listing={listing} dealer={dealer} />

        {/* Trust Band — the defining value of this page. Every chip
            is a hashed receipt, not a marketing claim:
            prep-signed, recall-clear, archival-hashed. This is what
            no VDP on the market shows today. */}
        <TrustBand listing={listing} />

        {/* Recall banner — only shows if the campaign data has
            anything actionable. Clear listings don't need the visual
            weight; do-not-drive blocks publish upstream so we only
            have to handle "open but safe to drive" here. */}
        <RecallBanner listing={listing} />

        {/* Availability band — the Tesla-style "when can you get it"
            answer right under the trust proof. Pickup is always
            available; delivery is a dealer-configurable soft claim. */}
        <AvailabilityBand listing={listing} dealer={dealer} />

        {/* Drive-out price block — FTC 97-letter alignment. The
            number at the top is the real, no-asterisk total. The
            breakdown is tappable so shoppers can see exactly what's
            in the number. */}
        <PriceBlock listing={listing} />

        {/* Key specs grid — pulls from listing.key_specs */}
        <KeySpecs listing={listing} />

        {/* Photos gallery — only renders if the listing has photos */}
        <PhotosGallery listing={listing} />

        {/* Description — long-form vehicle write-up if the dealer
            filled one in (or the VDP scraper did). */}
        {listing.description && (
          <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
            <h2 className="text-sm font-semibold text-foreground mb-2">{L.about_this_vehicle}</h2>
            <p className="text-[12px] text-slate-700 leading-relaxed whitespace-pre-wrap">
              {listing.description}
            </p>
          </section>
        )}

        {/* Certification card — only CPO vehicles */}
        {listing.certification && (
          <CertificationCard cert={listing.certification} />
        )}

        {/* Payment estimator — client-side, default APR/term from
            the listing record. Shoppers can tweak inputs inline. */}
        {listing.payment_estimate && typeof listing.price === "number" && (
          <PaymentEstimator
            price={listing.price}
            estimate={listing.payment_estimate}
          />
        )}

        {/* Videos */}
        {listing.videos?.length > 0 && (
          <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
            <div className="flex items-center gap-2 mb-3">
              <Play className="w-4 h-4 text-[#1E90FF]" />
              <h2 className="text-sm font-semibold text-foreground">{L.video_walkaround}</h2>
            </div>
            <div className="grid gap-3">
              {listing.videos.map((v) => (
                <a
                  key={v.id}
                  href={v.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-muted aspect-video flex items-center justify-center hover:bg-muted/80 transition-colors"
                >
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#1E90FF]">
                    <Play className="w-4 h-4" /> {fmt(L.watch_caption, v.caption || L.video_fallback)}
                  </span>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* What's on this vehicle */}
        <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
          <div className="flex items-center gap-2 mb-3">
            <Package className="w-4 h-4 text-[#1E90FF]" />
            <h2 className="text-sm font-semibold text-foreground">{L.whats_on_vehicle}</h2>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-4">
            {L.whats_on_intro}
          </p>

          {installed.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-bold uppercase tracking-label text-[#1E90FF] mb-2">
                {L.preinstalled_included}
              </p>
              <div className="space-y-2">
                {installed.map((p) => (
                  <ProductCard key={p.id} p={p} tone="installed" />
                ))}
              </div>
            </div>
          )}

          {optional.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-label text-amber-600 mb-2">
                {L.optional_you_choose}
              </p>
              <div className="space-y-2">
                {optional.map((p) => (
                  <ProductCard key={p.id} p={p} tone="optional" />
                ))}
              </div>
            </div>
          )}

          {installed.length === 0 && optional.length === 0 && (
            <p className="text-xs text-muted-foreground">{L.no_additional_products}</p>
          )}
        </section>

        {/* Verified installations — vendor/detail-shop proof (photo + date)
            that the protection is really on this vehicle. */}
        <VerifiedInstallsPublic slug={listing.slug} />

        {/* Dealer value props */}
        {listing.value_props?.length > 0 && (
          <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <h2 className="text-sm font-semibold text-foreground">{L.included_with_purchase}</h2>
            </div>
            <div className="space-y-2">
              {listing.value_props.map((vp, i) => (
                <div
                  key={i}
                  className="flex items-start justify-between gap-3 p-3 rounded-lg bg-amber-50/60 border border-amber-100"
                >
                  <div>
                    <p className="text-sm font-semibold text-foreground">{vp.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{vp.description}</p>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded flex-shrink-0 whitespace-nowrap">
                    {vp.price}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Features grid — a quick-scan list of dealer-highlighted
            features (safety package, tech package, etc.). */}
        {listing.features?.length > 0 && (
          <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
            <h2 className="text-sm font-semibold text-foreground mb-3">{L.notable_features}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {listing.features.map((f, i) => (
                <div key={i} className="flex items-start gap-2 p-3 rounded-lg border border-border">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-foreground">{f.title}</p>
                    {f.subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">{f.subtitle}</p>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Program documents — Monroney PDF, Buyers Guide, factory
            sticker, and anything else the dealer attached. These
            are the legally required artifacts a shopper should be
            able to take with them. */}
        <ProgramDocuments listing={listing} />

        {/* "Your Protection" block removed — the Trust Band above
            already shows the same receipts with hashed proof. The
            QR-to-revisit card and separate Contact card removed too;
            the sticky CTA bar at the bottom is the single durable
            affordance for both Reserve and Call. */}

        {/* Footer */}
        <footer className="text-center py-6 pb-32 md:pb-6">
          <Logo variant="full" size={22} />
          <p className="text-[10px] text-muted-foreground mt-2">
            {L.powered_by} · <Clock className="inline w-2.5 h-2.5 -mt-0.5" /> {L.published}{" "}
            {listing.published_at ? new Date(listing.published_at).toLocaleDateString() : "recently"}
          </p>
        </footer>
      </main>

      {/* Sticky Reserve bar — Tesla-style commitment verb. One
          primary action (Reserve), one small fallback (Call). */}
      <div className="fixed bottom-0 inset-x-0 z-30 p-3 md:p-4 bg-white/95 backdrop-blur-md border-t border-slate-200 md:bg-transparent md:border-t-0 md:backdrop-blur-0 md:pointer-events-none">
        <div className="max-w-3xl mx-auto flex items-center gap-2 md:justify-end md:pointer-events-auto">
          {dealer.phone && (
            <a
              href={`tel:${dealer.phone}`}
              className="h-12 w-12 md:w-auto md:px-4 rounded-full md:rounded-xl bg-white border border-slate-200 text-slate-800 inline-flex items-center justify-center gap-1.5 hover:bg-slate-50 transition-all flex-shrink-0"
              title={L.call_dealership}
              aria-label={L.call_dealership}
            >
              <Phone className="w-4 h-4 stroke-[2.5]" />
              <span className="hidden md:inline font-display font-semibold tracking-tight">{L.call}</span>
            </a>
          )}
          <button
            onClick={() => setInquiryOpen(true)}
            className="flex-1 md:flex-initial h-12 px-6 rounded-xl bg-slate-950 text-white inline-flex items-center justify-center gap-2 hover:bg-slate-900 transition-all whitespace-nowrap"
          >
            <span className="font-display font-bold tracking-tight text-[15px]">{L.reserve_vehicle}</span>
          </button>
        </div>
      </div>

      {inquiryOpen && (
        <InquiryModal
          listing={listing}
          dealer={dealer}
          onClose={() => {
            setInquiryOpen(false);
            if (inquirySent) setInquirySent(false);
          }}
          onSent={() => setInquirySent(true)}
          sent={inquirySent}
        />
      )}

      {handoffOpen && (
        <HandoffModal
          url={viewUrl}
          ymm={listing.ymm || "this vehicle"}
          onClose={() => setHandoffOpen(false)}
        />
      )}
    </div>
  );
};

interface InquiryModalProps {
  listing: VehicleListing;
  dealer: { name?: string; phone?: string; address?: string; city?: string; state?: string };
  onClose: () => void;
  onSent: () => void;
  sent: boolean;
}

const InquiryModal = ({ listing, dealer, onClose, onSent, sent }: InquiryModalProps) => {
  const { L } = usePublicLocale();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState(L.default_inquiry_message);
  const [intent, setIntent] = useState<"info" | "test_drive" | "offer">("info");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim() || (!email.trim() && !phone.trim())) {
      toast.error(L.inquiry_validation_error);
      return;
    }
    setSubmitting(true);
    try {
      // Persist to the leads table so it shows up in the dealer's
      // leads panel (Admin > Leads) as a real CRM record, not just
      // an audit entry. tenant_id is auto-filled server-side via
      // set_tenant_id_leads trigger.
      const { error: leadError } = await (supabase as any).from("leads").insert({
        store_id: listing.store_id,
        name: name.trim(),
        phone: phone.trim() || "",
        email: email.trim() || "",
        vehicle_interest: `${listing.ymm || "Vehicle"}${listing.trim ? " " + listing.trim : ""}`,
        vehicle_vin: listing.vin,
        source: "website",
        signing_url: typeof window !== "undefined" ? window.location.href : "",
        status: "new",
        notes: `[intent=${intent}] ${message.trim()}`,
      });

      // Dual-log to audit so the inquiry also appears in the tamper-
      // evident timeline even if the lead row was rejected (missing
      // tenant, etc.).
      await (supabase as any).from("audit_log").insert({
        action: "vehicle_inquiry",
        entity_type: "vehicle_listing",
        entity_id: listing.id,
        store_id: listing.store_id,
        details: {
          slug: listing.slug,
          vin: listing.vin,
          ymm: listing.ymm,
          intent,
          name: name.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
          message: message.trim() || null,
          lead_persisted: !leadError,
          page: typeof window !== "undefined" ? window.location.href : null,
          at: new Date().toISOString(),
        },
      });

      // Fire-and-forget email confirmation to the shopper so they
      // have the vehicle + dealer contact in their inbox.
      if (email.trim()) {
        const dealerName = dealer.name || "the dealership";
        const html = `
          <p>Hi ${name.trim() || "there"},</p>
          <p>Thanks for your interest in the <strong>${listing.ymm || "vehicle"}${listing.trim ? " " + listing.trim : ""}</strong> (VIN ${listing.vin}) at ${dealerName}.</p>
          <p>The team has your request and the vehicle details saved. You can revisit the listing any time:</p>
          <p><a href="${typeof window !== "undefined" ? window.location.href : ""}" style="display:inline-block;padding:10px 16px;background:#1E90FF;color:#fff;text-decoration:none;border-radius:6px">View vehicle</a></p>
          ${dealer.phone ? `<p>Or call ${dealerName} directly: <a href="tel:${dealer.phone}">${dealer.phone}</a></p>` : ""}
        `;
        supabase.functions.invoke("send-email", {
          body: {
            to: email.trim(),
            subject: `Your request — ${listing.ymm || "Vehicle"}`,
            html,
          },
        }).catch(() => { /* best-effort */ });
      }

      onSent();
    } catch {
      toast.error(L.inquiry_send_error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end md:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white w-full md:max-w-lg md:rounded-2xl rounded-t-[28px] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile drag handle */}
        <div className="pt-2 md:hidden flex justify-center">
          <div className="w-10 h-1 rounded-full bg-slate-300" />
        </div>

        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-black font-display tracking-tight">
              {sent ? L.reserved : L.reserve_vehicle}
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {sent ? fmt(L.reserved_subtitle, dealer.name || L.dealership) : listing.ymm || listing.vin}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {sent ? (
          <div className="p-5 space-y-4">
            <div className="rounded-xl bg-slate-950 text-white p-5 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0 text-emerald-400" />
              <div>
                <p className="font-bold text-base">{L.vehicle_held_title}</p>
                <p className="text-xs mt-1 text-white/80">{L.vehicle_held_body}</p>
              </div>
            </div>

            {(dealer.phone || dealer.address) && (
              <div className="rounded-xl border border-slate-200 p-4 text-xs space-y-1">
                <p className="font-bold text-slate-900">{dealer.name || L.dealership}</p>
                {dealer.phone && (
                  <a href={`tel:${dealer.phone}`} className="text-slate-600 hover:text-[#1E90FF] block">
                    <Phone className="inline w-3 h-3 mr-1" />
                    {dealer.phone}
                  </a>
                )}
                {dealer.address && (
                  <p className="text-slate-600">
                    {dealer.address}
                    {dealer.city ? `, ${dealer.city}` : ""}
                    {dealer.state ? `, ${dealer.state}` : ""}
                  </p>
                )}
              </div>
            )}

            <button
              onClick={onClose}
              className="w-full h-11 rounded-xl bg-slate-900 text-white font-display font-black text-sm hover:brightness-110"
            >
              {L.close}
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <p className="text-[12px] text-slate-600 leading-relaxed">
              {L.reserve_intro}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "info", label: L.hold_for_me, icon: ShieldCheck },
                { id: "test_drive", label: L.test_drive, icon: Calendar },
                { id: "offer", label: L.make_offer, icon: DollarSign },
              ].map((i) => (
                <button
                  key={i.id}
                  onClick={() => setIntent(i.id as typeof intent)}
                  className={`h-16 rounded-xl border text-[11px] font-semibold inline-flex flex-col items-center justify-center gap-1 transition-all ${
                    intent === i.id
                      ? "border-slate-950 bg-slate-950 text-white"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <i.icon className="w-4 h-4" />
                  {i.label}
                </button>
              ))}
            </div>

            <Field label={L.your_name} value={name} onChange={setName} placeholder={L.full_name} />
            <div className="grid grid-cols-2 gap-2">
              <Field label={L.email} value={email} onChange={setEmail} placeholder="you@example.com" type="email" />
              <Field label={L.phone} value={phone} onChange={setPhone} placeholder="(555) 123-4567" type="tel" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-label text-slate-500">{L.message}</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-slate-200 p-3 text-sm focus:outline-none focus:border-[#1E90FF] focus:ring-2 focus:ring-[#1E90FF]/20"
              />
            </div>

            <p className="text-[10px] text-slate-500 leading-relaxed">
              {L.inquiry_disclaimer}
            </p>

            <button
              onClick={submit}
              disabled={submitting || !name.trim() || (!email.trim() && !phone.trim())}
              className="w-full h-12 rounded-xl bg-slate-950 text-white font-display font-bold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-slate-900 transition-colors"
            >
              {submitting ? L.reserving : (<><Send className="w-4 h-4 stroke-[2.5]" /> {L.reserve_now}</>)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const Field = ({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "email" | "tel";
}) => (
  <div>
    <label className="text-[10px] font-bold uppercase tracking-label text-slate-500">{label}</label>
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      type={type}
      placeholder={placeholder}
      className="mt-1 w-full h-11 px-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-[#1E90FF] focus:ring-2 focus:ring-[#1E90FF]/20"
    />
  </div>
);

const ProductCard = ({
  p,
  tone,
}: {
  p: {
    id: string;
    name: string;
    subtitle?: string | null;
    warranty?: string | null;
    price: number;
    disclosure?: string | null;
    benefit_justification?: string | null;
  };
  tone: "installed" | "optional";
}) => {
  const { L } = usePublicLocale();
  return (
  <div
    className={`rounded-lg border p-3 ${
      tone === "installed" ? "border-[#1E90FF]/20 bg-[#1E90FF]/5" : "border-amber-200 bg-amber-50/40"
    }`}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{p.name}</p>
        {p.subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{p.subtitle}</p>}
        {p.warranty && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            <Award className="inline w-3 h-3 mr-1 -mt-0.5" />
            {p.warranty}
          </p>
        )}
      </div>
      <p className="text-sm font-bold tabular-nums text-foreground whitespace-nowrap">
        <DollarSign className="inline w-3 h-3 -mt-0.5" />
        {p.price.toLocaleString()}
      </p>
    </div>
    {/* Wave 27 — benefit justification text reads first because
        it's what the customer cares about: WHY did the dealer
        add this. Renders distinct from the legal disclosure so
        the eye lands on the value pitch before the fine print. */}
    {p.benefit_justification && p.benefit_justification.trim() && (
      <p className="text-[11px] text-foreground mt-2 leading-relaxed font-medium">
        <span className="text-[9px] uppercase tracking-[0.14em] font-bold text-foreground/60 mr-1">
          {L.why_benefits_you}
        </span>
        {p.benefit_justification}
      </p>
    )}
    {p.disclosure && (
      <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">{p.disclosure}</p>
    )}
    {/* Wave 27 — voluntary notice on optional items. FTC §5 hook
        the dealer's addendum builder also renders; restating it
        here gives the customer the same notice in the digital
        receipt before they scan the QR at delivery. */}
    {tone === "optional" && (
      <p className="text-[9px] text-amber-900 mt-2 leading-snug font-semibold uppercase tracking-[0.08em]">
        {L.optional_not_condition}
      </p>
    )}
  </div>
  );
};

const TrustItem = ({ text }: { text: string }) => (
  <div className="flex items-start gap-2">
    <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
    <p className="text-[11px] text-muted-foreground">{text}</p>
  </div>
);

// ──────────────────────────────────────────────────────────────
// HandoffModal — the cross-device + delivery-signing affordance.
// Sales rep at the pickup desk can hand an iPad over, the buyer
// scans this QR with their phone, and loads the listing (and
// eventually the signing flow) on their own device so the
// signature and hash chain are bound to their hardware, not the
// dealer's.
// ──────────────────────────────────────────────────────────────

const HandoffModal = ({
  url,
  ymm,
  onClose,
}: {
  url: string;
  ymm: string;
  onClose: () => void;
}) => {
  const { L } = usePublicLocale();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* noop */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white w-full md:max-w-sm md:rounded-2xl rounded-t-[28px] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pt-2 md:hidden flex justify-center">
          <div className="w-10 h-1 rounded-full bg-slate-300" />
        </div>

        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="min-w-0">
            <h3 className="text-base font-black font-display tracking-tight">{L.open_on_another_device_title}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5 truncate">{ymm}</p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center"
            aria-label={L.close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 text-center space-y-4">
          <div className="inline-flex p-4 rounded-2xl bg-white border border-slate-200">
            <QRCodeSVG value={url} size={192} level="M" />
          </div>

          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-900">{L.scan_to_continue}</p>
            <p className="text-[11px] text-slate-600 leading-relaxed">{L.scan_to_continue_body}</p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-center gap-1 text-[10px] font-mono text-slate-500 break-all px-2">
              {url}
            </div>
            <button
              onClick={copy}
              className="w-full h-10 rounded-xl border border-slate-200 text-slate-800 text-sm font-semibold hover:bg-slate-50 inline-flex items-center justify-center gap-2"
            >
              <QrCode className="w-3.5 h-3.5" />
              {copied ? L.link_copied : L.copy_link}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// Trust-first layout components (new for Wave 6.1)
// ──────────────────────────────────────────────────────────────

interface DealerMini {
  name?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  tagline?: string;
  logo_url?: string;
  primary_color?: string;
}

const HeroSection = ({ listing, dealer }: { listing: VehicleListing; dealer: DealerMini }) => {
  const { L } = usePublicLocale();
  const heroPhoto = listing.photos?.find((p) => p.kind === "hero") || listing.photos?.[0];

  return (
    <section className="rounded-2xl overflow-hidden">
      <div
        className="relative aspect-[4/3] sm:aspect-[16/9] w-full bg-slate-950"
        style={
          heroPhoto
            ? { backgroundImage: `url(${heroPhoto.url})`, backgroundSize: "cover", backgroundPosition: "center" }
            : undefined
        }
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/10" />
        <div className="absolute inset-x-0 bottom-0 p-6 md:p-8 text-white">
          <h1 className="text-3xl md:text-5xl font-black font-display tracking-[-0.03em] leading-[0.95]">
            {listing.ymm || fmt(L.vehicle_details_fallback, listing.vin.slice(-8))}
          </h1>
          {listing.trim && (
            <p className="text-base md:text-lg text-white/85 font-display mt-1 tracking-tight">{listing.trim}</p>
          )}
          <div className="mt-3 flex items-center gap-4 text-[11px] text-white/70 font-mono uppercase tracking-wider flex-wrap">
            {listing.mileage != null && <span>{listing.mileage.toLocaleString()} {L.mi_short}</span>}
            <span>VIN · {listing.vin.slice(-8)}</span>
            {dealer.city && dealer.state && (
              <span>{dealer.city}, {dealer.state}</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

const AvailabilityBand = ({
  listing,
  dealer,
}: {
  listing: VehicleListing;
  dealer: DealerMini;
}) => {
  const { L } = usePublicLocale();
  // Pickup is always "ready" once the listing is published — the
  // prep-gate guaranteed it. Delivery is a soft forward-looking
  // claim, rendered only when the dealer has an address on file.
  const pickupCity = dealer.city && dealer.state ? `${dealer.city}, ${dealer.state}` : null;
  return (
    <section className="rounded-2xl bg-slate-950 text-white p-5 md:p-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/50 font-semibold">{L.pickup}</p>
          <p className="text-lg font-bold font-display mt-1">{L.ready_now}</p>
          <p className="text-[12px] text-white/70 mt-0.5">
            {pickupCity
              ? fmt(L.pickup_available_at, `${dealer.name || L.dealership} · ${pickupCity}`)
              : L.pickup_available_generic}
          </p>
        </div>
        <div className="sm:border-l sm:border-white/15 sm:pl-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/50 font-semibold">{L.delivery}</p>
          <p className="text-lg font-bold font-display mt-1">{L.on_request}</p>
          <p className="text-[12px] text-white/70 mt-0.5">{L.delivery_ask}</p>
        </div>
      </div>
    </section>
  );
};

const TrustBand = ({ listing }: { listing: VehicleListing }) => {
  const { L } = usePublicLocale();
  const prepSigned = listing.prep_status?.foreman_signed_at;
  const prepDate = prepSigned ? new Date(prepSigned).toLocaleDateString() : null;

  const recall = listing.recall_check;
  const recallDate = recall?.checked_at ? new Date(recall.checked_at).toLocaleDateString() : null;
  const recallHasOpen = recall?.has_open || false;
  const recallCampaigns = recall?.campaigns?.length || 0;

  const publishedDate = listing.published_at ? new Date(listing.published_at).toLocaleDateString() : null;

  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {/* Prep-signed */}
        <Chip
          tone="emerald"
          icon={ShieldCheck}
          label={L.prep_signed}
          value={prepDate || L.prep_pending}
          title={prepSigned ? fmt(L.prep_signed_title, prepDate ?? "") : L.prep_required_title}
        />
        {/* Recall status */}
        <Chip
          tone={recallHasOpen ? "amber" : "emerald"}
          icon={recallHasOpen ? AlertTriangle : CheckCircle2}
          label={recallHasOpen ? fmt(L.recalls_open, recallCampaigns) : L.recalls_clear}
          value={recallDate ? fmt(L.recalls_as_of, recallDate) : L.prep_checked}
          title={recallHasOpen ? L.recalls_open_title : L.recalls_clear_title}
        />
        {/* Archive receipt */}
        <Chip
          tone="emerald"
          icon={FileText}
          label={L.archived}
          value={publishedDate || L.prep_pending}
          title={L.archived_title}
        />
      </div>
    </section>
  );
};

const Chip = ({
  tone,
  icon: Icon,
  label,
  value,
  title,
}: {
  tone: "emerald" | "amber";
  icon: typeof ShieldCheck;
  label: string;
  value: string;
  title?: string;
}) => {
  const toneClasses = tone === "amber"
    ? "border-amber-200 bg-white text-amber-900"
    : "border-emerald-200 bg-white text-emerald-900";
  const iconTone = tone === "amber" ? "text-amber-600" : "text-emerald-600";
  return (
    <div className={`rounded-xl border px-3 py-2 flex items-center gap-2 ${toneClasses}`} title={title}>
      <Icon className={`w-4 h-4 flex-shrink-0 ${iconTone}`} />
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-label leading-tight">{label}</p>
        <p className="text-[11px] font-semibold truncate">{value}</p>
      </div>
    </div>
  );
};

const RecallBanner = ({ listing }: { listing: VehicleListing }) => {
  const { L } = usePublicLocale();
  const recall = listing.recall_check;
  if (!recall || !recall.has_open || !recall.campaigns || recall.campaigns.length === 0) return null;
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-amber-900">{L.recall_banner_title}</p>
          <p className="text-[11px] text-amber-800 mt-1">{L.recall_banner_body}</p>
          <ul className="mt-2 space-y-1.5">
            {recall.campaigns.slice(0, 3).map((c, i) => (
              <li key={i} className="text-[11px] text-amber-900">
                <span className="font-mono font-bold">{c.campaignNumber || "—"}</span>
                {c.component ? ` · ${c.component}` : ""}
                {c.summary ? ` — ${c.summary}` : ""}
              </li>
            ))}
            {recall.campaigns.length > 3 && (
              <li className="text-[10px] text-amber-700 italic">{fmt(L.recall_more, recall.campaigns.length - 3)}</li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
};

const PriceBlock = ({ listing }: { listing: VehicleListing }) => {
  const { L } = usePublicLocale();
  const [open, setOpen] = useState(false);
  const totals = listing.sticker_snapshot?.totals || {};
  const driveOut = typeof totals.final_price === "number" ? totals.final_price : listing.price;
  if (driveOut == null) return null;

  const lines: { label: string; value: number; note?: string }[] = [];
  if (typeof totals.base_price === "number") lines.push({ label: L.base_price, value: totals.base_price });
  if (typeof totals.accessories_total === "number" && totals.accessories_total > 0) {
    lines.push({ label: L.dealer_installed_addons, value: totals.accessories_total, note: L.addon_included_note });
  }
  if (typeof totals.doc_fee === "number" && totals.doc_fee > 0) {
    lines.push({ label: L.doc_fee, value: totals.doc_fee });
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="p-6 md:p-7">
        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-semibold">
          {L.drive_out_price}
        </p>
        <p className="text-5xl md:text-6xl font-black tracking-[-0.03em] font-display tabular-nums text-slate-950 mt-1 leading-none">
          ${driveOut.toLocaleString()}
        </p>
        <p className="text-[12px] text-slate-600 mt-3 leading-relaxed max-w-md">
          {L.drive_out_disclaimer}
        </p>
      </div>

      {lines.length > 0 && (
        <>
          <button
            onClick={() => setOpen((o) => !o)}
            className="w-full flex items-center justify-between px-6 py-3 border-t border-slate-200 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <span>{L.whats_in_price}</span>
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {open && (
            <div className="px-6 pb-5 space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex items-start justify-between text-[13px]">
                  <div className="min-w-0">
                    <p className="text-slate-900">{l.label}</p>
                    {l.note && <p className="text-[10px] text-slate-500 mt-0.5">{l.note}</p>}
                  </div>
                  <p className="font-bold tabular-nums text-slate-950">${l.value.toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
};

const KeySpecs = ({ listing }: { listing: VehicleListing }) => {
  const { L } = usePublicLocale();
  const s = listing.key_specs;
  if (!s) return null;
  const items: { icon: typeof CarIcon; label: string; value?: string | number | null }[] = [
    { icon: CarIcon, label: L.body, value: s.body_style },
    { icon: Cog, label: L.drivetrain, value: s.drivetrain },
    { icon: Gauge, label: L.transmission, value: s.transmission },
    { icon: Fuel, label: L.fuel, value: s.fuel },
    { icon: Gauge, label: L.mpg, value: s.mpg_combined ? `${s.mpg_combined} comb.` : s.mpg_city && s.mpg_hwy ? `${s.mpg_city}/${s.mpg_hwy}` : null },
    { icon: Palette, label: L.exterior, value: s.exterior_color },
  ];
  const populated = items.filter((i) => i.value != null && i.value !== "");
  if (populated.length === 0) return null;
  return (
    <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
      <h2 className="text-sm font-semibold text-foreground mb-3">{L.key_specs}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {populated.map((it, i) => {
          const Icon = it.icon;
          return (
            <div key={i} className="flex items-start gap-2">
              <Icon className="w-4 h-4 text-[#1E90FF] mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-label text-muted-foreground">{it.label}</p>
                <p className="text-[13px] font-semibold text-foreground truncate">{it.value}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

const PhotosGallery = ({ listing }: { listing: VehicleListing }) => {
  const { L } = usePublicLocale();
  const photos = listing.photos || [];
  if (photos.length <= 1) return null; // hero already shown
  return (
    <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
      <h2 className="text-sm font-semibold text-foreground mb-3">{L.photos}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {photos.slice(0, 9).map((p, i) => (
          <a
            key={i}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block aspect-square rounded-lg overflow-hidden bg-slate-100 hover:opacity-90 transition-opacity"
          >
            <img
              src={p.url}
              alt={p.alt || fmt(L.photo_alt, i + 1)}
              loading="lazy"
              className="w-full h-full object-cover"
            />
          </a>
        ))}
      </div>
      {photos.length > 9 && (
        <p className="text-[10px] text-muted-foreground mt-2">{fmt(L.more_photos, photos.length - 9)}</p>
      )}
    </section>
  );
};

const CertificationCard = ({ cert }: { cert: NonNullable<VehicleListing["certification"]> }) => {
  const { L } = usePublicLocale();
  return (
  <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
    <div className="flex items-center gap-2 mb-2">
      <Award className="w-4 h-4 text-amber-500" />
      <h2 className="text-sm font-semibold text-foreground">{cert.program_name || L.certified_preowned}</h2>
    </div>
    <div className="grid grid-cols-3 gap-3 text-center">
      {cert.coverage_months != null && (
        <Stat label={L.warranty} value={`${cert.coverage_months} mo`} />
      )}
      {cert.coverage_miles != null && (
        <Stat label={L.coverage} value={`${cert.coverage_miles.toLocaleString()} ${L.mi_short}`} />
      )}
      {cert.inspection_points != null && (
        <Stat label={L.inspection} value={`${cert.inspection_points} pts`} />
      )}
    </div>
    {cert.url && (
      <a href={cert.url} target="_blank" rel="noopener noreferrer" className="block mt-3 text-[11px] text-[#1E90FF] font-semibold hover:underline">
        {L.view_full_program}
      </a>
    )}
  </section>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-border p-3">
    <p className="text-[9px] font-bold uppercase tracking-label text-muted-foreground">{label}</p>
    <p className="text-base font-bold font-display tabular-nums text-foreground mt-0.5">{value}</p>
  </div>
);

const PaymentEstimator = ({
  price,
  estimate,
}: {
  price: number;
  estimate: NonNullable<VehicleListing["payment_estimate"]>;
}) => {
  const { L } = usePublicLocale();
  const [apr, setApr] = useState(estimate.default_apr ?? 7.5);
  const [down, setDown] = useState(estimate.default_down ?? Math.round(price * 0.1));
  const [months, setMonths] = useState(estimate.default_term_months ?? 72);

  const monthly = useMemo(() => {
    const principal = Math.max(price - down, 0);
    const r = apr / 100 / 12;
    if (r === 0) return principal / months;
    return (principal * r) / (1 - Math.pow(1 + r, -months));
  }, [price, down, apr, months]);

  return (
    <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
      <h2 className="text-sm font-semibold text-foreground mb-3">{L.est_monthly_payment}</h2>
      <p className="text-3xl font-black font-display tabular-nums text-foreground">
        ${isFinite(monthly) ? Math.round(monthly).toLocaleString() : "—"}<span className="text-sm font-semibold text-muted-foreground">{L.per_mo}</span>
      </p>
      <div className="grid grid-cols-3 gap-3 mt-3">
        <Slider label={L.apr} value={apr} min={0} max={20} step={0.1} onChange={setApr} />
        <Slider label={L.down} value={down} min={0} max={Math.round(price * 0.5)} step={100} onChange={setDown} />
        <Slider label={L.term} value={months} min={24} max={84} step={6} onChange={setMonths} />
      </div>
      <p className="text-[10px] text-muted-foreground mt-3 italic">
        {L.estimate_only}
      </p>
    </section>
  );
};

const Slider = ({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
}) => (
  <div>
    <div className="flex items-center justify-between">
      <label className="text-[10px] font-bold uppercase tracking-label text-muted-foreground">{label}</label>
      <span className="text-[11px] font-bold tabular-nums">{value}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full mt-1 accent-[#1E90FF]"
    />
  </div>
);

const ProgramDocuments = ({ listing }: { listing: VehicleListing }) => {
  const { L } = usePublicLocale();
  const docs: { name: string; url: string; type: string }[] = [];
  if (listing.factory_sticker_url) {
    docs.push({ name: L.factory_monroney, url: listing.factory_sticker_url, type: "Monroney PDF" });
  }
  // Internal deal-jacket documents stay off the public shopper page —
  // title, odometer disclosure, and "we owe" are dealer records, not
  // customer-facing artifacts.
  const INTERNAL_TYPES = new Set(["title", "odometer", "we_owe"]);
  docs.push(...(listing.documents || []).filter((d) => !INTERNAL_TYPES.has(d.type)));
  if (docs.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
      <div className="flex items-center gap-2 mb-3">
        <Package className="w-4 h-4 text-[#1E90FF]" />
        <h2 className="text-sm font-semibold text-foreground">{L.program_documents}</h2>
      </div>
      <div className="space-y-2">
        {docs.map((d, i) => (
          <a
            key={i}
            href={d.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
          >
            <div className="w-8 h-8 rounded bg-[#1E90FF]/10 flex items-center justify-center flex-shrink-0">
              <FileText className="w-4 h-4 text-[#1E90FF]" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{d.name}</p>
              <p className="text-[10px] text-muted-foreground">{d.type} — {L.tap_to_view}</p>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
};

// Buyer-facing proof that the protection was professionally installed.
// Reads through a public, slug-keyed RPC (anon can't read install_proofs
// directly); photos come from the private bucket via short-lived signed
// URLs. Renders nothing until the RPC exists or if there are no proofs.
const VerifiedInstallsPublic = ({ slug }: { slug: string }) => {
  const [proofs, setProofs] = useState<
    { id: string; product_name: string | null; installer_company: string | null; installed_at: string | null; photo_path: string | null }[]
  >([]);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (supabase as any).rpc("get_install_proofs_public", { _slug: slug });
        const rows = (data as typeof proofs) || [];
        if (cancelled) return;
        setProofs(rows);
        const map: Record<string, string> = {};
        await Promise.all(
          rows
            .filter((r) => r.photo_path)
            .map(async (r) => {
              const { data: signed } = await supabase.storage
                .from("install-proofs")
                .createSignedUrl(r.photo_path as string, 3600);
              if (signed?.signedUrl) map[r.id] = signed.signedUrl;
            }),
        );
        if (!cancelled) setUrls(map);
      } catch {
        /* RPC not deployed yet — hide the section */
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  if (proofs.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
      <div className="flex items-center gap-2 mb-3">
        <BadgeCheck className="w-4 h-4 text-emerald-600" />
        <h2 className="text-sm font-semibold text-foreground">Verified installations</h2>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed mb-4">
        Each item below was confirmed installed on this vehicle by the installer, with a photo and timestamp.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {proofs.map((p) => (
          <div key={p.id} className="rounded-lg border border-border overflow-hidden">
            {urls[p.id] ? (
              <img src={urls[p.id]} alt={p.product_name || "Installed"} className="w-full h-32 object-cover" />
            ) : (
              <div className="w-full h-32 bg-muted flex items-center justify-center">
                <Camera className="w-5 h-5 text-muted-foreground" />
              </div>
            )}
            <div className="p-3">
              <p className="text-sm font-semibold text-foreground">{p.product_name || "Installed equipment"}</p>
              <p className="text-[10px] text-muted-foreground">
                {p.installer_company ? `${p.installer_company} · ` : ""}
                {p.installed_at ? new Date(p.installed_at).toLocaleDateString() : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default PublicListing;
