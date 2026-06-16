import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useAuth } from "@/contexts/AuthContext";
import { getStateCompliance, FEDERAL_DISCLOSURES, FTC_BUYERS_GUIDE_SYSTEMS } from "@/data/stateCompliance";
import { supabase } from "@/integrations/supabase/client";
import Logo from "@/components/brand/Logo";
import { toast } from "sonner";
import { ShieldCheck, FileText, Scale, Building2, AlertTriangle, CheckCircle2, BookOpen, Gavel, Users, Globe, Search, Download, FileSignature, Wrench, Car, ScrollText, FileArchive } from "lucide-react";
import { buildAuditPacket } from "@/lib/auditPacket";
import { downloadPacketHtml } from "@/lib/auditPacketRenderer";
import PriceIntegrityPanel from "@/components/admin/PriceIntegrityPanel";

// ──────────────────────────────────────────────────────────────
// Compliance packet — the regulator-defense surface. Given a VIN,
// pulls every signed artifact (addendums, prep sign-offs, deal
// signings, vehicle listings, audit events) and exports a single
// JSON bundle the dealer can hand to counsel, AG, or FTC staff.
//
// Queries are tenant-scoped via RLS; admins with cross-tenant
// access see everything on the same VIN.
// ──────────────────────────────────────────────────────────────

interface CompliancePacket {
  query: { vin: string; at: string };
  tenant: { id: string | null; name: string | null };
  vehicle_listings: unknown[];
  addendums: unknown[];
  prep_sign_offs: unknown[];
  deal_signing_tokens: unknown[];
  audit_events: unknown[];
  signed_document_archive: unknown[];
  summary: {
    listing_count: number;
    addendum_count: number;
    signed_addendum_count: number;
    prep_signoff_count: number;
    signed_prep_count: number;
    deal_token_count: number;
    signed_deal_count: number;
    audit_event_count: number;
    archived_document_count: number;
  };
}

const useCompliancePacket = () => {
  const [packet, setPacket] = useState<CompliancePacket | null>(null);
  const [loading, setLoading] = useState(false);

  const lookup = async (vin: string, tenantId: string | null, tenantName: string | null) => {
    if (!vin || vin.length < 11) {
      toast.error("Enter at least 11 characters of a VIN");
      return;
    }
    setLoading(true);
    setPacket(null);
    const clean = vin.toUpperCase().trim();
    try {
      const [listings, addendums, prep, deals, audits, archive] = await Promise.all([
        (supabase as any)
          .from("vehicle_listings")
          .select("*")
          .eq("vin", clean)
          .order("created_at", { ascending: false })
          .limit(20),
        (supabase as any)
          .from("addendums")
          .select("*")
          .eq("vehicle_vin", clean)
          .order("created_at", { ascending: false })
          .limit(50),
        (supabase as any)
          .from("prep_sign_offs")
          .select("*")
          .eq("vin", clean)
          .order("created_at", { ascending: false })
          .limit(20),
        (supabase as any)
          .from("deal_signing_tokens")
          .select("*")
          .or(`vehicle_payload->>vin.eq.${clean}`)
          .order("created_at", { ascending: false })
          .limit(20),
        (supabase as any)
          .from("audit_log")
          .select("*")
          .or(`details->>vin.eq.${clean}`)
          .order("created_at", { ascending: false })
          .limit(200),
        (supabase as any)
          .from("signed_document_archive")
          .select("*")
          .eq("vin", clean)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      const rows = (x: { data: unknown[] | null }) => x.data || [];
      const lA = rows(addendums) as Array<{ status?: string }>;
      const lP = rows(prep) as Array<{ status?: string }>;
      const lD = rows(deals) as Array<{ status?: string }>;
      const next: CompliancePacket = {
        query: { vin: clean, at: new Date().toISOString() },
        tenant: { id: tenantId, name: tenantName },
        vehicle_listings: rows(listings),
        addendums: lA,
        prep_sign_offs: lP,
        deal_signing_tokens: lD,
        audit_events: rows(audits),
        signed_document_archive: rows(archive),
        summary: {
          listing_count: rows(listings).length,
          addendum_count: lA.length,
          signed_addendum_count: lA.filter((x) => x.status === "signed").length,
          prep_signoff_count: lP.length,
          signed_prep_count: lP.filter((x) => x.status === "signed").length,
          deal_token_count: lD.length,
          signed_deal_count: lD.filter((x) => x.status === "signed").length,
          audit_event_count: rows(audits).length,
          archived_document_count: rows(archive).length,
        },
      };
      setPacket(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  };

  const download = () => {
    if (!packet) return;
    const blob = new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-packet-${packet.query.vin}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Compliance packet downloaded");
  };

  return { packet, loading, lookup, download };
};

const CompliancePacketPanel = ({
  tenantId,
  tenantName,
}: {
  tenantId: string | null;
  tenantName: string | null;
}) => {
  const [searchParams] = useSearchParams();
  const [vin, setVin] = useState(() =>
    (searchParams.get("vin") || "").toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/gi, "").slice(0, 17),
  );
  const { packet, loading, lookup, download } = useCompliancePacket();
  const { user } = useAuth();
  const [buildingAudit, setBuildingAudit] = useState(false);
  const [chainRoot, setChainRoot] = useState<string | null>(null);

  // Wave 15.3 — when /compliance?vin=<vin> is hit (e.g. from
  // the Inventory "Defend this VIN" row action), auto-trigger
  // the packet lookup so the dealer lands on the receipt
  // instead of a search box. Fires once per matching URL.
  useEffect(() => {
    const qVin = (searchParams.get("vin") || "").toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/gi, "");
    if (qVin && qVin.length >= 11 && !packet && !loading) {
      lookup(qVin, tenantId, tenantName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Wave 14.1 — Audit-Defense Packet. Pulls the full artifact
  // set + live NHTSA recall snapshot, hashes every section, and
  // downloads a self-contained HTML document ready for production
  // to counsel / AG / FTC. Distinct from the raw JSON export
  // above (which stays useful for engineering / forensics).
  const buildAndDownloadAuditPacket = async () => {
    if (!packet) return;
    setBuildingAudit(true);
    setChainRoot(null);
    try {
      const built = await buildAuditPacket({
        supabase: supabase as any,
        vin: packet.query.vin,
        tenantId,
        tenantName,
        generatedBy: user?.email || null,
      });
      setChainRoot(built.manifest.chain_root);
      downloadPacketHtml(built);
      toast.success("Audit-defense packet downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Audit packet build failed");
    } finally {
      setBuildingAudit(false);
    }
  };

  const counts = packet?.summary;

  const cards = useMemo(
    () => [
      { key: "listing_count",           label: "Vehicle listings",     icon: Car,           hint: "rows in vehicle_listings" },
      { key: "signed_addendum_count",   label: "Signed addendums",     icon: FileSignature, hint: "status = signed" },
      { key: "signed_prep_count",       label: "Signed prep sign-offs", icon: Wrench,       hint: "foreman signed" },
      { key: "signed_deal_count",       label: "Signed deals",         icon: FileText,      hint: "deal jackets completed" },
      { key: "archived_document_count", label: "Archived documents",   icon: ScrollText,    hint: "PDF/JSON in cold storage" },
      { key: "audit_event_count",       label: "Audit events",         icon: ShieldCheck,   hint: "immutable event log" },
    ] as const,
    []
  );

  return (
    <div className="space-y-4">
      <div className="shimmer-hero relative overflow-hidden rounded-2xl px-6 py-6 text-white">
        <div className="relative z-10 space-y-3">
          <div className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-label">
            <ShieldCheck className="w-3 h-3" />
            Compliance Packet
          </div>
          <h2 className="text-2xl font-black tracking-tight font-display">
            Pull every signed artifact for a VIN.
          </h2>
          <p className="text-xs text-white/75 max-w-2xl">
            Enter a VIN below. We return every vehicle listing, addendum signature,
            prep sign-off, deal jacket, audit event, and archived document on record
            — signed, timestamped, exportable as a single JSON bundle for counsel,
            state AG, or FTC review.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              lookup(vin, tenantId, tenantName);
            }}
            className="flex items-stretch gap-2"
          >
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/60" />
              <input
                value={vin}
                onChange={(e) => setVin(e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/gi, ""))}
                placeholder="17-character VIN"
                maxLength={17}
                autoComplete="off"
                autoCapitalize="characters"
                className="w-full h-11 pl-10 pr-3 rounded-lg bg-white/15 backdrop-blur border border-white/20 text-white placeholder:text-white/50 font-mono tracking-widest focus:outline-none focus:bg-white/25"
              />
            </div>
            <button
              type="submit"
              disabled={loading || vin.length < 11}
              className="h-11 px-5 rounded-lg bg-white text-[#0B2041] font-display font-black text-sm inline-flex items-center gap-1.5 disabled:opacity-50 hover:brightness-95 transition-all whitespace-nowrap"
            >
              {loading ? "Searching…" : "Search"}
            </button>
          </form>
        </div>
      </div>

      {packet && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            {cards.map((c) => (
              <div key={c.key} className="rounded-xl border border-border bg-card p-3">
                <c.icon className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="mt-1 text-2xl font-black tabular-nums text-foreground">
                  {counts?.[c.key as keyof typeof counts] ?? 0}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-label text-muted-foreground mt-0.5">
                  {c.label}
                </p>
                <p className="text-[10px] text-muted-foreground/70">{c.hint}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-bold text-foreground">
                  Packet ready for <span className="font-mono">{packet.query.vin}</span>
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Pulled {new Date(packet.query.at).toLocaleString()} · Tenant: {packet.tenant.name || "—"}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={buildAndDownloadAuditPacket}
                  disabled={buildingAudit}
                  className="h-10 px-4 rounded-lg bg-gradient-to-r from-[#3BB4FF] to-[#1E90FF] text-white font-display font-black text-sm inline-flex items-center gap-1.5 shadow-premium hover:brightness-110 disabled:opacity-60"
                  title="Self-contained, hash-chained HTML packet for counsel / AG / FTC"
                >
                  <FileArchive className="w-4 h-4 stroke-[2.5]" />
                  {buildingAudit ? "Building…" : "Audit-Defense Packet (HTML)"}
                </button>
                <button
                  onClick={download}
                  className="h-10 px-4 rounded-lg border border-border bg-card text-foreground text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-muted"
                  title="Raw JSON bundle — engineering / forensics use"
                >
                  <Download className="w-4 h-4" />
                  Download JSON
                </button>
              </div>
            </div>
            {chainRoot && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-900">
                <p className="font-semibold uppercase tracking-[0.14em] text-[9px] text-emerald-800">
                  SHA-256 chain root · last audit packet
                </p>
                <code className="block mt-0.5 font-mono break-all text-[11px]">{chainRoot}</code>
                <p className="mt-1 text-[10px] text-emerald-800/80">
                  Quote this hash verbatim in any production. Any change to any
                  included artifact changes this root.
                </p>
              </div>
            )}
            <details className="group">
              <summary className="text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground">
                Preview raw packet contents ({Math.round(JSON.stringify(packet).length / 1024)} KB)
              </summary>
              <pre className="mt-2 text-[10px] font-mono bg-muted/40 rounded-md p-3 max-h-80 overflow-auto whitespace-pre-wrap break-words">
                {JSON.stringify(packet, null, 2)}
              </pre>
            </details>
            {(counts?.signed_addendum_count || 0) === 0 &&
             (counts?.signed_prep_count || 0) === 0 &&
             (counts?.signed_deal_count || 0) === 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <div>
                  <strong>No signed artifacts on record for this VIN.</strong> If you
                  expected signatures here, check that the VIN was entered correctly,
                  confirm your tenant scope includes this vehicle, and that signing
                  links were actually completed by the customer.
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

const ComplianceCenter = () => {
  const { currentStore, tenant } = useTenant();
  const { settings } = useDealerSettings();
  const dealerState = currentStore?.state || settings.doc_fee_state || "";
  const compliance = getStateCompliance(dealerState);
  const storeName = currentStore?.name || settings.dealer_name || "Your Dealership";

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-8">
      {/* Compliance packet — VIN lookup + export */}
      <CompliancePacketPanel
        tenantId={tenant?.id || null}
        tenantName={tenant?.name || null}
      />

      {/* Advertised-vs-sticker price reconciliation (nightly crawl feeds this) */}
      <PriceIntegrityPanel />

      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="w-5 h-5 text-blue-600" />
          <h1 className="text-2xl font-semibold tracking-tight font-display text-foreground">Compliance Knowledge Center</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          This guide explains every disclosure, requirement, and best practice built into your addendum platform.
          Every dealer employee should read and understand these requirements. They are not optional — they are the law.
        </p>
      </div>

      {/* Your state */}
      {dealerState && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="w-4 h-4 text-blue-700" />
            <h2 className="text-sm font-semibold text-blue-900">Your Dealership: {storeName}</h2>
          </div>
          <p className="text-xs text-blue-800">
            State: <strong>{compliance.stateName || dealerState}</strong> · Doc fee terminology: <strong>{compliance.docFeeTerminology}</strong>
            {compliance.docFeeMaxCap !== null && <> · Max cap: <strong>${compliance.docFeeMaxCap}</strong></>}
            {compliance.carsActState && <> · <span className="text-amber-700 font-bold">California SB 766 applies (eff. Oct 1, 2026)</span></>}
          </p>
        </div>
      )}

      {/* Section 1: Why compliance matters */}
      <Section icon={Scale} title="Why This Matters" id="why">
        <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
          <p>In 2024-2026, the Federal Trade Commission and state Attorneys General have aggressively enforced consumer protection laws against auto dealers. Settlements have reached <strong>$78 million</strong> (Maryland, April 2026), <strong>$20 million</strong> (Illinois, December 2024), and <strong>$2.6 million</strong> (Arizona, August 2024) — all for deceptive add-on and pricing practices.</p>
          <p>This platform is built to protect your dealership by ensuring every sticker, every addendum, and every customer interaction complies with federal and state law. Every disclosure you see on your addendums is there for a legal reason.</p>
          <p>Our goal: <strong>No dealer using this platform should ever face an FTC enforcement action or state AG investigation for their addendum practices.</strong></p>
        </div>
      </Section>

      {/* Section 2: The two documents */}
      <Section icon={FileText} title="Understanding Your Documents" id="documents">
        <div className="grid md:grid-cols-2 gap-4">
          <Card title="Window Sticker (On the Vehicle)" color="blue">
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li><Check /> Goes on the actual vehicle window</li>
              <li><Check /> Shows dealer logo, vehicle info, equipment, pricing</li>
              <li><Check /> Informational only — no signatures needed</li>
              <li><Check /> Contains a QR code linking to the legal addendum</li>
              <li><Check /> Does NOT contain full FTC disclosures</li>
              <li><Check /> Customer can review it at their own pace on the lot</li>
            </ul>
          </Card>
          <Card title="Legal Addendum (At the Desk)" color="emerald">
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li><Check /> The compliance document — this is what protects you legally</li>
              <li><Check /> Full FTC and state disclosures</li>
              <li><Check /> Customer must initial EVERY product</li>
              <li><Check /> Customer must accept or decline EVERY optional item</li>
              <li><Check /> Requires customer + employee signatures</li>
              <li><Check /> Timestamped, audit-logged, immutable record</li>
              <li><Check /> Financing impact disclosure (cost over loan life)</li>
              <li><Check /> Window sticker matching acknowledgment</li>
            </ul>
          </Card>
        </div>
      </Section>

      {/* Section 3: Federal requirements */}
      <Section icon={Globe} title="Federal Requirements" id="federal">
        <SubSection title="FTC Used Car Rule (16 CFR § 455)">
          <p className="text-xs text-muted-foreground mb-3">Applies to any dealer selling 5+ used vehicles in 12 months. Requires a Buyers Guide on every used vehicle.</p>
          <div className="space-y-2">
            <Requirement req="Buyers Guide must be displayed on every used vehicle" status="built" />
            <Requirement req="Must show: year, make, model, VIN, mileage at time of sale" status="built" />
            <Requirement req="Must disclose warranty status: As-Is, Implied, or Warranty" status="built" />
            <Requirement req="Must list covered systems if warranty offered" status="built" />
            <Requirement req='Must state "Spoken promises are difficult to enforce"' status="built" />
            <Requirement req='Must state "Ask to have this vehicle inspected by your mechanic"' status="built" />
            <Requirement req="Minimum size: 11 inches × 7¼ inches" status="built" />
            <Requirement req="100% black ink on white stock" status="built" />
            <Requirement req="No logos or symbols allowed on the Buyers Guide" status="built" />
            <Requirement req="Fine: $16,000 per violation" status="info" />
          </div>
        </SubSection>

        <SubSection title="Monroney Act (New Cars)">
          <p className="text-xs text-muted-foreground mb-3">The factory window sticker must remain on the vehicle until sold. Federal law prohibits dealers from removing or modifying it. Our addendum is a SEPARATE document.</p>
          <div className="space-y-2">
            <Requirement req="Factory Monroney sticker must not be removed or modified" status="built" />
            <Requirement req="Dealer addendum clearly labeled as separate from factory sticker" status="built" />
            <Requirement req="Dealer accessories itemized separately with pricing" status="built" />
          </div>
        </SubSection>

        <SubSection title="Express, Informed Consent">
          <p className="text-xs text-muted-foreground mb-3">Before charging for ANY add-on, the customer must give clear consent after seeing what it costs — including over the life of the loan.</p>
          <div className="space-y-2">
            <Requirement req="Customer must initial each product" status="built" />
            <Requirement req="Customer must accept or decline each optional product" status="built" />
            <Requirement req="Financing impact shown (cost over 48/60/72 month terms)" status="built" />
            <Requirement req="Products clearly marked as installed vs. optional" status="built" />
            <Requirement req="No product may be charged without affirmative consent" status="built" />
          </div>
        </SubSection>
      </Section>

      {/* Section 4: State requirements */}
      {dealerState && (
        <Section icon={Building2} title={`${compliance.stateName || dealerState} State Requirements`} id="state">
          {compliance.docFeeDisclosures.length > 0 && (
            <SubSection title={`${compliance.docFeeTerminology} Disclosures`}>
              <div className="space-y-2">
                {compliance.docFeeDisclosures.map((d, i) => (
                  <Requirement key={i} req={d} status="built" />
                ))}
              </div>
            </SubSection>
          )}

          {compliance.carsActState && (
            <SubSection title="California SB 766">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-800 font-medium">Effective October 1, 2026. This is the most comprehensive state-level auto dealer disclosure law in the country.</p>
                </div>
              </div>
              <div className="space-y-2">
                <Requirement req="12-point bold type headings on disclosures" status="built" />
                <Requirement req="10-point bold body text on disclosures" status="built" />
                <Requirement req="Disclosures circumscribed by a line above signature" status="built" />
                <Requirement req="Multi-language: Spanish, Chinese, Tagalog, Vietnamese, Korean" status="built" />
                <Requirement req="10-day post-sale window for optional add-on purchases" status="built" />
                <Requirement req="Prohibition on no-benefit add-ons (nitrogen < 95%, etc.)" status="built" />
                <Requirement req="2-year minimum record retention" status="built" />
              </div>
            </SubSection>
          )}
        </Section>
      )}

      {/* Section 5: Best practices */}
      <Section icon={BookOpen} title="Best Practices" id="best-practices">
        <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
          <BestPractice num="01" title="Never surprise the customer">
            Every product and every charge should be visible on the window sticker BEFORE the customer sits down.
            The addendum signing should confirm what they already saw — not introduce new items.
          </BestPractice>
          <BestPractice num="02" title="Always explain the difference between installed and optional">
            Pre-installed items cannot be removed. Optional items can be declined with zero impact on the deal.
            Make this crystal clear every time.
          </BestPractice>
          <BestPractice num="03" title="Never pressure on optional products">
            The FTC and state AGs are specifically targeting dealers who make customers feel they must accept optional products.
            "Declining will not affect your financing" is not just a disclosure — it must be true.
          </BestPractice>
          <BestPractice num="04" title="Keep every record">
            Every addendum, every signature, every timestamp. This platform retains everything automatically.
            If an AG or the FTC comes asking, your records are ready.
          </BestPractice>
          <BestPractice num="05" title="Have your attorney review your disclosures">
            This platform provides industry-standard FTC-compliant disclosures. But YOUR attorney should review them
            for your specific state and business. You can customize any disclosure through the admin panel.
          </BestPractice>
        </div>
      </Section>

      {/* Section 6: Dealer legal sign-off */}
      {/* FTC Buyers Guide Rules */}
      <Section icon={FileText} title="FTC Buyers Guide — The Rules" id="buyers-guide-rules">
        <SubSection title="What the Law Requires">
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            Under <strong>16 CFR § 455</strong> (the FTC Used Car Rule), every dealer selling 5 or more used
            vehicles in a 12-month period must display a Buyers Guide on every used vehicle offered for sale.
            This applies to vehicles on your lot, consignment vehicles, off-site sales events, and auctions open to consumers.
          </p>
          <div className="space-y-2">
            <Requirement req="Must be displayed on EVERY used vehicle (GVWR under 8,500 lbs, curb weight under 6,000 lbs)" status="built" />
            <Requirement req="Must show: year, make, model, VIN, and mileage at time of sale" status="built" />
            <Requirement req="Must disclose warranty status: As-Is, Implied Warranties Only, or Dealer Warranty" status="built" />
            <Requirement req='Must include: "Spoken promises are difficult to enforce. Ask the dealer to put all promises in writing."' status="built" />
            <Requirement req='Must include: "Ask to have this vehicle inspected by your mechanic either on or off the lot."' status="built" />
            <Requirement req="Must list major mechanical and electrical systems and potential problems" status="built" />
            <Requirement req="Must disclose service contract availability" status="built" />
            <Requirement req="Spanish version required if negotiation is conducted in Spanish" status="built" />
          </div>
        </SubSection>

        <SubSection title="Can You Print Your Own?">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-3">
            <p className="text-xs text-emerald-900 font-medium">
              <strong>YES.</strong> The FTC does NOT require you to use their official printed form.
              You can generate your own Buyers Guide on a computer, print it yourself, or get it from
              any supplier — as long as you match the EXACT specifications.
            </p>
          </div>
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            This platform generates FTC-compliant Buyers Guides that match all requirements.
            However, you must ensure:
          </p>
          <div className="space-y-2">
            <Requirement req="100% black ink on white stock (no colored ink for the form itself)" status="built" />
            <Requirement req="Minimum size: 11 inches high × 7¼ inches wide" status="built" />
            <Requirement req="Exact wording as specified in 16 CFR § 455 appendix figures" status="built" />
            <Requirement req="Exact type style and type sizes as shown in the FTC model" status="built" />
            <Requirement req="Exact format and layout matching the FTC model" status="built" />
            <Requirement req="NO logos, dealer branding, or other symbols anywhere on the form" status="built" />
            <Requirement req="Both sides must be readable when displayed" status="built" />
          </div>
        </SubSection>

        <SubSection title="Penalties">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-xs text-red-900 font-medium">
              <strong>$16,000 per violation.</strong> Each vehicle without a proper Buyers Guide is a separate violation.
              A lot with 50 cars missing guides could face $800,000 in fines.
            </p>
          </div>
        </SubSection>

        <SubSection title="Contract Integration">
          <p className="text-xs text-muted-foreground leading-relaxed">
            The FTC requires the following clause in every sales contract: <em>"The information you see
            on the window form for this vehicle is part of this contract. Information on the window form
            overrides any contrary provisions in the contract of sale."</em> This platform automatically
            generates this clause for inclusion in your deal jacket.
          </p>
        </SubSection>
      </Section>

      {/* Pricing Format Rules */}
      <Section icon={Scale} title="Pricing Format — New vs. Used" id="pricing-rules">
        <SubSection title="New Car Addendum Pricing">
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            The factory Monroney sticker (required by the Automobile Information Disclosure Act of 1958)
            must remain on the vehicle until sold. Federal law prohibits removing or modifying it.
            Your dealer addendum is a SEPARATE document that sits alongside the Monroney.
          </p>
          <div className="bg-card rounded-lg border border-border p-3 font-mono text-xs space-y-1">
            <div className="flex justify-between"><span>Manufacturer's Suggested Retail Price (MSRP)</span><span>$32,500.00</span></div>
            <div className="flex justify-between text-muted-foreground"><span>Paint Protection Film</span><span>$995.00</span></div>
            <div className="flex justify-between text-muted-foreground"><span>Ceramic Coating</span><span>$799.00</span></div>
            <div className="flex justify-between text-muted-foreground"><span>Window Tint</span><span>$399.00</span></div>
            <div className="flex justify-between text-muted-foreground"><span>Documentation Fee</span><span>$499.00</span></div>
            <div className="flex justify-between border-t-2 border-foreground pt-1 font-bold"><span>TOTAL SUGGESTED RETAIL PRICE</span><span>$35,192.00</span></div>
          </div>
        </SubSection>

        <SubSection title="Used Car Addendum Pricing">
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            Used vehicles start with market value (not MSRP). Accessories are added to the market value.
            The total reflects what the customer will pay for the vehicle with all dealer additions.
          </p>
          <div className="bg-card rounded-lg border border-border p-3 font-mono text-xs space-y-1">
            <div className="flex justify-between"><span>Market Value</span><span>$18,900.00</span></div>
            <div className="flex justify-between text-muted-foreground"><span>Paint Protection Film</span><span>$995.00</span></div>
            <div className="flex justify-between text-muted-foreground"><span>Theft Deterrent System</span><span>$499.00</span></div>
            <div className="flex justify-between text-muted-foreground"><span>Documentation Fee</span><span>$499.00</span></div>
            <div className="flex justify-between border-t-2 border-foreground pt-1 font-bold"><span>TOTAL PRICE</span><span>$20,893.00</span></div>
          </div>
        </SubSection>
      </Section>

      {/* FTC March 2026 Warning Letters */}
      <Section icon={AlertTriangle} title="FTC Warning Letters — March 2026" id="ftc-warnings">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-amber-900">97 Dealer Groups Warned by the FTC</h3>
              <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                On March 13, 2026, even after the federal CARS Rule was vacated by the Fifth Circuit,
                the FTC sent warning letters to 97 auto dealership groups across the United States
                regarding their advertising and pricing practices.
              </p>
            </div>
          </div>
        </div>

        <SubSection title="What the FTC Said">
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            The FTC demanded that <strong>advertised vehicle prices reflect the total price consumers
            are actually required to pay</strong>. The letters specifically called out:
          </p>
          <div className="space-y-2 mb-3">
            <Requirement req="Advertising prices that exclude mandatory fees" status="info" />
            <Requirement req="Requiring add-ons not disclosed in advertising" status="info" />
            <Requirement req="Conditioning advertised prices on dealer financing" status="info" />
            <Requirement req="Charging for add-ons without express, informed consent" status="info" />
            <Requirement req="Adding nitrogen tires, VIN etch, paint protection without clear disclosure" status="info" />
          </div>
        </SubSection>

        <SubSection title="Why This Matters Even Though the CARS Rule Was Repealed">
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">
            The CARS Rule was vacated in January 2025 — but the FTC's authority under <strong>Section 5
            of the FTC Act</strong> (prohibiting unfair or deceptive practices) was NOT affected. The March 2026
            letters prove the FTC is actively using Section 5 to enforce the same principles the CARS Rule
            would have codified.
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">
            Additionally, states are filling the gap with their own laws. California's SB 766
            takes effect October 1, 2026 with even stricter requirements than the vacated federal
            rule would have imposed.
          </p>
          <p className="text-xs text-foreground font-semibold leading-relaxed">
            This is exactly why this platform exists. Whether the requirement comes from federal law,
            state law, or FTC enforcement guidance — your addendums are compliant because we build
            compliance into every document automatically.
          </p>
        </SubSection>

        <SubSection title="Recent Enforcement Settlements">
          <div className="space-y-3">
            <EnforcementCase amount="$78,000,000" parties="FTC + Maryland AG v. Dealer Group" date="April 2026" desc="Systematic deceptive pricing and add-on practices. Largest FTC auto retail settlement in history." />
            <EnforcementCase amount="$20,000,000" parties="FTC + Illinois AG v. Major Dealer" date="December 2024" desc="Deceptive practices in car sales, financing, and product add-ons." />
            <EnforcementCase amount="$2,600,000" parties="FTC + Arizona AG v. Coulter Motor" date="August 2024" desc="Unauthorized nitrogen, tint, etch, paint coating add-ons. Discriminatory pricing to Latino customers." />
            <EnforcementCase amount="$136,000" parties="NJ AG v. Sansone Hyundai" date="September 2024" desc='Charging for aftermarket items listed at "no charge" on contracts.' />
          </div>
        </SubSection>
      </Section>

      {/* Connecticut-specific K-208 */}
      {(dealerState === "CT" || !dealerState) && (
        <Section icon={ShieldCheck} title="Connecticut: Form K-208 Safety Inspection" id="ct-k208">
          <SubSection title="Mandatory for Every Used Vehicle Sale">
            <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
              Under <strong>CGS 14-62(g)</strong>, every Connecticut licensed dealer must complete a safety
              inspection on every used motor vehicle before offering it for retail sale. The inspection
              must be documented on <strong>Form K-208</strong> (CT Licensed Dealer Vehicle Inspection Form).
            </p>
            <div className="space-y-2 mb-3">
              <Requirement req="Inspection must be performed BEFORE offering the vehicle for sale" status="built" />
              <Requirement req="Form K-208 must be completed with all inspection items checked" status="built" />
              <Requirement req="Inspector (service manager) must sign the certification" status="built" />
              <Requirement req="Customer must receive a copy of the completed form" status="built" />
              <Requirement req="Dealer must retain a copy in the deal file" status="built" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-red-700">$500</p>
                <p className="text-[10px] text-red-600 font-medium mt-1">Fine for NOT performing the safety inspection</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-amber-700">$250</p>
                <p className="text-[10px] text-amber-600 font-medium mt-1">Fine for NOT providing customer copy</p>
              </div>
            </div>
          </SubSection>

          <SubSection title="What's Inspected (13 Categories, 60+ Items)">
            <p className="text-xs text-muted-foreground mb-2 leading-relaxed">
              The K-208 covers a comprehensive safety inspection including:
            </p>
            <div className="grid grid-cols-2 gap-1 text-[10px] text-foreground">
              {["Service Brakes", "Parking Brake", "Steering System", "Tires & Wheels",
                "Lights & Signals", "Horn & Mirrors", "Windshield & Wipers", "Exhaust System",
                "Suspension", "Body & Frame", "Safety Equipment", "Fluid Levels & Leaks", "Emissions"
              ].map(cat => (
                <div key={cat} className="flex items-center gap-1.5 py-0.5">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                  <span>{cat}</span>
                </div>
              ))}
            </div>
          </SubSection>
        </Section>
      )}

      {/* Window Sticker vs. Addendum */}
      <Section icon={FileText} title="Window Sticker vs. Signing Addendum" id="sticker-vs-addendum">
        <SubSection title="What Goes Where">
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            The financing impact disclosure, full FTC disclosures, initials, accept/decline, and
            signatures belong on the <strong>signing addendum</strong> — NOT on the window sticker.
            The window sticker is the marketing/pricing document. The addendum is the legal sign-off.
          </p>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs font-bold text-blue-900 mb-2">Window Sticker (On the Car)</p>
              <div className="space-y-1 text-[10px] text-blue-800">
                <p>• Dealer logo & branding</p>
                <p>• Vehicle info + equipment list</p>
                <p>• Pricing: MSRP or Market Value → accessories → total</p>
                <p>• QR code linking to signing addendum</p>
                <p>• NOT: disclosures, signatures, financing impact</p>
              </div>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <p className="text-xs font-bold text-emerald-900 mb-2">Signing Addendum (At the Desk)</p>
              <div className="space-y-1 text-[10px] text-emerald-800">
                <p>• Full FTC + state disclosures</p>
                <p>• Product initials (every product)</p>
                <p>• Accept / Decline for optional items</p>
                <p>• Financing impact over loan life</p>
                <p>• FTC warranty acknowledgment + mileage</p>
                <p>• Window sticker match confirmation</p>
                <p>• Customer + co-buyer + employee signatures</p>
                <p>• Timestamped, audit-logged, immutable</p>
              </div>
            </div>
          </div>
        </SubSection>
      </Section>

      <Section icon={Gavel} title="Dealer Legal Adoption Agreement" id="legal">
        <div className="bg-card rounded-xl border-2 border-foreground p-6 space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            By using this platform, the dealership ("<strong>{storeName}</strong>") acknowledges the following:
          </p>

          <div className="space-y-3 text-xs text-foreground leading-relaxed">
            <p><strong>1. OPPORTUNITY FOR LEGAL REVIEW.</strong> The dealership has been given the opportunity to have its legal counsel review all disclosure language, addendum verbiage, and compliance templates provided by this platform before adoption and use.</p>

            <p><strong>2. CUSTOMIZATION RIGHTS.</strong> The dealership may request modifications to any disclosure language, addendum wording, or compliance template at any time. Requested changes will be reviewed and implemented by the platform provider in a reasonable timeframe.</p>

            <p><strong>3. ADOPTION OF DISCLOSURES.</strong> If the dealership proceeds without requesting changes, the dealership voluntarily adopts all standard disclosure language, addendum templates, and compliance verbiage as its own. The dealership represents that it is satisfied with the content and accuracy of these materials for its jurisdiction and business operations.</p>

            <p><strong>4. DUAL SIGNATURE RECOMMENDATION.</strong> We strongly recommend that both the dealership principal AND the dealership's legal counsel sign this adoption agreement. However, if only the dealership principal signs, the principal acknowledges that they were given the opportunity to involve legal counsel and chose to proceed independently.</p>

            <p><strong>5. NOT LEGAL COUNSEL.</strong> The platform provider is NOT a law firm, does NOT provide legal advice, does NOT offer legal remedies, and does NOT represent the dealership in any legal capacity. This platform provides disclosure language and compliance templates based on industry best practices and current federal and state law research. We highly recommend that every dealership seeks the review and approval of their own legal counsel to verify that all disclosure verbiage, addendum language, and compliance templates are satisfactory for their specific jurisdiction and business operations.</p>

            <p><strong>6. CHANGES & MODIFICATIONS.</strong> Any changes to the verbiage, disclosures, or templates are welcomed. The dealership may submit requested modifications at any time, and the platform provider will make the appropriate changes. Upon implementation of changes, the dealership will be asked to review and re-sign this agreement reflecting the updated language. All prior versions will be retained in the compliance audit trail.</p>

            <p><strong>7. ASSUMPTION OF LIABILITY.</strong> By signing this agreement, the dealership acknowledges that: (a) at the time of signing, they have been given full opportunity to have their own legal counsel review all disclosure language; (b) the dealership places its own liability on the accuracy and appropriateness of the disclosure language used; (c) the platform provider shall not be held liable for any regulatory action, fine, penalty, or legal proceeding resulting from the dealership's use of these templates; (d) if the dealership chose not to have legal counsel review the disclosures, the dealership assumes full responsibility for that decision and its consequences.</p>

            <p><strong>8. STATE-SPECIFIC COMPLIANCE.</strong> The disclosure templates have been configured for the state of <strong>{compliance.stateName || "your state"}</strong> based on our research of current state requirements. State laws change. The dealership is responsible for notifying the platform provider of any changes in state requirements that may affect their disclosures.</p>

            <p><strong>9. RECORD RETENTION.</strong> All signed addendums, customer interactions, and compliance records are retained for a minimum of {compliance.recordRetentionYears} years in accordance with applicable federal and state record retention requirements.</p>
          </div>

          <div className="border-t-2 border-foreground pt-4 mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Dealership Principal</p>
                <div className="border-b-2 border-foreground h-10 mb-1" />
                <p className="text-[9px] text-muted-foreground">Signature</p>
                <div className="border-b border-border-custom h-6 mt-2 mb-1" />
                <p className="text-[9px] text-muted-foreground">Printed Name & Title</p>
                <div className="border-b border-border-custom h-6 mt-2 mb-1" />
                <p className="text-[9px] text-muted-foreground">Date</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Dealership Legal Counsel (Recommended)</p>
                <div className="border-b-2 border-foreground h-10 mb-1" />
                <p className="text-[9px] text-muted-foreground">Signature</p>
                <div className="border-b border-border-custom h-6 mt-2 mb-1" />
                <p className="text-[9px] text-muted-foreground">Printed Name & Firm</p>
                <div className="border-b border-border-custom h-6 mt-2 mb-1" />
                <p className="text-[9px] text-muted-foreground">Date</p>
              </div>
            </div>
            <p className="text-[8px] text-muted-foreground italic">
              If only the dealership principal signs above, the principal acknowledges that they were given
              the full opportunity to have legal counsel review all disclosure language and compliance templates,
              and they chose to proceed without such review. The dealership adopts all standard disclosures as its own.
            </p>
          </div>
        </div>
      </Section>

      {/* Footer */}
      <div className="text-center py-8 border-t border-border">
        <Logo variant="full" size={28} />
        <p className="text-xs text-muted-foreground mt-3">
          This compliance guide is provided for educational purposes. It does not constitute legal advice.
          Always consult with your dealership's legal counsel for jurisdiction-specific guidance.
        </p>
        <p className="text-[10px] text-muted-foreground mt-2">
          Last updated: {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </p>
      </div>
    </div>
  );
};

// Helper components
const Section = ({ icon: Icon, title, id, children }: { icon: typeof ShieldCheck; title: string; id: string; children: React.ReactNode }) => (
  <section id={id} className="scroll-mt-20">
    <div className="flex items-center gap-2 mb-4">
      <Icon className="w-4 h-4 text-blue-600 flex-shrink-0" />
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
    </div>
    {children}
  </section>
);

const SubSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="bg-card rounded-xl border border-border shadow-premium p-5 mb-4">
    <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>
    {children}
  </div>
);

const Card = ({ title, color, children }: { title: string; color: "blue" | "emerald"; children: React.ReactNode }) => (
  <div className={`rounded-xl border p-5 ${color === "blue" ? "border-blue-200 bg-blue-50/50" : "border-emerald-200 bg-emerald-50/50"}`}>
    <h3 className={`text-sm font-semibold mb-3 ${color === "blue" ? "text-blue-900" : "text-emerald-900"}`}>{title}</h3>
    {children}
  </div>
);

const Check = () => <CheckCircle2 className="w-3 h-3 text-emerald-500 inline-block mr-1.5 -mt-0.5 flex-shrink-0" />;

const Requirement = ({ req, status }: { req: string; status: "built" | "info" }) => (
  <div className="flex items-start gap-2 py-1">
    {status === "built" ? (
      <span className="text-[9px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0">BUILT</span>
    ) : (
      <span className="text-[9px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0">INFO</span>
    )}
    <p className="text-xs text-foreground">{req}</p>
  </div>
);

const EnforcementCase = ({ amount, parties, date, desc }: { amount: string; parties: string; date: string; desc: string }) => (
  <div className="bg-card rounded-lg border border-border p-3">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold text-foreground">{parties}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{date} — {desc}</p>
      </div>
      <span className="text-sm font-bold text-red-600 tabular-nums flex-shrink-0">{amount}</span>
    </div>
  </div>
);

const BestPractice = ({ num, title, children }: { num: string; title: string; children: React.ReactNode }) => (
  <div className="bg-card rounded-xl border border-border shadow-premium p-5">
    <div className="flex items-start gap-3">
      <span className="text-xs font-bold text-blue-600 tabular-nums flex-shrink-0">{num}</span>
      <div>
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{children}</p>
      </div>
    </div>
  </div>
);

export default ComplianceCenter;
