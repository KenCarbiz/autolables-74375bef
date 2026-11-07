import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import { supabase } from "@/integrations/supabase/client";
import { uploadPhoto } from "@/lib/storage";
import { AdminButton } from "@/components/admin/v2/primitives";
import {
  AdminIcon, AdvancedDisclosure, ColorField, DetailDrawer, FieldRow, INPUT_CLASS, LogoSlot, PreviewOnlyNotice, SectionCard, SelectField, type ReviewChangeRow,
} from "@/components/admin/v3/editor";
import { colorError, contrastRatio, normalizeHex, AA_NORMAL_TEXT, WHITE_HEX } from "@/lib/admin/color";
import type { DraftErrors, EditorDraftChange } from "@/lib/admin/useEditorDraft";
import { DEFAULT_ACCENT_HEX } from "./brandModel";
import { BrandEditorFrame, LoadingState } from "./editor/BrandEditorFrame";
import { settingsWriter, useBrandEditor, useBrandEditorContext } from "./editor/useBrandEditor";
import { BlockedCard, ConfirmDialog, PreviewFrame, Segmented, SourceLine } from "./editor/parts";

interface AppearanceDraft extends Record<string, unknown> {
  primary_color: string;
  secondary_color: string;
  dealer_logo_url: string;
}

const PALETTE_MIGRATION = "20261114000000";
const WORKSPACE_SECONDARY = "#0B2041";

const validate = (d: AppearanceDraft): DraftErrors<AppearanceDraft> => {
  const e: DraftErrors<AppearanceDraft> = {};
  const p = colorError(d.primary_color, false);
  if (p) e.primary_color = `Primary colour: ${p}`;
  const s = colorError(d.secondary_color, false);
  if (s) e.secondary_color = `Secondary colour: ${s}`;
  return e;
};

const norm = (v: string) => (v.trim() === "" ? "" : normalizeHex(v) ?? v.trim());
const fileName = (url: string) => { try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || url); } catch { return url; } };

const LABELS: Record<string, string> = { primary_color: "Primary colour", secondary_color: "Secondary colour", dealer_logo_url: "Logo for light backgrounds" };
const describe = (c: EditorDraftChange<AppearanceDraft>): ReviewChangeRow => {
  const logo = c.key === "dealer_logo_url";
  const show = (v: unknown) => (logo ? (v ? fileName(String(v)) : "No logo (documents use the dealership name)") : v ? norm(String(v)) : "AutoLabels default");
  return { id: c.key, label: LABELS[c.key] ?? c.key, before: show(c.before), after: show(c.after) };
};

async function writeSecondary(tenantId: string, hex: string): Promise<void> {
  const res = (await (supabase as unknown as { from: (t: string) => { update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => { select: (c: string) => PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }> } } } })
    .from("onboarding_profiles").update({ secondary_color: hex || null }).eq("tenant_id", tenantId).select("tenant_id"));
  if (res.error || !res.data?.length) throw new Error("The secondary colour was not accepted by the server. It is kept in your draft.");
}

const readableOn = (hex: string) => (contrastRatio(hex, WHITE_HEX) >= AA_NORMAL_TEXT || contrastRatio(hex, "#0B1526") < contrastRatio(hex, WHITE_HEX) ? "#FFFFFF" : "#0B1526");

type Kind = "customer" | "document";

const Surface = ({ dark, kind, accent, secondary, logo, name, logoNote }: { dark: boolean; kind: Kind; accent: string; secondary: string; logo: string; name: string; logoNote?: string }) => {
  const bg = dark ? "#162638" : "#FFFFFF";
  const ink = dark ? "#FFFFFF" : "#142338";
  const muted = dark ? "#C3CEDB" : "#475569";
  return (
    <figure className="m-0 min-w-0" aria-label={`${kind === "customer" ? "Customer Passport" : "Document"} on a ${dark ? "dark" : "light"} surface`}>
      <div className="rounded-lg border border-adm-border overflow-hidden" style={{ backgroundColor: bg, color: ink }} data-surface={dark ? "dark" : "light"}>
        <div className="px-4 py-3 flex flex-col items-start gap-1.5 border-b" style={{ borderColor: dark ? "#2C4058" : "#E2E8F0" }}>
          {logo ? <img src={logo} alt="" className="h-8 w-auto max-w-[120px] object-contain" /> : <span className="text-[14px] leading-[20px] font-bold break-words">{name || "Dealership name"}</span>}
          {logo && <span className="text-[14px] leading-[20px] font-semibold break-words min-w-0">{name}</span>}
        </div>
        <div className="p-4 space-y-3">
          {kind === "customer" ? (
            <>
              <p className="text-[18px] leading-[24px] font-bold">Today's sale price</p>
              <p className="text-[14px] leading-[20px]" style={{ color: muted }}>Fee-inclusive. Your savings appear only when positive.</p>
              <span className="inline-flex items-center justify-center min-h-[40px] px-4 rounded-md text-[14px] leading-[20px] font-semibold" style={{ backgroundColor: accent, color: readableOn(accent) }}>See my price</span>
              <span className="block h-1 rounded" style={{ backgroundColor: secondary }} aria-hidden="true" />
            </>
          ) : (
            <>
              <p className="text-[18px] leading-[24px] font-bold">Dealer addendum</p>
              <div className="h-1.5 rounded" style={{ backgroundColor: accent }} aria-hidden="true" />
              <p className="text-[14px] leading-[20px]" style={{ color: muted }}>Installed products and totals print below this rule.</p>
              <p className="text-[14px] leading-[20px] font-semibold" style={{ color: accent === bg ? ink : accent }}>Accent text sample</p>
            </>
          )}
        </div>
      </div>
      <figcaption className="mt-1.5 text-[13px] leading-[18px] text-adm-muted">{dark ? "Dark surface" : "Light surface"}{logoNote ? `. ${logoNote}` : ""}</figcaption>
    </figure>
  );
};

export default function AppearanceView() {
  const ctx = useBrandEditorContext();
  const { source, settings } = ctx;
  const { tenant, reload: reloadTenant } = useTenant();
  const [kind, setKind] = useState<Kind>("customer");
  const [fullPreview, setFullPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const savedSecondary = ctx.fixture
    ? (ctx.fixture.variants?.[ctx.fixtureState]?.secondaryColor ?? ctx.fixture.secondaryColor ?? "")
    : tenant?.secondary_color && tenant.secondary_color.toUpperCase() !== WORKSPACE_SECONDARY ? tenant.secondary_color : "";
  const baseline = useMemo<AppearanceDraft | undefined>(
    () => (source.loading && !ctx.fixture ? undefined : { primary_color: norm(settings.primary_color || ""), secondary_color: norm(savedSecondary), dealer_logo_url: settings.dealer_logo_url || "" }),
    [source.loading, ctx.fixture, settings.primary_color, settings.dealer_logo_url, savedSecondary],
  );
  const writeSettings = useMemo(() => settingsWriter(source), [source]);
  const editor = useBrandEditor<AppearanceDraft>({
    ctx,
    baseline,
    validate,
    describe,
    buildPatch: (d, b, changes) => Object.fromEntries(changes.map((c) => [c.key, c.key === "dealer_logo_url" ? d.dealer_logo_url : norm(String(c.after ?? ""))])),
    write: async (patch) => {
      const { secondary_color, ...rest } = patch;
      const hasRest = Object.keys(rest).length > 0;
      if (secondary_color !== undefined) {
        if (source.isFixture || !source.tenantId) throw new Error("This is a design fixture: nothing is saved.");
        if (!ctx.canWriteProfile) throw new Error("Only an owner or admin can change the secondary colour. Nothing was saved.");
        await writeSecondary(source.tenantId, String(secondary_color));
        await Promise.resolve(reloadTenant?.());
      }
      if (hasRest) {
        try {
          await writeSettings(rest);
        } catch (e) {
          const why = (e instanceof Error ? e.message : "The server did not accept the change.").replace(/\s*Nothing was saved\.?/i, "").trim();
          throw new Error(secondary_color !== undefined ? `The secondary colour was saved, but the other changes were not. ${why}` : why);
        }
      }
    },
  });
  const draft = editor.draft;
  if (!draft) return <LoadingState />;

  const disabled = !ctx.editable;
  const errors = editor.errors as Record<string, string | undefined>;
  const accentOk = !colorError(draft.primary_color, false) && draft.primary_color.trim() !== "";
  const accent = accentOk ? (normalizeHex(draft.primary_color) as string) : DEFAULT_ACCENT_HEX;
  const secondaryOk = !colorError(draft.secondary_color, false) && draft.secondary_color.trim() !== "";
  const secondary = secondaryOk ? (normalizeHex(draft.secondary_color) as string) : "#0B2041";
  const name = settings.dealer_name || "";
  const hasLogo = !!draft.dealer_logo_url;
  const dirtyPreview = editor.dirty;

  const pickLogo = async (file: File) => {
    if (!source.tenantId || source.isFixture) return;
    setUploading(true);
    setUploadError(null);
    try {
      const result = await uploadPhoto("dealer-logos", file, { tenantId: source.tenantId, storeId: source.activeStoreId ?? undefined, vin: "brand-logo" });
      if (!result?.url) { setUploadError("The upload did not return a file address."); return; }
      editor.set("dealer_logo_url", result.url);
      toast.success("Logo uploaded. Review and apply to use it.");
    } catch (e) {
      setUploadError(`Upload failed: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setUploading(false);
    }
  };

  const previews = (
    <>
      <Segmented label="Preview surface" value={kind} onChange={setKind} options={[{ value: "customer", label: "Customer" }, { value: "document", label: "Document" }]} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <Surface dark={false} kind={kind} accent={accent} secondary={secondary} logo={draft.dealer_logo_url} name={name} />
        <Surface dark kind={kind} accent={accent} secondary={secondary} logo={draft.dealer_logo_url} name={name} logoNote={hasLogo ? "No dark-surface logo yet, so the light logo is shown as uploaded" : undefined} />
      </div>
    </>
  );

  return (
    <BrandEditorFrame
      ctx={ctx}
      editor={editor}
      scopeNote="Colours and the logo apply to customer pages and documents, never to the AutoLabels application."
      impact="Documents and the customer Passport pick up the new colours and logo the next time they are generated or opened. The AutoLabels application keeps its navy and blue."
      previewLabel="Customer and document preview"
      preview={
        <>
          <PreviewFrame title="Customer and document preview" draft={dirtyPreview} caption="Both surfaces use the same draft colours and logo.">
            <PreviewOnlyNotice>This preview shows draft values on sample content. It does not change what customers see and sends nothing.</PreviewOnlyNotice>
            {previews}
            <AdminButton variant="secondary" className="w-full" onClick={() => setFullPreview(true)}>
              <AdminIcon name="maximize" />
              Open larger preview
            </AdminButton>
          </PreviewFrame>
        </>
      }
    >
      <SectionCard icon="palette" title="Brand colours" description="The colours used on customer pages and documents for this dealership.">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <ColorField name="Primary colour" role="Accent" optional value={draft.primary_color} disabled={disabled} onChange={(v) => editor.set("primary_color", v)} />
            <SourceLine>Dealer settings (primary_color). Customer and document accent.</SourceLine>
            <AdminButton variant="secondary" disabled={disabled || draft.primary_color === ""} onClick={() => editor.set("primary_color", "")}>Use the AutoLabels default</AdminButton>
          </div>
          <div className="space-y-2">
            <ColorField name="Secondary colour" role="Supporting" optional value={draft.secondary_color} disabled={disabled || !ctx.canWriteProfile} onChange={(v) => editor.set("secondary_color", v)} />
            <SourceLine>Shared dealer profile (onboarding_profiles.secondary_color).</SourceLine>
            {!ctx.canWriteProfile && <p className="text-[13px] leading-[18px] text-adm-ink">Read-only for your role. Only an owner or admin can change the shared dealer profile.</p>}
            <p className="text-[13px] leading-[18px] text-adm-muted">The AutoLabels application theme is not set here. Editing this colour does not recolour the application you are using.</p>
          </div>
        </div>
        <AdvancedDisclosure title="Where each colour is used">
          <ul className="space-y-2 text-[14px] leading-[20px] text-adm-ink">
            <li className="flex items-start gap-3"><span aria-hidden="true" className="mt-1 w-4 h-4 rounded-full border border-adm-border flex-shrink-0" style={{ backgroundColor: accent }} />Primary: dealer-coloured rules and highlights on generated documents, and the accent on the customer Vehicle Passport where a dealer colour applies.</li>
            <li className="flex items-start gap-3"><span aria-hidden="true" className="mt-1 w-4 h-4 rounded-full border border-adm-border flex-shrink-0" style={{ backgroundColor: secondary }} />Secondary: supporting colour stored in the shared dealer profile that the other apps in the AutoLabels family read.</li>
          </ul>
        </AdvancedDisclosure>
      </SectionCard>

      <BlockedCard
        icon="layers"
        title="Named palette"
        does="Name each brand colour, give it a role (primary, secondary or accent), and add, edit, remove or reset them. Until then the primary and secondary colours above are the saved palette."
        migrationId={PALETTE_MIGRATION}
        preview={
          <>
            <FieldRow label="Colour name">{(p) => <input {...p} className={INPUT_CLASS} disabled placeholder="Name" />}</FieldRow>
            <FieldRow label="Role">{(p) => <SelectField {...p} disabled><option>Primary, secondary or accent</option></SelectField>}</FieldRow>
            <div className="flex gap-2 flex-wrap">
              <AdminButton variant="secondary" disabled><AdminIcon name="plus" />Add colour</AdminButton>
              <AdminButton variant="secondary" disabled><AdminIcon name="rotate" />Reset palette</AdminButton>
            </div>
          </>
        }
      />

      <SectionCard icon="image" title="Logos" description="One logo for each kind of background. Logos are never cropped, stretched or recoloured.">
        <div className="grid gap-4 lg:grid-cols-2 items-stretch [&>*]:h-full">
          <LogoSlot
            label="Logo for light backgrounds"
            src={draft.dealer_logo_url || null}
            alt="Dealership logo for light backgrounds"
            surface="light"
            uploading={uploading}
            error={uploadError}
            disabled={disabled || source.isFixture}
            guidance={source.isFixture ? "Uploading is off in the design fixture. PNG, JPEG, SVG or WebP, up to 2 MB." : "PNG, JPEG, SVG or WebP, up to 2 MB. A transparent PNG or SVG works best."}
            onSelectFile={(f) => void pickLogo(f)}
            onRemove={() => setConfirmRemove(true)}
          >
            <SourceLine>Dealer settings (dealer_logo_url), the same file the Identity summary shows.</SourceLine>
          </LogoSlot>
          <BlockedCard
            icon="moon"
            title="Logo for dark backgrounds"
            does="A separate logo for dark surfaces. Until then the light-background logo is shown unmodified as the fallback."
            migrationId={PALETTE_MIGRATION}
            className="h-full"
            preview={<LogoSlot label="Logo for dark backgrounds" surface="dark" disabled guidance="PNG or SVG with a transparent background, up to 2 MB." onSelectFile={() => undefined} />}
          />
        </div>
      </SectionCard>

      <ConfirmDialog
        open={confirmRemove}
        title="Remove the logo for light backgrounds?"
        confirmLabel="Remove logo"
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => { setConfirmRemove(false); editor.set("dealer_logo_url", ""); }}
      >
        <p>This clears the logo used on documents and customer pages once you review and apply it. The file is not deleted.</p>
        <p>Fallback after removal: documents print the dealership name. The AutoLabels mark is never used in its place.</p>
      </ConfirmDialog>

      <DetailDrawer open={fullPreview} onClose={() => setFullPreview(false)} title="Customer and document preview" description="Draft values on sample content.">
        <PreviewOnlyNotice />
        {previews}
      </DetailDrawer>
    </BrandEditorFrame>
  );
}
