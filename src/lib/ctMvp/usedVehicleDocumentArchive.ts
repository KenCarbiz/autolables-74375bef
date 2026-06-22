import { persistArchivedPdf } from "@/lib/pdfArchive";
import { recordFtcGenerated, recordK208Generated, buildPersistenceContext } from "@/lib/ctMvp/productionHooks";
import type { UsedVehicleDocumentData } from "@/lib/ctMvp/usedVehicleDocuments";

export type UsedVehicleDocumentArchiveKind = "ftc_buyers_guide" | "k208_warranty";

export type UsedVehicleDocumentArchiveInput = {
  tenantId: string;
  vehicleId?: string | null;
  pdf: Blob;
  kind: UsedVehicleDocumentArchiveKind;
  data: UsedVehicleDocumentData;
  createdBy?: string | null;
};

export type UsedVehicleDocumentArchiveResult = {
  kind: UsedVehicleDocumentArchiveKind;
  documentId: string;
  archived: boolean;
  archivePath?: string | null;
};

const blobToBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const value = String(reader.result || "");
    resolve(value.includes(",") ? value.split(",")[1] : value);
  };
  reader.onerror = () => reject(reader.error || new Error("Could not read PDF blob"));
  reader.readAsDataURL(blob);
});

const documentIdFor = (kind: UsedVehicleDocumentArchiveKind, data: UsedVehicleDocumentData) => {
  const vinOrStock = data.vin || data.stock || "vehicle";
  return `${kind}-${vinOrStock}-${new Date().toISOString().slice(0, 10)}`;
};

export const archiveUsedVehicleCompliancePdf = async ({
  tenantId,
  vehicleId,
  pdf,
  kind,
  data,
  createdBy,
}: UsedVehicleDocumentArchiveInput): Promise<UsedVehicleDocumentArchiveResult> => {
  const documentId = documentIdFor(kind, data);
  const pdfBase64 = await blobToBase64(pdf);
  const context = buildPersistenceContext({
    tenantId,
    vehicleId,
    vin: data.vin,
    stock: data.stock,
  });

  const archive = await persistArchivedPdf(pdfBase64, {
    docType: "disclosure",
    entityId: vehicleId || data.vin || data.stock || documentId,
    vin: data.vin || null,
    retentionYears: 7,
  });

  const metadata = {
    documentId,
    kind,
    archive,
    vin: data.vin,
    stock: data.stock,
    warrantyMode: data.warrantyMode,
    warrantyDuration: data.warrantyDuration,
    warrantyMiles: data.warrantyMiles,
    warrantyPercent: data.warrantyPercent,
    systemsCovered: data.systemsCovered,
    createdBy: createdBy || null,
  };

  if (kind === "ftc_buyers_guide") {
    await recordFtcGenerated(context, {
      documentId,
      warrantyMode: data.warrantyMode,
      language: data.language,
      systemsCovered: data.systemsCovered,
      metadata,
    });
  } else {
    await recordK208Generated(context, {
      documentId,
      warrantyMode: data.warrantyMode,
      warrantyDuration: data.warrantyDuration,
      warrantyMiles: data.warrantyMiles,
      warrantyPercent: data.warrantyPercent,
      metadata,
    });
  }

  return {
    kind,
    documentId,
    archived: true,
    archivePath: (archive as { path?: string | null })?.path || null,
  };
};

export const archiveUsedVehicleCompliancePacket = async (args: Omit<UsedVehicleDocumentArchiveInput, "kind">) => {
  const ftc = await archiveUsedVehicleCompliancePdf({ ...args, kind: "ftc_buyers_guide" });
  const k208 = await archiveUsedVehicleCompliancePdf({ ...args, kind: "k208_warranty" });
  return { ftc, k208 };
};
