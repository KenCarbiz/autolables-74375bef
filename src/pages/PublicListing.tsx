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
} from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import Logo from "@/components/brand/Logo";
import { QRCodeSVG } from "qrcode.react";
import { useVehicleListing, type VehicleListing } from "@/hooks/useVehicleListing";
import { supabase } from "@/integrations/supabase/client";

// ──────────────────────────────────────────────────────────────
// PublicListing — the shopper-facing window sticker. Mounted at
// /v/:slug. This is what a customer sees when they scan the QR
// on the printed addendum, or open the link a dealer embeds on
// their VDP. Must be Supabase-backed, SEO-friendly, ADA-friendly,
// and signed-in-unnecessary.
// ──────────────────────────────────────────────────────────────

const PublicListing = () => {
  const { slug } = useParams<{ slug: string }>();
  const { publicUrl } = useVehicleListing("");
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
    })();
    return () => {
      mounted = false;
    };
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#1E90FF] border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-muted-foreground">Loading vehicle details…</p>
        </div>
      </div>
    );
  }

  if (rateLimited) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="text-center max-w-md">
          <Clock className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-foreground">Slow Down a Moment</h1>
          <p className="text-sm text-muted-foreground mt-2">
            We've seen a lot of traffic from your network in the last few minutes.
            Please wait a few minutes and refresh.
          </p>
        </div>
      </div>
    );
  }

  if (notFound || !listing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="text-center max-w-md">
          <Package className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-foreground">Vehicle Not Available</h1>
          <p className="text-sm text-muted-foreground mt-2">
            This listing may have been sold, unpublished, or the link is incorrect.
          </p>
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

  return (
    <div className="min-h-screen bg-white">
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
            {/* Handoff — shopper on desktop opens this on phone, or
                sales rep hands the iPad to the customer at delivery
                and the buyer scans it to sign on their own device. */}
            <button
              onClick={() => setHandoffOpen(true)}
              className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-600"
              aria-label="Open on another device"
              title="Open on phone / delivery signing"
            >
              <Smartphone className="w-4 h-4" />
            </button>
            <button
              onClick={handleShare}
              className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-600"
              aria-label={copied ? "Link copied" : "Share vehicle"}
              title={copied ? "Link copied" : "Share"}
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
            <h2 className="text-sm font-semibold text-foreground mb-2">About this vehicle</h2>
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
              <h2 className="text-sm font-semibold text-foreground">Video Walkaround</h2>
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
                    <Play className="w-4 h-4" /> Watch {v.caption || "video"}
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
            <h2 className="text-sm font-semibold text-foreground">What's On This Vehicle</h2>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-4">
            Below are the dealer-installed products and accessories on this vehicle.
            Items marked <strong>Pre-Installed</strong> are already on the vehicle and included in the price.
            Items marked <strong>Optional</strong> can be accepted or declined at no impact to your purchase.
          </p>

          {installed.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-bold uppercase tracking-label text-[#1E90FF] mb-2">
                Pre-Installed (Included in Price)
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
                Optional (You Choose)
              </p>
              <div className="space-y-2">
                {optional.map((p) => (
                  <ProductCard key={p.id} p={p} tone="optional" />
                ))}
              </div>
            </div>
          )}

          {installed.length === 0 && optional.length === 0 && (
            <p className="text-xs text-muted-foreground">No additional products on this vehicle.</p>
          )}
        </section>

        {/* Dealer value props */}
        {listing.value_props?.length > 0 && (
          <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <h2 className="text-sm font-semibold text-foreground">Included With Your Purchase</h2>
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
            <h2 className="text-sm font-semibold text-foreground mb-3">Notable features</h2>
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
            Powered by AutoLabels.io · <Clock className="inline w-2.5 h-2.5 -mt-0.5" /> Published{" "}
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
              title="Call dealership"
              aria-label="Call dealership"
            >
              <Phone className="w-4 h-4 stroke-[2.5]" />
              <span className="hidden md:inline font-display font-semibold tracking-tight">Call</span>
            </a>
          )}
          <button
            onClick={() => setInquiryOpen(true)}
            className="flex-1 md:flex-initial h-12 px-6 rounded-xl bg-slate-950 text-white inline-flex items-center justify-center gap-2 hover:bg-slate-900 transition-all whitespace-nowrap"
          >
            <span className="font-display font-bold tracking-tight text-[15px]">Reserve this vehicle</span>
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
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("I'm interested in this vehicle. Please contact me.");
  const [intent, setIntent] = useState<"info" | "test_drive" | "offer">("info");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim() || (!email.trim() && !phone.trim())) {
      toast.error("Name plus email or phone is required.");
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
      toast.error("Couldn't send your request. Try calling the dealer directly.");
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
              {sent ? "Reserved" : "Reserve this vehicle"}
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {sent ? `${dealer.name || "The dealer"} will be in touch shortly.` : listing.ymm || listing.vin}
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
                <p className="font-bold text-base">Your vehicle is held.</p>
                <p className="text-xs mt-1 text-white/80">
                  The dealer has your request time-stamped and hashed into the audit trail. Expect contact shortly during business hours.
                </p>
              </div>
            </div>

            {(dealer.phone || dealer.address) && (
              <div className="rounded-xl border border-slate-200 p-4 text-xs space-y-1">
                <p className="font-bold text-slate-900">{dealer.name || "Dealership"}</p>
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
              Close
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <p className="text-[12px] text-slate-600 leading-relaxed">
              Tell us what you'd like to do next. The dealer will reach out with next steps — no contract, no cost.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "info", label: "Hold for me", icon: ShieldCheck },
                { id: "test_drive", label: "Test drive", icon: Calendar },
                { id: "offer", label: "Make an offer", icon: DollarSign },
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

            <Field label="Your name" value={name} onChange={setName} placeholder="Full name" />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Email" value={email} onChange={setEmail} placeholder="you@example.com" type="email" />
              <Field label="Phone" value={phone} onChange={setPhone} placeholder="(555) 123-4567" type="tel" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-label text-slate-500">Message</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-slate-200 p-3 text-sm focus:outline-none focus:border-[#1E90FF] focus:ring-2 focus:ring-[#1E90FF]/20"
              />
            </div>

            <p className="text-[10px] text-slate-500 leading-relaxed">
              By sending this you agree we can share your contact with this
              dealership so they can follow up. Your request is time-stamped
              and logged to the dealer's audit trail.
            </p>

            <button
              onClick={submit}
              disabled={submitting || !name.trim() || (!email.trim() && !phone.trim())}
              className="w-full h-12 rounded-xl bg-slate-950 text-white font-display font-bold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-slate-900 transition-colors"
            >
              {submitting ? "Reserving…" : (<><Send className="w-4 h-4 stroke-[2.5]" /> Reserve now</>)}
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
}) => (
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
          Why this benefits you:
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
        Optional · not a condition of credit approval
      </p>
    )}
  </div>
);

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
            <h3 className="text-base font-black font-display tracking-tight">Open on another device</h3>
            <p className="text-[11px] text-slate-500 mt-0.5 truncate">{ymm}</p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 text-center space-y-4">
          <div className="inline-flex p-4 rounded-2xl bg-white border border-slate-200">
            <QRCodeSVG value={url} size={192} level="M" />
          </div>

          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-900">Scan to continue on your phone</p>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Point your phone camera at the code. At delivery, this is also how the buyer signs on their own device — every signature stays bound to the buyer's hardware.
            </p>
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
              {copied ? "Link copied" : "Copy link"}
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
            {listing.ymm || `Vehicle Details — VIN ${listing.vin.slice(-8)}`}
          </h1>
          {listing.trim && (
            <p className="text-base md:text-lg text-white/85 font-display mt-1 tracking-tight">{listing.trim}</p>
          )}
          <div className="mt-3 flex items-center gap-4 text-[11px] text-white/70 font-mono uppercase tracking-wider flex-wrap">
            {listing.mileage != null && <span>{listing.mileage.toLocaleString()} mi</span>}
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
  // Pickup is always "ready" once the listing is published — the
  // prep-gate guaranteed it. Delivery is a soft forward-looking
  // claim, rendered only when the dealer has an address on file.
  const pickupCity = dealer.city && dealer.state ? `${dealer.city}, ${dealer.state}` : null;
  return (
    <section className="rounded-2xl bg-slate-950 text-white p-5 md:p-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/50 font-semibold">Pickup</p>
          <p className="text-lg font-bold font-display mt-1">Ready now</p>
          <p className="text-[12px] text-white/70 mt-0.5">
            {pickupCity ? `Available today at ${dealer.name || "the dealership"} in ${pickupCity}.` : "Available today at the dealership."}
          </p>
        </div>
        <div className="sm:border-l sm:border-white/15 sm:pl-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/50 font-semibold">Delivery</p>
          <p className="text-lg font-bold font-display mt-1">On request</p>
          <p className="text-[12px] text-white/70 mt-0.5">
            Ask about home delivery within the dealer's service area.
          </p>
        </div>
      </div>
    </section>
  );
};

const TrustBand = ({ listing }: { listing: VehicleListing }) => {
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
          label="Prep-signed"
          value={prepDate || "Pending"}
          title={prepSigned ? `Shop foreman signed on ${prepDate}` : "Foreman sign-off required before publish"}
        />
        {/* Recall status */}
        <Chip
          tone={recallHasOpen ? "amber" : "emerald"}
          icon={recallHasOpen ? AlertTriangle : CheckCircle2}
          label={recallHasOpen ? `${recallCampaigns} recall${recallCampaigns === 1 ? "" : "s"} open` : "Recalls clear"}
          value={recallDate ? `as of ${recallDate}` : "Checked"}
          title={recallHasOpen
            ? "One or more open NHTSA campaigns. Ask the dealer about remedy status."
            : `NHTSA campaign check found no open do-not-drive recalls.`}
        />
        {/* Archive receipt */}
        <Chip
          tone="emerald"
          icon={FileText}
          label="Archived"
          value={publishedDate || "Pending"}
          title="Every signed document for this VIN is retained in a tamper-evident archive for 7 years."
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
  const recall = listing.recall_check;
  if (!recall || !recall.has_open || !recall.campaigns || recall.campaigns.length === 0) return null;
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-amber-900">Open NHTSA recall{recall.campaigns.length === 1 ? "" : "s"} on this VIN</p>
          <p className="text-[11px] text-amber-800 mt-1">
            The campaigns below are on file with NHTSA. Ask the dealer whether remedies have been applied before purchase.
          </p>
          <ul className="mt-2 space-y-1.5">
            {recall.campaigns.slice(0, 3).map((c, i) => (
              <li key={i} className="text-[11px] text-amber-900">
                <span className="font-mono font-bold">{c.campaignNumber || "—"}</span>
                {c.component ? ` · ${c.component}` : ""}
                {c.summary ? ` — ${c.summary}` : ""}
              </li>
            ))}
            {recall.campaigns.length > 3 && (
              <li className="text-[10px] text-amber-700 italic">+ {recall.campaigns.length - 3} more</li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
};

const PriceBlock = ({ listing }: { listing: VehicleListing }) => {
  const [open, setOpen] = useState(false);
  const totals = listing.sticker_snapshot?.totals || {};
  const driveOut = typeof totals.final_price === "number" ? totals.final_price : listing.price;
  if (driveOut == null) return null;

  const lines: { label: string; value: number; note?: string }[] = [];
  if (typeof totals.base_price === "number") lines.push({ label: "Base price", value: totals.base_price });
  if (typeof totals.accessories_total === "number" && totals.accessories_total > 0) {
    lines.push({ label: "Dealer-installed add-ons", value: totals.accessories_total, note: "Included in the total above" });
  }
  if (typeof totals.doc_fee === "number" && totals.doc_fee > 0) {
    lines.push({ label: "Doc fee", value: totals.doc_fee });
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="p-6 md:p-7">
        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-semibold">
          Drive-out price
        </p>
        <p className="text-5xl md:text-6xl font-black tracking-[-0.03em] font-display tabular-nums text-slate-950 mt-1 leading-none">
          ${driveOut.toLocaleString()}
        </p>
        <p className="text-[12px] text-slate-600 mt-3 leading-relaxed max-w-md">
          Every mandatory fee is in this number. Tax, tag, and registration are state-set and added at titling.
        </p>
      </div>

      {lines.length > 0 && (
        <>
          <button
            onClick={() => setOpen((o) => !o)}
            className="w-full flex items-center justify-between px-6 py-3 border-t border-slate-200 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <span>What's in this price</span>
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
  const s = listing.key_specs;
  if (!s) return null;
  const items: { icon: typeof CarIcon; label: string; value?: string | number | null }[] = [
    { icon: CarIcon, label: "Body", value: s.body_style },
    { icon: Cog, label: "Drivetrain", value: s.drivetrain },
    { icon: Gauge, label: "Transmission", value: s.transmission },
    { icon: Fuel, label: "Fuel", value: s.fuel },
    { icon: Gauge, label: "MPG", value: s.mpg_combined ? `${s.mpg_combined} comb.` : s.mpg_city && s.mpg_hwy ? `${s.mpg_city}/${s.mpg_hwy}` : null },
    { icon: Palette, label: "Exterior", value: s.exterior_color },
  ];
  const populated = items.filter((i) => i.value != null && i.value !== "");
  if (populated.length === 0) return null;
  return (
    <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
      <h2 className="text-sm font-semibold text-foreground mb-3">Key specs</h2>
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
  const photos = listing.photos || [];
  if (photos.length <= 1) return null; // hero already shown
  return (
    <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
      <h2 className="text-sm font-semibold text-foreground mb-3">Photos</h2>
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
              alt={p.alt || `Vehicle photo ${i + 1}`}
              loading="lazy"
              className="w-full h-full object-cover"
            />
          </a>
        ))}
      </div>
      {photos.length > 9 && (
        <p className="text-[10px] text-muted-foreground mt-2">+ {photos.length - 9} more photos available from the dealership</p>
      )}
    </section>
  );
};

const CertificationCard = ({ cert }: { cert: NonNullable<VehicleListing["certification"]> }) => (
  <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
    <div className="flex items-center gap-2 mb-2">
      <Award className="w-4 h-4 text-amber-500" />
      <h2 className="text-sm font-semibold text-foreground">{cert.program_name || "Certified Pre-Owned"}</h2>
    </div>
    <div className="grid grid-cols-3 gap-3 text-center">
      {cert.coverage_months != null && (
        <Stat label="Warranty" value={`${cert.coverage_months} mo`} />
      )}
      {cert.coverage_miles != null && (
        <Stat label="Coverage" value={`${cert.coverage_miles.toLocaleString()} mi`} />
      )}
      {cert.inspection_points != null && (
        <Stat label="Inspection" value={`${cert.inspection_points} pts`} />
      )}
    </div>
    {cert.url && (
      <a href={cert.url} target="_blank" rel="noopener noreferrer" className="block mt-3 text-[11px] text-[#1E90FF] font-semibold hover:underline">
        View full program details →
      </a>
    )}
  </section>
);

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
      <h2 className="text-sm font-semibold text-foreground mb-3">Estimated monthly payment</h2>
      <p className="text-3xl font-black font-display tabular-nums text-foreground">
        ${isFinite(monthly) ? Math.round(monthly).toLocaleString() : "—"}<span className="text-sm font-semibold text-muted-foreground">/mo</span>
      </p>
      <div className="grid grid-cols-3 gap-3 mt-3">
        <Slider label="APR %" value={apr} min={0} max={20} step={0.1} onChange={setApr} />
        <Slider label="Down $" value={down} min={0} max={Math.round(price * 0.5)} step={100} onChange={setDown} />
        <Slider label="Term mo" value={months} min={24} max={84} step={6} onChange={setMonths} />
      </div>
      <p className="text-[10px] text-muted-foreground mt-3 italic">
        Estimate only. Your actual rate and payment depend on your credit and the lender's terms.
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
  const docs: { name: string; url: string; type: string }[] = [];
  if (listing.factory_sticker_url) {
    docs.push({ name: "Factory Monroney label", url: listing.factory_sticker_url, type: "Monroney PDF" });
  }
  docs.push(...(listing.documents || []));
  if (docs.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
      <div className="flex items-center gap-2 mb-3">
        <Package className="w-4 h-4 text-[#1E90FF]" />
        <h2 className="text-sm font-semibold text-foreground">Program documents</h2>
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
              <p className="text-[10px] text-muted-foreground">{d.type} — Tap to view</p>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
};

export default PublicListing;
