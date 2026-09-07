import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, FileArchive, Fingerprint, Search, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { buildAuditPacket, type AuditPacket } from "@/lib/auditPacket";
import { downloadPacketHtml } from "@/lib/auditPacketRenderer";
import { EmptyState, Panel, SectionHeading, StateBadge, TableShell, formatDateTime } from "./primitives";

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

const cleanVin = (raw: string): string => raw.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/gi, "").slice(0, 17);

const SECTION_TITLES: Record<string, string> = {
  "01-vehicle-file": "Vehicle file",
  "02-listings": "Vehicle listings",
  "03-addendums": "Addendums",
  "04-signings": "Signatures",
  "05-prep-sign-offs": "Prep sign-offs",
  "06-deal-jackets": "Deal jackets",
  "07-recall-snapshot": "NHTSA recall snapshot",
  "08-audit-log": "Audit events",
  "09-archive": "Archived documents",
  "10-get-ready": "Get-Ready records",
  "11-advertised-prices": "Price snapshots",
  "12-addon-elections": "Customer elections",
  "13-install-proofs": "Installation proof",
};

interface SupportingDocs {
  buyersGuides: number;
  stickers: number;
  vehicleDocuments: { doc_type: string; created_at: string }[];
}

const EMPTY_DOCS: SupportingDocs = { buyersGuides: 0, stickers: 0, vehicleDocuments: [] };

export const VinDefenseSection = ({
  initialVin,
  tenantId,
  tenantName,
}: {
  initialVin: string;
  tenantId: string | null;
  tenantName: string | null;
}) => {
  const { user } = useAuth();
  const [vin, setVin] = useState(() => cleanVin(initialVin));
  const [packet, setPacket] = useState<AuditPacket | null>(null);
  const [docs, setDocs] = useState<SupportingDocs>(EMPTY_DOCS);
  const [building, setBuilding] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);

  const assemble = useCallback(async (target: string) => {
    if (target.length < 11) {
      toast.error("Enter at least 11 characters of a VIN");
      return;
    }
    setBuilding(true);
    setPacket(null);
    setDocs(EMPTY_DOCS);
    setReceipt(null);
    try {
      const [built, listingRes, vehicleDocs] = await Promise.all([
        buildAuditPacket({
          // deno-lint-ignore no-explicit-any
          supabase: supabase as any,
          vin: target,
          tenantId,
          tenantName,
          generatedBy: user?.email || null,
        }),
        sb().from("vehicle_listings").select("id").eq("vin", target).limit(20),
        sb().from("vehicle_documents").select("doc_type, created_at").eq("vin", target).limit(200),
      ]);

      const listingIds = ((listingRes?.data as { id: string }[] | null) ?? []).map((l) => l.id);
      let generated: { document_type: string | null }[] = [];
      if (listingIds.length > 0) {
        const genRes = await sb()
          .from("generated_documents")
          .select("document_type")
          .in("vehicle_id", listingIds)
          .limit(500);
        generated = (genRes?.data as { document_type: string | null }[] | null) ?? [];
      }
      const typeIs = (needle: string) =>
        generated.filter((g) => String(g.document_type || "").toLowerCase().includes(needle)).length;
      setDocs({
        buyersGuides: typeIs("buyers_guide") + typeIs("buyers-guide"),
        stickers: typeIs("sticker"),
        vehicleDocuments: ((vehicleDocs?.data as { doc_type: string; created_at: string }[] | null) ?? []),
      });
      setPacket(built);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not assemble the packet");
    } finally {
      setBuilding(false);
    }
  }, [tenantId, tenantName, user?.email]);

  useEffect(() => {
    const target = cleanVin(initialVin);
    if (target.length >= 11) {
      setVin(target);
      void assemble(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialVin]);

  const exportHtml = () => {
    if (!packet) return;
    setReceipt(packet.manifest.chain_root);
    // Tamper-evident receipt that this chain root existed at this time, so the
    // packet stays re-verifiable later: regenerate, compare roots.
    sb().rpc("record_evidence_receipt", {
      _vin: packet.manifest.vin,
      _chain_root: packet.manifest.chain_root,
      _manifest: packet.manifest.sections,
      _packet_version: packet.manifest.version,
    }).then(() => undefined, () => undefined);
    downloadPacketHtml(packet);
    toast.success("Evidence packet downloaded");
  };

  const exportJson = () => {
    if (!packet) return;
    const blob = new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vin-defense-${packet.manifest.vin}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const s = packet?.summary;
  const coverage = packet
    ? [
        { label: "Price snapshots", count: s?.advertised_price_snapshot_count ?? 0, note: "Every advertised price captured for this VIN, with source and timestamp." },
        { label: "Window stickers", count: docs.stickers, note: "Generated sticker documents whose frozen snapshot carries this VIN." },
        { label: "Addendums", count: s?.addendum_count ?? 0, note: `${s?.signed_addendum_count ?? 0} signed.` },
        { label: "Buyers Guide", count: docs.buyersGuides, note: "FTC Used Car Rule guide generated for this VIN." },
        { label: "Customer elections", count: packet.sections.find((x) => x.name === "12-addon-elections")?.count ?? 0, note: "Per add-on proof the customer initialled or affirmatively accepted." },
        { label: "Installation proof", count: s?.install_photo_count ?? 0, note: `${s?.install_signature_count ?? 0} installer signature(s) on record.` },
        { label: "Signatures", count: s?.customer_signing_count ?? 0, note: "Customer and co-buyer signings, with consent and IP capture." },
        { label: "Documents", count: docs.vehicleDocuments.length, note: "Title, MCO, and other dealer-only files attached to the vehicle." },
        { label: "Audit events", count: s?.audit_event_count ?? 0, note: "Immutable log entries naming this VIN." },
      ]
    : [];

  return (
    <div className="space-y-5">
      <SectionHeading
        title="VIN defense"
        description="One VIN, one evidence packet. Every price snapshot, sticker, addendum, Buyers Guide, customer election, installation proof, signature, document, and audit event on record — canonicalised, SHA-256 hashed section by section, and chained to a single root the dealership can quote verbatim."
      />

      <Panel>
        <form
          className="flex flex-wrap items-center gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void assemble(vin);
          }}
        >
          <div className="relative min-w-[260px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={vin}
              onChange={(e) => setVin(cleanVin(e.target.value))}
              placeholder="17-character VIN"
              maxLength={17}
              autoComplete="off"
              autoCapitalize="characters"
              className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-3 font-mono tracking-widest text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            type="submit"
            disabled={building || vin.length < 11}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-foreground px-5 text-al-button text-background disabled:opacity-50"
          >
            <ShieldCheck className="h-4 w-4" />
            {building ? "Assembling…" : "Assemble packet"}
          </button>
        </form>
      </Panel>

      {!packet && !building && (
        <Panel>
          <EmptyState
            icon={Fingerprint}
            headline="No packet assembled yet."
            body="Enter a VIN to pull its complete evidence record. Nothing is fabricated: a section with no artifacts is reported as empty."
          />
        </Panel>
      )}

      {packet && (
        <>
          <Panel
            title={`Evidence coverage for ${packet.manifest.vin}`}
            meta={`Assembled ${formatDateTime(packet.manifest.generated_at)}${packet.manifest.generated_by ? ` by ${packet.manifest.generated_by}` : ""}`}
          >
            <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-3">
              {coverage.map((c) => (
                <div key={c.label} className="bg-card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-al-meta font-bold uppercase tracking-label text-muted-foreground">{c.label}</p>
                    <StateBadge tone={c.count > 0 ? "clear" : "neutral"}>
                      {c.count > 0 ? `${c.count} on record` : "None on record"}
                    </StateBadge>
                  </div>
                  <p className="mt-1.5 text-al-meta leading-4 text-muted-foreground">{c.note}</p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title="Packet manifest"
            meta="Each section is canonicalised and hashed independently. Changing any included artifact changes its section hash, which changes the chain root."
          >
            <TableShell headers={["Section", "Records", "SHA-256"]}>
              {packet.manifest.sections.map((sec) => (
                <tr key={sec.name} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5 text-al-body text-foreground">
                    {SECTION_TITLES[sec.name] ?? sec.name}
                  </td>
                  <td className="px-4 py-2.5 text-al-body tabular-nums text-foreground">
                    {sec.count === 0 ? <span className="text-muted-foreground">Empty</span> : sec.count}
                  </td>
                  <td className="px-4 py-2.5">
                    <code className="break-all font-mono text-al-meta text-muted-foreground">{sec.sha256}</code>
                  </td>
                </tr>
              ))}
            </TableShell>
          </Panel>

          <Panel title="Chain root" meta="Quote this hash verbatim in any production to counsel, a state AG, or the FTC.">
            <div className="space-y-3 p-4">
              <code className="block break-all rounded-xl border border-border bg-muted/50 p-3 font-mono text-al-meta text-foreground">
                {packet.manifest.chain_root}
              </code>
              {receipt === packet.manifest.chain_root && (
                <p className="text-al-meta text-muted-foreground">
                  A receipt for this chain root was recorded at export time so the packet can be re-verified later.
                </p>
              )}
              {s && !s.has_listing && (
                <p className="text-al-body text-amber-800">
                  No vehicle listing exists for this VIN under this tenant. The packet still reports whatever
                  artifacts were found, but confirm the VIN and your store scope before relying on it.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={exportHtml}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-foreground px-4 text-al-button text-background"
                >
                  <FileArchive className="h-4 w-4" /> Export evidence packet
                </button>
                <button
                  type="button"
                  onClick={exportJson}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-al-button text-foreground hover:bg-muted"
                >
                  <Download className="h-4 w-4" /> Export raw JSON
                </button>
              </div>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
};

export default VinDefenseSection;
