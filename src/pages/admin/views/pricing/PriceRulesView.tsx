import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from "react";
import vehiclePlaceholder from "@/assets/admin-v2/artwork/vehicle-placeholder.svg";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, Check, FileText, Globe, Info, Pencil, Tag } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings, type DealerSettings } from "@/contexts/DealerSettingsContext";
import { useViewFixture } from "@/lib/admin/dataSource";
import { countDisplay, type CountValue } from "@/lib/admin/health";
import { buildSalePriceCard, DEFAULT_PRICE_LABEL, PRICE_DISPLAY_MODES, PRICE_LABEL_PRESETS, resolvePriceLabel, type PriceDisplayMode, type PricingVehicleType } from "@/lib/priceModel";
import { STATE_DOC_FEES } from "@/data/docFees";
import { TODAYS_PRICE_MODE_OPTIONS, DEFAULT_TODAYS_PRICE_CUSTOM, resolveTodaysPrice } from "@/lib/todaysPrice";
import { COMP_STRATEGY_OPTIONS, type CompStrategy } from "@/lib/compStrategy";
import {
  describePriceBasis,
  effectiveFee,
  feeDraftWarnings,
  feeReference,
  fmtMoney,
  isFeeDraftEqual,
  jurisdictionLabel,
  validateFeeDraft,
  type FeeDraft,
} from "@/lib/admin/pricing/feePolicy";
import { consistencyHeadline, conditionOfListing, summarizeConsistency, EVIDENCE_LABEL, STATUS_LABEL, type ConsistencyAssessment, type ConsistencyStatus, type EvidenceState } from "@/lib/admin/pricing/priceConsistency";
import { feeReviewHref, tenantIdOf, useConsistency, useListingCounts, useWebsitePriceTerm, type FeeScope } from "./pricingData";
import { AdminInput, AdminSelect, Field } from "./ui";
import { AdminButton, AdminCard, AdminTable, InlineNote, StatusChip, Td, Th, type Tone } from "@/components/admin/v2/primitives";
import { cn } from "@/lib/utils";

// Price rules: the document-fee policy as a read-only statement with a
// reviewable draft, the customer price preview built by the canonical price
// model, and the per-vehicle consistency table. Opening this page writes
// nothing; the fee change itself is applied only through Fee Change Review.

const PriceAuditPanelLazy = lazy(() => import("@/components/admin/PriceAuditPanel").then((m) => ({ default: m.PriceAuditPanel })));
const PriceIntegrityPanelLazy = lazy(() => import("@/components/admin/PriceIntegrityPanel").then((m) => ({ default: m.PriceIntegrityPanel })));

export interface PreviewVehicle {
  title: string;
  trim: string | null;
  stock: string | null;
  imageUrl: string | null;
  sellingPrice: number;
  vehicleType: PricingVehicleType;
}

export interface PriceRulesFixture {
  policy: { stateCode: string; feeEnabled: boolean; feeAmount: number; mode: PriceDisplayMode };
  counts: { eligible: CountValue | null; archived: CountValue | null };
  preview: PreviewVehicle | null;
  /** Null means the read failed: the table reports Unknown. */
  consistency: { rows: ConsistencyAssessment[]; truncated: boolean } | null;
  websiteTerm: string | null;
}

// Reference marks: an 18px check, a 20px filled triangle and an 11px filled
// dot. The reference draws marks brighter than the text tokens: a #10A523
// check and dot, and the #F2A51A triangle Overview uses.
const EvidenceMark = ({ state }: { state: EvidenceState }) => {
  if (state === "awaiting") return <span aria-hidden="true" className="inline-block w-[11px] h-[11px] rounded-full bg-adm-muted flex-shrink-0" />;
  if (state === "older_version") return <AlertTriangle className="w-5 h-5 -ml-[3px] flex-shrink-0 fill-current stroke-white text-[#F2A51A]" aria-hidden="true" />;
  return <Check className="w-[18px] h-[18px] -ml-[2px] flex-shrink-0 text-[#10A523]" strokeWidth={2.25} aria-hidden="true" />;
};
const STATUS_TONE: Record<ConsistencyStatus, Tone> = { consistent: "success", mismatch: "warning", not_checked: "neutral" };

const previewFromRows = (rows: ConsistencyAssessment[]): PreviewVehicle | null => {
  const row = rows.find((r) => r.sellingPrice != null && r.sellingPrice > 0) ?? null;
  if (!row || row.sellingPrice == null) return null;
  return {
    title: row.vehicle,
    trim: row.listing.trim,
    stock: row.listing.stock,
    imageUrl: row.listing.heroImageUrl,
    sellingPrice: row.sellingPrice,
    vehicleType: conditionOfListing(row.listing.condition),
  };
};

// Without a photo, the supplied vehicle line drawing (transparent) sits on the frame's own tint.
const Thumb = ({ url, className = "w-16 h-[38px]", landmark }: { url: string | null; className?: string; landmark?: string }) => (
  <span data-landmark={landmark} className={`${className} rounded-md bg-adm-workspace overflow-hidden flex-shrink-0 inline-flex items-center justify-center`} aria-hidden="true">
    {url ? <img src={url} alt="" className="w-full h-full object-cover" /> : <img src={vehiclePlaceholder} alt="" className="w-[62%] h-auto" />}
  </span>
);

// Card with the reference's 17px title row (12px cap height); AdminCard fixes
// its title at 16px. The reference's header padding differs per card, so each
// card passes its own.
const PanelCard = ({
  id,
  title,
  description,
  action,
  children,
  headerClassName,
  descriptionClassName = "mt-[3px]",
  actionClassName,
  headerBorder = true,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  headerClassName?: string;
  descriptionClassName?: string;
  actionClassName?: string;
  headerBorder?: boolean;
}) => (
  <AdminCard id={id} flush className="overflow-hidden">
    <header className={cn("flex items-start justify-between gap-4 px-5 pt-[13px] pb-[11px]", headerBorder && "border-b border-adm-border", headerClassName)}>
      <div className="min-w-0">
        <h3 className="text-[17px] leading-[20px] font-bold text-adm-ink">{title}</h3>
        {description && <p className={cn("text-[13px] leading-[18px] text-adm-muted", descriptionClassName)}>{description}</p>}
      </div>
      {action && <div className={cn("flex-shrink-0 flex items-center gap-3", actionClassName)}>{action}</div>}
    </header>
    {children}
  </AdminCard>
);

// Reference: a 12px dot, a 24px count on a 27px line with a 13px label on its
// baseline, and a 12px hint directly under the count.
const ImpactStat = ({ tone, value, label, hint, className }: { tone: "success" | "neutral"; value: string; label: string; hint: string; className?: string }) => (
  <div className={cn("flex items-start gap-3", className)}>
    <span aria-hidden="true" className={cn("mt-[9px] w-3 h-3 rounded-full flex-shrink-0", tone === "success" ? "bg-[#10A523]" : "bg-adm-muted/60")} />
    <div className="min-w-0">
      <p className="flex items-baseline gap-x-3 whitespace-nowrap">
        <span data-landmark="impact-count" className="text-[24px] leading-[27px] font-bold text-adm-ink tabular-nums">{value}</span>
        <span className="text-[13px] leading-[18px] font-medium text-adm-ink">{label}</span>
      </p>
      <p className="text-[12px] leading-[18px] text-adm-muted">{hint}</p>
    </div>
  </div>
);

const countValue = (c: CountValue | null): string => (c == null ? "Unknown" : countDisplay(c));

export default function PriceRulesView() {
  const fixture = useViewFixture<PriceRulesFixture>("price-rules");
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { tenant } = useTenant();
  const { settings, updateSettings } = useDealerSettings();
  const tenantId = tenantIdOf(tenant);
  const live = !fixture;

  const policy = useMemo(
    () =>
      fixture?.policy ?? {
        stateCode: (settings.doc_fee_state || "").toUpperCase(),
        feeEnabled: !!settings.doc_fee_enabled,
        feeAmount: Number(settings.doc_fee_amount) || 0,
        mode: (settings.price_display_mode || "advertised_before_doc") as PriceDisplayMode,
      },
    [fixture, settings.doc_fee_state, settings.doc_fee_enabled, settings.doc_fee_amount, settings.price_display_mode],
  );
  const stored = useMemo<FeeDraft>(() => ({ enabled: policy.feeEnabled, amount: policy.feeAmount, stateCode: policy.stateCode }), [policy]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<FeeDraft>(stored);
  const [scope, setScope] = useState<FeeScope>("active");
  useEffect(() => {
    if (!editing) setDraft(stored);
  }, [stored, editing]);

  const dirty = !isFeeDraftEqual(draft, stored);
  const errors = validateFeeDraft(draft);
  const warnings = feeDraftWarnings(draft);

  const counts = useListingCounts(tenantId, live);
  const consistency = useConsistency(tenantId, effectiveFee(stored), policy.mode, live);
  const websiteTerm = useWebsitePriceTerm(tenantId, live);

  const eligible: CountValue | null = fixture ? fixture.counts.eligible : counts.isError ? { kind: "failed" } : counts.isLoading ? { kind: "loading" } : counts.data?.eligible ?? null;
  const archived: CountValue | null = fixture ? fixture.counts.archived : counts.isError ? { kind: "failed" } : counts.isLoading ? { kind: "loading" } : counts.data?.archived ?? null;

  const consistencyRows = fixture ? fixture.consistency?.rows ?? null : consistency.data?.rows ?? null;
  const consistencyFailed = fixture ? fixture.consistency === null : consistency.isError || (!consistency.isLoading && !tenantId);
  const consistencyLoading = live && consistency.isLoading;
  const truncated = fixture ? !!fixture.consistency?.truncated : !!consistency.data?.truncated;
  const summary = consistencyRows ? summarizeConsistency(consistencyRows) : null;
  const headline = consistencyLoading ? { label: "Checking", tone: "neutral" as Tone } : consistencyHeadline(summary, consistencyFailed);

  const preview = fixture ? fixture.preview : consistencyRows ? previewFromRows(consistencyRows) : null;
  const previewFee = effectiveFee(editing ? draft : stored);
  const previewCard = preview
    ? buildSalePriceCard({
        vehicleType: preview.vehicleType,
        vehicleSellingPrice: preview.sellingPrice,
        totalAdvertisedPrice: preview.sellingPrice + previewFee,
        docFee: previewFee,
        docFeeLabel: feeReference((editing ? draft : stored).stateCode)?.terminology ?? null,
      })
    : null;

  const term = fixture ? fixture.websiteTerm : websiteTerm.data ?? null;

  const reviewChanges = () => {
    if (!dirty || errors.length) return;
    navigate(feeReviewHref(draft, scope));
  };

  const pendingText = dirty ? (errors.length ? "Fix the draft before reviewing." : "Draft changes are reviewed before anything is applied.") : "No pending changes";

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,710fr)_minmax(0,588fr)] gap-x-3 gap-y-3.5">
        <PanelCard
          title="Price display policy"
          description="Controls how pricing is calculated and presented across AutoLabels."
          actionClassName="mt-[2px] -mr-0.5"
          action={
            editing ? (
              <AdminButton size="sm" className="rounded-[6px]" onClick={() => { setEditing(false); setDraft(stored); }}>Discard</AdminButton>
            ) : (
              <AdminButton variant="outline" size="sm" className="rounded-[6px] border-[#C5D4F7] gap-2" onClick={() => setEditing(true)}>
                <Pencil className="w-[17px] h-[17px]" aria-hidden="true" />
                Edit
              </AdminButton>
            )
          }
        >
          <div className="px-5 pt-2 pb-[18px]">
            {editing ? (
              <div className="mt-2 space-y-3">
                <div className="flex items-center justify-between gap-4 rounded-md border border-adm-border px-3 py-2.5">
                  <div>
                    <p className="text-[14px] font-semibold text-adm-ink">Charge a document fee</p>
                    <p className="text-[12px] text-adm-muted">When off, stored totals equal the selling price.</p>
                  </div>
                  <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} aria-label="Charge a document fee" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Jurisdiction" htmlFor="fee-state">
                    <AdminSelect id="fee-state" value={draft.stateCode} onChange={(e) => setDraft({ ...draft, stateCode: e.target.value })}>
                      <option value="">Not set</option>
                      {STATE_DOC_FEES.map((s) => (
                        <option key={s.stateCode} value={s.stateCode}>{s.state}</option>
                      ))}
                    </AdminSelect>
                  </Field>
                  <Field label="Document fee" htmlFor="fee-amount" hint={feeReference(draft.stateCode) ? `Called "${feeReference(draft.stateCode)?.terminology}" in ${jurisdictionLabel(draft.stateCode)}.` : undefined}>
                    <AdminInput id="fee-amount" type="number" inputMode="decimal" step="0.01" min={0} value={Number.isFinite(draft.amount) ? draft.amount : ""} onChange={(e) => setDraft({ ...draft, amount: e.target.value === "" ? NaN : Number(e.target.value) })} disabled={!draft.enabled} />
                  </Field>
                </div>
                {errors.length > 0 && <InlineNote tone="danger">{errors.join(" ")}</InlineNote>}
                {warnings.map((w) => (
                  <InlineNote key={w} tone="warning">{w}</InlineNote>
                ))}
              </div>
            ) : (
              <dl className="px-2">
                {[
                  { label: "Jurisdiction", value: jurisdictionLabel(stored.stateCode) },
                  { label: "Document fee", value: stored.enabled ? fmtMoney(stored.amount) : "Disabled" },
                  { label: "Display basis", value: describePriceBasis(policy.mode) },
                  {
                    label: "Source observation",
                    value: (
                      <span className="inline-flex items-center gap-2">
                        Read only
                        <Info className="w-[17px] h-[17px] text-adm-muted" aria-hidden="true" />
                        <span className="sr-only">Website prices are observed by the nightly check and are never edited here.</span>
                      </span>
                    ),
                  },
                ].map((row) => (
                  <div key={row.label} className="grid grid-cols-[209px_minmax(0,1fr)] text-[14px] leading-[24px]">
                    <dt className="text-adm-ink">{row.label}</dt>
                    <dd className="text-adm-ink min-w-0">{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <InlineNote tone="info" className="mt-[15px] rounded-[6px] border-transparent bg-adm-workspace pl-[10px] pr-3 py-[5px] gap-[9px] [&>svg]:w-5 [&>svg]:h-5 [&>svg]:text-adm-primary">Administrative recalculation does not verify source prices.</InlineNote>

            <div className="mt-4 border-t border-adm-border pt-[10px]">
              <h4 className="text-[16px] leading-[22px] font-semibold text-adm-ink">Change impact</h4>
              <p className="mt-[3px] text-[13px] leading-[18px] text-adm-muted">Shows how many vehicles will be affected by a change to these settings.</p>
              <label className="mt-[9px] flex items-center">
                <span className="w-[89px] flex-shrink-0 text-[14px] leading-[20px] font-medium text-adm-ink">Scope</span>
                <AdminSelect value={scope} onChange={(e) => setScope(e.target.value as FeeScope)} className="h-8 w-full max-w-[252px] text-[14px]" aria-label="Change scope">
                  <option value="active">Active inventory (default)</option>
                  <option value="all">Include archived records</option>
                </AdminSelect>
              </label>
              <div className="mt-[13px] flex items-stretch flex-wrap gap-y-4">
                <ImpactStat tone="success" value={countValue(eligible)} label="eligible vehicles" hint="Active inventory to recalculate" className="w-[250px] flex-none pl-[15px]" />
                <ImpactStat
                  tone="neutral"
                  value={countValue(archived)}
                  label={scope === "all" ? "archived vehicles included" : "archived vehicles excluded"}
                  hint={scope === "all" ? "Archived inventory will be recalculated too" : "Archived inventory is not affected"}
                  className="flex-auto pl-[17px] pr-3 border-l border-adm-border"
                />
                <div className="w-[146px] flex flex-col items-center">
                  <AdminButton
                    variant="primary"
                    size="sm"
                    className="w-full h-8 min-h-0 rounded-[6px] disabled:font-normal"
                    disabled={!dirty || errors.length > 0}
                    onClick={reviewChanges}
                    data-landmark="price-review"
                  >
                    Review changes
                  </AdminButton>
                  <span className="mt-[3px] text-[12px] leading-[18px] text-adm-muted text-center">{pendingText}</span>
                </div>
              </div>
              {!fixture && !tenantId && <p className="mt-2 text-[12px] text-adm-muted">Counts are unavailable without a dealership context.</p>}
            </div>
          </div>
        </PanelCard>

        <PanelCard title="Customer price preview" description="Illustrative example of how pricing is displayed to customers." headerClassName="pt-[14px] pb-[13px]" descriptionClassName="mt-1">
          {previewCard && preview ? (
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_252px] gap-x-[31px] gap-y-4 items-start pl-[11px] pr-6 pt-[23px] pb-6">
              <Thumb url={preview.imageUrl} landmark="preview-photo" className="w-full aspect-video md:mt-[34px]" />
              <div className="min-w-0">
                <p className="text-[18px] leading-[23px] font-semibold text-adm-ink">{preview.title}</p>
                <p className="text-[13px] leading-[18px] text-adm-muted">{[preview.trim, preview.stock ? `Stock ${preview.stock}` : null].filter(Boolean).join(" · ")}</p>
                <dl className="mt-[23px] text-[15px] leading-[20px]">
                  <div className="flex items-center justify-between gap-3 h-[33px]"><dt className="text-adm-ink">Selling price</dt><dd className="font-semibold text-adm-ink tabular-nums">{fmtMoney(previewCard.vehicleSellingPrice)}</dd></div>
                  <div className="flex items-center justify-between gap-3 h-[33px]"><dt className="text-adm-ink">{previewCard.feeLabel ?? "Document fee"}</dt><dd className="font-semibold text-adm-ink tabular-nums">{previewCard.feeAmount == null ? "None" : fmtMoney(previewCard.feeAmount)}</dd></div>
                  <div className="mt-[7px] border-t border-adm-border pt-[7px]">
                    <div className="flex items-center justify-between gap-3 h-8"><dt className="text-[16px] font-bold text-adm-ink">Advertised total</dt><dd className="text-[18px] font-bold text-adm-ink tabular-nums">{fmtMoney(previewCard.totalAdvertisedPrice)}</dd></div>
                  </div>
                </dl>
                <p className="mt-[9px] text-[12px] leading-[18px] text-adm-muted">Taxes and registration are separate.</p>
              </div>
            </div>
          ) : (
            <p className="px-5 py-5 text-[13px] leading-[18px] text-adm-muted">{consistencyLoading ? "Loading a vehicle from inventory…" : "No priced vehicle is available to preview yet."}</p>
          )}
        </PanelCard>
      </div>

      <PanelCard
        title="Price consistency"
        description="Compares advertised total across different consumer touchpoints."
        headerBorder={false}
        headerClassName="pt-[14px] pb-0"
        action={
          <>
            <StatusChip tone={headline.tone} icon>{headline.label}</StatusChip>
            <a href="#price-audit" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-adm-primary hover:underline">
              <Info className="w-5 h-5" aria-hidden="true" />
              Price audit
            </a>
          </>
        }
      >
        {consistencyLoading ? (
          <p className="px-5 pt-3 pb-5 text-[13px] text-adm-muted">Checking inventory…</p>
        ) : consistencyFailed || !consistencyRows ? (
          <p role="status" className="px-5 pt-3 pb-5 text-[13px] text-adm-muted">Price consistency could not be read for this rooftop. It is Unknown, not reconciled.</p>
        ) : consistencyRows.length === 0 ? (
          <p className="px-5 pt-3 pb-5 text-[13px] text-adm-muted">No active vehicle carries a price yet.</p>
        ) : (
          <AdminTable
            caption="Price consistency by vehicle"
            inset
            className="mx-3 mt-[11px] mb-0 rounded-[8px] [&_th]:py-[9.5px] [&_td]:py-[6px] [&_th]:px-[13px] [&_td]:px-[13px] [&_td]:text-[13px] [&_th]:border-r [&_td]:border-r [&_th:last-child]:border-r-0 [&_td:last-child]:border-r-0 [&_tbody_tr:last-child>td]:border-b-0"
          >
            <thead>
              <tr>
                <Th>Vehicle</Th>
                <Th className="w-[114px]">Selling price</Th>
                <Th className="w-[134px]">Document fee</Th>
                <Th className="w-[130px] !pl-[9px]"><span className="flex items-center gap-1.5 h-[18px]"><Globe className="w-[18px] h-[18px]" aria-hidden="true" />Website</span></Th>
                <Th className="w-[130px] !pl-[12px]"><span className="flex items-center gap-1.5 h-[18px]"><Tag className="w-[17px] h-[17px]" aria-hidden="true" />Label</span></Th>
                <Th className="w-[118px] !pl-[10px]"><span className="flex items-center gap-1 h-[18px]"><FileText className="w-5 h-5" aria-hidden="true" />Passport</span></Th>
                <Th className="w-[164px]">Evidence</Th>
                <Th className="w-[126px]">Status</Th>
                <Th className="w-[92px]">Action</Th>
              </tr>
            </thead>
            <tbody>
              {consistencyRows.map((row) => {
                return (
                  <tr key={row.listing.id}>
                    <Td>
                      <div className="flex items-center gap-4">
                        <Thumb url={row.listing.heroImageUrl} />
                        <div className="min-w-0">
                          <p className="font-semibold text-adm-ink truncate" data-parity="fixture-vehicle">{row.vehicle}</p>
                          <p className="text-[12px] leading-[18px] text-adm-muted truncate" data-parity="fixture-vehicle">{[row.listing.trim, row.listing.stock ? `Stock ${row.listing.stock}` : null].filter(Boolean).join(" · ") || "—"}</p>
                        </div>
                      </div>
                    </Td>
                    <Td className="tabular-nums"><span data-parity="fixture-price">{fmtMoney(row.sellingPrice)}</span></Td>
                    <Td className="tabular-nums">{fmtMoney(row.docFee)}</Td>
                    <Td className="tabular-nums">{row.website == null ? <span className="text-adm-muted">—</span> : <span data-parity="fixture-price">{fmtMoney(row.website)}</span>}</Td>
                    <Td className="tabular-nums"><span data-parity="fixture-price">{fmtMoney(row.label)}</span></Td>
                    <Td className="tabular-nums"><span data-parity="fixture-price">{fmtMoney(row.passport)}</span></Td>
                    <Td>
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <EvidenceMark state={row.evidence} />
                        {EVIDENCE_LABEL[row.evidence]}
                      </span>
                    </Td>
                    <Td><StatusChip tone={STATUS_TONE[row.status]} className="rounded-full px-3 py-[2px] text-[12px] leading-[18px] font-medium">{STATUS_LABEL[row.status]}</StatusChip></Td>
                    <Td>{row.reviewHref ? <Link to={row.reviewHref} className="font-semibold text-adm-primary hover:underline">Review</Link> : <span className="text-adm-muted">—</span>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </AdminTable>
        )}
        {consistencyRows && consistencyRows.length > 0 && (
          <div className="flex items-center justify-between gap-4 px-5 py-4 text-[12px] leading-[18px] text-adm-muted">
            <span>{consistencyRows.length.toLocaleString()} vehicles shown{truncated ? " (first page)" : ""}</span>
            <span className="inline-flex items-center gap-2">
              <Info className="w-5 h-5" aria-hidden="true" />
              {summary && summary.mismatch > 0 ? `${summary.mismatch} ${summary.mismatch === 1 ? "mismatch needs" : "mismatches need"} review.` : dirty ? "Draft fee change pending review." : "No changes pending."}
            </span>
          </div>
        )}
      </PanelCard>

      <AdminCard id="price-presentation" title="Customer price presentation" description="Wording and comparison policy. These change presentation only; prices are never recalculated here.">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Field label="Display basis" htmlFor="price-display-mode" hint="Controls the price shown on the customer Passport. Market comparisons always use the price before the document fee.">
            <AdminSelect id="price-display-mode" value={policy.mode} onChange={(e) => updateSettings({ price_display_mode: e.target.value as DealerSettings["price_display_mode"] })}>
              {PRICE_DISPLAY_MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </AdminSelect>
          </Field>
          {(() => {
            const label = settings.price_label || DEFAULT_PRICE_LABEL;
            const setLabel = (patch: Partial<typeof label>) => updateSettings({ price_label: { ...label, ...patch } });
            const previewText = resolvePriceLabel(label, settings.dealer_name, term);
            return (
              <Field label="Price label" htmlFor="price-label" hint={label.preset === "website" && !term ? "Your website's price term applies once the nightly check detects it; showing \"Our Price\" until then." : `Wording only. Customers will see: ${previewText}${label.preset === "website" ? " (detected from your website)" : ""}.`}>
                <div className="space-y-2">
                  <AdminSelect id="price-label" value={label.preset} onChange={(e) => setLabel({ preset: e.target.value as typeof label.preset })}>
                    {PRICE_LABEL_PRESETS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </AdminSelect>
                  {label.preset === "custom" && <AdminInput value={label.custom || ""} onChange={(e) => setLabel({ custom: e.target.value })} placeholder="Our Price" aria-label="Custom price label" />}
                </div>
              </Field>
            );
          })()}
          <Field label="Market comparison" htmlFor="comp-strategy" hint={COMP_STRATEGY_OPTIONS.find((o) => o.value === (settings.comp_settings?.compStrategy || "value_building"))?.help}>
            <div className="space-y-2">
              <AdminSelect id="comp-strategy" value={settings.comp_settings?.compStrategy || "value_building"} onChange={(e) => updateSettings({ comp_settings: { ...(settings.comp_settings || {}), compStrategy: e.target.value as CompStrategy } })}>
                {COMP_STRATEGY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </AdminSelect>
              {(settings.comp_settings?.compStrategy || "value_building") === "value_building" && (
                <label className="flex items-start gap-2 text-[12px] leading-[18px] text-adm-ink">
                  <input type="checkbox" className="mt-0.5 accent-adm-primary" checked={!!settings.comp_settings?.includeLowerPricedComps} onChange={(e) => updateSettings({ comp_settings: { ...(settings.comp_settings || {}), includeLowerPricedComps: e.target.checked } })} />
                  <span>Also allow slightly lower-priced comparables (within 3% of this vehicle's price).</span>
                </label>
              )}
            </div>
          </Field>
          <Field label="Today's Price wording" htmlFor="todays-price-mode" hint={TODAYS_PRICE_MODE_OPTIONS.find((o) => o.value === (settings.todays_price_mode || "payment_estimate"))?.hint}>
            <AdminSelect id="todays-price-mode" value={settings.todays_price_mode || "payment_estimate"} onChange={(e) => updateSettings({ todays_price_mode: e.target.value as DealerSettings["todays_price_mode"] })}>
              {TODAYS_PRICE_MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </AdminSelect>
          </Field>
          {(() => {
            const custom = { ...DEFAULT_TODAYS_PRICE_CUSTOM, ...(settings.todays_price_custom || {}) };
            const setCustom = (patch: Partial<typeof custom>) => updateSettings({ todays_price_custom: { ...custom, ...patch } });
            const resolved = resolveTodaysPrice({ todays_price_mode: settings.todays_price_mode, todays_price_custom: custom });
            return (
              <div className="lg:col-span-2 space-y-3">
                {settings.todays_price_mode === "custom" && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Headline"><AdminInput value={custom.headline} onChange={(e) => setCustom({ headline: e.target.value })} placeholder="Today's Price" /></Field>
                    <Field label="Subheadline"><AdminInput value={custom.sub} onChange={(e) => setCustom({ sub: e.target.value })} placeholder="Personalize your payment estimate for this vehicle." /></Field>
                    <Field label="Button text"><AdminInput value={custom.cta} onChange={(e) => setCustom({ cta: e.target.value })} placeholder="Request Payment Details" /></Field>
                    <Field label="Disclaimer"><AdminInput value={custom.disclaimer} onChange={(e) => setCustom({ disclaimer: e.target.value })} placeholder="Estimate only, with approved credit." /></Field>
                    <label className="sm:col-span-2 flex items-start gap-2 text-[12px] leading-[18px] text-adm-ink">
                      <input type="checkbox" className="mt-0.5 accent-adm-primary" checked={custom.allow_otd_wording} onChange={(e) => setCustom({ allow_otd_wording: e.target.checked })} />
                      <span>Allow out-the-door or best-price wording in custom copy. When off, copy containing that language falls back to the safe default.</span>
                    </label>
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5">
                  {([
                    ["show_calculator", "Payment calculator"],
                    ["show_down", "Down payment slider"],
                    ["show_term", "Term selector"],
                    ["show_apr", "APR slider"],
                  ] as ["show_calculator" | "show_down" | "show_term" | "show_apr", string][]).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-[12px] leading-[18px] text-adm-ink">
                      <input type="checkbox" className="accent-adm-primary" checked={custom[key]} onChange={(e) => setCustom({ [key]: e.target.checked })} />
                      {label}
                    </label>
                  ))}
                </div>
                <p className="text-[12px] leading-[18px] text-adm-muted">Shoppers see: <span className="font-semibold text-adm-ink">{resolved.headline}</span>, {resolved.sub} Button: <span className="font-semibold text-adm-ink">{resolved.cta}</span></p>
              </div>
            );
          })()}
          <Field label="Passport experience version" htmlFor="passport-version" hint="Store-wide default. A vehicle can override this per VIN.">
            <AdminSelect id="passport-version" value={settings.passport_version === "v3" ? "v3" : "current"} onChange={(e) => updateSettings({ passport_version: e.target.value as "current" | "v3" })}>
              <option value="current">Current Passport</option>
              <option value="v3">Passport V3</option>
            </AdminSelect>
          </Field>
          <div className="flex items-start justify-between gap-4 rounded-md border border-adm-border px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">We do not retail branded-title vehicles</p>
              <p className="text-[12px] leading-[18px] text-adm-muted">Shown on the Passport as your own attestation, never as a verified title check, and never over a brand a source reports.</p>
            </div>
            <Switch checked={!!settings.title_policy_no_branded} onCheckedChange={(v) => updateSettings({ title_policy_no_branded: v })} aria-label="We do not retail branded-title vehicles" />
          </div>
        </div>
      </AdminCard>

      {live && (
        <Suspense fallback={<p className="text-[13px] text-adm-muted">Loading price audit…</p>}>
          <section id="price-audit" aria-label="Price audit">
            <PriceAuditPanelLazy />
          </section>
          {isAdmin && (
            <section id="price-integrity" aria-label="Price integrity">
              <PriceIntegrityPanelLazy />
            </section>
          )}
        </Suspense>
      )}
    </div>
  );
}
