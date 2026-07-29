import {
  ShieldCheck, FileText, ExternalLink, Download, ChevronRight, MessageSquare,
  AlertTriangle, CheckCircle2, Clock, HelpCircle, MapPin, Phone, Navigation,
  Building2, Wrench, DollarSign, BadgeCheck, Car, History as HistoryIcon,
} from "lucide-react";
import type { PassportData } from "@/lib/passportV2Data";
import type { VehicleListing } from "@/hooks/useVehicleListing";
import { packetVisible } from "@/lib/packetModules";
import { listingHero } from "@/lib/photos";
import { historyReportName } from "@/lib/passportV2Data";
import {
  VERIFICATION_STATUS_LABEL, VERIFICATION_CHECK_SHORT_LABEL,
  type ReportCheck, type VerificationStatus, type VerificationReport,
} from "@/lib/passport/verificationSummary";
import { resolveVehicleTruth, fmtMoney } from "@/lib/passport/vehicleTruth";
import { documentCoverType, resolveDocumentArtwork } from "@/lib/passport/documentArtwork";
import { DocumentCoverThumbnail } from "@/components/passport/DocumentCoverThumbnail";
import { CARD } from "./PassportSlideOver";
import type { PanelDef } from "./panelDef";
import type { PassportPanelKey } from "./passportPanelKeys";

// ──────────────────────────────────────────────────────────────────────
// Trust, document and dealer drawers.
//
// Every panel here replaced a full-page navigation. The rule that decided
// which: looking deeper at the SAME vehicle is investigation and stays over
// the passport; committing to something, entering contact details, or opening
// a formal printable report is a task and earns a page.
//
// All of them read the shared truth model, so a status shown here is the same
// status the passport, the verification report and the buying report show. A
// pending check reads Pending in all four places or in none.
// ──────────────────────────────────────────────────────────────────────

const NAVY = "#0F172A";
const SUB = "#64748B";
const BLUE = "#2563EB";

const STATUS_TONE: Record<VerificationStatus, { bg: string; border: string; text: string; icon: React.ElementType }> = {
  verified: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", icon: CheckCircle2 },
  needs_attention: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", icon: AlertTriangle },
  needs_confirmation: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", icon: HelpCircle },
  pending: { bg: "bg-slate-50", border: "border-[#E6E8EC]", text: "text-slate-600", icon: Clock },
  unavailable: { bg: "bg-slate-50", border: "border-[#E6E8EC]", text: "text-slate-500", icon: HelpCircle },
};

// Plain-language meaning of each state. A shopper reading "Pending" must not
// infer a bad result, and "Not available" must not read as "we found nothing
// wrong" either — both are statements about the SOURCE, not the vehicle.
const STATUS_MEANING: Record<VerificationStatus, string> = {
  verified: "A source returned a result and it checked out.",
  needs_attention: "A source reported something worth reviewing with the dealer before you buy.",
  needs_confirmation: "Two sources disagree. That is not a finding against the vehicle — it means the answer has to be confirmed.",
  pending: "This check has not returned yet. Pending is not a negative result — no conclusion has been reached either way.",
  unavailable: "No source returned data for this check on this vehicle. That is a gap in the records, not a finding about the car.",
};

const fmtDate = (iso: string | null): string | null =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

const StatusPill = ({ status }: { status: VerificationStatus }) => {
  const t = STATUS_TONE[status];
  const Icon = t.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-bold ${t.bg} ${t.border} ${t.text}`}>
      <Icon className="w-3.5 h-3.5" /> {VERIFICATION_STATUS_LABEL[status]}
    </span>
  );
};

// Source + date line. The date is the SOURCE's own last-checked date, never
// the moment the page rendered: a report generated on Jul 29 whose history
// source last answered on Jul 5 must say Jul 5.
const SourceLine = ({ check }: { check: ReportCheck }) => {
  const when = fmtDate(check.checkedAt);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]" style={{ color: SUB }}>
      <span className="font-semibold">Source:</span>
      <span>{check.evidence.find((e) => e.label === "Source")?.value ?? "Not stated"}</span>
      <span aria-hidden>·</span>
      <span className="font-semibold">Last checked:</span>
      <span>{when ?? (check.status === "pending" ? "Refresh pending" : "Not recorded")}</span>
    </div>
  );
};

const EvidenceList = ({ check }: { check: ReportCheck }) => {
  const rows = check.evidence.filter((e) => e.label !== "Source" && e.value != null);
  if (!rows.length) return null;
  return (
    <div className={`${CARD} p-4`}>
      <p className="text-[12px] font-bold uppercase tracking-wide mb-2" style={{ color: SUB }}>Supporting evidence</p>
      {rows.map((e) => (
        <div key={e.label} className="flex items-start justify-between gap-4 py-1.5 border-b border-[#F1F5F9] last:border-0">
          <span className="text-[13px]" style={{ color: SUB }}>{e.label}</span>
          <span className="text-[13px] font-semibold text-right" style={{ color: NAVY }}>{e.value}</span>
        </div>
      ))}
    </div>
  );
};

const CheckDetail = ({ check }: { check: ReportCheck }) => (
  <div className="space-y-4">
    <div className={`rounded-2xl border p-5 ${STATUS_TONE[check.status].bg} ${STATUS_TONE[check.status].border}`}>
      <StatusPill status={check.status} />
      <p className="text-[14px] mt-3 leading-relaxed" style={{ color: NAVY }}>
        {check.finding ?? STATUS_MEANING[check.status]}
      </p>
    </div>
    <div className={`${CARD} p-4`}>
      <p className="text-[12px] font-bold uppercase tracking-wide mb-1.5" style={{ color: SUB }}>
        What {VERIFICATION_STATUS_LABEL[check.status]} means
      </p>
      <p className="text-[13px] leading-relaxed" style={{ color: NAVY }}>{STATUS_MEANING[check.status]}</p>
    </div>
    <EvidenceList check={check} />
    <SourceLine check={check} />
  </div>
);

const MissingCheck = ({ label }: { label: string }) => (
  <div className={`${CARD} p-5`}>
    <StatusPill status="unavailable" />
    <p className="text-[14px] mt-3" style={{ color: NAVY }}>
      {label} has not been evaluated for this vehicle yet.
    </p>
    <p className="text-[13px] mt-1.5" style={{ color: SUB }}>{STATUS_MEANING.unavailable}</p>
  </div>
);

export interface TrustPanelContext {
  d: PassportData;
  listing: VehicleListing;
  isPreview: boolean;
  /** Full-page navigation — used ONLY for formal reports and contact flows. */
  go: (section: string) => void;
  openPanel: (key: PassportPanelKey) => void;
  /** Fires an analytics event without personal data. */
  track: (event: string, meta?: Record<string, unknown>) => void;
}

export function isTrustPanelKey(key: string): boolean {
  return key === "title-brand" || key === "vehicle-history" || key === "verification-categories"
    || key === "documents" || key === "dealer-profile";
}

export function buildTrustPanel(key: PassportPanelKey, ctx: TrustPanelContext): PanelDef | null {
  const { d, listing, go, openPanel, track } = ctx;
  const truth = resolveVehicleTruth(d, listing);
  const report = truth.verification;

  const askDealer = { label: "Ask the Dealer", onClick: () => go("contact") };
  const fullReport = {
    label: "Open Full Verification Report",
    onClick: () => { track("full_report_opened", { report: "verification" }); go("verification"); },
  };

  switch (key) {
    // ── A. Title & brand ────────────────────────────────────────────
    case "title-brand": {
      const check = truth.checkByKey("title");
      return {
        title: "Title & Brand",
        subtitle: check ? VERIFICATION_STATUS_LABEL[check.status] : "Not available",
        body: check ? <CheckDetail check={check} /> : <MissingCheck label="Title & brand" />,
        primary: askDealer,
        secondary: fullReport,
        footerQuestion: "Want the dealer to confirm the title record?",
        specialistLabel: "Ask about the title",
      };
    }

    // ── B. Vehicle history ──────────────────────────────────────────
    case "vehicle-history": {
      const rows = ["history", "ownership", "odometer", "title"]
        .map((k) => truth.checkByKey(k))
        .filter((c): c is ReportCheck => !!c);
      const carfax = d.historyReport && packetVisible(listing, "historyReport") ? d.historyReport : null;
      return {
        title: "Vehicle History",
        subtitle: rows.length ? `${rows.filter((r) => r.status === "verified").length} of ${rows.length} history checks returned` : "Not available",
        body: (
          <div className="space-y-4">
            {rows.length === 0 && <MissingCheck label="Vehicle history" />}
            {rows.map((c) => (
              <div key={c.key} className={`${CARD} p-4`}>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[14px] font-bold" style={{ color: NAVY }}>{VERIFICATION_CHECK_SHORT_LABEL[c.key] ?? c.name}</p>
                  <StatusPill status={c.status} />
                </div>
                <p className="text-[13px] mt-2 leading-relaxed" style={{ color: c.finding ? NAVY : SUB }}>
                  {c.finding ?? STATUS_MEANING[c.status]}
                </p>
                <div className="mt-2.5"><SourceLine check={c} /></div>
              </div>
            ))}
            {carfax && (
              <a
                href={carfax.url} target="_blank" rel="noopener noreferrer"
                onClick={() => track("document_viewed", { document: "history_report", provider: carfax.provider })}
                className="w-full h-12 rounded-xl inline-flex items-center justify-center gap-2 text-[14px] font-bold text-white"
                style={{ background: BLUE }}
              >
                Open the {historyReportName(carfax.provider)} report <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        ),
        primary: askDealer,
        secondary: fullReport,
        footerQuestion: "Questions about this vehicle's history?",
        specialistLabel: "Ask about the history",
      };
    }

    // ── C. Every verification category ──────────────────────────────
    case "verification-categories":
      return {
        title: "Verification Categories",
        subtitle: `${report.verifiedChecks} verified · ${report.totalChecks} checks total`,
        body: <CategoryList report={report} openPanel={openPanel} track={track} />,
        primary: askDealer,
        secondary: fullReport,
        footerQuestion: "Want any of these confirmed in writing?",
        specialistLabel: "Ask the dealership",
      };

    // ── H. Documents ────────────────────────────────────────────────
    case "documents":
      return {
        title: "Documents",
        subtitle: documentSubtitle(listing, d),
        body: <DocumentList ctx={ctx} />,
        primary: { label: "Request a Document", onClick: () => go("check-availability") },
        secondary: { label: "Open Document Center", onClick: () => go("documents") },
        footerQuestion: "Need a record that isn't here?",
        specialistLabel: "Ask the dealership",
        xl: true,
      };

    // ── I. Dealer ───────────────────────────────────────────────────
    case "dealer-profile":
      return {
        title: `About ${d.dealerName || "this dealership"}`,
        subtitle: d.dealerAddress || "Dealer information",
        body: <DealerConfidence ctx={ctx} />,
        primary: { label: "Schedule Test Drive", onClick: () => go("test-drive") },
        secondary: { label: "Contact Dealer", onClick: () => go("contact") },
        footerQuestion: `Want to visit ${d.dealerName || "the dealership"}?`,
        specialistLabel: "Get directions or call",
      };

    default:
      return null;
  }
}

// ── Category list with inline expansion (never a page jump) ───────────
function CategoryList({ report, openPanel, track }: {
  report: VerificationReport;
  openPanel: (k: PassportPanelKey) => void;
  track: (e: string, m?: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-3">
      {report.checks.map((c) => {
        // Title and history have their own dedicated drawers; everything else
        // expands in place using the browser's own disclosure element, which
        // keeps keyboard and screen-reader behaviour correct for free.
        const dedicated: Record<string, PassportPanelKey> = { title: "title-brand", history: "vehicle-history" };
        const target = dedicated[c.key];
        const label = VERIFICATION_CHECK_SHORT_LABEL[c.key] ?? c.name;
        if (target) {
          return (
            <button
              key={c.key}
              onClick={() => { track("verification_category_viewed", { category: c.key }); openPanel(target); }}
              className={`${CARD} w-full text-left p-4 hover:border-[#2563EB] transition-colors`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-[14px] font-bold" style={{ color: NAVY }}>{label}</p>
                <StatusPill status={c.status} />
              </div>
              <p className="text-[13px] mt-2" style={{ color: c.finding ? NAVY : SUB }}>{c.finding ?? STATUS_MEANING[c.status]}</p>
              <div className="mt-2.5 flex items-center justify-between gap-3">
                <SourceLine check={c} />
                <ChevronRight className="w-4 h-4 shrink-0" style={{ color: BLUE }} />
              </div>
            </button>
          );
        }
        return (
          <details
            key={c.key}
            className={`${CARD} p-4 group`}
            onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) track("verification_category_viewed", { category: c.key }); }}
          >
            <summary className="cursor-pointer list-none">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[14px] font-bold" style={{ color: NAVY }}>{label}</p>
                <StatusPill status={c.status} />
              </div>
              <p className="text-[13px] mt-2" style={{ color: c.finding ? NAVY : SUB }}>{c.finding ?? STATUS_MEANING[c.status]}</p>
              <div className="mt-2.5"><SourceLine check={c} /></div>
            </summary>
            <div className="mt-4 pt-4 border-t border-[#F1F5F9] space-y-3">
              <p className="text-[13px] leading-relaxed" style={{ color: NAVY }}>{STATUS_MEANING[c.status]}</p>
              <EvidenceList check={c} />
            </div>
          </details>
        );
      })}
    </div>
  );
}

// ── Documents ─────────────────────────────────────────────────────────
type DocRow = {
  key: string;
  title: string;
  source: string;
  scope: "VIN-specific" | "Model-level";
  availability: "Available now" | "External source" | "Signed record" | "Not yet available";
  url: string | null;
  external: boolean;
  why: string;
};

function collectDocuments(listing: VehicleListing, d: PassportData): DocRow[] {
  const rows: DocRow[] = [];
  const stored = ((listing.documents as { type?: string; name?: string; url?: string }[] | undefined) || [])
    .filter((x) => x?.name && x?.url)
    .filter((x) => (x.type === "window_sticker" ? packetVisible(listing, "oemSticker") : packetVisible(listing, "documents")));

  for (const doc of stored) {
    const signed = /sign|addendum|disclosure/i.test(String(doc.type || ""));
    rows.push({
      key: `stored:${doc.type}:${doc.name}`,
      title: doc.name as string,
      source: "Dealer-provided",
      scope: "VIN-specific",
      availability: signed ? "Signed record" : "Available now",
      url: doc.url as string,
      external: false,
      why: signed
        ? "A record you signed. It is kept with the vehicle so you can retrieve it later."
        : "The dealership attached this record to this specific vehicle.",
    });
  }

  const brand = (listing.ymm || "").trim().split(/\s+/)[1] || "";
  const hist = d.historyReport && packetVisible(listing, "historyReport") ? d.historyReport : null;
  if (hist) {
    rows.push({
      key: "history",
      title: `${historyReportName(hist.provider)} Vehicle History Report`,
      source: historyReportName(hist.provider),
      scope: "VIN-specific",
      availability: "External source",
      url: hist.url,
      external: true,
      why: "An independent record of title, ownership, odometer and reported damage for this VIN.",
    });
  }

  const brochure = (listing as { oem_brochure?: { url?: string; year?: number } }).oem_brochure;
  if (brochure?.url && packetVisible(listing, "brochure")) {
    rows.push({
      key: "brochure",
      title: `Official ${brand.toUpperCase()} Brochure${brochure.year ? ` (${brochure.year})` : ""}`,
      source: `${brand} (manufacturer)`,
      scope: "Model-level",
      availability: "External source",
      url: brochure.url,
      external: true,
      why: "The manufacturer's own description of this model year's trims, packages and equipment.",
    });
  }

  const manual = (listing as { oem_owners_manual?: { url?: string; year?: number } }).oem_owners_manual;
  const manualStored = stored.some((x) => x.type === "owners_manual");
  if (manual?.url && packetVisible(listing, "ownersManual") && !manualStored) {
    rows.push({
      key: "manual",
      title: `Official ${brand.toUpperCase()} Owner's Manual${manual.year ? ` (${manual.year})` : ""}`,
      source: `${brand} (manufacturer)`,
      scope: "Model-level",
      availability: "External source",
      url: manual.url,
      external: true,
      why: "Operating, maintenance and warning information for this model year.",
    });
  }

  if (listing.oem_sticker_url && packetVisible(listing, "oemSticker") && !stored.some((x) => x.type === "window_sticker")) {
    rows.push({
      key: "oem-sticker",
      title: "Original OEM Window Sticker",
      source: "Manufacturer",
      scope: "VIN-specific",
      availability: "External source",
      url: listing.oem_sticker_url,
      external: true,
      why: "The factory Monroney label showing how this exact VIN was built and priced when new.",
    });
  }

  return rows;
}

function documentSubtitle(listing: VehicleListing, d: PassportData): string {
  const rows = collectDocuments(listing, d);
  if (!rows.length) return "No documents available yet";
  // Every badge on this drawer is counted from the same list it renders, so a
  // record cannot be listed as available and missing from the count.
  const now = rows.filter((r) => r.availability === "Available now").length;
  const ext = rows.filter((r) => r.availability === "External source").length;
  const signed = rows.filter((r) => r.availability === "Signed record").length;
  const parts = [
    now ? `${now} available now` : null,
    ext ? `${ext} external` : null,
    signed ? `${signed} signed` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

const AVAIL_TONE: Record<DocRow["availability"], string> = {
  "Available now": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "External source": "bg-blue-50 text-[#2563EB] border-blue-200",
  "Signed record": "bg-purple-50 text-[#7C3AED] border-purple-200",
  "Not yet available": "bg-slate-100 text-slate-600 border-slate-200",
};

function DocumentList({ ctx }: { ctx: TrustPanelContext }) {
  const { listing, d, track } = ctx;
  const rows = collectDocuments(listing, d);
  const vehicle = {
    year: (listing.ymm || "").trim().split(/\s+/)[0] || "",
    make: (listing.ymm || "").trim().split(/\s+/)[1] || "",
    model: (listing.ymm || "").trim().split(/\s+/).slice(2).join(" "),
    trim: listing.trim || "",
    vin: listing.vin || "",
    photo: listingHero(listing) || null,
  };

  if (!rows.length) {
    return (
      <div className={`${CARD} p-6 text-center`}>
        <FileText className="w-10 h-10 mx-auto mb-3" style={{ color: "#CBD5E1" }} />
        <p className="text-[14px] font-bold" style={{ color: NAVY }}>No documents are available yet</p>
        <p className="text-[13px] mt-1" style={{ color: SUB }}>
          Ask {d.dealerName || "the dealership"} which records they can provide for this vehicle.
        </p>
      </div>
    );
  }

  return (
    // min-w-0 on the grid and break-words on the titles: a long manufacturer
    // filename used to push the drawer wider than the viewport and give the
    // whole page a horizontal scrollbar.
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
      {rows.map((r) => (
          <div key={r.key} className={`${CARD} p-3 flex gap-3 min-w-0`}>
            <div className="shrink-0">
              <DocumentCoverThumbnail
                type={documentCoverType(r.key, r.title)}
                year={vehicle.year}
                make={vehicle.make}
                model={vehicle.model}
                trim={vehicle.trim}
                vin={vehicle.vin}
                primaryVehiclePhotoUrl={vehicle.photo ?? undefined}
                neutralTitle={r.title}
              />
            </div>
            <div className="min-w-0 flex-1 flex flex-col">
              <p className="text-[13px] font-bold leading-snug break-words" style={{ color: NAVY }}>{r.title}</p>
              <p className="text-[11.5px] mt-0.5 break-words" style={{ color: SUB }}>{r.source} · {r.scope}</p>
              <span className={`mt-1.5 self-start inline-flex items-center text-[10.5px] font-bold rounded-full border px-2 py-0.5 ${AVAIL_TONE[r.availability]}`}>
                {r.availability}
              </span>
              <details className="mt-1.5">
                <summary className="text-[11.5px] font-semibold cursor-pointer list-none" style={{ color: SUB }}>
                  Why this matters
                </summary>
                <p className="text-[11.5px] mt-1 leading-relaxed" style={{ color: SUB }}>{r.why}</p>
              </details>
              {r.url && (
                <div className="mt-auto pt-2 flex items-center gap-2">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => track("document_viewed", { document: r.key, external: r.external })}
                    className="h-9 flex-1 rounded-lg text-white text-[12.5px] font-bold inline-flex items-center justify-center gap-1.5"
                    style={{ background: BLUE }}
                  >
                    View {r.external ? <ExternalLink className="w-3.5 h-3.5" /> : null}
                  </a>
                  {!r.external && (
                    <a
                      href={r.url}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => track("document_downloaded", { document: r.key })}
                      aria-label={`Download ${r.title}`}
                      className="h-9 w-9 rounded-lg border inline-flex items-center justify-center"
                      style={{ borderColor: "#E6E8EC", color: BLUE }}
                    >
                      <Download className="w-4 h-4" />
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
      ))}
    </div>
  );
}

// ── Dealer confidence ─────────────────────────────────────────────────
function DealerConfidence({ ctx }: { ctx: TrustPanelContext }) {
  const { d, listing, track } = ctx;
  const t = d.dealerTrust;

  // Every row is configured by the dealer. Nothing is inferred and nothing is
  // defaulted — an unconfigured field simply does not appear, so the drawer
  // never asserts "family owned" or "service on site" about a store that has
  // not said so.
  const facts: { icon: React.ElementType; label: string; value: string }[] = [];
  if (t.certifications.length) facts.push({ icon: BadgeCheck, label: "Authorized retailer", value: t.certifications.join(" · ") });
  if (t.yearsInBusiness) facts.push({ icon: Clock, label: "Years in business", value: t.yearsInBusiness });
  if (t.familyOwned) facts.push({ icon: Building2, label: "Ownership", value: "Family owned" });
  if (t.serviceLocation === "onsite") facts.push({ icon: Wrench, label: "Service centre", value: "On site" });
  if (t.financing) facts.push({ icon: DollarSign, label: "Financing", value: "Available in house" });
  if (t.bbbRating) facts.push({ icon: ShieldCheck, label: "BBB rating", value: t.bbbRating });

  const address = d.dealerAddress || null;
  const phone = d.dealerPhone || null;
  const directions = address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` : null;

  return (
    <div className="space-y-4">
      {listing.hero_image_url && (
        <div className="rounded-2xl overflow-hidden border border-[#E6E8EC]">
          <img src={listing.hero_image_url} alt="" className="w-full h-36 object-cover" loading="lazy" />
        </div>
      )}
      <div className={`${CARD} p-5`}>
        <p className="text-[18px] font-extrabold leading-tight" style={{ color: NAVY }}>{d.dealerName || "This dealership"}</p>
        {d.reviewRating != null && (
          <p className="text-[13px] mt-1" style={{ color: SUB }}>
            {d.reviewRating}-star Google rating{d.reviewCount ? ` across ${d.reviewCount.toLocaleString()} reviews` : ""}
          </p>
        )}
      </div>

      {facts.length > 0 && (
        <div className={`${CARD} p-4`}>
          {facts.map((f) => (
            <div key={f.label} className="flex items-center justify-between gap-4 py-2 border-b border-[#F1F5F9] last:border-0">
              <span className="text-[13px] inline-flex items-center gap-2" style={{ color: SUB }}>
                <f.icon className="w-4 h-4" style={{ color: BLUE }} /> {f.label}
              </span>
              <span className="text-[13px] font-semibold text-right" style={{ color: NAVY }}>{f.value}</span>
            </div>
          ))}
        </div>
      )}

      {(address || phone) && (
        <div className={`${CARD} p-4 space-y-2`}>
          {address && (
            <p className="text-[13px] inline-flex items-start gap-2" style={{ color: NAVY }}>
              <MapPin className="w-4 h-4 mt-0.5 shrink-0" style={{ color: BLUE }} /> {address}
            </p>
          )}
          {phone && (
            <a href={`tel:${phone}`} onClick={() => track("contact_started", { channel: "phone", placement: "dealer_drawer" })} className="text-[13px] font-bold inline-flex items-center gap-2" style={{ color: BLUE }}>
              <Phone className="w-4 h-4" /> {phone}
            </a>
          )}
          {directions && (
            <a
              href={directions} target="_blank" rel="noopener noreferrer"
              onClick={() => track("contact_started", { channel: "directions", placement: "dealer_drawer" })}
              className="w-full h-11 rounded-xl border inline-flex items-center justify-center gap-2 text-[13px] font-bold"
              style={{ borderColor: "#E6E8EC", color: NAVY }}
            >
              <Navigation className="w-4 h-4" style={{ color: BLUE }} /> Directions
            </a>
          )}
        </div>
      )}

      {d.whyBuy.length > 0 && (
        <div className={`${CARD} p-4`}>
          <p className="text-[12px] font-bold uppercase tracking-wide mb-2" style={{ color: SUB }}>Why buy here</p>
          <ul className="space-y-2">
            {d.whyBuy.slice(0, 6).map((w) => (
              <li key={w} className="flex items-start gap-2 text-[13px]" style={{ color: NAVY }}>
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" /> {w}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export { STATUS_MEANING, StatusPill, collectDocuments };
