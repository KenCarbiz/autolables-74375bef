import { useDealerSettings, DEFAULT_SETTINGS } from "@/contexts/DealerSettingsContext";
import { useTenant } from "@/contexts/TenantContext";

interface AddendumHeaderProps {
  inkSaving?: boolean;
}

// settings.dealer_name defaults to a non-empty placeholder, so it would
// always shadow the real tenant. Only treat it as set when the dealer has
// changed it from the default.
const configured = (v: string, fallback: string) =>
  v && v !== fallback ? v : "";

// Official-document masthead: left-anchored dealer letterhead (logo + legal
// name + address + license) vs a right-side form-control block, joined by a
// rule system and a fine-print legal strip — the engraved-form look of a
// DMV / Monroney supplement, not a centered web banner.
const AddendumHeader = ({ inkSaving }: AddendumHeaderProps) => {
  const { settings } = useDealerSettings();
  const { currentStore, tenant } = useTenant();

  const name =
    currentStore?.name ||
    configured(settings.dealer_name, DEFAULT_SETTINGS.dealer_name) ||
    tenant?.name ||
    settings.dealer_name;
  const tagline =
    currentStore?.tagline ||
    configured(settings.dealer_tagline, DEFAULT_SETTINGS.dealer_tagline);
  const logo = currentStore?.logo_url || settings.dealer_logo_url || tenant?.logo_url;
  // Fall back to the active store's location so the licensed-seller line shows
  // even when the dealer hasn't typed an address into Branding yet.
  const street = settings.dealer_address || (currentStore as { address?: string } | null)?.address || "";
  const city = settings.dealer_city || currentStore?.city || "";
  const stateAbbr = settings.dealer_state || currentStore?.state || "";
  const zip = settings.dealer_zip || currentStore?.zip || "";
  const address = [street, city, stateAbbr, zip].filter(Boolean).join(" · ");

  return (
    <header className={`addn-masthead border-b-2 border-navy ${inkSaving ? "bg-card text-navy" : "bg-navy text-primary-foreground"}`}>
      {/* Masthead: letterhead left / document-control block right */}
      <div className="flex items-stretch justify-between gap-3 px-4 pt-2.5 pb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {logo && settings.feature_custom_branding && (
            <img src={logo} alt={name} className="h-9 w-auto object-contain shrink-0" />
          )}
          <div className="min-w-0 leading-tight">
            <p className="font-barlow-condensed font-bold uppercase tracking-wide text-[15px] truncate">{name}</p>
            {address && <p className="text-[8px] tracking-wide opacity-80 truncate">{address}</p>}
            {settings.dealer_license_number && (
              <p className="text-[8px] tracking-wide opacity-70 truncate">Lic. #{settings.dealer_license_number}</p>
            )}
          </div>
        </div>

        <div className={`addn-divider shrink-0 text-right pl-3 flex flex-col justify-center border-l ${inkSaving ? "border-navy/25" : "border-white/25"}`}>
          <p className="font-barlow-condensed font-extrabold uppercase tracking-[0.12em] text-[17px] leading-none">
            Dealer Addendum
          </p>
          <p className="text-[8px] tracking-[0.18em] uppercase mt-1 opacity-80">
            Form AL-100 · Supplement to Monroney Label
          </p>
        </div>
      </div>

      {/* Legal subtitle strip on a hairline rule */}
      <div className={`addn-legalstrip px-4 py-1 border-t ${inkSaving ? "border-navy/25" : "border-white/20 bg-white/[0.04]"}`}>
        <p className="text-[8px] tracking-[0.22em] uppercase text-center opacity-80">
          Supplemental Window Label · Dealer-Installed Products &amp; Accessories
        </p>
        {tagline && <p className="text-[7px] tracking-wide text-center opacity-60 mt-0.5">{tagline}</p>}
      </div>
    </header>
  );
};

export default AddendumHeader;
