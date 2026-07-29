import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronDown, Search, LayoutGrid, List, Eye, Download, Printer,
  Upload, MoreVertical, ShieldCheck, CheckCircle2, FileText, ClipboardList, BadgeCheck,
  Package, DollarSign, Car, MessageSquare, Phone, ExternalLink, X, Star, Wrench,
  TrendingUp, Clock, Settings, Building2, PenLine, Plus, Info, Globe,
  ChevronRight, FileCheck2, ClipboardX, FilePlus2,
  FileSpreadsheet, PanelsTopLeft, BookOpen, ClipboardCheck, FileSignature,
  History as HistoryIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { type VehicleListing } from "@/hooks/useVehicleListing";
import { formatPhone } from "@/components/addendum/CustomerInfoSection";
import Logo from "@/components/brand/Logo";
import { derivePassport, historyReportName } from "@/lib/passportV2Data";
import { resolvePassportBack } from "@/lib/passportReturn";
import { packetVisible } from "@/lib/packetModules";
import { trackCustomerCtaClicked } from "@/lib/engagement/customerEngagement";
import { listingHero } from "@/lib/photos";
import { documentCoverType, resolveDocumentArtwork, type ArtworkInput } from "@/lib/passport/documentArtwork";
import { countAvailableDocuments } from "@/lib/passport/documentAvailability";
import { DocumentCoverThumbnail } from "@/components/passport/DocumentCoverThumbnail";
import { usePublishedWindowSticker } from "@/hooks/usePublishedWindowSticker";
import { MOCK_LISTING } from "./VehiclePassportV3";
import { usePublicListing } from "@/hooks/usePublicListing";
import { supabase } from "@/integrations/supabase/client";
import { isSignedUrlUsable } from "@/lib/factorySticker/assets";
import { requestPassportDocumentDelivery } from "@/lib/passport/passportDocumentDelivery";
import PassportCtaDock from "@/components/passport/PassportCtaDock";
import { CARD } from "@/lib/passportTokens";

// ──────────────────────────────────────────────────────────────
// VehiclePassportDocuments — /passport-v3/:vehicleSlug/documents
//
// Premium document center in the V3 design system. Renders only the
// real documents the dealership attached to the listing (grouped by
// category); expected-but-absent types are not fabricated. Search,
// sort, category filter, grid/list, and an inline preview viewer.
// ──────────────────────────────────────────────────────────────


interface Doc { type: string; name: string; url: string; uploaded_at?: string; description?: string }

const CATEGORIES: { key: string; label: string; icon: React.ElementType; kw: RegExp }[] = [
  { key: "purchase", label: "Vehicle Purchase", icon: FileText, kw: /purchase|buyer'?s order|installment|worksheet|sales contract|bill of sale/i },
  { key: "history", label: "Vehicle History", icon: ClipboardList, kw: /carfax|autocheck|history|ownership|maintenance record/i },
  { key: "warranty", label: "Warranty", icon: ShieldCheck, kw: /warranty|maintenance plan|service contract|coverage|vsc/i },
  { key: "inspection", label: "Inspection & Compliance", icon: BadgeCheck, kw: /inspection|cpo|checklist|recall|buyers? guide|monroney|window sticker|emission|safety/i },
  { key: "accessories", label: "Accessories", icon: Package, kw: /accessor|feature sheet|equipment|add-?on|brochure/i },
  { key: "registration", label: "Registration", icon: ClipboardList, kw: /registration|title|odometer|temporary|plate|dmv/i },
  { key: "finance", label: "Finance", icon: DollarSign, kw: /finance|credit app|loan|lease|gap|payment/i },
  { key: "additional", label: "Additional Documents", icon: FileText, kw: /.*/ },
];

const categoryOf = (d: Doc) => {
  const hay = `${d.type} ${d.name}`;
  return (CATEGORIES.find((c) => c.key !== "additional" && c.kw.test(hay)) ?? CATEGORIES[CATEGORIES.length - 1]).key;
};
const fileType = (url: string) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url) ? "Image" : /\.docx?(\?|$)/i.test(url) ? "DOC" : "PDF";
const fmtDate = (s?: string) => s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

// Highlights/specs live in the passport slide-out panels (the richest
// renderers), reached via ?panel= deep links rather than the stale V2 pages.
const PASSPORT_NAV: { label: string; to?: string; panel?: string; active?: boolean }[] = [
  { label: "Overview", to: "" }, { label: "Market Intelligence", to: "market-price" }, { label: "Why This Is A Great Buy", to: "great-buy" },
  { label: "Vehicle History", to: "vehicle-history" }, { label: "Ownership Timeline", to: "ownership-timeline" }, { label: "Factory Warranty", to: "factory-warranty" },
  { label: "What Owners Say", to: "owner-reviews" }, { label: "Features & Equipment", panel: "highlights" }, { label: "Specifications", panel: "key-specs" },
  { label: "Why Buy From This Dealership?", to: "dealer" }, { label: "Documents", to: "documents", active: true },
];

// What a drawn cover is built from. Read off the listing once, per page, so
// no card re-derives year/make/model for itself.
interface CoverVehicle {
  year?: string; make?: string; model?: string; trim?: string; vin?: string;
  photo?: string | null; provider?: string | null; oemLogoUrl?: string | null;
}

// Split the stored "2025 INFINITI QX55 LUXE" once. Every card used to re-split
// it inline for its own copy.
const coverVehicleFor = (listing: VehicleListing): CoverVehicle => {
  const parts = (listing.ymm || "").trim().split(/\s+/);
  return {
    year: parts[0] || "",
    make: parts[1] || "",
    model: parts.slice(2).join(" "),
    trim: listing.trim || "",
    vin: listing.vin || "",
    photo: listingHero(listing) || null,
    oemLogoUrl: null,
  };
};

const ARTWORK_ICONS = {
  FileSpreadsheet, History: HistoryIcon, PanelsTopLeft, BookOpen, ClipboardCheck,
  Wrench, FileCheck2, ShieldCheck, FileSignature, FileText,
} as const;

// The document preview well. A document is pictured as a document: a real
// first page when a customer-safe one exists, otherwise a drawn cover for its
// type. The vehicle photograph is never used here — it belongs to the vehicle
// summary, and repeating it on six cards told the shopper nothing about what
// each record was.
//
// The well fills the card row instead of standing at a fixed height inside it,
// so the tint and the divider run the full height rather than dead-ending
// against bare white. `self-stretch` on the sheet — not a percentage height —
// is what makes that resolve: the well is itself a stretched flex item, so
// `h-full` inside it would depend on stretched items being treated as definite,
// while stretching the sheet needs no resolution at all.
const DocumentPreview = ({ input, vehicle, onQuickView }: {
  input: ArtworkInput; vehicle?: CoverVehicle; onQuickView?: () => void;
}) => {
  const art = resolveDocumentArtwork(input);
  const [failed, setFailed] = useState(false);
  const Icon = ARTWORK_ICONS[art.fallbackIcon] ?? FileText;
  const showImage = !!art.artworkUrl && !failed;
  // Height-driven, never width-driven: the sheet stands at the full height of
  // the well and takes whatever width its own page shape gives it, so an 11x8.5
  // window sticker reads as a landscape page and an 8.5x11 form as an upright
  // one. `w-full` used to fight `max-h-full` here — the box went full width and
  // the page was letterboxed inside it, which is where the dead gutters came
  // from.
  // Height-driven: the sheet stands at the well's full height and takes the
  // width its own page shape gives it, so an 11x8.5 window sticker reads as a
  // landscape page and an 8.5x11 form as an upright one.
  const sheet = art.orientation === "landscape"
    ? "self-stretch w-auto max-w-full aspect-[11/8.5]"
    : "self-stretch w-auto max-w-full aspect-[8.5/11]";

  return (
    <div className="relative w-full flex items-center justify-center overflow-hidden bg-[#F8FAFC] p-1.5 min-h-[131px] sm:min-h-[172px] sm:border-r sm:border-[#E2E8F0] lg:min-h-[131px] lg:border-r-0 xl:min-h-[172px] xl:border-r">
      {showImage ? (
        <img
          src={art.artworkUrl!}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          // Landscape (window sticker): cover + top. The frame is already the
          // page's own 11:8.5, so for a correct single-page asset this crops
          // nothing and behaves exactly like contain — but when the stored
          // preview is a legacy STACKED multi-page SVG, top-anchored cover
          // shows precisely page 1 and clips page 2 away, instead of squeezing
          // both pages into an illegible sliver. Stale assets self-heal without
          // waiting for a regeneration. Portrait forms stay contain so a
          // government form is never cropped.
          className={`${sheet} bg-white ${art.orientation === "landscape" ? "object-cover object-top" : "object-contain"}`}
          style={{ border: "1px solid rgba(15,23,42,0.10)", boxShadow: "0 2px 6px rgba(15,23,42,0.12)" }}
        />
      ) : vehicle ? (
        // A drawn cover built from this vehicle. Replaces the old icon-on-a-
        // blank-sheet, which told the shopper nothing and read as a document
        // that had failed to load.
        <DocumentCoverThumbnail
          className="self-stretch w-auto max-w-full"
          type={documentCoverType(input.type, input.title, vehicle.provider)}
          year={vehicle.year}
          make={vehicle.make}
          model={vehicle.model}
          trim={vehicle.trim}
          vin={vehicle.vin}
          primaryVehiclePhotoUrl={vehicle.photo}
          provider={vehicle.provider}
          oemLogoUrl={vehicle.oemLogoUrl}
          // The record's own name ("Retail Installment Contract") when it has
          // one, else its type label. accessibleLabel already resolves that.
          neutralTitle={art.accessibleLabel}
        />
      ) : (
        <div
          className={`${sheet} bg-white flex flex-col items-center justify-center gap-1.5 px-2`}
          style={{ border: "1px solid rgba(15,23,42,0.10)", boxShadow: "0 2px 6px rgba(15,23,42,0.12)" }}
        >
          <Icon className="w-7 h-7" strokeWidth={1.75} style={{ color: art.accentColor }} aria-hidden />
          <span className="text-[9px] font-bold tracking-[0.08em] text-center leading-tight" style={{ color: art.accentColor }}>
            {art.label}
          </span>
        </div>
      )}
      {/* Routes to the SAME handler as the button in the content area — one
          preview implementation, and never a button nested inside a button.
          The chip is small enough to sit in the well's side gutter instead of
          on top of the page; on touch the whole well is the target, so a 20px
          chip never has to serve as a 20px tap area. */}
      {onQuickView ? (
        <button
          type="button"
          onClick={onQuickView}
          title="Quick view"
          aria-label={`Quick view ${art.accessibleLabel}`}
          className="group/qv absolute inset-0 flex items-end justify-end p-1.5 sm:inset-auto sm:bottom-1.5 sm:right-1.5 sm:p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
        >
          <span className="w-7 h-7 sm:w-5 sm:h-5 rounded-md bg-white/95 border border-[#E2E8F0] text-[#475569] inline-flex items-center justify-center shadow-sm transition-colors group-hover/qv:border-[#2563EB] group-hover/qv:text-[#2563EB]">
            <Eye className="w-3.5 h-3.5 sm:w-3 sm:h-3" aria-hidden />
          </span>
        </button>
      ) : null}
    </div>
  );
};

// "Email me this packet" — the deepest-funnel shoppers on the passport are
// document seekers, and until now they converted at 0%. Uses the existing
// delivery pipeline (request -> outbox -> send-passport-document-deliveries),
// which the `passport-delivery-flush` cron drains every 5 minutes. The send
// function is service-key gated, so this anonymous session queues only — the
// confirmation copy promises a queued request, never a delivered email.
const EmailPacketCard = ({ listing, docs, availableCount, onClose }: { listing: VehicleListing; availableCount?: number; docs: Doc[]; onClose: () => void }) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = async () => {
    if (!name.trim() || !/.+@.+\..+/.test(email.trim())) { toast.error("Name and a valid email are required"); return; }
    setSending(true);
    try {
      const l = listing as unknown as { tenant_id?: string | null; id?: string; store_id?: string | null };
      await requestPassportDocumentDelivery({
        tenantId: l.tenant_id, storeId: l.store_id, vehicleId: l.id, vin: listing.vin,
        vehicleOfInterest: { ymm: listing.ymm, trim: listing.trim, price: listing.price, slug: listing.slug },
        customerName: name.trim(), customerEmail: email.trim(),
        requestedDocuments: docs.slice(0, 20).map((x) => ({ documentType: x.type || "document", documentTitle: x.name })),
      });
      setSent(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      toast.error(/not enabled/i.test(msg) ? "Document delivery isn't enabled — ask the dealership to send the packet." : "Couldn't send — please contact the dealership.");
    } finally { setSending(false); }
  };
  if (sent) return (
    <div className={`${CARD} p-5 mb-5 flex items-center gap-3`}>
      <CheckCircle2 className="w-8 h-8 text-[#16A34A] shrink-0" />
      <div className="min-w-0 flex-1"><p className="text-[14px] font-bold text-[#0F172A]">Request received</p><p className="text-[12px] text-[#64748B]">We&rsquo;ll email the packet to {email} shortly. The dealership also has your request.</p></div>
      <button onClick={onClose} className="text-[12px] font-semibold text-[#64748B] shrink-0">Close</button>
    </div>
  );
  return (
    <div className={`${CARD} p-5 mb-5`}>
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-[14px] font-bold text-[#0F172A]">Email me this packet</p><p className="text-[12px] text-[#64748B] mt-0.5">All {availableCount ?? docs.length} documents for the {listing.ymm}, straight to your inbox.</p></div>
        <button onClick={onClose} className="text-[#94A3B8] hover:text-[#0F172A] shrink-0"><X className="w-4 h-4" /></button>
      </div>
      {/* One column, always. This card lives inside the 360px status rail, and
          `sm:` is the VIEWPORT width, not the container's -- so a three-column
          grid put three fields into a 360px column and pushed the button, and
          the page, off its own right edge. */}
      <div className="grid grid-cols-1 gap-2.5 mt-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email address" className="border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button onClick={submit} disabled={sending} className="h-[42px] w-full px-5 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] disabled:opacity-60 text-white text-sm font-bold">{sending ? "Sending..." : "Send packet"}</button>
      </div>
      <p className="text-[11px] text-[#94A3B8] mt-2">By submitting, you agree the dealership may contact you about this vehicle.</p>
    </div>
  );
};

// A harvested OEM link as public-listing-view returns it. The LINK is all we
// hold: the brochure and the owner's manual stay on the manufacturer site and
// neither PDF is ever downloaded, so there is no stored page-1 to show. The
// card art is drawn instead, by DocumentCoverThumbnail.
type OemLink = {
  url: string; title?: string | null; year?: number | null;
  /** True when `url` is this dealer's own stored copy rather than the OEM site. */
  hosted?: boolean | null;
  /** The manufacturer's own URL, always present even when we serve a copy. */
  manufacturer_url?: string | null;
};

// Owner's-manual card. We hold the manufacturer's LINK and nothing else — the
// shopper opens or downloads the manual from the OEM, and no bytes are copied
// into the vehicle. hasStoredCopy still hides the card, so a manual attached by
// hand as a document does not appear twice.
const OwnersManualCard = ({
  listing, isPreview, hasStoredCopy,
}: { listing: VehicleListing; isPreview: boolean; hasStoredCopy: boolean }) => {
  const m = (listing as { oem_owners_manual?: OemLink }).oem_owners_manual;
  if (hasStoredCopy || !m?.url || !packetVisible(listing, "ownersManual")) return null;
  const mk = (listing.ymm || "").trim().split(/\s+/)[1] || "manufacturer";
  const track = (cta: string) => { if (!isPreview) trackCustomerCtaClicked({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: "passport", surface: "vehicle_passport", metadata: { cta, placement: "documents_page" } }); };
  const action = (
    <div className="flex items-center gap-2">
      <a href={m.url} target="_blank" rel="noopener noreferrer" onClick={() => track("owners_manual_open")}
        className="flex-1 h-11 sm:h-8 rounded-lg border border-[#E6E8EC] text-[13px] font-semibold text-[#2563EB] inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]">
        Open Manual <ExternalLink className="w-4 h-4" />
      </a>
      <a href={m.url} target="_blank" rel="noopener noreferrer" download onClick={() => track("owners_manual_download")}
        className="flex-1 h-11 sm:h-8 rounded-lg bg-[#2563EB] text-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-[#1D4ED8]">
        <Download className="w-4 h-4" /> Download
      </a>
    </div>
  );
  const openManual = () => { track("owners_manual_open"); window.open(m.url, "_blank", "noopener"); };
  return (
    <RecordCard
      cover={<DocumentPreview input={{ type: "owners_manual", title: "Owner's Manual" }} vehicle={coverVehicleFor(listing)} onQuickView={openManual} />}
      title={`Official ${mk.toUpperCase()} Owner's Manual${m.year ? ` (${m.year})` : ""}`}
      source={`${mk.toUpperCase()} · Manufacturer source`}
      status={m.hosted ? "available" : "external"}
      explanation="The manufacturer's official owner's manual for this year and model."
      meta={m.hosted
        ? <span className="inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> Saved with this vehicle &middot; yours to keep</span>
        : <span className="inline-flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" /> Opens on the manufacturer site</span>}
      action={action}
      why="The owner's manual explains the exact features, controls and maintenance for this vehicle's build."
    />
  );
};

// Status system for the Document Center. Green is reserved for records that are
// actually available or verified — never for a manufacturer link that merely
// exists (those are the neutral "External Source").
type DocStatus = "available" | "verified" | "signed" | "external" | "request" | "pending" | "unavailable";
const STATUS_STYLE: Record<DocStatus, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  available: { label: "Available Now", cls: "text-[#15803D] bg-emerald-50 ring-emerald-100", icon: CheckCircle2 },
  verified: { label: "Verified Copy", cls: "text-[#15803D] bg-emerald-50 ring-emerald-100", icon: BadgeCheck },
  signed: { label: "Signed Copy", cls: "text-[#15803D] bg-emerald-50 ring-emerald-100", icon: PenLine },
  external: { label: "External Source", cls: "text-[#475569] bg-slate-100 ring-slate-200", icon: ExternalLink },
  request: { label: "Available by Request", cls: "text-[#1d4ed8] bg-blue-50 ring-blue-100", icon: MessageSquare },
  pending: { label: "Pending", cls: "text-[#B45309] bg-amber-50 ring-amber-100", icon: Clock },
  unavailable: { label: "Not Available", cls: "text-[#64748B] bg-slate-50 ring-slate-200", icon: X },
};
const StatusBadge = ({ status }: { status: DocStatus }) => {
  const s = STATUS_STYLE[status];
  return <span className={`inline-flex items-center gap-1 text-[11px] font-bold rounded-full px-2 py-0.5 ring-1 ${s.cls}`}><s.icon className="w-3 h-3" /> {s.label}</span>;
};

// Records a shopper may ASK the dealership for. These are request options, never
// presented as currently-available documents (data boundary).
// `satisfiedBy` is the cover types that already answer this request. When one
// of them is on the page the chip is dropped -- asking a shopper to request the
// document they are looking at reads as though we cannot see our own page.
// "Other Document" has none, so it always stays.
const REQUEST_OPTIONS: { key: string; label: string; icon: typeof FileText; tint: string; satisfiedBy?: string[] }[] = [
  { key: "buyers_guide", label: "Buyer's Guide", icon: FileText, tint: "bg-blue-50 text-[#2563EB]", satisfiedBy: ["buyers_guide"] },
  { key: "window_sticker", label: "Window Sticker / Build Sheet", icon: Car, tint: "bg-blue-50 text-[#2563EB]", satisfiedBy: ["factory_sticker"] },
  { key: "warranty", label: "Warranty Information", icon: ShieldCheck, tint: "bg-emerald-50 text-[#059669]", satisfiedBy: ["warranty"] },
  { key: "verification", label: "Verification Report", icon: BadgeCheck, tint: "bg-teal-50 text-[#0D9488]" },
  { key: "inspection", label: "Inspection Report", icon: ClipboardX, tint: "bg-amber-50 text-[#D97706]", satisfiedBy: ["inspection"] },
  { key: "signed_price", label: "Signed Price Record", icon: PenLine, tint: "bg-purple-50 text-[#7C3AED]", satisfiedBy: ["signed_record"] },
  { key: "service", label: "Service Records", icon: Wrench, tint: "bg-orange-50 text-[#EA580C]", satisfiedBy: ["service_record"] },
  { key: "other", label: "Other Document", icon: FilePlus2, tint: "bg-slate-100 text-[#64748B]" },
];

// Documents-page loading skeleton — mirrors the two-column Document Center so the
// layout doesn't jump when data arrives. Scoped to this page only.
const DocSkeleton = () => (
  <div className="min-h-[100svh] bg-[#F6F7F9]" style={{ fontFamily: "Inter, -apple-system, sans-serif" }}>
    <div className="bg-white border-b border-[#E6E8EC] h-16" />
    <div className="lg:grid lg:grid-cols-[280px_1fr]">
      <div className="hidden lg:block border-r border-[#E6E8EC] bg-white h-screen p-5">
        <div className="rounded-xl border border-[#E6E8EC] p-3 animate-pulse"><div className="w-full aspect-[16/10] rounded-lg bg-slate-100" /><div className="h-4 bg-slate-100 rounded mt-3 w-3/4" /><div className="h-3 bg-slate-100 rounded mt-2 w-1/2" /></div>
      </div>
      <div className="px-5 lg:px-8 py-6 max-w-[1200px] w-full">
        <div className="animate-pulse">
          <div className="h-7 bg-slate-200 rounded w-72" />
          <div className="h-4 bg-slate-100 rounded w-96 mt-3" />
          <div className="flex gap-2 mt-4">{[0, 1, 2].map((i) => <div key={i} className="h-7 bg-slate-100 rounded-full w-40" />)}</div>
          <div className="grid lg:grid-cols-[1fr_320px] gap-6 mt-6">
            <div className="grid sm:grid-cols-2 gap-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-40 bg-white rounded-2xl ring-1 ring-slate-100" />)}</div>
            <div className="h-64 bg-white rounded-2xl ring-1 ring-slate-100" />
          </div>
        </div>
      </div>
    </div>
  </div>
);

// A real, visual record card: a document preview on the left, one clear status,
// and a four-line content column — status · title · what it is · where it came
// from — over a single action row.
//
// Every arbitrary text size carries its own `leading-*`: without one they
// inherit Tailwind's 1.5 root line-height, which spent ~5px of strut per line
// on a card that has five of them. `source` rides the meta line and the "Why
// this matters" disclosure rides the status line, so a card with either costs
// no extra row. The preview well is a flex child of a stretched wrapper, so it
// fills the row height the content column sets rather than pinning its own.
const RecordCard = ({ cover, title, source, status, explanation, meta, action, why }: {
  cover: ReactNode; title: string; source: string; status: DocStatus; explanation?: string; meta?: ReactNode; action: ReactNode; why?: string;
}) => (
  // The row layout needs ~250px for the well plus a readable content column.
  // Between lg and xl the page gives this card only ~296px, so it stacks there
  // and returns to a row at xl.
  <div className="rounded-2xl border border-[#E2E8F0] bg-white overflow-hidden flex flex-col sm:flex-row lg:flex-col xl:flex-row">
    {/* The well itself is flush with the card edge, but the sheet inside it is
        inset 6px by the well's padding, which keeps it clear of the 16px
        `rounded-2xl` corner arc — so widening the sheet cannot get its left
        corners shaved by the card's `overflow-hidden`. */}
    <div className="shrink-0 flex w-full sm:w-[250px] lg:w-full xl:w-[250px]">{cover}</div>
    <div className="flex-1 min-w-0 flex flex-col justify-center px-4 py-3 sm:py-1.5 lg:py-3 xl:py-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 leading-none">
        <StatusBadge status={status} />
        {why && (
          <details className="group ml-auto open:basis-full">
            <summary className="text-[12px] leading-[1.25] font-semibold text-[#2563EB] cursor-pointer list-none inline-flex items-center gap-1">Why this matters <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" /></summary>
            <p className="text-[12.5px] leading-snug text-[#64748B] mt-1.5">{why}</p>
          </details>
        )}
      </div>
      <p className="text-[15px] leading-[1.15] font-bold text-[#0F172A] mt-1 truncate">{title}</p>
      {explanation && <p className="text-[12.5px] leading-[1.3] text-[#475569] mt-1 line-clamp-1">{explanation}</p>}
      <div className="mt-1 text-[11.5px] leading-[1.25] text-[#64748B] flex items-center gap-x-2 overflow-hidden whitespace-nowrap">
        <span className="min-w-0 truncate">{source}</span>
        {meta && <><span aria-hidden className="text-[#CBD5E1] shrink-0">·</span><span className="shrink-0 inline-flex items-center gap-x-2">{meta}</span></>}
      </div>
      <div className="mt-1.5">{action}</div>
    </div>
  </div>
);
// The generated factory build record, served only when its generated_documents
// row is published (get_published_documents_public returns nothing else).
interface FactoryStickerDoc {
  id: string;
  version: number;
  pdf_url?: string | null;
  online_url?: string | null;
  published_at?: string | null;
}

// Customer-safe wording only — internal pipeline statuses never reach shoppers.
// UNVERIFIED_GENERIC is deliberately absent: no verification claim is made.
const FACTORY_VERIFICATION_BADGE: Record<string, string> = {
  AUTO_VERIFIED: "Factory Build Data Verified",
  PROVIDER_DECODED: "OEM Data Matched",
  OEM_DATA_MATCHED: "OEM Data Matched",
  DEALER_VERIFIED: "Dealer Verified",
};

const VehiclePassportDocuments = () => {
  const params = useParams<{ vehicleSlug?: string; slug?: string }>();
  const vehicleSlug = params.vehicleSlug ?? params.slug;
  const navigate = useNavigate();
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("newest");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [preview, setPreview] = useState<Doc | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [reqSel, setReqSel] = useState<Set<string>>(() => new Set());
  const [factoryDoc, setFactoryDoc] = useState<FactoryStickerDoc | null>(null);
  const [factoryVerification, setFactoryVerification] = useState<string | null>(null);

  const isPreview = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("preview");

  const { listing, loading, notFound } = usePublicListing(vehicleSlug, { preview: isPreview, previewData: MOCK_LISTING as unknown as VehicleListing });
  // The real page-1 preview asset filed alongside the published PDF. The card
  // was resolving to a drawn cover only because nothing handed it this URL.
  const { sticker: publishedSticker } = usePublishedWindowSticker(listing?.slug || null, !isPreview);


  const d = useMemo(() => (listing ? derivePassport(listing) : null), [listing]);
  // Server strips excluded docs on live listings; this mirrors it for
  // preview/mock data so curation previews stay honest.
  const allDocs = useMemo(() => ((listing?.documents as Doc[] | undefined) || [])
    .filter((x) => x.name && x.url)
    .filter((x) => (x.type === "window_sticker" ? packetVisible(listing, "oemSticker") : packetVisible(listing, "documents"))), [listing]);
  // Real most-recent upload date — never a hardcoded timestamp.
  const lastUpdated = useMemo(() => {
    const ts = allDocs.map((x) => x.uploaded_at).filter((t): t is string => !!t).sort().pop();
    return ts ? new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
  }, [allDocs]);
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    allDocs.forEach((x) => { const k = categoryOf(x); m[k] = (m[k] || 0) + 1; });
    return m;
  }, [allDocs]);

  const filtered = useMemo(() => {
    let list = allDocs;
    if (cat !== "all") list = list.filter((x) => categoryOf(x) === cat);
    if (q.trim()) { const s = q.toLowerCase(); list = list.filter((x) => `${x.name} ${x.type} ${x.description ?? ""}`.toLowerCase().includes(s)); }
    const sorted = [...list];
    if (sort === "newest") sorted.sort((a, b) => (b.uploaded_at || "").localeCompare(a.uploaded_at || ""));
    else if (sort === "oldest") sorted.sort((a, b) => (a.uploaded_at || "").localeCompare(b.uploaded_at || ""));
    else if (sort === "alpha") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "category") sorted.sort((a, b) => categoryOf(a).localeCompare(categoryOf(b)));
    return sorted;
  }, [allDocs, cat, q, sort]);

  const grouped = useMemo(() => CATEGORIES.map((c) => ({ c, docs: filtered.filter((x) => categoryOf(x) === c.key) })).filter((g) => g.docs.length > 0), [filtered]);

  // Published factory build record via the same anon-safe RPC that backs the
  // passport document list — only published rows exist in its result, so an
  // unpublished or review-held sticker can never appear here. Honors the
  // dealer's packet documents toggle like every other document on this page.
  useEffect(() => {
    const s = listing?.slug;
    if (!s || isPreview || !packetVisible(listing, "documents")) { setFactoryDoc(null); setFactoryVerification(null); return; }
    let cancelled = false;
    (async () => {
      try {
        // The RPC's parameter was renamed across migrations (p_slug vs _slug);
        // accept either deployment.
        // deno-lint-ignore no-explicit-any
        let res = await (supabase as any).rpc("get_published_documents_public", { p_slug: s });
        // deno-lint-ignore no-explicit-any
        if (res.error) res = await (supabase as any).rpc("get_published_documents_public", { _slug: s });
        const rows = (Array.isArray(res.data) ? res.data : []) as (FactoryStickerDoc & { document_type?: string })[];
        const doc = rows
          .filter((r) => r.document_type === "factory_sticker" && (r.pdf_url || r.online_url))
          .sort((a, b) => (b.version || 0) - (a.version || 0))[0] || null;
        if (cancelled) return;
        if (doc) {
          // Stored asset URLs are signed and expire; re-mint unless the
          // cached credential is provably still valid.
          const cached = doc.pdf_url || doc.online_url || null;
          if (!isSignedUrlUsable(cached, Date.now())) {
            try {
              const { data: asset } = await supabase.functions.invoke("public-document-asset", {
                body: { slug: s, document_type: "factory_sticker", asset_type: "pdf" },
              });
              const payload = (asset || {}) as { success?: boolean; url?: string };
              if (payload.success === true && payload.url) doc.pdf_url = payload.url;
            } catch { /* the card falls back to the stored URL */ }
          }
        }
        setFactoryDoc(doc);
        if (doc && listing?.id) {
          // Verification detail is tenant-RLS'd: signed-in dealership staff see
          // the badge source; anonymous shoppers simply get no badge.
          // deno-lint-ignore no-explicit-any
          const { data: rec } = await (supabase as any)
            .from("factory_sticker_records")
            .select("verification_status")
            .eq("vehicle_id", listing.id)
            .maybeSingle();
          if (!cancelled) setFactoryVerification((rec?.verification_status as string) || null);
        } else {
          setFactoryVerification(null);
        }
      } catch { if (!cancelled) { setFactoryDoc(null); setFactoryVerification(null); } }
    })();
    return () => { cancelled = true; };
  }, [listing, isPreview]);

  if (loading) return <DocSkeleton />;
  if (notFound || !listing || !d) return (
    <div className="min-h-[100svh] flex items-center justify-center px-6 bg-[#F6F7F9]"><div className="text-center"><FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" /><h1 className="text-xl font-bold">Documents unavailable</h1></div></div>
  );

  const slug = listing.slug || vehicleSlug;
  // Passport ROOT nav (empty section) honors a validated returnTo so a V3-launched
  // Documents visit returns to /v3/:slug; deep-section links stay on /v/:slug.
  const pp = (s: string) =>
    s ? `/v/${slug}/${s}${isPreview ? "?preview=1" : ""}` : resolvePassportBack(window.location.search, slug || "", isPreview);
  const hero = listingHero(listing);
  const coverVehicle = coverVehicleFor(listing);
  const total = allDocs.length;
  const adv = d.dealerTrust;
  const share = async (url: string) => { try { if (navigator.share) { await navigator.share({ url }); return; } } catch { return; } await navigator.clipboard.writeText(url); toast.success("Link copied"); };
  const CAT_TABS = [{ key: "all", label: "All Documents" }, ...CATEGORIES.filter((c) => (counts[c.key] || 0) > 0).map((c) => ({ key: c.key, label: c.label.replace("Vehicle ", "").replace(" & Compliance", "") }))];

  // Print packet manifest — grouped over ALL included docs (never the
  // active search/category filter) so Print always emits the full packet.
  const printGroups = CATEGORIES.map((c) => ({ c, docs: allDocs.filter((x) => categoryOf(x) === c.key) })).filter((g) => g.docs.length > 0);
  const printedOn = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const oemBrochure = (listing as { oem_brochure?: OemLink }).oem_brochure;
  const brochureMk = (listing.ymm || "").trim().split(/\s+/)[1] || "";
  const printLinks: { title: string; note: string; url: string }[] = [];
  if (d.historyReport && packetVisible(listing, "historyReport"))
    printLinks.push({ title: `${historyReportName(d.historyReport.provider)} Vehicle History Report`, note: d.historyReport.source === "vin" ? "Official record for this VIN" : "External report link", url: d.historyReport.url });
  if (oemBrochure?.url && packetVisible(listing, "brochure"))
    printLinks.push({ title: `Official ${brochureMk.toUpperCase()} Brochure${oemBrochure.year ? ` (${oemBrochure.year})` : ""}`, note: "Manufacturer website", url: oemBrochure.url });
  const oemManual = (listing as { oem_owners_manual?: OemLink }).oem_owners_manual;
  if (oemManual?.url && packetVisible(listing, "ownersManual") && !allDocs.some((x) => x.type === "owners_manual"))
    printLinks.push({ title: `Official ${brochureMk.toUpperCase()} Owner's Manual${oemManual.year ? ` (${oemManual.year})` : ""}`, note: "Manufacturer website", url: oemManual.url });
  if (listing.oem_sticker_url && packetVisible(listing, "oemSticker") && !allDocs.some((x) => x.type === "window_sticker"))
    printLinks.push({ title: "Original OEM Window Sticker", note: "Factory Monroney label", url: listing.oem_sticker_url });
  const factoryDocUrl = factoryDoc ? (factoryDoc.pdf_url || factoryDoc.online_url || "") : "";
  const isNewCar = listing.condition === "new";
  const factoryTitle = isNewCar ? "Factory Window Sticker" : "Original Factory Build & MSRP Record";
  const factorySubtitle = isNewCar ? "Factory Configuration & MSRP" : "VIN-Specific Factory Configuration When New";
  if (factoryDocUrl)
    printLinks.push({ title: factoryTitle, note: factorySubtitle, url: factoryDocUrl });

  // ── Document Center data (real records only — never fabricated) ──
  const dealerName = d.dealerName || "the dealership";
  const vinLast = (listing.vin || "").slice(-6);
  const uploaded = allDocs.map((doc) => ({ doc, status: (/sign|addendum|disclosure/i.test(doc.type) ? "signed" : "available") as DocStatus }));
  const signedCount = uploaded.filter((u) => u.status === "signed").length;
  const verifiedCount = allDocs.filter((x) => (x as { verified?: boolean }).verified === true).length;
  // External/manufacturer links — accessible now, but on an outside site.
  const histLink = d.historyReport && packetVisible(listing, "historyReport") ? d.historyReport : null;
  const brochureLink = oemBrochure?.url && packetVisible(listing, "brochure") ? oemBrochure : null;
  const brochureBrand = (() => { const mk = (listing.ymm || "").trim().split(/\s+/)[1]; return mk ? `${mk}.com` : "the manufacturer's site"; })();
  const manualStored = allDocs.some((x) => x.type === "owners_manual");
  const manualLink = oemManual?.url && packetVisible(listing, "ownersManual") && !manualStored ? oemManual : null;
  const stickerLink = listing.oem_sticker_url && packetVisible(listing, "oemSticker") && !allDocs.some((x) => x.type === "window_sticker") ? listing.oem_sticker_url : null;
  const availableCount = countAvailableDocuments({
    uploadedCount: uploaded.length,
    hasFactoryRecord: !!factoryDocUrl,
    externalLinks: [histLink?.url, brochureLink?.url, manualLink?.url, stickerLink],
  });
  const lastChecked = lastUpdated || "Today";
  // Do not ask a shopper to request a record that is sitting on the same page.
  // The chip list is filtered against what is actually available, through the
  // one type vocabulary, so a rename on either side cannot desynchronise them.
  //
  // Deliberately NOT a hook: everything below here runs after the loading and
  // not-found returns above, so a useMemo here would make the first render call
  // fewer hooks than the second (React #310) and take the page down.
  const requestOptions = (() => {
    const present = new Set<string>();
    for (const doc of allDocs) present.add(documentCoverType(doc.type, doc.name));
    if (factoryDocUrl) present.add("factory_sticker");
    if (stickerLink) present.add("factory_sticker");
    if (histLink) present.add(histLink.provider === "autocheck" ? "vehicle_history" : "carfax");
    if (brochureLink) present.add("oem_brochure");
    if (manualLink) present.add("owners_manual");
    return REQUEST_OPTIONS.filter((o) => !o.satisfiedBy?.some((k) => present.has(k)));
  })();
  const trackDoc = (cta: string, meta: Record<string, unknown> = {}) => { if (!isPreview) trackCustomerCtaClicked({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: "passport", surface: "vehicle_passport", metadata: { cta, placement: "documents_page", ...meta } }); };
  const toggleReq = (k: string) => setReqSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const requestSelected = () => {
    trackDoc("request_documents", { selected: [...reqSel] });
    const keys = [...reqSel];
    const qs = keys.length ? `?req=${encodeURIComponent(keys.join(","))}${isPreview ? "&preview=1" : ""}` : (isPreview ? "?preview=1" : "");
    navigate(`/v/${slug}/check-availability${qs}`);
  };

  const uploadedAction = (doc: Doc) => (
    <div className="flex items-center gap-2">
      <button onClick={() => setPreview(doc)} className="flex-1 h-11 sm:h-8 rounded-lg border border-[#E6E8EC] text-[13px] font-semibold text-[#2563EB] inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><Eye className="w-4 h-4" /> Preview</button>
      <a href={doc.url} download target="_blank" rel="noopener noreferrer" className="flex-1 h-11 sm:h-8 rounded-lg bg-[#2563EB] text-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-[#1d4fd7]"><Download className="w-4 h-4" /> Download</a>
    </div>
  );
  const externalAction = (url: string, label: string, cta: string, meta: Record<string, unknown> = {}) => (
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={() => trackDoc(cta, meta)} className="h-11 sm:h-8 w-fit px-4 rounded-lg bg-[#2563EB] text-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-[#1d4fd7]">{label} <ExternalLink className="w-4 h-4" /></a>
  );
  // Quick View on an external record does exactly what that record's own
  // action does — same destination, same tracked event. No second viewer.
  const openExternal = (url: string, cta: string, meta: Record<string, unknown> = {}) => () => {
    trackDoc(cta, meta);
    window.open(url, "_blank", "noopener");
  };
  const openFactoryRecord = () => { trackDoc("factory_build_record_view"); setPreview({ type: "factory_sticker", name: factoryTitle, url: factoryDocUrl }); };

  return (
    <div className="vpd-doc-root min-h-[100svh] bg-[#F6F7F9] text-[#0F172A]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <Helmet><title>{`Documents — ${listing.ymm} · AutoLabels`}</title><meta name="robots" content="noindex" /></Helmet>

      {/* Print/save-to-PDF manifest: a clean US-Letter document packet index,
          not a screenshot of the interactive grid. Screen chrome is hidden by
          the scoped rule below; this block is the only thing that prints. */}
      <style>{`@media print { .vpd-doc-root > :not(.vpd-print) { display: none !important; } .vpd-print { display: block !important; } }`}</style>
      <div className="vpd-print hidden print:block bg-white text-[#0F172A] px-1">
        <div className="flex items-center justify-between border-b-2 border-[#0F172A] pb-3 mb-4">
          <Logo variant="full" size={20} />
          <div className="text-right">
            <p className="text-[15px] font-bold">Vehicle Document Packet</p>
            <p className="text-[11px] text-[#475569]">Generated {printedOn}</p>
          </div>
        </div>
        <div className="mb-5">
          <p className="text-[20px] font-bold leading-tight">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</p>
          <p className="text-[12px] text-[#334155] mt-1">
            VIN {listing.vin}
            {listing.mileage != null ? ` · ${listing.mileage.toLocaleString()} mi` : ""}
            {d.dealerName ? ` · ${d.dealerName}` : ""}
          </p>
        </div>
        {printLinks.length > 0 && (
          <div className="mb-5 break-inside-avoid">
            <h2 className="text-[13px] font-bold uppercase tracking-wide text-[#475569] border-b border-[#CBD5E1] pb-1 mb-2">Linked Reports</h2>
            {printLinks.map((l, i) => (
              <div key={i} className="break-inside-avoid py-2 border-b border-[#EEF1F4]">
                <p className="text-[13px] font-semibold">{l.title}</p>
                <p className="text-[11px] text-[#475569]">{l.note}</p>
                <p className="text-[10px] text-[#2563EB] break-all">{l.url}</p>
              </div>
            ))}
          </div>
        )}
        {printGroups.map(({ c, docs }) => (
          <div key={c.key} className="mb-5 break-inside-avoid">
            <h2 className="text-[13px] font-bold uppercase tracking-wide text-[#475569] border-b border-[#CBD5E1] pb-1 mb-2">{c.label} <span className="font-normal">({docs.length})</span></h2>
            {docs.map((doc, i) => (
              <div key={i} className="break-inside-avoid flex items-baseline justify-between gap-4 py-1.5 border-b border-[#EEF1F4]">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">{doc.name}</p>
                  {doc.description && <p className="text-[11px] text-[#475569]">{doc.description}</p>}
                </div>
                <span className="text-[10px] text-[#475569] shrink-0 whitespace-nowrap">Dealer Provided · {fileType(doc.url)}{doc.uploaded_at ? ` · ${fmtDate(doc.uploaded_at)}` : ""}</span>
              </div>
            ))}
          </div>
        ))}
        {printLinks.length === 0 && printGroups.length === 0 && (
          <p className="text-[13px] text-[#475569]">No documents are currently included in this packet. Contact {d.dealerName || "the dealership"} to request documents.</p>
        )}
        <div className="mt-6 pt-3 border-t border-[#CBD5E1] text-[11px] text-[#475569]">View the full digital packet at autolabels.io/v/{slug} · Generated {printedOn}</div>
      </div>

      {/* Top bar */}
      <header className="bg-white border-b border-[#E6E8EC] px-5 lg:px-8 h-16 flex items-center justify-between">
        <Logo variant="full" size={22} />
        <div className="flex items-center gap-5 text-[13px] text-[#64748B]">
          <button onClick={() => share(window.location.href)} className="inline-flex items-center gap-1.5 hover:text-[#0F172A]"><Upload className="w-4 h-4" /> <span className="hidden sm:inline">Share</span></button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 hover:text-[#0F172A]"><Printer className="w-4 h-4" /> <span className="hidden sm:inline">Print</span></button>
          <button onClick={() => navigate(pp("check-availability"))} className="h-10 px-4 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-[13px] font-semibold inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Check Availability</button>
        </div>
      </header>

      <div className="lg:grid lg:grid-cols-[280px_1fr]">
        {/* Left sidebar */}
        <aside className="hidden lg:flex flex-col border-r border-[#E6E8EC] bg-white sticky top-0 h-screen overflow-y-auto px-5 py-5">
          <button onClick={() => navigate(pp(""))} className="text-[13px] font-semibold text-[#2563EB] inline-flex items-center gap-1.5 mb-4 self-start"><ChevronLeft className="w-4 h-4" /> Back to Passport</button>
          <div className="rounded-xl border border-[#E6E8EC] p-3">
            {hero && <img src={hero} alt="" className="w-full aspect-[16/10] object-cover rounded-lg" />}
            <p className="text-[15px] font-bold mt-2.5 leading-tight">{listing.ymm}</p>
            {listing.trim && <p className="text-[12px] text-[#64748B]">{listing.trim}</p>}
            <p className="text-[11px] text-[#94A3B8] mt-1.5">VIN {listing.vin}</p>
            <p className="text-[11px] text-[#94A3B8]">Stock # {listing.vin.slice(-6)}{listing.mileage != null ? ` · ${listing.mileage.toLocaleString()} mi` : ""}</p>
            <button onClick={() => navigate(pp(""))} className="mt-3 w-full h-11 sm:h-8 rounded-lg border border-[#E6E8EC] text-[12px] font-bold inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><ExternalLink className="w-3.5 h-3.5 text-[#2563EB]" /> View Full Passport</button>
          </div>
          <nav className="mt-4 space-y-0.5 flex-1">
            {PASSPORT_NAV.map((n) => (
              <button key={n.label} onClick={() => navigate(n.panel ? `/v/${slug}?panel=${n.panel}${isPreview ? "&preview=1" : ""}` : pp(n.to || ""))} className={`w-full text-left px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${n.active ? "bg-blue-50 text-[#2563EB]" : "text-[#64748B] hover:bg-slate-50"}`}>{n.label}</button>
            ))}
          </nav>
          <div className="mt-4 rounded-xl border border-[#E6E8EC] bg-[#fafbfc] p-4">
            <p className="text-[13px] font-bold">Questions?</p>
            <p className="text-[12px] text-[#64748B]">We're here to help.</p>
            <div className="flex items-center gap-2.5 mt-3">
              {adv.advisorPhoto ? <img src={adv.advisorPhoto} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" /> : <span className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0"><Building2 className="w-5 h-5 text-[#2563EB]" /></span>}
              <div className="min-w-0"><p className="text-[12px] font-bold leading-tight">{adv.advisorName || d.dealerName}</p>{adv.advisorTitle && <p className="text-[10px] text-[#64748B]">{adv.advisorTitle}</p>}{d.reviewRating != null && <div className="inline-flex gap-0.5 mt-0.5">{[0,1,2,3,4].map((i) => <Star key={i} className="w-3 h-3 text-amber-400" fill={i < Math.round(d.reviewRating!) ? "#F59E0B" : "none"} strokeWidth={1.5} />)}</div>}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              {d.dealerPhone ? <a href={`tel:${d.dealerPhone}`} className="h-8 rounded-lg border border-[#E6E8EC] text-[11px] font-bold inline-flex items-center justify-center gap-1 hover:border-[#2563EB]"><Phone className="w-3 h-3 text-[#2563EB]" /> {adv.advisorName ? `Call ${adv.advisorName.split(" ")[0]}` : "Call"}</a> : <button onClick={() => navigate(pp("contact"))} className="h-8 rounded-lg border border-[#E6E8EC] text-[11px] font-bold inline-flex items-center justify-center gap-1"><Phone className="w-3 h-3 text-[#2563EB]" /> Call</button>}
              <button onClick={() => navigate(pp("contact"))} className="h-8 rounded-lg border border-[#E6E8EC] text-[11px] font-bold inline-flex items-center justify-center gap-1 hover:border-[#2563EB]"><MessageSquare className="w-3 h-3 text-[#2563EB]" /> Message</button>
            </div>
          </div>
        </aside>

        {/* Main workspace — Vehicle Document Center (redesign scope: this page only) */}
        <main className="px-5 lg:px-8 py-6 min-w-0">
          <div className="mx-auto max-w-[1200px]">
            {/* Header */}
            <div>
              <h1 className="text-[28px] font-bold tracking-tight">Vehicle Document Center</h1>
              <p className="text-[14px] text-[#64748B] mt-1.5">Review available records for this vehicle or request a copy from {dealerName}.</p>
              <p className="text-[13px] text-[#475569] mt-2.5 inline-flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-[#64748B]" /> Every document is clearly labeled by its source and availability.</p>
              <div className="flex flex-wrap items-center gap-2.5 mt-4">
                <span className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-[#15803D] bg-emerald-50 ring-1 ring-emerald-100 rounded-full px-3.5 py-1.5"><CheckCircle2 className="w-4 h-4" /> {availableCount} Available Now</span>
                {vinLast && <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#1d4ed8] bg-blue-50 ring-1 ring-blue-100 rounded-full px-3.5 py-1.5"><ExternalLink className="w-4 h-4" /> Connected to VIN {vinLast}</span>}
                <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#475569] bg-white ring-1 ring-slate-200 rounded-full px-3.5 py-1.5"><Info className="w-4 h-4 text-[#94A3B8]" /> Additional records available by request</span>
              </div>
            </div>

            {/* Row 1: Available Now + Document Status */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 mt-6 items-start">
              <div className={`${CARD} p-5`}>
                <p className="text-[16px] font-bold text-[#0F172A]">Available Now</p>
                <p className="text-[13px] text-[#64748B] mt-0.5 mb-4">Documents you can view immediately.</p>
                {availableCount > 0 ? (
                  <div className="space-y-2.5">
                    {uploaded.map(({ doc, status }, i) => (
                      <RecordCard key={`u-${i}`}
                        cover={<DocumentPreview input={{ type: doc.type, title: doc.name, url: doc.url }} vehicle={coverVehicle} onQuickView={() => setPreview(doc)} />}
                        title={doc.name}
                        source={`Provided by ${dealerName}`}
                        status={status}
                        explanation={doc.description || (doc.type === "window_sticker" ? "Original factory window sticker — MSRP and equipment as built." : "Provided by the dealership for this vehicle.")}
                        meta={<span className="inline-flex items-center gap-1">{fileType(doc.url)}{doc.uploaded_at ? ` · Added ${fmtDate(doc.uploaded_at)}` : ""}</span>}
                        action={uploadedAction(doc)} />
                    ))}
                    {factoryDocUrl && factoryDoc && (
                      <RecordCard
                        cover={<DocumentPreview input={{ type: isNewCar ? "window_sticker" : "build_sheet", title: isNewCar ? "Window Sticker" : "Build Record", thumbnailUrl: publishedSticker?.thumbnailUrl ?? null }} vehicle={coverVehicle} onQuickView={openFactoryRecord} />}
                        title={factoryTitle}
                        source={factorySubtitle}
                        status="available"
                        explanation={`The equipment, packages and MSRP this exact VIN carried when it left the factory, prepared by ${dealerName} from the factory build data.`}
                        meta={<>
                          {factoryVerification && FACTORY_VERIFICATION_BADGE[factoryVerification] && (
                            <span className="inline-flex items-center gap-1 text-[#15803D] font-semibold"><BadgeCheck className="w-3.5 h-3.5" /> {FACTORY_VERIFICATION_BADGE[factoryVerification]}</span>
                          )}
                          <span className="inline-flex items-center gap-1">PDF{factoryDoc.published_at ? ` · Added ${fmtDate(factoryDoc.published_at)}` : ""}</span>
                        </>}
                        action={
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              onClick={openFactoryRecord}
                              className="h-11 sm:h-8 px-3.5 rounded-lg border border-[#E6E8EC] text-[13px] font-semibold text-[#2563EB] inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"
                            >
                              <Eye className="w-4 h-4" /> View Document
                            </button>
                            <a
                              href={factoryDoc.pdf_url || factoryDocUrl} download target="_blank" rel="noopener noreferrer"
                              onClick={() => trackDoc("factory_build_record_download")}
                              className="h-11 sm:h-8 px-3.5 rounded-lg bg-[#2563EB] text-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-[#1d4fd7]"
                            >
                              <Download className="w-4 h-4" /> Download PDF
                            </a>
                            <button
                              onClick={() => { trackDoc("factory_build_record_print"); window.open(factoryDocUrl, "_blank", "noopener"); }}
                              className="h-11 sm:h-8 px-3.5 rounded-lg border border-[#E6E8EC] text-[13px] font-semibold text-[#0F172A] inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"
                            >
                              <Printer className="w-4 h-4" /> Print
                            </button>
                          </div>
                        }
                        why="The factory build record confirms the original equipment and MSRP for this exact VIN, so you can compare it with how the vehicle is equipped today." />
                    )}
                    {histLink && (
                      <RecordCard
                        cover={<DocumentPreview input={{ type: "vehicle_history", title: "Vehicle History Report" }} vehicle={{ ...coverVehicle, provider: histLink.provider }} onQuickView={openExternal(histLink.url, "history_report", { provider: histLink.provider })} />}
                        title={`${historyReportName(histLink.provider)} Vehicle History Report`}
                        source={histLink.source === "vin" ? `${historyReportName(histLink.provider)} · Official VIN record` : `${histLink.provider === "autocheck" ? "AutoCheck" : "CARFAX"} · provided by ${dealerName}`}
                        status="external"
                        explanation={`Ownership, title and accident history for this VIN, provided at no cost by ${dealerName}.`}
                        meta={<span className="inline-flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" /> Opens on {histLink.provider === "autocheck" ? "autocheck.com" : "carfax.com"}</span>}
                        action={externalAction(histLink.url, "View Report", "history_report", { provider: histLink.provider })}
                        why="A history report confirms the ownership, title and accident record tied to this exact VIN." />
                    )}
                    {brochureLink && (
                      <RecordCard
                        cover={<DocumentPreview input={{ type: "brochure", title: "Official Brochure" }} vehicle={coverVehicle} onQuickView={openExternal(brochureLink.url, "oem_brochure")} />}
                        title={`${(listing.ymm || "").trim()} Official Brochure`}
                        source={`${((listing.ymm || "").trim().split(/\s+/)[1] || "Manufacturer").toUpperCase()} USA · Manufacturer source`}
                        status="external"
                        explanation={`Features, specifications and model information published by ${((listing.ymm || "").trim().split(/\s+/)[1] || "the manufacturer").toUpperCase()}.`}
                        meta={<><span className="inline-flex items-center gap-1"><Globe className="w-3.5 h-3.5" /> Official brochure</span><span aria-hidden className="text-[#CBD5E1]">·</span><span className="inline-flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" /> Opens on {brochureBrand}</span></>}
                        action={externalAction(brochureLink.url, "Open Official Brochure", "oem_brochure")}
                        why="The manufacturer's brochure confirms the factory features and specifications for this year and model." />
                    )}
                    <OwnersManualCard listing={listing} isPreview={isPreview} hasStoredCopy={manualStored} />
                    {stickerLink && (
                      <RecordCard
                        cover={<DocumentPreview input={{ type: "window_sticker", title: "Window Sticker", url: stickerLink }} vehicle={coverVehicle} onQuickView={openExternal(stickerLink, "oem_window_sticker")} />}
                        title="Original OEM Window Sticker"
                        source="Manufacturer source"
                        status="external"
                        explanation="Original factory window sticker — MSRP and factory equipment as built."
                        meta={<span className="inline-flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" /> Opens in a new tab</span>}
                        action={externalAction(stickerLink, "View Sticker", "oem_window_sticker")} />
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-[#D8DEE6] p-8 text-center">
                    <span className="w-11 h-11 rounded-xl bg-slate-100 text-[#94A3B8] flex items-center justify-center mx-auto mb-2.5"><FileText className="w-5 h-5" /></span>
                    <p className="text-[13.5px] font-semibold text-[#475569]">No documents are available to view yet.</p>
                    <p className="text-[12.5px] text-[#64748B] mt-1">Request the records you need below and {dealerName} will confirm what's available.</p>
                  </div>
                )}
              </div>

              <div className={`${CARD} p-5`}>
                <div className="flex items-start justify-between">
                  <p className="text-[16px] font-bold text-[#0F172A]">Document Status</p>
                  <span className="w-11 h-11 rounded-full bg-blue-50 flex items-center justify-center shrink-0"><FileCheck2 className="w-5 h-5 text-[#2563EB]" /></span>
                </div>
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 text-[13px] text-[#475569]"><span className={`w-2.5 h-2.5 rounded-full ${availableCount > 0 ? "bg-[#16A34A]" : "border border-[#CBD5E1]"}`} /> Available now</span>
                    <span className={`text-[15px] font-medium tabular-nums ${availableCount > 0 ? "text-[#0F172A]" : "text-[#94A3B8]"}`}>{availableCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 text-[13px] text-[#475569]"><span className={`w-2.5 h-2.5 rounded-full ${signedCount > 0 ? "bg-[#16A34A]" : "border border-[#CBD5E1]"}`} /> Signed customer records</span>
                    <span className={`text-[15px] font-medium tabular-nums ${signedCount > 0 ? "text-[#0F172A]" : "text-[#94A3B8]"}`}>{signedCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 text-[13px] text-[#475569]"><span className={`w-2.5 h-2.5 rounded-full ${verifiedCount > 0 ? "bg-[#16A34A]" : "border border-[#CBD5E1]"}`} /> Verified records</span>
                    <span className={`text-[15px] font-medium tabular-nums ${verifiedCount > 0 ? "text-[#0F172A]" : "text-[#94A3B8]"}`}>{verifiedCount}</span>
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-[#EEF1F4]">
                    <span className="text-[13px] text-[#475569]">Last checked</span>
                    <span className="text-[13px] font-semibold text-[#0F172A]">{lastChecked}</span>
                  </div>
                </div>
                <div className="mt-4 rounded-lg bg-blue-50 p-3 flex items-start gap-2 text-[12.5px] text-[#334155] leading-snug">
                  <Info className="w-4 h-4 text-[#2563EB] shrink-0 mt-0.5" /> Records shown here are associated with this exact VIN when available.
                </div>
                <button onClick={() => navigate(pp("check-availability"))} className="mt-4 w-full h-11 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-[13px] font-bold inline-flex items-center justify-center">Request a Document</button>
                <p className="text-[12px] text-[#64748B] text-center mt-2">{dealerName} will confirm availability.</p>
                {availableCount > 0 && !isPreview && (
                  <button onClick={() => setEmailOpen((v) => !v)} className="mt-3 w-full text-[12.5px] font-semibold text-[#2563EB] inline-flex items-center justify-center gap-1.5 hover:underline"><Upload className="w-3.5 h-3.5" /> Email me this packet</button>
                )}
                {emailOpen && <div className="mt-3"><EmailPacketCard listing={listing} docs={allDocs} availableCount={availableCount} onClose={() => setEmailOpen(false)} /></div>}
              </div>
            </div>

            {/* Available by Request */}
            <div className={`${CARD} p-5 mt-5`}>
              <p className="text-[16px] font-bold text-[#0F172A]">Need a document you don&rsquo;t see?</p>
              <p className="text-[13px] text-[#64748B] mt-0.5 mb-4">Choose the records you need and {dealerName} will confirm what is available for this vehicle.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {requestOptions.map((o) => {
                  const on = reqSel.has(o.key);
                  return (
                    <button key={o.key} onClick={() => toggleReq(o.key)} aria-pressed={on}
                      className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${on ? "border-[#2563EB] ring-1 ring-[#2563EB] bg-blue-50/40" : "border-[#E6E8EC] bg-white hover:border-[#C7D2FE]"}`}>
                      <span className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${o.tint}`}><o.icon className="w-5 h-5" /></span>
                      <span className="text-[13px] font-semibold text-[#0F172A] flex-1 leading-snug">{o.label}</span>
                      <span className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${on ? "border-[#2563EB] bg-[#2563EB] text-white" : "border-[#CBD5E1]"}`}>{on && <CheckCircle2 className="w-3.5 h-3.5" />}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between gap-3 flex-wrap mt-4">
                <p className="text-[12px] text-[#64748B]">The dealership will respond using your preferred contact method.</p>
                <button onClick={requestSelected} disabled={reqSel.size === 0}
                  className="h-10 px-4 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-[13px] font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
                  Request Selected Documents{reqSel.size > 0 ? ` (${reqSel.size})` : ""}
                </button>
              </div>
            </div>

            {/* Questions */}
            <div className={`${CARD} p-5 mt-5 flex flex-col sm:flex-row sm:items-center gap-4`}>
              <span className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><MessageSquare className="w-5 h-5 text-[#2563EB]" /></span>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-bold text-[#0F172A]">Questions about a document?</p>
                <p className="text-[13px] text-[#64748B] mt-0.5">A {dealerName} representative can explain what applies to this vehicle.</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => navigate(pp("contact"))} className="h-10 px-4 rounded-xl border border-[#E6E8EC] text-[#0F172A] text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><MessageSquare className="w-4 h-4 text-[#2563EB]" /> Ask a Question</button>
                {d.dealerPhone
                  ? <a href={`tel:${d.dealerPhone}`} className="h-10 px-4 rounded-xl border border-[#E6E8EC] text-[#0F172A] text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><Phone className="w-4 h-4 text-[#2563EB]" /> Call Dealership</a>
                  : <button onClick={() => navigate(pp("contact"))} className="h-10 px-4 rounded-xl border border-[#E6E8EC] text-[#0F172A] text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><Phone className="w-4 h-4 text-[#2563EB]" /> Call Dealership</button>}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Preview viewer */}
      {preview && (
        <div className="fixed inset-0 z-[70] flex justify-center items-stretch">
          <div className="absolute inset-0 bg-black/60" onClick={() => setPreview(null)} />
          <div className="relative bg-white w-full sm:max-w-4xl h-full sm:h-auto sm:my-6 sm:rounded-2xl flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E6E8EC] shrink-0">
              <div className="flex items-center gap-2.5 min-w-0"><span className="w-9 h-9 rounded-xl bg-blue-50 text-[#2563EB] flex items-center justify-center shrink-0"><FileText className="w-5 h-5" /></span><p className="font-bold truncate">{preview.name}</p></div>
              <div className="flex items-center gap-2 shrink-0">
                <a href={preview.url} download target="_blank" rel="noopener noreferrer" className="h-9 px-3 rounded-lg border border-[#E6E8EC] text-[13px] font-semibold inline-flex items-center gap-1.5 hover:border-[#2563EB]"><Download className="w-4 h-4" /> Download</a>
                <button onClick={() => window.open(preview.url, "_blank")} className="h-9 px-3 rounded-lg border border-[#E6E8EC] text-[13px] font-semibold inline-flex items-center gap-1.5 hover:border-[#2563EB]"><Printer className="w-4 h-4" /> Print</button>
                <button onClick={() => share(preview.url)} className="h-9 px-3 rounded-lg border border-[#E6E8EC] text-[13px] font-semibold inline-flex items-center gap-1.5 hover:border-[#2563EB]"><Upload className="w-4 h-4" /> Share</button>
                <button onClick={() => setPreview(null)} className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center"><X className="w-5 h-5" /></button>
              </div>
            </div>
            <div className="flex-1 bg-slate-50 min-h-[60vh]">
              {/\.(png|jpe?g|webp|gif)(\?|$)/i.test(preview.url)
                ? <div className="h-full flex items-center justify-center p-4"><img src={preview.url} alt={preview.name} className="max-w-full max-h-full rounded-lg shadow" /></div>
                : <iframe title={preview.name} src={preview.url} className="w-full h-full min-h-[70vh] border-0" />}
            </div>
          </div>
        </div>
      )}

      <PassportCtaDock go={(s) => navigate(pp(s))} dealerPhone={d.dealerPhone || undefined} reviewRating={d.reviewRating} advisor={d.dealerTrust} routing={d.contactRouting} vehicle={{ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin }} />
    </div>
  );
};

export default VehiclePassportDocuments;
