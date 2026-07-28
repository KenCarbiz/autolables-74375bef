// NeoVIN payload → our structured build sheet.
//
// Extracted from marketcheck-specs so the sticker orchestrator can rehydrate a
// build sheet from the raw response we already stored in neovin_snapshots,
// instead of re-buying a decode we have already paid for — and so this logic
// can finally be unit-tested. It previously lived behind a Deno.serve() and
// was never executed by any test in the repo.

// Flatten a feed value (string | {name|label|description|...}) to a clean name.
// deno-lint-ignore no-explicit-any
// NeoVIN shapes: InstalledOption/AvailableOption use `name`; Feature/
// HighValueFeature use `description`; InstalledEquipment uses `item`.
export const flat = (x: any): string =>
  typeof x === "string" ? x.trim()
  : x && typeof x === "object" ? String(x.name ?? x.label ?? x.item ?? x.description ?? x.value ?? x.code ?? "").trim()
  : "";

// ── Structured build sheet ───────────────────────────────────────────────────
// NeoVIN returns five distinct layers (packages / installed options / high-value
// features / standard features / granular installed_equipment). The flat
// options+features arrays keep back-compat; this preserves the tiers so the
// passport can show packages as packages instead of a 633-row info dump.
// installed_equipment (engineering rows) is deliberately NOT captured — it is
// noise for shoppers.
// deno-lint-ignore no-explicit-any
export function structuredSheet(payload: any): Record<string, unknown> | null {
  const src = payload || {};
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : undefined; };

  // Per-item factory option codes are sticker-grade data (the Monroney lists
  // them); persist them additively when the feed carries them.
  const codeOf = (x: unknown): string | undefined => {
    const c = String((x as { code?: unknown; option_code?: unknown } | null)?.code
      ?? (x as { option_code?: unknown } | null)?.option_code ?? "").trim();
    return c || undefined;
  };

  const packages: { name: string; code?: string; msrp?: number; contents: string[] }[] = [];
  // Same list under any of the names the provider has been observed to use.
  const firstArray = (...vals: unknown[]) => vals.find((v) => Array.isArray(v) && v.length) as unknown[] | undefined;
  const pkgSrc = firstArray(src.options_packages, src.option_packages, src.packages) ?? [];
  for (const p of pkgSrc) {
    const name = flat(p);
    if (!name) continue;
    const contents = ([] as unknown[])
      .concat(p?.options ?? p?.contents ?? p?.items ?? p?.features ?? [])
      .map(flat).filter(Boolean);
    packages.push({ name, code: codeOf(p), msrp: num(p?.msrp ?? p?.price), contents });
  }

  const options: { name: string; code?: string; msrp?: number }[] = [];
  const optSrc = firstArray(src.installed_options_details, src.installed_options, src.optional_equipment) ?? [];
  for (const o of optSrc) {
    const name = flat(o);
    if (!name) continue;
    // Some feeds list packages inside installed options — route them by type or
    // by the presence of sub-contents.
    const subs = ([] as unknown[]).concat(o?.options ?? o?.contents ?? []).map(flat).filter(Boolean);
    if (/package/i.test(String(o?.type ?? o?.category ?? "")) || subs.length) {
      if (!packages.some((p) => p.name === name)) packages.push({ name, code: codeOf(o), msrp: num(o?.msrp ?? o?.price), contents: subs });
    } else {
      options.push({ name, code: codeOf(o), msrp: num(o?.msrp ?? o?.price) });
    }
  }

  // Category map {category: [{description}|string]} → {category: [names]}.
  //
  // NeoVIN returns these EITHER as a {category: [...]} map OR as a flat typed
  // array (Feature/HighValueFeature items). The array form used to be rejected
  // outright by an `!Array.isArray` guard, so every feature was silently
  // dropped, structuredSheet returned null, and the window sticker reported
  // "no factory build data" for a VIN the provider had answered 200 for.
  // Grouping is presentational; losing the equipment is not.
  const catMap = (obj: unknown, fallbackCategory: string): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    if (Array.isArray(obj)) {
      // Prefer the item's own category when it carries one, so a flat array
      // still produces grouped output rather than one undifferentiated bucket.
      for (const item of obj) {
        const name = flat(item);
        if (!name) continue;
        const cat = String(
          (item as { category?: unknown; group?: unknown; type?: unknown } | null)?.category
          ?? (item as { group?: unknown } | null)?.group
          ?? (item as { type?: unknown } | null)?.type ?? "",
        ).trim() || fallbackCategory;
        (out[cat] ||= []).push(name);
      }
      for (const k of Object.keys(out)) out[k] = [...new Set(out[k])];
      return out;
    }
    if (obj && typeof obj === "object") {
      for (const [cat, arr] of Object.entries(obj as Record<string, unknown>)) {
        const names = (Array.isArray(arr) ? arr : [arr]).map(flat).filter(Boolean);
        if (names.length) out[cat] = names;
      }
    }
    return out;
  };
  const key_features = catMap(src.high_value_features, "Key Features");
  const standard = catMap(src.features, "Standard Equipment");

  // include_generic=true falls back to typical-for-trim specs when the VIN
  // can't be fully decoded — the passport must label those, never assert them.
  const generic = Boolean(src.is_generic ?? src.generic ?? /generic/i.test(String(src.decode_mode ?? src.decode ?? "")));

  // ── Sticker-grade fields (Factory Window Sticker Generator) ──────────
  // The raw NeoVIN payload was historically discarded after extraction, so
  // base MSRP, destination charge, and color codes were lost forever. These
  // additive keys persist them for future decodes (the complete raw response
  // is also captured verbatim in neovin_snapshots). NeoVIN field names, per
  // the parsing above + mc-probe: msrp (base), delivery_charges
  // (destination), combined_msrp (total); exterior_color/interior_color as
  // {name|generic_name, code, msrp}; made_in/made_in_city for assembly.
  const pricing: Record<string, number> = {};
  const baseMsrp = num(src.msrp ?? src.base_msrp ?? src.base_price);
  const destCharge = num(src.delivery_charges ?? src.destination_charge ?? src.destination ?? src.freight_charge);
  const totalMsrp = num(src.combined_msrp ?? src.total_msrp ?? src.total_price ?? src.msrp_with_options);
  if (baseMsrp) pricing.base_msrp = baseMsrp;
  if (destCharge) pricing.destination_charge = destCharge;
  if (totalMsrp) pricing.total_msrp = totalMsrp;

  // deno-lint-ignore no-explicit-any
  const colorOf = (c: any): Record<string, unknown> | undefined => {
    if (c == null) return undefined;
    if (typeof c === "string") return c.trim() ? { name: c.trim() } : undefined;
    if (typeof c !== "object") return undefined;
    const name = String(c.name ?? c.generic_name ?? c.description ?? "").trim();
    const code = String(c.code ?? c.color_code ?? "").trim();
    const cMsrp = num(c.msrp ?? c.price);
    if (!name && !code) return undefined;
    return { ...(name ? { name } : {}), ...(code ? { code } : {}), ...(cMsrp ? { msrp: cMsrp } : {}) };
  };
  const exterior = colorOf(src.exterior_color ?? src.base_ext_color);
  const interior = colorOf(src.interior_color ?? src.base_int_color);
  const colors = exterior || interior
    ? { ...(exterior ? { exterior } : {}), ...(interior ? { interior } : {}) }
    : undefined;

  const plant = String(src.plant ?? src.assembly_plant ?? "").trim();
  const country = String(src.made_in ?? src.assembly_country ?? "").trim();
  const city = String(src.made_in_city ?? "").trim();
  const assembly = plant || country || city
    ? { ...(plant ? { plant } : {}), ...(country ? { country } : {}), ...(city ? { city } : {}) }
    : undefined;

  // Equipment absent but pricing present is still a usable factory record —
  // base MSRP, destination and total are exactly what the sticker's price
  // table needs. This guard used to throw a perfectly good MSRP away because
  // the option arrays did not match an expected shape.
  const noEquipment = !packages.length && !options.length
    && !Object.keys(key_features).length && !Object.keys(standard).length;
  if (noEquipment && !Object.keys(pricing).length) return null;
  return {
    packages, options, key_features, standard, generic,
    // Lets a consumer tell "the provider had no equipment" from "we have
    // pricing only", instead of inferring it from an absent key.
    ...(noEquipment ? { equipment_absent: true } : {}),
    ...(Object.keys(pricing).length ? { pricing } : {}),
    ...(colors ? { colors } : {}),
    ...(assembly ? { assembly } : {}),
    decoded_at: new Date().toISOString(), source: "neovin",
  };
}

