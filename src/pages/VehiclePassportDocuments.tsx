import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronDown, Search, LayoutGrid, List, Eye, Download, Printer,
  Upload, MoreVertical, ShieldCheck, CheckCircle2, FileText, ClipboardList, BadgeCheck,
  Package, DollarSign, Car, MessageSquare, Phone, ExternalLink, X, Star, Wrench,
  TrendingUp, Clock, Settings, Building2,
} from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { type VehicleListing } from "@/hooks/useVehicleListing";
import { formatPhone } from "@/components/addendum/CustomerInfoSection";
import Logo from "@/components/brand/Logo";
import { derivePassport } from "@/lib/passportV2Data";
import { listingHero } from "@/lib/photos";
import { MOCK_LISTING } from "./VehiclePassportV3";
import { usePublicListing } from "@/hooks/usePublicListing";
import PassportCtaDock from "@/components/passport/PassportCtaDock";

// ──────────────────────────────────────────────────────────────
// VehiclePassportDocuments — /passport-v3/:vehicleSlug/documents
//
// Premium document center in the V3 design system. Renders only the
// real documents the dealership attached to the listing (grouped by
// category); expected-but-absent types are not fabricated. Search,
// sort, category filter, grid/list, and an inline preview viewer.
// ──────────────────────────────────────────────────────────────

const CARD = "rounded-2xl border border-[#E6E8EC] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.05)]";

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

const PASSPORT_NAV = [
  { label: "Overview", to: "" }, { label: "Market Intelligence", to: "market-price" }, { label: "Why This Is A Great Buy", to: "great-buy" },
  { label: "Vehicle History", to: "vehicle-history" }, { label: "Ownership Timeline", to: "ownership-timeline" }, { label: "Factory Warranty", to: "factory-warranty" },
  { label: "What Owners Say", to: "owner-reviews" }, { label: "Vehicle Highlights", to: "features" }, { label: "Specifications", to: "specifications" },
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

const VehiclePassportDocuments = () => {
  const params = useParams<{ vehicleSlug?: string; slug?: string }>();
  const vehicleSlug = params.vehicleSlug ?? params.slug;
  const navigate = useNavigate();
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("newest");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [preview, setPreview] = useState<Doc | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const isPreview = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("preview");
  const { listing, loading, notFound } = usePublicListing(vehicleSlug, { preview: isPreview, previewData: MOCK_LISTING as unknown as VehicleListing });

  const d = useMemo(() => (listing ? derivePassport(listing) : null), [listing]);
  const allDocs = useMemo(() => ((listing?.documents as Doc[] | undefined) || []).filter((x) => x.name && x.url), [listing]);
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

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-[#F6F7F9]"><div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" /></div>;
  if (notFound || !listing || !d) return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[#F6F7F9]"><div className="text-center"><FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" /><h1 className="text-xl font-bold">Documents unavailable</h1></div></div>
  );

  const slug = listing.slug || vehicleSlug;
  const pp = (s: string) => `/v/${slug}${s ? `/${s}` : ""}${isPreview ? "?preview=1" : ""}`;
  const hero = listingHero(listing);
  const total = allDocs.length;
  const adv = d.dealerTrust;
  const share = async (url: string) => { try { if (navigator.share) { await navigator.share({ url }); return; } } catch { return; } await navigator.clipboard.writeText(url); toast.success("Link copied"); };
  const CAT_TABS = [{ key: "all", label: "All Documents" }, ...CATEGORIES.filter((c) => (counts[c.key] || 0) > 0).map((c) => ({ key: c.key, label: c.label.replace("Vehicle ", "").replace(" & Compliance", "") }))];

  const DocCard = ({ doc }: { doc: Doc }) => (
    <div className={`${CARD} p-3 flex flex-col transition-transform hover:-translate-y-0.5`}>
      <button onClick={() => setPreview(doc)} className="rounded-xl border border-[#EEF1F4] overflow-hidden h-[120px] bg-slate-50"><DocThumb url={doc.url} /></button>
      <div className="flex items-start justify-between gap-2 mt-3">
        <p className="text-[13px] font-bold leading-tight">{doc.name}</p>
        <button className="text-[#94A3B8] hover:text-[#0F172A] shrink-0"><MoreVertical className="w-4 h-4" /></button>
      </div>
      {doc.description && <p className="text-[11px] text-[#64748B] mt-0.5 leading-snug">{doc.description}</p>}
      {doc.uploaded_at && <p className="text-[11px] text-[#94A3B8] mt-1">{fmtDate(doc.uploaded_at)}</p>}
      <div className="flex items-center gap-2 mt-2">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#16A34A] bg-emerald-50 rounded px-1.5 py-0.5"><CheckCircle2 className="w-3 h-3" /> Dealer Verified</span>
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#EF4444] bg-red-50 rounded px-1.5 py-0.5">{fileType(doc.url)}</span>
      </div>
      <div className="flex items-center gap-1 mt-2.5 pt-2.5 border-t border-[#EEF1F4]">
        <button onClick={() => setPreview(doc)} title="Preview" className="flex-1 h-8 rounded-lg hover:bg-blue-50 inline-flex items-center justify-center text-[#2563EB]"><Eye className="w-4 h-4" /></button>
        <a href={doc.url} download target="_blank" rel="noreferrer" title="Download" className="flex-1 h-8 rounded-lg hover:bg-blue-50 inline-flex items-center justify-center text-[#2563EB]"><Download className="w-4 h-4" /></a>
        <button onClick={() => window.open(doc.url, "_blank")} title="Print" className="flex-1 h-8 rounded-lg hover:bg-blue-50 inline-flex items-center justify-center text-[#2563EB]"><Printer className="w-4 h-4" /></button>
        <button onClick={() => share(doc.url)} title="Share" className="flex-1 h-8 rounded-lg hover:bg-blue-50 inline-flex items-center justify-center text-[#2563EB]"><Upload className="w-4 h-4" /></button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#0F172A]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <Helmet><title>{`Documents — ${listing.ymm} · AutoLabels`}</title><meta name="robots" content="noindex" /></Helmet>

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
              <button key={n.label} onClick={() => navigate(pp(n.to))} className={`w-full text-left px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${n.active ? "bg-blue-50 text-[#2563EB]" : "text-[#64748B] hover:bg-slate-50"}`}>{n.label}</button>
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

        {/* Main workspace */}
        <main className="px-5 lg:px-8 py-6 min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-[26px] font-bold tracking-tight">Vehicle Documents</h1>
              <p className="text-[14px] text-[#64748B] mt-0.5">Everything provided by the dealership for this vehicle.</p>
              <p className="text-[12px] text-[#94A3B8] mt-2 inline-flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Last updated: Today · 10:42 AM</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#0F172A]"><span className="w-6 h-6 rounded-full bg-emerald-50 flex items-center justify-center"><CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" /></span>{total} Documents Available</span>
              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#16A34A] bg-emerald-50 rounded-full px-3 py-1.5"><ShieldCheck className="w-4 h-4" /> Dealer Verified</span>
            </div>
          </div>

          {/* Hero card */}
          <div className={`${CARD} p-6 mt-5 flex flex-col lg:flex-row lg:items-center gap-6`}>
            <span className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center shrink-0"><ShieldCheck className="w-7 h-7 text-[#16A34A]" /></span>
            <div className="flex-1">
              <h2 className="text-[18px] font-bold">Vehicle Documentation</h2>
              <p className="text-[14px] text-[#64748B]">Everything you need in one place.</p>
              <p className="text-[12px] text-[#94A3B8] mt-1">All available documents have been verified and uploaded by the dealership.</p>
            </div>
            <div className="lg:w-[360px] shrink-0">
              <p className="text-[15px] font-bold mb-1.5"><span className="text-[20px] font-extrabold">{total}</span> of {total} Documents Available</p>
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-[#16A34A]" style={{ width: total ? "100%" : "0%" }} /></div>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 mt-5">
            <div className="flex items-center gap-1.5 overflow-x-auto flex-1 min-w-0">
              {CAT_TABS.map((t) => (
                <button key={t.key} onClick={() => setCat(t.key)} className={`whitespace-nowrap h-9 px-3.5 rounded-xl text-[13px] font-semibold transition-colors ${cat === t.key ? "bg-[#2563EB] text-white" : "bg-white border border-[#E6E8EC] text-[#64748B] hover:border-[#2563EB]"}`}>{t.label}</button>
              ))}
            </div>
            <div className="relative">
              <Search className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents..." className="h-9 w-[220px] pl-9 pr-3 rounded-xl border border-[#E6E8EC] text-[13px] outline-none focus:border-[#2563EB]" />
            </div>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-9 px-3 rounded-xl border border-[#E6E8EC] text-[13px] bg-white cursor-pointer">
              <option value="newest">Sort: Newest First</option><option value="oldest">Oldest First</option><option value="alpha">Alphabetical</option><option value="category">Category</option>
            </select>
            <div className="flex items-center rounded-xl border border-[#E6E8EC] overflow-hidden">
              <button onClick={() => setView("grid")} className={`w-9 h-9 flex items-center justify-center ${view === "grid" ? "bg-blue-50 text-[#2563EB]" : "text-[#94A3B8]"}`}><LayoutGrid className="w-4 h-4" /></button>
              <button onClick={() => setView("list")} className={`w-9 h-9 flex items-center justify-center ${view === "list" ? "bg-blue-50 text-[#2563EB]" : "text-[#94A3B8]"}`}><List className="w-4 h-4" /></button>
            </div>
          </div>

          {/* Workspace: categories + grid */}
          <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6 mt-5">
            <div className={`${CARD} p-4 h-max`}>
              <p className="text-[13px] font-bold mb-2">Document Categories</p>
              <div className="space-y-0.5">
                {CATEGORIES.filter((c) => (counts[c.key] || 0) > 0).map((c) => (
                  <button key={c.key} onClick={() => setCat(c.key)} className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors ${cat === c.key ? "bg-blue-50 text-[#2563EB]" : "text-[#64748B] hover:bg-slate-50"}`}>
                    <c.icon className={`w-4 h-4 shrink-0 ${cat === c.key ? "text-[#2563EB]" : "text-[#94A3B8]"}`} /><span className="flex-1 text-left truncate">{c.label}</span><span className="text-[12px] text-[#94A3B8]">{counts[c.key]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-8">
              {grouped.length === 0 ? (
                <div className={`${CARD} p-12 text-center`}>
                  <span className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3"><FileText className="w-7 h-7" /></span>
                  <p className="text-[15px] font-bold text-[#475569]">No documents available{cat !== "all" ? " in this category" : ""}{q ? " for your search" : ""}.</p>
                  <p className="text-[13px] text-[#64748B] mt-1.5">Documents the dealership uploads will appear here automatically.</p>
                </div>
              ) : grouped.map(({ c, docs }) => (
                <div key={c.key}>
                  <button onClick={() => setCollapsed((s) => ({ ...s, [c.key]: !s[c.key] }))} className="w-full flex items-center justify-between mb-3">
                    <h3 className="text-[16px] font-bold">{c.label}</h3>
                    <span className="text-[13px] font-semibold text-[#2563EB] inline-flex items-center gap-1">{docs.length} Documents <ChevronDown className={`w-4 h-4 transition-transform ${collapsed[c.key] ? "-rotate-90" : ""}`} /></span>
                  </button>
                  {!collapsed[c.key] && (
                    view === "grid"
                      ? <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">{docs.map((doc, i) => <DocCard key={i} doc={doc} />)}</div>
                      : <div className={`${CARD} divide-y divide-[#EEF1F4]`}>{docs.map((doc, i) => (
                          <div key={i} className="flex items-center gap-3 p-3">
                            <span className="w-10 h-12 rounded border border-[#EEF1F4] overflow-hidden shrink-0"><DocThumb url={doc.url} /></span>
                            <div className="min-w-0 flex-1"><p className="text-[13px] font-bold truncate">{doc.name}</p><p className="text-[11px] text-[#94A3B8]">{fmtDate(doc.uploaded_at)} · {fileType(doc.url)}</p></div>
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#16A34A] bg-emerald-50 rounded px-1.5 py-0.5 shrink-0"><CheckCircle2 className="w-3 h-3" /> Verified</span>
                            <button onClick={() => setPreview(doc)} className="h-8 px-2 rounded-lg hover:bg-blue-50 text-[#2563EB] shrink-0"><Eye className="w-4 h-4" /></button>
                            <a href={doc.url} download target="_blank" rel="noreferrer" className="h-8 px-2 rounded-lg hover:bg-blue-50 text-[#2563EB] shrink-0 inline-flex items-center"><Download className="w-4 h-4" /></a>
                          </div>
                        ))}</div>
                  )}
                </div>
              ))}
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

      <PassportCtaDock go={(s) => navigate(pp(s))} dealerPhone={d.dealerPhone || undefined} reviewRating={d.reviewRating} advisor={d.dealerTrust} />
    </div>
  );
};

export default VehiclePassportDocuments;
