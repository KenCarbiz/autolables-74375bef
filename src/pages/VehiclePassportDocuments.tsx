import { useMemo, useState, type ReactNode } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronDown, Search, LayoutGrid, List, Eye, Download, Printer,
  Upload, MoreVertical, ShieldCheck, CheckCircle2, FileText, ClipboardList, BadgeCheck,
  Package, DollarSign, Car, MessageSquare, Phone, ExternalLink, X, Star, Wrench,
  TrendingUp, Clock, Settings, Building2, PenLine, Plus, Info, Globe,
  ChevronRight, FileCheck2, ClipboardX, FilePlus2,
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
import { MOCK_LISTING } from "./VehiclePassportV3";
import { usePublicListing } from "@/hooks/usePublicListing";
import { supabase } from "@/integrations/supabase/client";
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

const DocThumb = ({ url }: { url: string }) => {
  if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)) return <img src={url} alt="" className="w-full h-full object-cover" />;
  return (
    <div className="w-full h-full bg-white p-3">
      <div className="h-1.5 w-8 bg-[#2563EB]/30 rounded mb-2" />
      {Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-1 rounded bg-slate-200 mb-1.5" style={{ width: `${[100, 92, 96, 70, 88, 60, 80][i]}%` }} />)}
    </div>
  );
};

// "Email me this packet" — the deepest-funnel shoppers on the passport are
// document seekers, and until now they converted at 0%. Uses the existing
// delivery pipeline (request -> outbox -> send function) and flushes the outbox
// immediately so the packet arrives while the shopper is still on the lot.
const EmailPacketCard = ({ listing, docs, onClose }: { listing: VehicleListing; docs: Doc[]; onClose: () => void }) => {
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
      supabase.functions.invoke("send-passport-document-deliveries", { body: { limit: 5 } }).catch(() => { /* cron will flush */ });
      setSent(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      toast.error(/not enabled/i.test(msg) ? "Document delivery isn't enabled — ask the dealership to send the packet." : "Couldn't send — please contact the dealership.");
    } finally { setSending(false); }
  };
  if (sent) return (
    <div className={`${CARD} p-5 mb-5 flex items-center gap-3`}>
      <CheckCircle2 className="w-8 h-8 text-[#16A34A] shrink-0" />
      <div className="min-w-0 flex-1"><p className="text-[14px] font-bold text-[#0F172A]">Packet on its way</p><p className="text-[12px] text-[#64748B]">Check {email} — the dealership team was notified too.</p></div>
      <button onClick={onClose} className="text-[12px] font-semibold text-[#64748B] shrink-0">Close</button>
    </div>
  );
  return (
    <div className={`${CARD} p-5 mb-5`}>
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-[14px] font-bold text-[#0F172A]">Email me this packet</p><p className="text-[12px] text-[#64748B] mt-0.5">All {docs.length} documents for the {listing.ymm}, straight to your inbox.</p></div>
        <button onClick={onClose} className="text-[#94A3B8] hover:text-[#0F172A] shrink-0"><X className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2.5 mt-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email address" className="border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button onClick={submit} disabled={sending} className="h-[42px] px-5 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] disabled:opacity-60 text-white text-sm font-bold">{sending ? "Sending..." : "Send packet"}</button>
      </div>
      <p className="text-[11px] text-[#94A3B8] mt-2">By submitting, you agree the dealership may contact you about this vehicle.</p>
    </div>
  );
};

// Owner's-manual card. By default we only hold the OEM link (no bytes stored),
// so the shopper can open it on the manufacturer site OR pull a copy into this
// vehicle's passport with one click. Once a copy is saved it shows as a normal
// document instead, so this card hides (hasStoredCopy).
const OwnersManualCard = ({
  listing, isPreview, hasStoredCopy,
}: { listing: VehicleListing; isPreview: boolean; hasStoredCopy: boolean }) => {
  const [saving, setSaving] = useState(false);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const m = (listing as { oem_owners_manual?: { url: string; title?: string | null; year?: number | null } }).oem_owners_manual;
  if (hasStoredCopy || !m?.url || !packetVisible(listing, "ownersManual")) return null;
  const mk = (listing.ymm || "").trim().split(/\s+/)[1] || "manufacturer";
  const track = (cta: string) => { if (!isPreview) trackCustomerCtaClicked({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: "passport", surface: "vehicle_passport", metadata: { cta, placement: "documents_page" } }); };
  const save = async () => {
    if (isPreview) { toast.message("Sample preview — saving is disabled here."); return; }
    setSaving(true);
    track("owners_manual_save");
    try {
      const { data, error } = await supabase.functions.invoke("save-owners-manual", { body: { slug: listing.slug || listing.vin } });
      if (error || !data?.url) throw new Error(error?.message || "save_failed");
      setSavedUrl(data.url as string);
      toast.success("Owner's manual saved to this vehicle.");
      window.open(data.url as string, "_blank", "noopener");
    } catch {
      toast.error("Couldn't save the manual right now. The manufacturer link still opens below.");
    } finally {
      setSaving(false);
    }
  };
  const action = (
    <div className="flex items-center gap-2">
      <a href={savedUrl || m.url} target="_blank" rel="noopener noreferrer" onClick={() => track("owners_manual_open")}
        className="flex-1 h-9 rounded-lg border border-[#E6E8EC] text-[13px] font-semibold text-[#2563EB] inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]">
        {savedUrl ? "Download" : "Open Manual"} <ExternalLink className="w-4 h-4" />
      </a>
      {!savedUrl && (
        <button onClick={save} disabled={saving}
          className="flex-1 h-9 rounded-lg bg-[#2563EB] text-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-[#1D4ED8] disabled:opacity-60">
          {saving ? "Saving…" : "Save to passport"}
        </button>
      )}
    </div>
  );
  const hero = listingHero(listing);
  return (
    <RecordCard
      cover={<RecordCover hero={hero} label="Owner's Manual" />}
      title={`Official ${mk.toUpperCase()} Owner's Manual${m.year ? ` (${m.year})` : ""}`}
      source={`${mk.toUpperCase()} · Manufacturer source`}
      status={savedUrl ? "available" : "external"}
      explanation="The manufacturer's official owner's manual for this year and model."
      meta={<span className="inline-flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" /> Opens on the manufacturer site</span>}
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
const REQUEST_OPTIONS: { key: string; label: string; icon: typeof FileText; tint: string }[] = [
  { key: "buyers_guide", label: "Buyer's Guide", icon: FileText, tint: "bg-blue-50 text-[#2563EB]" },
  { key: "window_sticker", label: "Window Sticker / Build Sheet", icon: Car, tint: "bg-blue-50 text-[#2563EB]" },
  { key: "warranty", label: "Warranty Information", icon: ShieldCheck, tint: "bg-emerald-50 text-[#059669]" },
  { key: "verification", label: "Verification Report", icon: BadgeCheck, tint: "bg-teal-50 text-[#0D9488]" },
  { key: "inspection", label: "Inspection Report", icon: ClipboardX, tint: "bg-amber-50 text-[#D97706]" },
  { key: "signed_price", label: "Signed Price Record", icon: PenLine, tint: "bg-purple-50 text-[#7C3AED]" },
  { key: "service", label: "Service Records", icon: Wrench, tint: "bg-orange-50 text-[#EA580C]" },
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

// A real, visual record card: cover preview on the left, one clear status,
// source, explanation, an optional source-detail row, and one action. The cover
// is a real preview (uploaded doc thumbnail or the vehicle photo) — never a
// repeated generic file icon.
const RecordCard = ({ cover, title, source, status, explanation, meta, action, why }: {
  cover: ReactNode; title: string; source: string; status: DocStatus; explanation?: string; meta?: ReactNode; action: ReactNode; why?: string;
}) => (
  <div className="rounded-xl border border-[#E6E8EC] bg-white overflow-hidden flex flex-col sm:flex-row">
    <div className="sm:w-[210px] shrink-0 bg-slate-100 sm:self-stretch">{cover}</div>
    <div className="p-4 sm:p-5 flex-1 min-w-0 flex flex-col">
      <div><StatusBadge status={status} /></div>
      <p className="text-[16px] font-bold text-[#0F172A] mt-2 leading-tight">{title}</p>
      <p className="text-[12.5px] text-[#64748B] mt-1">{source}</p>
      {explanation && <p className="text-[13px] text-[#475569] mt-2 leading-snug">{explanation}</p>}
      {meta && <div className="mt-2.5 text-[12px] text-[#64748B] flex flex-wrap items-center gap-x-2 gap-y-1">{meta}</div>}
      <div className="mt-3.5">{action}</div>
      {why && (
        <details className="mt-2 group">
          <summary className="text-[13px] font-semibold text-[#2563EB] cursor-pointer list-none inline-flex items-center gap-1">Why this matters <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" /></summary>
          <p className="text-[12.5px] text-[#64748B] mt-1.5 leading-snug">{why}</p>
        </details>
      )}
    </div>
  </div>
);
// Branded "cover" for an external/manufacturer record when there is no file
// thumbnail — the vehicle photo with a dark wash, so the card reads as a real
// document tile rather than a generic icon.
const RecordCover = ({ hero, label }: { hero?: string | null; label: string }) => (
  hero
    ? <div className="h-44 sm:h-full sm:min-h-[150px] w-full overflow-hidden"><img src={hero} alt="" className="h-full w-full object-cover" /></div>
    : <div className="h-44 sm:h-full sm:min-h-[150px] w-full bg-gradient-to-br from-slate-800 to-slate-950 flex items-center justify-center"><span className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/85">{label}</span></div>
);

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

  const isPreview = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("preview");
  const { listing, loading, notFound } = usePublicListing(vehicleSlug, { preview: isPreview, previewData: MOCK_LISTING as unknown as VehicleListing });

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
  const total = allDocs.length;
  const adv = d.dealerTrust;
  const share = async (url: string) => { try { if (navigator.share) { await navigator.share({ url }); return; } } catch { return; } await navigator.clipboard.writeText(url); toast.success("Link copied"); };
  const CAT_TABS = [{ key: "all", label: "All Documents" }, ...CATEGORIES.filter((c) => (counts[c.key] || 0) > 0).map((c) => ({ key: c.key, label: c.label.replace("Vehicle ", "").replace(" & Compliance", "") }))];

  // Print packet manifest — grouped over ALL included docs (never the
  // active search/category filter) so Print always emits the full packet.
  const printGroups = CATEGORIES.map((c) => ({ c, docs: allDocs.filter((x) => categoryOf(x) === c.key) })).filter((g) => g.docs.length > 0);
  const printedOn = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const oemBrochure = (listing as { oem_brochure?: { url: string; title?: string | null; year?: number | null } }).oem_brochure;
  const brochureMk = (listing.ymm || "").trim().split(/\s+/)[1] || "";
  const printLinks: { title: string; note: string; url: string }[] = [];
  if (d.historyReport && packetVisible(listing, "historyReport"))
    printLinks.push({ title: `${historyReportName(d.historyReport.provider)} Vehicle History Report`, note: d.historyReport.source === "vin" ? "Official record for this VIN" : "External report link", url: d.historyReport.url });
  if (oemBrochure?.url && packetVisible(listing, "brochure"))
    printLinks.push({ title: `Official ${brochureMk.toUpperCase()} Brochure${oemBrochure.year ? ` (${oemBrochure.year})` : ""}`, note: "Manufacturer website", url: oemBrochure.url });
  const oemManual = (listing as { oem_owners_manual?: { url: string; title?: string | null; year?: number | null } }).oem_owners_manual;
  if (oemManual?.url && packetVisible(listing, "ownersManual") && !allDocs.some((x) => x.type === "owners_manual"))
    printLinks.push({ title: `Official ${brochureMk.toUpperCase()} Owner's Manual${oemManual.year ? ` (${oemManual.year})` : ""}`, note: "Manufacturer website", url: oemManual.url });
  if (listing.oem_sticker_url && packetVisible(listing, "oemSticker") && !allDocs.some((x) => x.type === "window_sticker"))
    printLinks.push({ title: "Original Window Sticker", note: "Factory Monroney label", url: listing.oem_sticker_url });

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
  const externalCount = (histLink ? 1 : 0) + (brochureLink ? 1 : 0) + (manualLink ? 1 : 0) + (stickerLink ? 1 : 0);
  const availableCount = uploaded.length + externalCount;
  const lastChecked = lastUpdated || "Today";
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
      <button onClick={() => setPreview(doc)} className="flex-1 h-9 rounded-lg border border-[#E6E8EC] text-[13px] font-semibold text-[#2563EB] inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><Eye className="w-4 h-4" /> Preview</button>
      <a href={doc.url} download target="_blank" rel="noreferrer" className="flex-1 h-9 rounded-lg bg-[#2563EB] text-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-[#1d4fd7]"><Download className="w-4 h-4" /> Download</a>
    </div>
  );
  const externalAction = (url: string, label: string, cta: string, meta: Record<string, unknown> = {}) => (
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={() => trackDoc(cta, meta)} className="h-10 w-fit px-4 rounded-lg bg-[#2563EB] text-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-[#1d4fd7]">{label} <ExternalLink className="w-4 h-4" /></a>
  );

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
            <button onClick={() => navigate(pp(""))} className="mt-3 w-full h-9 rounded-lg border border-[#E6E8EC] text-[12px] font-bold inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><ExternalLink className="w-3.5 h-3.5 text-[#2563EB]" /> View Full Passport</button>
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
                  <div className="space-y-4">
                    {uploaded.map(({ doc, status }, i) => (
                      <RecordCard key={`u-${i}`}
                        cover={<div className="h-40 sm:h-full sm:min-h-[150px]"><DocThumb url={doc.url} /></div>}
                        title={doc.name}
                        source={`Provided by ${dealerName}`}
                        status={status}
                        explanation={doc.description || (doc.type === "window_sticker" ? "Original factory window sticker — MSRP and equipment as built." : "Provided by the dealership for this vehicle.")}
                        meta={<span className="inline-flex items-center gap-1">{fileType(doc.url)}{doc.uploaded_at ? ` · Added ${fmtDate(doc.uploaded_at)}` : ""}</span>}
                        action={uploadedAction(doc)} />
                    ))}
                    {histLink && (
                      <RecordCard
                        cover={<RecordCover hero={hero} label="History Report" />}
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
                        cover={<RecordCover hero={hero} label="Brochure" />}
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
                        cover={<RecordCover hero={hero} label="Window Sticker" />}
                        title="Original Window Sticker"
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
                {emailOpen && <div className="mt-3"><EmailPacketCard listing={listing} docs={allDocs} onClose={() => setEmailOpen(false)} /></div>}
              </div>
            </div>

            {/* Available by Request */}
            <div className={`${CARD} p-5 mt-5`}>
              <p className="text-[16px] font-bold text-[#0F172A]">Need a document you don&rsquo;t see?</p>
              <p className="text-[13px] text-[#64748B] mt-0.5 mb-4">Choose the records you need and {dealerName} will confirm what is available for this vehicle.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {REQUEST_OPTIONS.map((o) => {
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
                <a href={preview.url} download target="_blank" rel="noreferrer" className="h-9 px-3 rounded-lg border border-[#E6E8EC] text-[13px] font-semibold inline-flex items-center gap-1.5 hover:border-[#2563EB]"><Download className="w-4 h-4" /> Download</a>
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
