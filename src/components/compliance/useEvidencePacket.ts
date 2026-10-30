import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { buildAuditPacket, type AuditPacket } from "@/lib/auditPacket";
import { downloadPacketHtml } from "@/lib/auditPacketRenderer";

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

export interface SupportingDocs {
  buyersGuides: number;
  stickers: number;
  vehicleDocuments: { doc_type: string; created_at: string }[];
}

export interface EvidenceReceipt {
  id: string;
  chain_root: string;
  packet_version: string;
  created_at: string;
}

const EMPTY_DOCS: SupportingDocs = { buyersGuides: 0, stickers: 0, vehicleDocuments: [] };

export const SECTION_TITLES: Record<string, string> = {
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

const TIME_KEYS = ["captured_at", "signed_at", "created_at", "updated_at", "at"];

/** Newest timestamp found on the rows of a packet section, or null when the section carries none. */
export const latestSourceTime = (data: unknown): string | null => {
  if (!Array.isArray(data)) return null;
  let best: string | null = null;
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    for (const k of TIME_KEYS) {
      const v = (row as Record<string, unknown>)[k];
      if (typeof v === "string" && !Number.isNaN(Date.parse(v)) && (!best || v > best)) best = v;
    }
  }
  return best;
};

export const useEvidencePacket = (vin: string, tenantId: string | null, tenantName: string | null) => {
  const { user } = useAuth();
  const [packet, setPacket] = useState<AuditPacket | null>(null);
  const [docs, setDocs] = useState<SupportingDocs>(EMPTY_DOCS);
  const [receipts, setReceipts] = useState<EvidenceReceipt[]>([]);
  const [building, setBuilding] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);

  const assemble = useCallback(async () => {
    if (vin.length < 11) return;
    setBuilding(true);
    setPacket(null);
    setDocs(EMPTY_DOCS);
    setReceipt(null);
    try {
      const [built, listingRes, vehicleDocs, receiptRes] = await Promise.all([
        buildAuditPacket({
          // deno-lint-ignore no-explicit-any
          supabase: supabase as any,
          vin,
          tenantId,
          tenantName,
          generatedBy: user?.email || null,
        }),
        sb().from("vehicle_listings").select("id").eq("vin", vin).limit(20),
        sb().from("vehicle_documents").select("doc_type, created_at").eq("vin", vin).limit(200),
        tenantId
          ? sb().from("evidence_receipts").select("id, chain_root, packet_version, created_at").eq("tenant_id", tenantId).eq("vin", vin).order("created_at", { ascending: false }).limit(50)
          : Promise.resolve({ data: [] }),
      ]);
      const listingIds = ((listingRes?.data as { id: string }[] | null) ?? []).map((l) => l.id);
      let generated: { document_type: string | null }[] = [];
      if (listingIds.length > 0) {
        const genRes = await sb().from("generated_documents").select("document_type").in("vehicle_id", listingIds).limit(500);
        generated = (genRes?.data as { document_type: string | null }[] | null) ?? [];
      }
      const typeIs = (needle: string) => generated.filter((g) => String(g.document_type || "").toLowerCase().includes(needle)).length;
      setDocs({
        buyersGuides: typeIs("buyers_guide") + typeIs("buyers-guide"),
        stickers: typeIs("sticker"),
        vehicleDocuments: (vehicleDocs?.data as { doc_type: string; created_at: string }[] | null) ?? [],
      });
      setReceipts((receiptRes?.data as EvidenceReceipt[] | null) ?? []);
      setPacket(built);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not assemble the packet");
    } finally {
      setBuilding(false);
    }
  }, [vin, tenantId, tenantName, user?.email]);

  useEffect(() => {
    void assemble();
  }, [assemble]);

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

  return { packet, docs, receipts, building, receipt, assemble, exportHtml, exportJson };
};
