// ──────────────────────────────────────────────────────────────────────
// OEM brand registry for dealer pages. LEGAL RULE (hard): OEM trademarks
// are never drawn or embedded here. A tenant-uploaded asset URL renders
// the real mark under the dealer's own franchise license; otherwise every
// variant falls back to a clean text-based treatment (brand name in
// letterspaced caps). No counterfeit marks, ever.
// ──────────────────────────────────────────────────────────────────────

export type OemBrandKey =
  | "acura" | "audi" | "bmw" | "buick" | "cadillac" | "chevrolet" | "chrysler"
  | "dodge" | "ford" | "genesis" | "gmc" | "honda" | "hyundai" | "infiniti"
  | "jeep" | "kia" | "lexus" | "lincoln" | "mazda" | "mercedes-benz" | "mini"
  | "nissan" | "porsche" | "ram" | "subaru" | "toyota" | "volkswagen" | "volvo";

// Official brand styling: all-caps where the OEM styles the wordmark that
// way (INFINITI, BMW, GMC, MINI, RAM); Title Case otherwise.
const OEM_DISPLAY_NAMES: Record<OemBrandKey, string> = {
  acura: "Acura",
  audi: "Audi",
  bmw: "BMW",
  buick: "Buick",
  cadillac: "Cadillac",
  chevrolet: "Chevrolet",
  chrysler: "Chrysler",
  dodge: "Dodge",
  ford: "Ford",
  genesis: "Genesis",
  gmc: "GMC",
  honda: "Honda",
  hyundai: "Hyundai",
  infiniti: "INFINITI",
  jeep: "Jeep",
  kia: "Kia",
  lexus: "Lexus",
  lincoln: "Lincoln",
  mazda: "Mazda",
  "mercedes-benz": "Mercedes-Benz",
  mini: "MINI",
  nissan: "Nissan",
  porsche: "Porsche",
  ram: "RAM",
  subaru: "Subaru",
  toyota: "Toyota",
  volkswagen: "Volkswagen",
  volvo: "Volvo",
};

// Luxury set for ownership-experience copy.
export const OEM_LUXURY_BRANDS: readonly OemBrandKey[] = [
  "acura", "audi", "bmw", "cadillac", "genesis", "infiniti",
  "lexus", "lincoln", "mercedes-benz", "porsche", "volvo",
];

const OEM_ALIASES: Record<string, OemBrandKey> = {
  chevy: "chevrolet",
  mercedes: "mercedes-benz",
  mercedesbenz: "mercedes-benz",
  benz: "mercedes-benz",
  vw: "volkswagen",
  minicooper: "mini",
};

export function oemDisplayName(brand: OemBrandKey): string {
  return OEM_DISPLAY_NAMES[brand];
}

export function isLuxuryOemBrand(brand: OemBrandKey): boolean {
  return OEM_LUXURY_BRANDS.includes(brand);
}

// Normalizes a free-form make string ("INFINITI", "Mercedes-Benz",
// "chevy") to a registry key, or null when the make isn't in the family.
export function resolveOemBrand(makeString: string | null | undefined): OemBrandKey | null {
  if (!makeString) return null;
  const compact = makeString.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!compact) return null;
  if (OEM_ALIASES[compact]) return OEM_ALIASES[compact];
  const keyed = (Object.keys(OEM_DISPLAY_NAMES) as OemBrandKey[]).find((k) => k.replace(/-/g, "") === compact);
  return keyed ?? null;
}

// Text badge treatments only. `logoUrl` (a tenant-uploaded asset) is the
// sole path to a pictorial mark.
export function OemLogo({
  brand, size = 20, variant = "mark", logoUrl, className,
}: {
  brand: OemBrandKey;
  size?: number;
  variant?: "mark" | "badge" | "text" | "authorized-retailer";
  logoUrl?: string;
  className?: string;
}) {
  const name = oemDisplayName(brand);
  if (variant === "authorized-retailer") {
    return <OemAuthorizedBadge brand={brand} logoUrl={logoUrl} className={className} />;
  }
  if (logoUrl) {
    return <img src={logoUrl} alt={name} style={{ height: size }} className={`object-contain ${className ?? ""}`} />;
  }
  if (variant === "badge") {
    return (
      <span
        className={`inline-flex items-center rounded-lg border border-[#DDE5EE] bg-white px-2.5 py-1 font-black uppercase tracking-[0.18em] text-[#0F172A] ${className ?? ""}`}
        style={{ fontSize: Math.round(size * 0.55), lineHeight: 1.2 }}
      >
        {name}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center uppercase tracking-[0.18em] ${variant === "mark" ? "font-black" : "font-bold"} ${className ?? ""}`}
      style={{ fontSize: Math.round(size * 0.65), lineHeight: 1.2 }}
    >
      {name}
    </span>
  );
}

// White rounded "Authorized Retailer" card: brand name in letterspaced
// caps over the retailer label. Accepts an unresolved make string so
// franchised stores outside the 28-brand registry still render cleanly.
export function OemAuthorizedBadge({
  brand, label, logoUrl, className,
}: {
  brand: OemBrandKey | (string & {});
  label?: string;
  logoUrl?: string;
  className?: string;
}) {
  const key = resolveOemBrand(brand);
  const name = key ? oemDisplayName(key) : String(brand).toUpperCase();
  return (
    <span className={`inline-flex flex-col items-center bg-white text-[#0F172A] rounded-xl px-4 py-2.5 shadow-lg ${className ?? ""}`}>
      {logoUrl
        ? <img src={logoUrl} alt={name} className="h-5 object-contain" />
        : <span className="text-[13px] font-black tracking-[0.18em] uppercase leading-none">{name}</span>}
      <span className="text-[9px] font-bold uppercase tracking-wider text-[#64748B] mt-1">{label ?? "Authorized Retailer"}</span>
    </span>
  );
}
