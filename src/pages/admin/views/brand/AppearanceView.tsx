import { useMemo } from "react";
import { AdminButton, AdminCard } from "@/components/admin/v2/primitives";
import wordmarkPrimary from "@/assets/admin-v2/brand/wordmark-primary.svg";
import wordmarkReverse from "@/assets/admin-v2/brand/wordmark-reverse.svg";
import { APPEARANCE_KEYS, DEFAULT_ACCENT_HEX, isHexColor, normalizeHex, validateAppearance } from "./brandModel";
import { useBrandForm } from "./useBrandForm";
import { BrandSaveBar } from "./BrandSaveBar";
import { AppearanceCard } from "./cards";

// The one editor for the dealer accent colour (settings key primary_color).
// Identity shows the same card read-only and links here.

export default function AppearanceView() {
  const form = useBrandForm(APPEARANCE_KEYS, validateAppearance);
  const { draft, set, source } = form;
  const accent = isHexColor(draft.primary_color) ? normalizeHex(draft.primary_color) : DEFAULT_ACCENT_HEX;
  const logo = source.settings.dealer_logo_url;
  const isDefault = useMemo(() => !(draft.primary_color || "").trim(), [draft.primary_color]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4 items-start">
        <div className="space-y-4">
          <AppearanceCard accent={draft.primary_color} onChange={(hex) => set("primary_color", hex)} error={form.errors[0] ?? null} />

          <AdminCard title="Logo on dark and light surfaces" description="Your logo is never stretched; it is fitted inside the space the surface allows.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-[10px] bg-adm-sidebar h-[96px] flex items-center justify-center px-6">
                {logo ? <img src={logo} alt="Dealership logo on a dark surface" className="max-h-10 max-w-full object-contain" /> : <img src={wordmarkReverse} alt="AutoLabels wordmark placeholder on a dark surface" className="h-6" />}
              </div>
              <div className="rounded-[10px] border border-adm-border bg-adm-surface h-[96px] flex items-center justify-center px-6">
                {logo ? <img src={logo} alt="Dealership logo on a light surface" className="max-h-10 max-w-full object-contain" /> : <img src={wordmarkPrimary} alt="AutoLabels wordmark placeholder on a light surface" className="h-6" />}
              </div>
            </div>
            <p className="mt-3 text-[12px] leading-[18px] text-adm-muted">{logo ? "Change the logo on the Identity tab." : "No dealership logo is uploaded. Documents fall back to the dealership name, never to the AutoLabels mark."}</p>
          </AdminCard>
        </div>

        <div className="space-y-4">
          <AdminCard title="Where the accent is used">
            <ul className="space-y-2 text-[14px] leading-[20px] text-adm-ink">
              <li className="flex items-center gap-3"><span className="w-4 h-4 rounded-full border border-adm-border flex-shrink-0" style={{ backgroundColor: accent }} aria-hidden="true" />Dealer-coloured elements on generated documents</li>
              <li className="flex items-center gap-3"><span className="w-4 h-4 rounded-full border border-adm-border flex-shrink-0" style={{ backgroundColor: accent }} aria-hidden="true" />Accent on the customer Vehicle Passport where a dealer colour applies</li>
            </ul>
            <p className="mt-3 text-[12px] leading-[18px] text-adm-muted">The application chrome keeps the AutoLabels navy and blue; the accent never restyles it.</p>
          </AdminCard>

          <AdminCard title="Reset">
            <p className="text-[13px] leading-[18px] text-adm-muted">Clear the dealer accent so the AutoLabels default applies again. Identity, logo and contact details are not touched.</p>
            <AdminButton
              variant="danger"
              className="mt-3"
              disabled={isDefault || !!form.blockedReason}
              onClick={() => {
                if (window.confirm("Reset the accent colour to the AutoLabels default? You can still save or discard afterwards.")) set("primary_color", "");
              }}
            >
              Reset accent to default
            </AdminButton>
          </AdminCard>
        </div>
      </div>

      <BrandSaveBar form={form} />
    </div>
  );
}
