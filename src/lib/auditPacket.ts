// ──────────────────────────────────────────────────────────────
// Audit-Defense Packet (Wave 14.1)
//
// Given a VIN + tenant, pulls every signed artifact, every audit
// event, the latest NHTSA recall snapshot, and the full vehicle
// file (Wave 10) into one tamper-evident structured object.
//
// Each section is canonicalised (sorted keys, stable JSON) and
// SHA-256 hashed. The manifest then hashes the sorted list of
// (section, hash) pairs → chain root. Any later change to any
// included artifact changes the root, which the dealer can quote
// to counsel / AG / FTC.
//
// Companion: src/lib/auditPacketRenderer.ts renders this object
// as a self-contained HTML page suitable for production.
// ──────────────────────────────────────────────────────────────

const VERSION = "audit-packet/v1-2026-05";

export interface AuditPacketSection {
  name: string;
  count: number;
  sha256: string;
  data: unknown;
}

export interface AuditPacketManifest {
  version: string;
  vin: string;
  tenant: { id: string | null; name: string | null };
  generated_at: string;
  generated_by: string | null;
  user_agent: string;
  sections: { name: string; count: number; sha256: string }[];
  chain_root: string;
}

export interface AuditPacket {
  manifest: AuditPacketManifest;
  sections: AuditPacketSection[];
  summary: {
    has_listing: boolean;
    addendum_count: number;
    signed_addendum_count: number;
    customer_signing_count: number;
    prep_signoff_count: number;
    signed_prep_count: number;
    deal_token_count: number;
    signed_deal_count: number;
    audit_event_count: number;
    archived_document_count: number;
    has_vehicle_file: boolean;
    has_recall_snapshot: boolean;
    open_recall_count: number;
    do_not_drive: boolean;
    // Wave 22 — install-photo + advertised-price summary so
    // the cover KPI strip can quote both at a glance.
    install_photo_count: number;
    install_signature_count: number;
    advertised_price_snapshot_count: number;
    latest_advertised_price: number | null;
    latest_advertised_source: string | null;
  };
}

// Canonical JSON — keys sorted at every depth so hashing the same
// content twice produces the same digest regardless of property
// order returned by Postgres/JSON.stringify.
const canonical = (v: unknown): string => {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}";
};

const sha256Hex = async (s: string): Promise<string> => {
  const buf = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
};

const hashSection = async (name: string, data: unknown): Promise<AuditPacketSection> => {
  const sha = await sha256Hex(canonical(data));
  const count = Array.isArray(data) ? data.length : (data == null ? 0 : 1);
  return { name, count, sha256: sha, data };
};

interface BuildArgs {
  // The Supabase client. Loosely typed to dodge our project-wide
  // `(supabase as any)` pattern without forcing a generic here.
  supabase: { from: (t: string) => any; functions: { invoke: (n: string, opts?: { body?: unknown }) => Promise<{ data: unknown; error: unknown }> } };
  vin: string;
  tenantId: string | null;
  tenantName: string | null;
  generatedBy?: string | null;
}

export async function buildAuditPacket(args: BuildArgs): Promise<AuditPacket> {
  const { supabase, vin, tenantId, tenantName, generatedBy = null } = args;
  const cleanVin = vin.toUpperCase().trim();

  // Fetch every table in parallel. Each query is tenant-scoped via
  // RLS at the DB layer; the .eq("vin", ...) filter narrows by VIN.
  const [
    listings,
    vehicleFile,
    addendums,
    signings,
    prep,
    deals,
    audits,
    archive,
    // Wave 22 — three new dimensions in the packet:
    getReady,           // installer photos + signatures (Wave 17)
    advertisedPrices,   // full history of advertised snapshots (Wave 20)
    installProofs,      // verified installer sign-offs (signature + photo)
  ] = await Promise.all([
    supabase.from("vehicle_listings").select("*").eq("vin", cleanVin).order("created_at", { ascending: false }).limit(20),
    supabase.from("vehicle_files").select("*").eq("vin", cleanVin).limit(5),
    supabase.from("addendums").select("*").eq("vehicle_vin", cleanVin).order("created_at", { ascending: false }).limit(50),
    supabase.from("addendum_signings").select("*").eq("vin", cleanVin).order("signed_at", { ascending: false }).limit(50),
    supabase.from("prep_sign_offs").select("*").eq("vin", cleanVin).order("created_at", { ascending: false }).limit(20),
    supabase.from("deal_signing_tokens").select("*").or(`vehicle_payload->>vin.eq.${cleanVin}`).order("created_at", { ascending: false }).limit(20),
    supabase.from("audit_log").select("*").or(`details->>vin.eq.${cleanVin}`).order("created_at", { ascending: false }).limit(500),
    supabase.from("signed_document_archive").select("*").eq("vin", cleanVin).order("created_at", { ascending: false }).limit(50),
    supabase.from("get_ready_records").select("*").eq("vin", cleanVin).order("updated_at", { ascending: false }).limit(5),
    supabase.from("advertised_prices").select("*").eq("vin", cleanVin).order("captured_at", { ascending: false }).limit(100),
    supabase.from("install_proofs").select("*").eq("vehicle_vin", cleanVin).order("created_at", { ascending: false }).limit(50),
  ]);

  // Live NHTSA recall snapshot — taken at packet time, included
  // so the dealer can show "at the moment of this export, NHTSA
  // returned X recalls / do-not-drive = false."
  let recall: unknown = null;
  try {
    const { data } = await supabase.functions.invoke("nhtsa-recall", { body: { vin: cleanVin } });
    recall = data ?? null;
  } catch {
    recall = { error: "recall lookup failed at packet time" };
  }

  const rows = (x: { data: unknown[] | null }) => (x?.data ?? []) as unknown[];

  // Pull arrays out so the manifest counts are honest and the
  // summary stats below have something to read.
  const listingRows = rows(listings);
  const vehicleFileRow = rows(vehicleFile)[0] ?? null;
  const addendumRows = rows(addendums) as Array<{ status?: string }>;
  const signingRows = rows(signings) as Array<{ signer_type?: string }>;
  const prepRows = rows(prep) as Array<{ status?: string }>;
  const dealRows = rows(deals) as Array<{ status?: string }>;
  const auditRows = rows(audits);
  const archiveRows = rows(archive);
  const getReadyRows = rows(getReady);
  const advertisedPriceRows = rows(advertisedPrices) as Array<{ advertised_price?: number; source_label?: string; snapshot_at?: string }>;
  const installProofRows = rows(installProofs);

  // Wave 23 — derived Add-On Election Record. For every addendum, we
  // surface per add-on the proof the customer ELECTED it: the price
  // shown, whether it was disclosed optional, the benefit text, and
  // the affirmative selection (optional accept/decline) or initials
  // captured at signing. Derived from the addendum rows already
  // fetched — read-only, no extra query, no impact on the deal flow.
  const addonElections = (addendumRows as Array<Record<string, unknown>>)
    .map((a) => {
      const products = Array.isArray(a.products_snapshot) ? (a.products_snapshot as Array<Record<string, unknown>>) : [];
      const optional = (a.optional_selections ?? {}) as Record<string, string>;
      const inits = (a.initials ?? {}) as Record<string, string>;
      const items = products.map((p) => {
        const id = String(p.id ?? "");
        const isOptional = p.badge_type === "optional";
        // An installed accessory priced above the advertised price
        // (price_in_advertised === false) is electable like an optional
        // add-on: its proof is the affirmative Accept, not just an initial.
        // An installed accessory included in the advertised price is
        // acknowledged with an initial.
        const priceInAdvertised = (p as { price_in_advertised?: boolean }).price_in_advertised !== false;
        const aboveAdvertised = p.badge_type === "installed" && !priceInAdvertised;
        const electable = isOptional || aboveAdvertised;
        const initialed = !!(inits[id] && String(inits[id]).trim());
        const accepted = optional[id] === "accept";
        const elected = electable ? accepted : initialed;
        const category = isOptional
          ? "optional"
          : aboveAdvertised
            ? "added_above_advertised"
            : "included_in_advertised";
        return {
          product_id: id,
          name: String(p.name ?? ""),
          price: typeof p.price === "number" ? p.price : null,
          category,
          above_advertised: aboveAdvertised,
          requires_election: electable,
          disclosed_optional: isOptional,
          benefit_justification: String((p as { benefit_justification?: string }).benefit_justification ?? ""),
          elected,
          acknowledgment: electable ? (optional[id] ?? "none") : (initialed ? "initialed" : "none"),
        };
      });
      const aboveAdvertisedItems = items.filter((i) => i.above_advertised);
      return {
        addendum_id: (a.id as string) ?? null,
        customer_name: (a.customer_name as string) ?? null,
        signed_at: (a.customer_signed_at as string) ?? null,
        content_hash: (a.content_hash as string) ?? null,
        item_count: items.length,
        elected_count: items.filter((i) => i.elected).length,
        // Above-advertised upcharges are the highest-scrutiny lines — a
        // regulator wants to see each was affirmatively elected, and the
        // exact dollar amount charged over the advertised price.
        above_advertised_count: aboveAdvertisedItems.length,
        above_advertised_elected_count: aboveAdvertisedItems.filter((i) => i.elected).length,
        above_advertised_elected_total: aboveAdvertisedItems
          .filter((i) => i.elected)
          .reduce((s, i) => s + (i.price ?? 0), 0),
        items,
      };
    })
    .filter((e) => e.item_count > 0);

  // Hash each section. Order matters for chain root — keep stable.
  // Wave 22 appends sections 10 + 11; do NOT reorder existing
  // names or every chain root quoted in past correspondence
  // becomes orphan.
  const sectionOrder: { name: string; data: unknown }[] = [
    { name: "01-vehicle-file",  data: vehicleFileRow },
    { name: "02-listings",      data: listingRows },
    { name: "03-addendums",     data: addendumRows },
    { name: "04-signings",      data: signingRows },
    { name: "05-prep-sign-offs", data: prepRows },
    { name: "06-deal-jackets",  data: dealRows },
    { name: "07-recall-snapshot", data: recall },
    { name: "08-audit-log",     data: auditRows },
    { name: "09-archive",       data: archiveRows },
    { name: "10-get-ready",     data: getReadyRows },
    { name: "11-advertised-prices", data: advertisedPriceRows },
    { name: "12-addon-elections", data: addonElections },
    { name: "13-install-proofs", data: installProofRows },
  ];

  const sections: AuditPacketSection[] = [];
  for (const s of sectionOrder) {
    sections.push(await hashSection(s.name, s.data));
  }

  // Chain root: hash of the sorted (name, hash) list. Any change
  // to any included artifact changes the section hash, which
  // changes this root.
  const chainPayload = canonical(
    sections.map(s => ({ name: s.name, sha256: s.sha256 }))
  );
  const chainRoot = await sha256Hex(chainPayload);

  // Recall summary fields are best-effort; the snapshot shape is
  // controlled by the nhtsa-recall edge function and may change.
  const recallObj = (recall ?? {}) as { recalls?: unknown[]; do_not_drive?: boolean };
  const openRecallCount = Array.isArray(recallObj.recalls) ? recallObj.recalls.length : 0;
  const doNotDrive = !!recallObj.do_not_drive;

  const manifest: AuditPacketManifest = {
    version: VERSION,
    vin: cleanVin,
    tenant: { id: tenantId, name: tenantName },
    generated_at: new Date().toISOString(),
    generated_by: generatedBy,
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "server",
    sections: sections.map(s => ({ name: s.name, count: s.count, sha256: s.sha256 })),
    chain_root: chainRoot,
  };

  return {
    manifest,
    sections,
    summary: {
      has_listing: listingRows.length > 0,
      addendum_count: addendumRows.length,
      signed_addendum_count: addendumRows.filter(a => a.status === "signed").length,
      customer_signing_count: signingRows.filter(s => s.signer_type === "customer" || s.signer_type === "cobuyer").length,
      prep_signoff_count: prepRows.length,
      signed_prep_count: prepRows.filter(p => p.status === "signed").length,
      deal_token_count: dealRows.length,
      signed_deal_count: dealRows.filter(d => d.status === "signed").length,
      audit_event_count: auditRows.length,
      archived_document_count: archiveRows.length,
      has_vehicle_file: !!vehicleFileRow,
      has_recall_snapshot: recall !== null && !(recall as { error?: string }).error,
      open_recall_count: openRecallCount,
      do_not_drive: doNotDrive,
      // Wave 22 — install-photo + signature aggregates across
      // every accessory on every get-ready record for this VIN.
      install_photo_count: (getReadyRows as any[]).reduce((sum: number, r: any) => {
        const accs = (r?.accessories_to_install || []) as Array<{ install_photos?: string[] }>;
        return sum + accs.reduce((s, a) => s + ((a.install_photos || []).length), 0);
      }, 0),
      install_signature_count: (getReadyRows as any[]).reduce((sum: number, r: any) => {
        const accs = (r?.accessories_to_install || []) as Array<{ installer_signature_data?: string }>;
        return sum + accs.filter(a => !!a.installer_signature_data).length;
      }, 0),
      advertised_price_snapshot_count: advertisedPriceRows.length,
      latest_advertised_price: advertisedPriceRows[0]?.advertised_price ?? null,
      latest_advertised_source: advertisedPriceRows[0]?.source_label ?? null,
    },
  };
}
