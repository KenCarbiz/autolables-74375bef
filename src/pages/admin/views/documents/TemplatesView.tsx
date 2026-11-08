import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { useAdminFixture, useAdminNow, useViewFixture } from "@/lib/admin/dataSource";
import { describeAge } from "@/lib/admin/health";
import LabelDefaultsPanel from "@/components/admin/LabelDefaultsPanel";
import FactoryStickerPanel from "@/components/admin/FactoryStickerPanel";
import StickerPrintTemplates from "@/components/admin/StickerPrintTemplates";
import { AdminButton, KeyValueList, StatusChip } from "@/components/admin/v2/primitives";
import { DetailDrawer, SectionCard, SelectField, useIsNarrow } from "@/components/admin/v3/editor";
import { StackedRows } from "./hub/StackedRows";
import { AccordionCard } from "./hub/AccordionCard";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { adminTabHref } from "@/lib/admin/sections";
import { documentRuleRows, rulesFromSettings, serviceGateContext } from "@/lib/admin/documentPolicy";
import { useDocumentsReadiness } from "./readiness";
import { FIELD_LABEL, INPUT_CLASS, SaveStatus, useInstantSettings, usePanelAnchor } from "./controls";

// Templates: the label defaults, factory build records and pre-printed stock
// templates (legacy panels, unchanged writers), the addendum paper size moved
// from the legacy settings tab, and a read-only view of the platform template
// catalog with its published versions. Nothing here edits version history.

export interface TemplateVersionRow {
  id: string;
  name: string;
  type: string;
  size: string;
  active: boolean;
  currentVersion: number;
  publishedAt: string | null;
}

export interface TemplatesFixture {
  /** null means the catalog could not be read. */
  catalog: TemplateVersionRow[] | null;
}

const PAPER_SIZES = [
  { key: "letter", label: "Letter (8.5 x 11)" },
  { key: "legal", label: "Legal (8.5 x 14)" },
  { key: "half-sheet", label: "Half Sheet (5.5 x 8.5)" },
  { key: "addendum-strip", label: "Strip (4.25 x 11)" },
  { key: "addendum-half", label: "Half Page (5.5 x 12.5)" },
  { key: "monroney", label: "Monroney (7.5 x 10)" },
  { key: "custom", label: "Custom" },
] as const;

type PaperSize = (typeof PAPER_SIZES)[number]["key"];

async function readTemplateCatalog(): Promise<TemplateVersionRow[] | null> {
  try {
    const [t, v] = await Promise.all([
      supabase.from("sticker_templates").select("id, name, type, size, is_active, current_version").is("deleted_at", null).order("name"),
      supabase.from("sticker_template_versions").select("template_id, version, published_at"),
    ]);
    if (t.error || v.error || !Array.isArray(t.data) || !Array.isArray(v.data)) return null;
    const published = new Map<string, string>();
    for (const row of v.data) published.set(`${row.template_id}:${row.version}`, row.published_at);
    return t.data.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      size: row.size,
      active: row.is_active,
      currentVersion: row.current_version,
      publishedAt: published.get(`${row.id}:${row.current_version}`) ?? null,
    }));
  } catch {
    return null;
  }
}

export type TemplatesSection = "all" | "library" | "settings";

export default function TemplatesView({ section = "all" }: { section?: TemplatesSection } = {}) {
  const fixture = useViewFixture<TemplatesFixture>("templates");
  const adminFixture = useAdminFixture();
  const now = useAdminNow();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  usePanelAnchor();
  const canEdit = hasDealerCapability(member?.role, "can_manage_settings", isAdmin);

  const paper = useInstantSettings(
    (s) => ({ addendum_paper_size: s.addendum_paper_size, addendum_custom_width: s.addendum_custom_width, addendum_custom_height: s.addendum_custom_height }),
    { toastId: "paper-size" },
  );

  const catalog = useQuery({
    queryKey: ["admin-v2", "template-catalog"],
    enabled: !adminFixture,
    queryFn: readTemplateCatalog,
    staleTime: 60_000,
  });
  const rows: TemplateVersionRow[] | null | undefined = fixture ? fixture.catalog : catalog.isError ? null : catalog.data;

  const { settings } = useDealerSettings();
  const readiness = useDocumentsReadiness();
  const [detail, setDetail] = useState<TemplateVersionRow | null>(null);
  const showLibrary = section !== "settings";
  const showSettings = section !== "library";
  const matrix = useMemo(() => documentRuleRows(rulesFromSettings(settings), serviceGateContext(settings)), [settings]);

  const narrow = useIsNarrow();
  const bare = "-mx-4 sm:-mx-6 -my-5";
  const editRules = <Link to={adminTabHref("approval-rules")} className="inline-flex items-center min-h-[44px] sm:min-h-[32px] text-[14px] font-semibold text-adm-primary hover:underline whitespace-nowrap">Edit rules</Link>;
  const openCalibration = <Link to={adminTabHref("print-calibration")} className="inline-flex items-center min-h-[44px] sm:min-h-[32px] text-[14px] font-semibold text-adm-primary hover:underline whitespace-nowrap">Open calibration</Link>;
  return (
    <div className="flex flex-col gap-4">
      {showLibrary && <LabelDefaultsPanel />}

      {showSettings && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          <SectionCard
            icon="clipboard-check"
            title="Approval matrix"
            description="Who approves each document and what sends it back for review."
            actions={narrow ? undefined : editRules}
          >
            {narrow && <div>{editRules}</div>}
            <div className={bare}>
              <StackedRows
                caption="Approval matrix"
                rows={matrix}
                rowKey={(r) => r.family}
                columns={[
                  { id: "document", header: "Document", primary: true, cell: (r) => r.document, className: "font-medium" },
                  { id: "approval", header: "Approval", cell: (r) => r.approval },
                  { id: "refresh", header: "Refresh after", cell: (r) => <span className="text-adm-muted">{r.refreshAfter}</span> },
                ]}
              />
            </div>
          </SectionCard>

          <SectionCard
            icon="printer"
            title="Print & calibration readiness"
            description="A printing issue does not block digital approval."
            actions={narrow ? undefined : openCalibration}
          >
            {narrow && <div>{openCalibration}</div>}
            <div className={bare}>
              <StackedRows
                caption="Readiness"
                rows={readiness.items}
                rowKey={(it) => it.key}
                columns={[
                  { id: "check", header: "Check", primary: true, cell: (it) => it.label, className: "font-medium" },
                  { id: "status", header: "Status", cell: (it) => <StatusChip tone={it.state === "ok" ? "success" : it.state === "needs" ? "warning" : "neutral"} className="text-[13px]">{it.chip}</StatusChip> },
                  { id: "detail", header: "Detail", cell: (it) => <span className="text-adm-muted">{it.detailValue}</span> },
                ]}
              />
            </div>
          </SectionCard>
        </div>
      )}

      {showSettings && (
        <SectionCard
          id="paper-size"
          icon="file"
          title="Addendum paper size"
          description="The addendum scales to this size. The FTC Buyers Guide stays at its federally mandated minimum (11 x 7.25 in, 16 CFR 455)."
          actions={<SaveStatus status={paper.status} />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,320px)_1fr_1fr] gap-3 items-end">
            <div>
              <label htmlFor="paper-size-select" className={FIELD_LABEL}>Paper size</label>
              <SelectField id="paper-size-select" aria-label="Addendum paper size" value={paper.draft.addendum_paper_size ?? ""} disabled={!canEdit} onChange={(e) => paper.patch({ addendum_paper_size: e.target.value as PaperSize })}>
                {PAPER_SIZES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </SelectField>
            </div>
            {paper.draft.addendum_paper_size === "custom" && (
              <>
                <div>
                  <label htmlFor="paper-width" className={FIELD_LABEL}>Width (in)</label>
                  <input id="paper-width" type="number" step="0.1" value={paper.draft.addendum_custom_width ?? ""} disabled={!canEdit} onChange={(e) => paper.patch({ addendum_custom_width: e.target.value })} className={INPUT_CLASS} />
                </div>
                <div>
                  <label htmlFor="paper-height" className={FIELD_LABEL}>Height (in)</label>
                  <input id="paper-height" type="number" step="0.1" value={paper.draft.addendum_custom_height ?? ""} disabled={!canEdit} onChange={(e) => paper.patch({ addendum_custom_height: e.target.value })} className={INPUT_CLASS} />
                </div>
              </>
            )}
          </div>
          {!canEdit && <p className="text-[13px] leading-[18px] text-adm-muted">Your role can view the paper size but not change it. Changing it needs the settings roles.</p>}
        </SectionCard>
      )}

      {showLibrary && (
        <AccordionCard icon="layers" title="Template catalog versions" description="Platform templates and the version each one serves. History is read-only here." summary={rows === undefined ? "Checking the catalog" : rows === null ? "Could not be read" : `${rows.length} ${rows.length === 1 ? "template" : "templates"}`}>
          {rows === undefined ? (
            <p className="text-[14px] text-adm-muted">Checking the template catalog</p>
          ) : rows === null ? (
            <p className="text-[14px] text-adm-muted">The template catalog could not be read. Versions show as Unknown, not as missing.</p>
          ) : rows.length === 0 ? (
            <p className="text-[14px] text-adm-muted">No templates are published in the catalog. The built-in templates still render.</p>
          ) : (
            <div className={bare}>
              <StackedRows
                caption="Template catalog versions"
                rows={rows}
                rowKey={(r) => r.id}
                columns={[
                  { id: "template", header: "Template", primary: true, cell: (r) => <><span className="block font-semibold">{r.name}</span><span className="block text-[13px] leading-[18px] font-normal text-adm-muted">{r.type}</span></> },
                  { id: "size", header: "Size", cell: (r) => r.size },
                  {
                    id: "version",
                    header: "Version",
                    cell: (r) => (
                      <>
                        <span className="block tabular-nums">v{r.currentVersion}</span>
                        <span className="block text-[13px] leading-[18px] text-adm-muted">{r.publishedAt ? `Published ${describeAge(r.publishedAt, now)}` : "Version not recorded"}</span>
                      </>
                    ),
                  },
                  { id: "status", header: "Status", cell: (r) => <StatusChip tone={r.active ? "success" : "neutral"} className="text-[13px]">{r.active ? "Active" : "Inactive"}</StatusChip> },
                  { id: "details", header: "Details", cell: (r) => <AdminButton size="sm" className="min-h-[44px] sm:min-h-[32px]" aria-label={`Details for ${r.name}`} onClick={() => setDetail(r)}>Details</AdminButton> },
                ]}
              />
            </div>
          )}
        </AccordionCard>
      )}

      {showLibrary && <FactoryStickerPanel />}
      {showLibrary && <StickerPrintTemplates />}

      <DetailDrawer open={!!detail} onClose={() => setDetail(null)} title={detail?.name ?? "Template"} description="Read from the platform template catalog. Nothing here edits a version.">
        {detail && (
          <KeyValueList
            rows={[
              { label: "Template ID", value: <span className="break-all font-mono text-[13px]">{detail.id}</span> },
              { label: "Type", value: detail.type },
              { label: "Paper size", value: detail.size },
              { label: "Version served", value: `v${detail.currentVersion}` },
              { label: "Published", value: detail.publishedAt ? new Date(detail.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Version not recorded" },
              { label: "Status", value: detail.active ? "Active" : "Inactive" },
            ]}
          />
        )}
        <p className="text-[13px] leading-[18px] text-adm-muted">A replacement is always a new version. Documents already generated keep the version they were made with.</p>
      </DetailDrawer>
    </div>
  );
}
