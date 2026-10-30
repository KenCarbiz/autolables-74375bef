import { useMemo } from "react";
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
import { AdminCard, AdminTable, StatusChip, Td, Th } from "@/components/admin/v2/primitives";
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

export default function TemplatesView() {
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
  const matrix = useMemo(() => documentRuleRows(rulesFromSettings(settings), serviceGateContext(settings)), [settings]);

  return (
    <div className="flex flex-col gap-4">
      <LabelDefaultsPanel />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <AdminCard title="Approval matrix" flush inset="sm" action={<Link to={adminTabHref("approval-rules")} className="text-[14px] font-semibold text-adm-primary hover:underline">Edit rules</Link>}>
          <AdminTable caption="Approval matrix" minWidth={460}>
            <thead>
              <tr>
                <Th>Document</Th>
                <Th>Approval</Th>
                <Th>Refresh after</Th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((r) => (
                <tr key={r.family}>
                  <Td className="whitespace-nowrap font-medium">{r.document}</Td>
                  <Td className="max-w-[200px] truncate">{r.approval}</Td>
                  <Td className="max-w-[180px] truncate text-adm-muted">{r.refreshAfter}</Td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        </AdminCard>

        <AdminCard title="Print & calibration readiness" flush inset="sm" action={<Link to={adminTabHref("print-calibration")} className="text-[14px] font-semibold text-adm-primary hover:underline">Open calibration</Link>}>
          <AdminTable caption="Readiness" minWidth={420}>
            <thead>
              <tr>
                <Th>Check</Th>
                <Th>Status</Th>
                <Th>Detail</Th>
              </tr>
            </thead>
            <tbody>
              {readiness.items.map((it) => (
                <tr key={it.key}>
                  <Td className="whitespace-nowrap font-medium">{it.label}</Td>
                  <Td><StatusChip tone={it.state === "ok" ? "success" : it.state === "needs" ? "warning" : "neutral"}>{it.chip}</StatusChip></Td>
                  <Td className="max-w-[200px] truncate text-adm-muted">{it.detailValue}</Td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        </AdminCard>
      </div>

      <AdminCard id="paper-size" title="Addendum paper size" description="The addendum scales to this size. The FTC Buyers Guide stays at its federally mandated minimum (11 x 7.25 in, 16 CFR 455)." action={<SaveStatus status={paper.status} />}>
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,320px)_1fr_1fr] gap-3 items-end">
          <div>
            <label htmlFor="paper-size-select" className={FIELD_LABEL}>Paper size</label>
            <select id="paper-size-select" aria-label="Addendum paper size" value={paper.draft.addendum_paper_size ?? ""} disabled={!canEdit} onChange={(e) => paper.patch({ addendum_paper_size: e.target.value as PaperSize })} className={INPUT_CLASS}>
              {PAPER_SIZES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
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
      </AdminCard>

      <AdminCard title="Template catalog versions" description="Platform templates and the version each one serves. History is read-only here." flush>
        {rows === undefined ? (
          <p className="px-6 pb-6 text-[13px] text-adm-muted">Checking the template catalog</p>
        ) : rows === null ? (
          <p className="px-6 pb-6 text-[13px] text-adm-muted">The template catalog could not be read. Versions show as Unknown, not as missing.</p>
        ) : rows.length === 0 ? (
          <p className="px-6 pb-6 text-[13px] text-adm-muted">No templates are published in the catalog. The built-in templates still render.</p>
        ) : (
          <AdminTable caption="Template catalog versions" minWidth={560}>
            <thead>
              <tr>
                <Th>Template</Th>
                <Th>Size</Th>
                <Th>Version</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <span className="block font-semibold">{r.name}</span>
                    <span className="block text-[12px] text-adm-muted">{r.type}</span>
                  </Td>
                  <Td>{r.size}</Td>
                  <Td>
                    <span className="block tabular-nums">v{r.currentVersion}</span>
                    <span className="block text-[12px] text-adm-muted">{r.publishedAt ? `Published ${describeAge(r.publishedAt, now)}` : "Version not recorded"}</span>
                  </Td>
                  <Td><StatusChip tone={r.active ? "success" : "neutral"}>{r.active ? "Active" : "Inactive"}</StatusChip></Td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
      </AdminCard>

      <FactoryStickerPanel />
      <StickerPrintTemplates />
    </div>
  );
}
