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
import { AdminCard, AdminLinkButton, AdminTable, StatusChip, Td, Th } from "@/components/admin/v2/primitives";
import { cn } from "@/lib/utils";
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

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] gap-4 items-start">
      <div className="space-y-4">
        <LabelDefaultsPanel />
        <FactoryStickerPanel />
        <StickerPrintTemplates />
      </div>

      <div className="space-y-4">
        <AdminCard id="paper-size" title="Addendum paper size" description="The addendum scales to this size. The FTC Buyers Guide stays at its federally mandated minimum (11 x 7.25 in, 16 CFR 455)." action={<SaveStatus status={paper.status} />}>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Addendum paper size">
            {PAPER_SIZES.map((p) => {
              const on = paper.draft.addendum_paper_size === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={on}
                  disabled={!canEdit}
                  onClick={() => paper.patch({ addendum_paper_size: p.key as PaperSize })}
                  className={cn("min-h-[32px] px-3 rounded-md text-[12px] font-semibold border disabled:opacity-50", on ? "border-adm-primary bg-adm-selected text-adm-primary" : "border-adm-border text-adm-ink hover:bg-adm-workspace")}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          {paper.draft.addendum_paper_size === "custom" && (
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div>
                <label htmlFor="paper-width" className={FIELD_LABEL}>Width (in)</label>
                <input id="paper-width" type="number" step="0.1" value={paper.draft.addendum_custom_width ?? ""} disabled={!canEdit} onChange={(e) => paper.patch({ addendum_custom_width: e.target.value })} className={INPUT_CLASS} />
              </div>
              <div>
                <label htmlFor="paper-height" className={FIELD_LABEL}>Height (in)</label>
                <input id="paper-height" type="number" step="0.1" value={paper.draft.addendum_custom_height ?? ""} disabled={!canEdit} onChange={(e) => paper.patch({ addendum_custom_height: e.target.value })} className={INPUT_CLASS} />
              </div>
            </div>
          )}
        </AdminCard>

        <AdminCard title="Design your own templates" description="Browse the gallery, customize a template with your branding, then choose it as a default in Label templates in effect.">
          <AdminLinkButton to="/sticker-studio" variant="primary">Open Sticker Studio</AdminLinkButton>
        </AdminCard>

        <AdminCard title="Template catalog versions" description="Platform templates and the version each one serves. History is read-only here." flush>
          {rows === undefined ? (
            <p className="px-6 pb-6 text-[13px] text-adm-muted">Checking the template catalog…</p>
          ) : rows === null ? (
            <p className="px-6 pb-6 text-[13px] text-adm-muted">The template catalog could not be read. Versions show as Unknown, not as missing.</p>
          ) : rows.length === 0 ? (
            <p className="px-6 pb-6 text-[13px] text-adm-muted">No templates are published in the catalog. The built-in templates still render.</p>
          ) : (
            <AdminTable caption="Template catalog versions">
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
          <p className="px-6 py-4 text-[12px] leading-[18px] text-adm-muted">
            Printer offsets and test sheets are on <Link to="/admin?tab=print-calibration" className="font-semibold text-adm-primary hover:underline">Print &amp; Calibration</Link>.
          </p>
        </AdminCard>
      </div>
    </div>
  );
}
