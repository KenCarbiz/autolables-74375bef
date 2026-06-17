// Maps an Autocurb dealer profile (the mirror stored on tenants.autocurb_profile)
// onto AutoLabels dealer-settings keys. Autocurb's dealers-api field names have
// drifted over time, so each value probes several candidate paths at the
// profile, branding, and first-store levels.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const pickStr = (...vals: any[]): string => {
  for (const v of vals) {
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const brandsToStr = (...vals: any[]): string => {
  for (const v of vals) {
    if (Array.isArray(v) && v.length) return v.map((x) => String(x).trim()).filter(Boolean).join(", ");
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
};

// Returns only the keys that have a value, so callers can spread it as a
// gap-filling layer without clobbering existing data with empty strings.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mapAutocurbProfile = (profile: any): Record<string, string> => {
  const p = (profile || {}) as Record<string, any>;
  const b = (p.branding || {}) as Record<string, any>;
  const st = (Array.isArray(p.stores) && p.stores[0] ? p.stores[0] : {}) as Record<string, any>;
  const out: Record<string, string> = {
    dealer_name: pickStr(p.legal_entity_name, p.name),
    dealer_tagline: pickStr(p.tagline, b.tagline, p.slogan),
    dealer_logo_url: pickStr(p.logo_url, b.logo_url, b.logo_white_url, b.corporate_logo_url),
    primary_color: pickStr(p.primary_color, b.primary_color, b.brand_color),
    dealer_address: pickStr(p.address, p.address_line1, p.street, p.street_address, st.address, st.address_line1, st.street, st.street_address),
    dealer_city: pickStr(st.city, p.city),
    dealer_state: pickStr(p.governing_law_state, st.state, p.state),
    dealer_zip: pickStr(st.zip, st.postal_code, st.zip_code, p.zip, p.postal_code, p.zip_code),
    dealer_phone: pickStr(p.phone, st.phone),
    dealer_principal: pickStr(p.dealer_principal, p.principal, p.owner_name, b.dealer_principal),
    dealer_license_number: pickStr(b.dealer_license_number, p.dealer_license_number, p.license_number, p.dealer_license, st.dealer_license_number, st.license_number),
    dealer_oem_brands: brandsToStr(st.oem_brands, st.brands, st.makes, p.oem_brands, p.brands),
  };
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(out)) if (v) cleaned[k] = v;
  return cleaned;
};
