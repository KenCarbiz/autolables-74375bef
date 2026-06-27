import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Upload, Bookmark, Printer,
  FileText, FileCheck, ShieldCheck, Shield, BadgeCheck, Award,
  Car, ClipboardCheck, ClipboardList, BookOpen, Wrench, History,
  KeyRound, AlertTriangle, CheckCircle2, Clock, Package,
  Download, ExternalLink, X, ChevronRight, MoreVertical,
  Mail, Smartphone, Link2, Lock, Bell, UploadCloud, Phone, MapPin, Send,
} from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { useVehicleListing, type VehicleListing } from "@/hooks/useVehicleListing";
import Logo from "@/components/brand/Logo";
import { formatPhone } from "@/components/addendum/CustomerInfoSection";

// ──────────────────────────────────────────────────────────────
// PublicDocuments — /v/:slug/documents
// Standalone consumer-facing document center. Reached from the
// passport "Documents" action. Config-driven catalog: each entry
// declares which vehicle types and dealer states it applies to,
// and resolves its status against real listing data.
// ──────────────────────────────────────────────────────────────

type DocStatus = "on_file" | "coming_soon" | "action_required";
type DocCategory = "pricing" | "history" | "inspection" | "warranty" | "ownership";
type VehType = "new" | "used" | "cpo" | "demo";

interface PublicDoc {
  document_type: string;
  online_url?: string | null;
  pdf_url?: string | null;
  png_url?: string | null;
  published_at?: string | null;
  version?: number | null;
}

interface ResolveCtx {
  listing: VehicleListing;
  pub: Record<string, PublicDoc>;
}

interface Resolved {
  status: DocStatus;
  url?: string | null;
  date?: string | null;
  statusText?: string;
  detailLines?: string[];
  pages?: number | null;
}

interface DocDescriptor {
  key: string;
  category: DocCategory;
  title: string;
  description: string;
  icon: React.ElementType;
  appliesTo: VehType[];
  requiredStates?: string[];
  resolve: (ctx: ResolveCtx) => Resolved;
}

const CATEGORIES: { key: "all" | DocCategory; label: string }[] = [
  { key: "all", label: "All Documents" },
  { key: "pricing", label: "Pricing & Compliance" },
  { key: "history", label: "Vehicle History" },
  { key: "inspection", label: "Inspection & Certification" },
  { key: "warranty", label: "Warranty" },
  { key: "ownership", label: "Ownership" },
];

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "";

const pickUrl = (d?: PublicDoc | null) => d?.online_url || d?.pdf_url || d?.png_url || null;

const findDoc = (listing: VehicleListing, kw: RegExp) =>
  (listing.documents || []).find((d) => kw.test(d.type || "") || kw.test(d.name || "")) || null;

// ── State normalization (full name → USPS) for state-specific docs ──
const STATE_ABBR: Record<string, string> = { CONNECTICUT: "CT", MASSACHUSETTS: "MA", "NEW YORK": "NY", "RHODE ISLAND": "RI", CALIFORNIA: "CA" };
const normalizeState = (s?: string | null) => {
  const up = (s || "").trim().toUpperCase();
  if (up.length === 2) return up;
  return STATE_ABBR[up] || up;
};

const detectVehType = (l: VehicleListing): VehType => {
  const mc = (l.mc_attributes || {}) as Record<string, unknown>;
  const raw = `${mc.inventory_type ?? ""} ${mc.listing_type ?? ""} ${mc.vehicle_type ?? ""}`.toLowerCase();
  if (l.condition === "cpo") return "cpo";
  if (raw.includes("demo")) return "demo";
  if (l.condition === "new") return "new";
  return "used";
};

// ── Document catalog ──────────────────────────────────────────
const CATALOG: DocDescriptor[] = [
  // PRICING & COMPLIANCE
  {
    key: "oem_window_sticker", category: "pricing", icon: FileText, appliesTo: ["new", "demo"],
    title: "OEM Window Sticker",
    description: "Original factory window sticker showing MSRP, standard equipment, and all installed options as delivered from the manufacturer.",
    resolve: ({ listing, pub }) => {
      const url = listing.oem_sticker_url || listing.factory_sticker_url || pickUrl(pub.window);
      return url ? { status: "on_file", url, date: listing.oem_sticker_checked_at } : { status: "coming_soon" };
    },
  },
  {
    key: "used_window_sticker", category: "pricing", icon: FileText, appliesTo: ["used", "cpo"],
    title: "Used Car Window Sticker",
    description: "AutoLabels-generated window sticker showing this vehicle's selling price, equipment, market data, and required disclosures.",
    resolve: ({ listing, pub }) => {
      const url = pickUrl(pub.window) || listing.oem_sticker_url;
      return url ? { status: "on_file", url, date: pub.window?.published_at } : { status: "coming_soon" };
    },
  },
  {
    key: "addendum_sticker", category: "pricing", icon: FileCheck, appliesTo: ["new", "used", "cpo", "demo"],
    title: "Addendum Sticker",
    description: "Dealership addendum disclosing additional products, accessories, and equipment with each item priced separately.",
    resolve: ({ listing, pub }) => {
      const url = pickUrl(pub.addendum) || findDoc(listing, /addendum/i)?.url;
      return url ? { status: "on_file", url, date: pub.addendum?.published_at } : { status: "coming_soon" };
    },
  },
  {
    key: "ftc_buyers_guide", category: "pricing", icon: Shield, appliesTo: ["used", "cpo", "demo"],
    title: "FTC Buyer's Guide",
    description: "Federal Used Car Rule disclosure of warranty status and any known defects — required on every used vehicle offered for sale.",
    resolve: ({ listing, pub }) => {
      const url = pickUrl(pub.buyers_guide) || findDoc(listing, /buyer|guide/i)?.url;
      return url
        ? { status: "on_file", url, date: pub.buyers_guide?.published_at }
        : { status: "action_required", statusText: "Required — Not Yet On File" };
    },
  },
  {
    key: "ftc_price_disclosure", category: "pricing", icon: BadgeCheck, appliesTo: ["new"],
    title: "Price Disclosure",
    description: "Itemized pricing disclosure confirming the advertised selling price and all separately priced items, presented in an FTC-aligned format.",
    resolve: ({ listing, pub }) => {
      const has = pickUrl(pub.window) || pickUrl(pub.addendum) || listing.oem_sticker_url;
      return has ? { status: "on_file", date: pub.window?.published_at || pub.addendum?.published_at } : { status: "coming_soon" };
    },
  },
  {
    key: "demo_disclosure", category: "pricing", icon: Car, appliesTo: ["demo"],
    title: "Demo Vehicle Disclosure",
    description: "Disclosure confirming this vehicle served as a dealer demonstrator, including demo mileage accumulated, any dealer-added accessories, and adjusted pricing rationale.",
    resolve: ({ listing }) => {
      const url = findDoc(listing, /demo/i)?.url;
      return url ? { status: "on_file", url } : { status: "coming_soon" };
    },
  },

  // VEHICLE HISTORY
  {
    key: "vehicle_history", category: "history", icon: History, appliesTo: ["used", "cpo", "demo"],
    title: "Vehicle History Report",
    description: "Comprehensive ownership, accident, service, title, and odometer history from CARFAX or AutoCheck.",
    resolve: ({ listing }) => {
      const url = findDoc(listing, /carfax|autocheck|history/i)?.url;
      return url ? { status: "on_file", url } : { status: "coming_soon" };
    },
  },
  {
    key: "title_history", category: "history", icon: FileCheck, appliesTo: ["used", "cpo", "demo"],
    title: "Title History",
    description: "Confirms clean title status with no salvage, flood, lemon-law, or rebuilt-title designations on record.",
    resolve: ({ listing }) => {
      const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
      const brand = String(mc.title_brand ?? mc.title_status ?? "").toLowerCase();
      const dirty = brand && !/clean|none|clear/.test(brand);
      const url = findDoc(listing, /title/i)?.url;
      if (dirty) return { status: "action_required", statusText: "Title Issue on Record", url, detailLines: [`Title brand reported: ${brand}`, "Contact the dealer for full title documentation."] };
      return { status: "on_file", url, statusText: "Clean Title Verified", detailLines: ["No salvage, flood, lemon-law, or rebuilt-title designations on record."] };
    },
  },

  // INSPECTION & CERTIFICATION
  {
    key: "multipoint_inspection", category: "inspection", icon: ClipboardCheck, appliesTo: ["used", "cpo", "demo"],
    title: "Multi-Point Inspection",
    description: "Comprehensive pre-sale inspection completed by our service department confirming this vehicle's mechanical condition.",
    resolve: ({ listing }) => {
      const signed = listing.prep_status?.foreman_signed_at;
      const url = findDoc(listing, /inspection|multi.?point/i)?.url;
      return signed || url
        ? { status: "on_file", url, date: signed, detailLines: signed ? ["All inspection categories reviewed and signed off by the service foreman."] : undefined }
        : { status: "coming_soon" };
    },
  },
  {
    key: "recall_clearance", category: "inspection", icon: ShieldCheck, appliesTo: ["new", "used", "cpo", "demo"],
    title: "Safety & Recall Clearance",
    description: "Confirms open NHTSA safety recalls have been identified and addressed prior to sale.",
    resolve: ({ listing }) => {
      const open = listing.open_recall_count ?? 0;
      const rc = listing.recall_check;
      if (open > 0) {
        const lines = (rc?.campaigns || []).map((c) => `${c.campaignNumber ? c.campaignNumber + ": " : ""}${c.summary || c.component || "Open campaign"}`);
        return { status: "action_required", statusText: "Recall Pending — See Dealer", detailLines: lines.length ? lines : ["One or more open recalls on record. Contact the dealer before purchase."] };
      }
      return { status: "on_file", statusText: "No Open Recalls — NHTSA Verified", date: rc?.checked_at, detailLines: ["This vehicle has no open NHTSA safety recalls on record and passes all safety checks."] };
    },
  },
  {
    key: "ct_k208", category: "inspection", icon: ClipboardList, appliesTo: ["used", "cpo", "demo"], requiredStates: ["CT"],
    title: "CT DMV K-208 Inspection",
    description: "Connecticut state-required used-vehicle inspection form confirming this vehicle passed all required safety and emissions criteria.",
    resolve: ({ listing }) => {
      const url = findDoc(listing, /k.?208/i)?.url;
      const signed = listing.prep_status?.foreman_signed_at;
      return url || signed ? { status: "on_file", url, date: signed } : { status: "coming_soon" };
    },
  },
  {
    key: "cpo_certification", category: "inspection", icon: BadgeCheck, appliesTo: ["cpo"],
    title: "CPO Certification Package",
    description: "Manufacturer certified pre-owned certification: inspection checklist, certification date, certifying dealer, and certification number.",
    resolve: ({ listing }) => {
      const cert = listing.certification;
      return cert?.url || cert?.program_name
        ? { status: "on_file", url: cert.url, detailLines: [cert.program_name ? `Program: ${cert.program_name}` : "", cert.inspection_points ? `${cert.inspection_points}-point certification inspection` : ""].filter(Boolean) }
        : { status: "coming_soon" };
    },
  },
  {
    key: "cpo_inspection_checklist", category: "inspection", icon: ClipboardCheck, appliesTo: ["cpo"],
    title: "CPO Inspection Checklist",
    description: "Point-by-point inspection checklist completed as part of the certified pre-owned process, showing every system inspected and its verified status.",
    resolve: ({ listing }) => {
      const cert = listing.certification;
      return cert?.inspection_points
        ? { status: "on_file", detailLines: [`${cert.inspection_points}-point inspection completed and verified.`] }
        : { status: "coming_soon" };
    },
  },

  // WARRANTY
  {
    key: "factory_warranty", category: "warranty", icon: ShieldCheck, appliesTo: ["new", "cpo", "demo"],
    title: "Factory Warranty Card",
    description: "Manufacturer warranty coverage details including Basic, Powertrain, Corrosion, and Roadside Assistance terms.",
    resolve: ({ listing }) => {
      const w = listing.warranty_info;
      const url = findDoc(listing, /factory.?warranty|warranty.?card/i)?.url;
      if (!w && !url) return { status: "coming_soon" };
      const lines: string[] = [];
      if (w?.factory_months || w?.factory_miles) lines.push(`Basic: ${w?.factory_months ? Math.round(w.factory_months / 12) + " yr" : ""}${w?.factory_months && w?.factory_miles ? " / " : ""}${w?.factory_miles ? (w.factory_miles / 1000).toFixed(0) + "K mi" : ""}`.trim());
      if (w?.powertrain_months || w?.powertrain_miles) lines.push(`Powertrain: ${w?.powertrain_months ? Math.round(w.powertrain_months / 12) + " yr" : ""}${w?.powertrain_months && w?.powertrain_miles ? " / " : ""}${w?.powertrain_miles ? (w.powertrain_miles / 1000).toFixed(0) + "K mi" : ""}`.trim());
      if (w?.in_service_date) lines.push(`In-service date: ${fmtDate(w.in_service_date)}`);
      return { status: "on_file", url, detailLines: lines.length ? lines : undefined };
    },
  },
  {
    key: "cpo_warranty", category: "warranty", icon: ShieldCheck, appliesTo: ["cpo"],
    title: "CPO Warranty Documentation",
    description: "Certified pre-owned warranty terms: coverage period, mileage limits, what is covered, deductible amount, and how to make a claim.",
    resolve: ({ listing }) => {
      const cert = listing.certification;
      return cert?.coverage_months || cert?.coverage_miles
        ? { status: "on_file", url: cert.url, detailLines: [`Coverage: ${cert.coverage_months ? Math.round(cert.coverage_months / 12) + " yr" : ""}${cert.coverage_months && cert.coverage_miles ? " / " : ""}${cert.coverage_miles ? (cert.coverage_miles / 1000).toFixed(0) + "K mi" : ""}`.trim()] }
        : { status: "coming_soon" };
    },
  },
  {
    key: "extended_warranty", category: "warranty", icon: Shield, appliesTo: ["new", "used", "cpo", "demo"],
    title: "Extended Warranty / Service Contract",
    description: "Optional extended coverage available for this vehicle. Available at time of purchase — ask the dealer for details.",
    resolve: ({ listing }) => {
      const url = findDoc(listing, /extended|service.?contract|vsc/i)?.url;
      return url ? { status: "on_file", url } : { status: "coming_soon" };
    },
  },
  {
    key: "dealer_warranty_disclosure", category: "warranty", icon: FileText, appliesTo: ["used", "demo"],
    title: "Dealer Warranty Disclosure",
    description: "If this vehicle is sold with a dealer warranty, the terms are disclosed here. If sold As-Is, that disclosure is documented here.",
    resolve: ({ listing }) => {
      const url = findDoc(listing, /as.?is|dealer.?warranty/i)?.url;
      return url ? { status: "on_file", url } : { status: "coming_soon" };
    },
  },

  // OWNERSHIP
  {
    key: "delivery_checklist", category: "ownership", icon: ClipboardCheck, appliesTo: ["new"],
    title: "New Vehicle Delivery Checklist",
    description: "Pre-delivery inspection checklist confirming all factory systems were tested and verified before customer delivery.",
    resolve: ({ listing }) => {
      const signed = listing.prep_status?.foreman_signed_at;
      const url = findDoc(listing, /delivery|pdi/i)?.url;
      return signed || url ? { status: "on_file", url, date: signed } : { status: "coming_soon" };
    },
  },
  {
    key: "build_sheet", category: "ownership", icon: FileText, appliesTo: ["new", "demo"],
    title: "Build Sheet",
    description: "Complete factory build order showing every option and package installed at the factory.",
    resolve: ({ listing }) => {
      const url = listing.factory_sticker_url;
      const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
      return url || mc.build || (listing.features && listing.features.length > 0)
        ? { status: "on_file", url }
        : { status: "coming_soon" };
    },
  },
  {
    key: "owners_manual", category: "ownership", icon: BookOpen, appliesTo: ["new", "used", "cpo", "demo"],
    title: "Owner's Manual",
    description: "Official owner's manual and reference guide for this vehicle.",
    resolve: ({ listing }) => {
      const url = findDoc(listing, /owner.?s?.?manual|manual/i)?.url;
      return url ? { status: "on_file", url } : { status: "coming_soon" };
    },
  },
  {
    key: "maintenance_guide", category: "ownership", icon: Wrench, appliesTo: ["new", "used", "cpo", "demo"],
    title: "Maintenance Guide",
    description: "Recommended maintenance schedule and service intervals for this vehicle.",
    resolve: ({ listing }) => {
      const url = findDoc(listing, /maintenance/i)?.url;
      return url ? { status: "on_file", url } : { status: "coming_soon" };
    },
  },
  {
    key: "terms_conditions", category: "ownership", icon: KeyRound, appliesTo: ["new", "used", "cpo", "demo"],
    title: "Terms & Conditions",
    description: "Dealership terms, conditions, and purchase policies.",
    resolve: () => ({ status: "on_file", detailLines: ["Standard dealership purchase terms, conditions, and policies apply. A full copy is available on request."] }),
  },
];

// ── Status presentation ───────────────────────────────────────
const STATUS_UI: Record<DocStatus, { strip: string; label: string; labelText: string; icon: React.ElementType; iconColor: string }> = {
  on_file:        { strip: "bg-emerald-500", label: "text-emerald-600", labelText: "ON FILE", icon: CheckCircle2, iconColor: "text-emerald-500" },
  coming_soon:    { strip: "bg-slate-300", label: "text-slate-400", labelText: "COMING SOON", icon: Clock, iconColor: "text-slate-400" },
  action_required:{ strip: "bg-red-500", label: "text-red-600", labelText: "ACTION REQUIRED", icon: AlertTriangle, iconColor: "text-red-500" },
};

// ── Send / capture modal (text · email · notify) ──────────────
const SendModal = ({
  listing, mode, docTitle, docUrl, onClose,
}: {
  listing: VehicleListing; mode: "email" | "text" | "notify";
  docTitle: string; docUrl?: string | null; onClose: () => void;
}) => {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const isText = mode === "text";
  const heading = mode === "notify" ? "Notify Me When Available" : isText ? "Text It to Me" : "Email It to Me";
  const placeholder = isText ? "Mobile number" : "Email address";

  const submit = async () => {
    if (!value.trim()) { toast.error(`Enter your ${isText ? "phone number" : "email"}`); return; }
    setSending(true);
    try {
      await (supabase as unknown as { from: (t: string) => { insert: (r: unknown) => Promise<unknown> } })
        .from("vehicle_leads")
        .insert({
          vehicle_listing_id: listing.id,
          tenant_id: listing.tenant_id,
          vin: listing.vin,
          name: "",
          email: isText ? null : value.trim(),
          phone: isText ? value.trim() : null,
          message: `${mode === "notify" ? "Notify when available" : "Send document"}: ${docTitle}${docUrl ? ` (${docUrl})` : ""}`,
          source: mode === "notify" ? "document_notify" : "document_share",
          created_at: new Date().toISOString(),
        });
      setSent(true);
    } catch {
      toast.error("Couldn't submit — please contact the dealer directly");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-black text-slate-900">{heading}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-5">{docTitle}</p>
        {sent ? (
          <div className="text-center py-6">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-900">
              {mode === "notify" ? "We'll let you know the moment it's available." : "On its way — check your messages shortly."}
            </p>
          </div>
        ) : (
          <>
            <input
              value={value} onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder} type={isText ? "tel" : "email"}
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <button onClick={submit} disabled={sending}
              className="w-full h-12 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-colors">
              {sending ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <><Send className="w-4 h-4" /> {mode === "notify" ? "Notify Me" : "Send It"}</>}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

// ── Inline document viewer ────────────────────────────────────
const ViewerPanel = ({
  doc, resolved, dealerName, onClose, onSend,
}: {
  doc: DocDescriptor; resolved: Resolved; dealerName: string;
  onClose: () => void; onSend: (mode: "email" | "text") => void;
}) => {
  const url = resolved.url || "";
  const isImage = /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);
  return (
    <div className="fixed inset-0 z-[65] flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-3xl h-full flex flex-col shadow-2xl
                      animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <doc.icon className="w-5 h-5" />
            </div>
            <p className="font-black text-slate-900 truncate">{doc.title}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-slate-50">
          {url ? (
            isImage ? (
              <div className="min-h-full flex items-center justify-center p-4">
                <img src={url} alt={doc.title} className="max-w-full rounded-lg shadow" />
              </div>
            ) : (
              <iframe title={doc.title} src={url} className="w-full h-full min-h-[70vh] border-0" />
            )
          ) : (
            <div className="p-8">
              <div className="max-w-lg mx-auto bg-white rounded-2xl border border-slate-200 p-6">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <p className="text-sm text-slate-600 leading-relaxed mb-4">{doc.description}</p>
                {resolved.detailLines && resolved.detailLines.length > 0 && (
                  <ul className="space-y-2">
                    {resolved.detailLines.map((line, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> {line}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-slate-400 mt-5">Verified on file by {dealerName}. Request a copy below.</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-200 shrink-0 overflow-x-auto">
          {url && (
            <>
              <a href={url} download target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 whitespace-nowrap">
                <Download className="w-4 h-4" /> Download
              </a>
              <button onClick={() => window.open(url, "_blank")}
                className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 whitespace-nowrap">
                <Printer className="w-4 h-4" /> Print
              </button>
            </>
          )}
          <button onClick={() => onSend("text")}
            className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 border border-slate-200 rounded-lg px-3 py-2 hover:bg-blue-50 whitespace-nowrap">
            <Smartphone className="w-4 h-4" /> Text to Me
          </button>
          <button onClick={() => onSend("email")}
            className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 border border-slate-200 rounded-lg px-3 py-2 hover:bg-blue-50 whitespace-nowrap">
            <Mail className="w-4 h-4" /> Email to Me
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Document card ─────────────────────────────────────────────
const DocCard = ({
  doc, resolved, dealerName, onView, onSend,
}: {
  doc: DocDescriptor; resolved: Resolved; dealerName: string;
  onView: () => void; onSend: (mode: "email" | "text" | "notify") => void;
}) => {
  const ui = STATUS_UI[resolved.status];
  const coming = resolved.status === "coming_soon";
  const StatusIcon = ui.icon;
  const dateStr = resolved.date ? fmtDate(resolved.date) : "";
  const metaBits = [
    resolved.url ? "PDF" : "Verified",
    resolved.pages ? `${resolved.pages} pages` : null,
    dateStr ? `Added ${new Date(resolved.date as string).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })}` : null,
  ].filter(Boolean).join("  ·  ");

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white overflow-hidden flex flex-col ${coming ? "opacity-90" : ""}`}>
      <div className={`h-1.5 ${ui.strip}`} />
      <div className="p-5 flex flex-col flex-1">
        <div className="flex items-center justify-between mb-3">
          <span className={`text-[11px] font-black tracking-wider ${ui.label}`}>{ui.labelText}</span>
          <button onClick={() => onSend(coming ? "notify" : "email")} className="text-slate-300 hover:text-slate-500">
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-start gap-3 mb-3">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${coming ? "bg-slate-100 text-slate-400" : "bg-blue-50 text-blue-600"}`}>
            <doc.icon className="w-6 h-6" />
          </div>
          <div className="min-w-0 pt-0.5">
            <p className="font-black text-slate-900 leading-tight">{doc.title}</p>
            <p className={`text-xs font-semibold mt-1 flex items-center gap-1 ${ui.label}`}>
              <StatusIcon className={`w-3.5 h-3.5 ${ui.iconColor}`} />
              {resolved.statusText || (resolved.status === "on_file" ? (dateStr ? `Verified ${dateStr}` : "On File") : coming ? "Coming Soon" : "Action Required")}
            </p>
          </div>
        </div>

        <p className="text-sm text-slate-600 leading-snug mb-4">{doc.description}</p>

        <div className="text-xs text-slate-400 mb-4 mt-auto">
          {!coming && <p>{metaBits}</p>}
          {!coming && <p>Uploaded by {dealerName}</p>}
          {coming && <p>Will be added soon</p>}
        </div>

        {coming ? (
          <button onClick={() => onSend("notify")}
            className="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm rounded-xl py-2.5 transition-colors">
            <Bell className="w-4 h-4" /> Notify Me When Available
          </button>
        ) : (
          <>
            <div className="flex gap-2">
              <button onClick={onView}
                className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl py-2.5 transition-colors">
                View Document <ChevronRight className="w-4 h-4" />
              </button>
              {resolved.url && (
                <a href={resolved.url} download target="_blank" rel="noreferrer"
                  className="flex items-center justify-center gap-1.5 border border-slate-200 text-slate-700 font-bold text-sm rounded-xl px-3 py-2.5 hover:bg-slate-50 transition-colors whitespace-nowrap">
                  <Download className="w-4 h-4" />
                </a>
              )}
            </div>
            <div className="flex items-center gap-5 mt-3 pt-3 border-t border-slate-100">
              <button onClick={() => onSend("text")} className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:underline">
                <Smartphone className="w-3.5 h-3.5" /> Text to Me
              </button>
              <button onClick={() => onSend("email")} className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:underline">
                <Mail className="w-3.5 h-3.5" /> Email to Me
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ── Page ──────────────────────────────────────────────────────
const PublicDocuments = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { publicUrl } = useVehicleListing("");

  const [listing, setListing] = useState<VehicleListing | null>(null);
  const [pub, setPub] = useState<Record<string, PublicDoc>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<"all" | DocCategory>("all");
  const [viewerKey, setViewerKey] = useState<string | null>(null);
  const [send, setSend] = useState<{ mode: "email" | "text" | "notify"; title: string; url?: string | null } | null>(null);

  useEffect(() => {
    if (!slug) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      const fetchPub = (async () => {
        try {
          const { data } = await (supabase as unknown as { rpc: (n: string, a: unknown) => Promise<{ data: unknown }> })
            .rpc("get_published_documents_public", { _slug: slug });
          return Array.isArray(data) ? (data as PublicDoc[]) : [];
        } catch { return []; }
      })();
      const [viewRes, pubArr] = await Promise.all([
        supabase.functions.invoke("public-listing-view", { body: { slug } }),
        fetchPub,
      ]);
      if (!mounted) return;
      const row = (viewRes.data as { listing?: VehicleListing } | null)?.listing ?? null;
      if (viewRes.error || !row) { setNotFound(true); setLoading(false); return; }
      setListing(row);
      const map: Record<string, PublicDoc> = {};
      for (const d of pubArr) if (!map[d.document_type]) map[d.document_type] = d;
      setPub(map);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [slug]);

  const vehType = useMemo(() => (listing ? detectVehType(listing) : "used"), [listing]);
  const dealerState = useMemo(() => normalizeState(listing?.dealer_snapshot?.state || listing?.vehicle_state), [listing]);

  const docs = useMemo(() => {
    if (!listing) return [] as { doc: DocDescriptor; resolved: Resolved }[];
    const ctx: ResolveCtx = { listing, pub };
    return CATALOG
      .filter((d) => d.appliesTo.includes(vehType))
      .filter((d) => !d.requiredStates || d.requiredStates.map(normalizeState).includes(dealerState))
      .map((doc) => ({ doc, resolved: doc.resolve(ctx) }));
  }, [listing, pub, vehType, dealerState]);

  const counts = useMemo(() => {
    const onFile = docs.filter((d) => d.resolved.status === "on_file").length;
    const coming = docs.filter((d) => d.resolved.status === "coming_soon").length;
    const action = docs.filter((d) => d.resolved.status === "action_required").length;
    const pct = docs.length ? Math.round((onFile / docs.length) * 100) : 0;
    return { onFile, coming, action, total: docs.length, pct };
  }, [docs]);

  const lastUpdated = useMemo(() => {
    const dates = docs.map((d) => d.resolved.date).filter(Boolean).map((d) => new Date(d as string).getTime());
    const fromPub = Object.values(pub).map((p) => p.published_at).filter(Boolean).map((d) => new Date(d as string).getTime());
    const all = [...dates, ...fromPub, listing?.updated_at ? new Date(listing.updated_at).getTime() : 0].filter(Boolean);
    return all.length ? fmtDate(new Date(Math.max(...all)).toISOString()) : "";
  }, [docs, pub, listing]);

  const visibleTabs = useMemo(
    () => CATEGORIES.filter((c) => c.key === "all" || docs.some((d) => d.doc.category === c.key)),
    [docs],
  );

  const shown = tab === "all" ? docs : docs.filter((d) => d.doc.category === tab);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (notFound || !listing) return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center">
        <Package className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <h1 className="text-xl font-bold">Documents unavailable</h1>
        <p className="text-sm text-slate-500 mt-2">This vehicle's document center could not be found.</p>
        <p className="text-[11px] text-slate-400 mt-3 font-mono">{slug}</p>
      </div>
    </div>
  );

  const dealer = (listing.dealer_snapshot || {}) as Record<string, unknown>;
  const dealerName = (dealer.name as string) || "the dealership";
  const ks = listing.key_specs || {};
  const ymm = listing.ymm || "Vehicle";
  const passportUrl = `/v/${listing.slug}/documents`;
  const customDocs = (listing.documents || []).filter((d) =>
    !/addendum|buyer|guide|carfax|autocheck|history|title|inspection|multi.?point|k.?208|extended|service.?contract|vsc|as.?is|dealer.?warranty|delivery|pdi|owner|manual|maintenance|demo|factory.?warranty|warranty.?card/i.test(`${d.type} ${d.name}`));

  const openSend = (mode: "email" | "text" | "notify", title: string, url?: string | null) => setSend({ mode, title, url });

  return (
    <div className="min-h-screen bg-white text-slate-900 pb-24 sm:pb-0">
      <Helmet>
        <title>{`Documents — ${ymm}${listing.trim ? ` ${listing.trim}` : ""}`}</title>
        <meta name="robots" content="noindex" />
        <link rel="canonical" href={`${publicUrl(listing.slug)}/documents`} />
      </Helmet>

      {/* ══ HEADER ══════════════════════════════════════════════ */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <Logo variant="full" size={20} />
        <div className="flex items-center gap-3">
          <button onClick={() => { navigator.clipboard?.writeText(`${publicUrl(listing.slug)}/documents`); toast.success("Link copied"); }}
            className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
            <Upload className="w-4 h-4" /><span className="hidden sm:inline">Share</span>
          </button>
          <button onClick={() => toast.success("Saved to this device")} className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
            <Bookmark className="w-4 h-4" /><span className="hidden sm:inline">Save</span>
          </button>
          <button onClick={() => window.print()} className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
            <Printer className="w-4 h-4" /><span className="hidden sm:inline">Print</span>
          </button>
        </div>
      </header>

      {/* ══ VEHICLE IDENTITY STRIP ══════════════════════════════ */}
      <div className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {(listing.hero_image_url || listing.photos?.[0]?.url) && (
              <img src={listing.hero_image_url || listing.photos[0].url} alt={ymm}
                className="w-24 h-16 rounded-xl object-cover border border-slate-100 shrink-0 hidden sm:block" />
            )}
            <div className="min-w-0">
              <p className="text-lg font-black text-slate-900 truncate">
                {ymm}{listing.trim ? <span className="font-semibold text-slate-500"> {listing.trim}</span> : null}
              </p>
              <p className="text-xs text-slate-500 truncate flex flex-wrap gap-x-2">
                {listing.mileage != null && <span>{listing.mileage.toLocaleString()} mi</span>}
                {ks.exterior_color && <span>· {ks.exterior_color}</span>}
                {(listing as unknown as Record<string, unknown>).stock_number && <span>· Stock # {String((listing as unknown as Record<string, unknown>).stock_number)}</span>}
                {listing.vin && <span>· VIN {listing.vin}</span>}
              </p>
            </div>
          </div>
          <button onClick={() => navigate(`/v-classic/${listing.slug}`)}
            className="flex items-center gap-2 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors shrink-0">
            <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Back to Vehicle Passport</span><span className="sm:hidden">Passport</span>
          </button>
        </div>
      </div>

      {/* ══ TITLE ═══════════════════════════════════════════════ */}
      <div className="max-w-6xl mx-auto px-4 pt-8 pb-2">
        <h1 className="text-3xl font-black tracking-tight text-slate-900">Vehicle Documents</h1>
        <p className="text-sm text-slate-500 mt-1">All documents verified and securely stored. Tap any document to view.</p>
      </div>

      {/* ══ STATUS SUMMARY BAR ══════════════════════════════════ */}
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="rounded-2xl border border-slate-200 p-5 flex flex-col lg:flex-row lg:items-center gap-5">
          <div className="flex items-center gap-3 flex-1">
            <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <FileCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-lg font-black text-slate-900 leading-none"><span className="text-emerald-600">{counts.onFile}</span> Documents on File</p>
              <p className="text-xs text-slate-500 mt-1">Verified and available</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-1">
            <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-lg font-black text-slate-900 leading-none">{counts.coming} Coming Soon</p>
              <p className="text-xs text-slate-500 mt-1">Will be added soon</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-1">
            <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <History className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-black text-slate-900 leading-none">Last Updated</p>
              <p className="text-xs text-slate-500 mt-1">{lastUpdated || "—"}</p>
            </div>
          </div>
          <div className="shrink-0 lg:w-48">
            <div className="flex items-end justify-between mb-1">
              <span className="text-2xl font-black text-emerald-600">{counts.pct}%</span>
              <span className="text-xs text-slate-500">Complete</span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${counts.pct}%` }} />
            </div>
          </div>
        </div>
        {counts.action > 0 && (
          <div className="mt-3 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {counts.action} document{counts.action > 1 ? "s" : ""} require{counts.action > 1 ? "" : "s"} attention before purchase.
          </div>
        )}
      </div>

      {/* ══ CATEGORY TABS ═══════════════════════════════════════ */}
      <div className="max-w-6xl mx-auto px-4 py-2">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {visibleTabs.map((c) => (
            <button key={c.key} onClick={() => setTab(c.key)}
              className={`whitespace-nowrap text-sm font-semibold px-4 py-2 rounded-xl border transition-colors ${
                tab === c.key ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* ══ DOCUMENT GRID ═══════════════════════════════════════ */}
      <div className="max-w-6xl mx-auto px-4 py-4">
        <h2 className="text-lg font-black text-slate-900 mb-4">
          {tab === "all" ? "All Documents" : CATEGORIES.find((c) => c.key === tab)?.label} <span className="text-slate-400">({shown.length})</span>
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {shown.map(({ doc, resolved }) => (
            <DocCard key={doc.key} doc={doc} resolved={resolved} dealerName={dealerName}
              onView={() => setViewerKey(doc.key)}
              onSend={(mode) => openSend(mode, doc.title, resolved.url)} />
          ))}
        </div>
      </div>

      {/* ══ ADDITIONAL / DEALER-UPLOADED DOCUMENTS ══════════════ */}
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="rounded-2xl border border-dashed border-slate-300 p-6 flex flex-col items-center text-center justify-center">
            <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center mb-3">
              <UploadCloud className="w-5 h-5" />
            </div>
            <p className="font-black text-slate-900">Additional Documents</p>
            <p className="text-xs text-slate-500 mt-1 mb-4">Have a document to share? We'll add it to this vehicle.</p>
            <button onClick={() => openSend("email", "Additional document request")}
              className="border border-slate-200 rounded-xl px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors">
              Upload Document
            </button>
          </div>
          <div className="rounded-2xl bg-blue-50 border border-blue-100 p-6 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
              <Lock className="w-6 h-6" />
            </div>
            <div>
              <p className="font-black text-slate-900 mb-1">All documents are verified and secure.</p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1">
                {["Checked for compliance and accuracy", "Virus scanned and encrypted", "Stored securely in the cloud", "Always accessible on any device"].map((t) => (
                  <li key={t} className="flex items-center gap-1.5 text-xs text-slate-600">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        {customDocs.length > 0 && (
          <div className="mt-5">
            <p className="text-sm font-bold text-slate-700 mb-3">Dealer-Provided Documents</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {customDocs.map((d) => (
                <a key={d.url} href={d.url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-3 p-4 border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-900 truncate">{d.name || "Document"}</p>
                    <p className="text-xs text-slate-400">Uploaded by {dealerName}</p>
                  </div>
                  <ExternalLink className="w-4 h-4 text-slate-400 shrink-0" />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ══ SHARE DOCUMENT PACKAGE ══════════════════════════════ */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="rounded-2xl border border-slate-200 p-6 sm:p-8 text-center">
          <h2 className="text-xl font-black text-slate-900 mb-1">Share This Vehicle's Complete Document Package</h2>
          <p className="text-sm text-slate-500 mb-6">Send all documents to yourself or share with a co-buyer.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <button onClick={() => openSend("email", "Complete document package")}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl px-5 py-3 transition-colors">
              <Mail className="w-4 h-4" /> Email All Documents
            </button>
            <button onClick={() => openSend("text", "Complete document package")}
              className="flex items-center gap-2 border border-slate-200 text-slate-700 font-bold text-sm rounded-xl px-5 py-3 hover:bg-slate-50 transition-colors">
              <Smartphone className="w-4 h-4" /> Text Document Link
            </button>
            <button onClick={() => { navigator.clipboard?.writeText(`${publicUrl(listing.slug)}/documents`); toast.success("Link copied to clipboard"); }}
              className="flex items-center gap-2 border border-slate-200 text-slate-700 font-bold text-sm rounded-xl px-5 py-3 hover:bg-slate-50 transition-colors">
              <Link2 className="w-4 h-4" /> Copy Link
            </button>
            <button onClick={() => window.print()}
              className="flex items-center gap-2 border border-slate-200 text-slate-700 font-bold text-sm rounded-xl px-5 py-3 hover:bg-slate-50 transition-colors">
              <Printer className="w-4 h-4" /> Print All
            </button>
          </div>
        </div>
      </div>

      {/* ══ DOCUMENT TRANSPARENCY (FTC-ALIGNED) ═════════════════ */}
      <div className="max-w-6xl mx-auto px-4 pb-8">
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-2">
            <ClipboardCheck className="w-5 h-5 text-blue-600" />
            <h3 className="font-black text-slate-900">Document Transparency Commitment</h3>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            All documents on this page are authentic and unaltered. Pricing documents reflect this vehicle's complete
            advertised selling price. Optional products and services are itemized separately and require written customer
            authorization prior to purchase. This vehicle is presented using AutoLabels' FTC-aligned 50-state disclosure engine.
          </p>
          <p className="text-xs text-slate-400 mt-3">
            {dealerName}
            {(dealer.license_number as string) ? ` · License # ${dealer.license_number}` : ""}
            {lastUpdated ? ` · Documents last updated ${lastUpdated}` : ""}
          </p>
        </div>
      </div>

      {/* ══ FOOTER ══════════════════════════════════════════════ */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {(dealer.logo_url as string) ? (
              <img src={dealer.logo_url as string} alt={dealerName} className="h-8 w-auto" />
            ) : (
              <Logo variant="full" size={18} />
            )}
          </div>
          <div className="flex items-center gap-4">
            {dealer.phone ? (
              <a href={`tel:${dealer.phone}`} className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 hover:text-blue-600">
                <Phone className="w-4 h-4" /> {formatPhone(dealer.phone as string)}
              </a>
            ) : null}
            {dealer.address ? (
              <a href={`https://maps.google.com/?q=${encodeURIComponent(`${dealer.address} ${dealer.city || ""} ${dealer.state || ""}`)}`} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 hover:text-blue-600">
                <MapPin className="w-4 h-4" /> Directions
              </a>
            ) : null}
          </div>
          <p className="text-xs text-slate-400">
            © {new Date().getFullYear()} {dealerName}. All rights reserved.
          </p>
        </div>
      </footer>

      {/* ══ STICKY MOBILE BAR ═══════════════════════════════════ */}
      <div className="fixed bottom-0 inset-x-0 z-40 sm:hidden bg-white border-t border-slate-200 px-3 py-2.5 flex items-center gap-2 shadow-lg">
        <button onClick={() => navigate(`/v-classic/${listing.slug}`)}
          className="flex-1 h-11 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5">
          <ArrowLeft className="w-4 h-4" /> Passport
        </button>
        <button onClick={() => openSend("email", "Complete document package")}
          className="flex-1 h-11 bg-blue-600 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5">
          <Mail className="w-4 h-4" /> Email All
        </button>
        <a href={dealer.phone ? `tel:${dealer.phone}` : passportUrl}
          className="flex-1 h-11 border-2 border-blue-600 text-blue-600 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5">
          <Phone className="w-4 h-4" /> Contact
        </a>
      </div>

      {/* ══ OVERLAYS ════════════════════════════════════════════ */}
      {viewerKey && (() => {
        const entry = docs.find((d) => d.doc.key === viewerKey);
        if (!entry) return null;
        return (
          <ViewerPanel doc={entry.doc} resolved={entry.resolved} dealerName={dealerName}
            onClose={() => setViewerKey(null)}
            onSend={(mode) => openSend(mode, entry.doc.title, entry.resolved.url)} />
        );
      })()}

      {send && (
        <SendModal listing={listing} mode={send.mode} docTitle={send.title} docUrl={send.url}
          onClose={() => setSend(null)} />
      )}
    </div>
  );
};

export default PublicDocuments;
