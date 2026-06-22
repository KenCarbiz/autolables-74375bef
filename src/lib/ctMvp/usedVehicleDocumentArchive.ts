import jsPDF from "jspdf";
import html2canvas from "html2canvas-pro";
import { archivePdf, persistArchivedPdf } from "@/lib/pdfArchive";
import { recordFtcGenerated, recordK208Generated, buildPersistenceContext } from "@/lib/ctMvp/productionHooks";
import type { UsedVehicleDocumentData } from "@/lib/ctMvp/usedVehicleDocuments";

export type UsedVehicleDocumentArchiveKind = "ftc_buyers_guide" | "k208_warranty";

export type UsedVehicleDocumentArchiveInput = {
  tenantId: string;
  vehicleId?: string | null;
  pdf: jsPDF;
  kind: UsedVehicleDocumentArchiveKind;
  data: UsedVehicleDocumentData;
  createdBy?: string | null;
};

export type UsedVehicleElementArchiveInput = Omit<UsedVehicleDocumentArchiveInput, "pdf"> & {
  element: HTMLElement;
};

export type UsedVehicleDocumentArchiveResult = {
  kind: UsedVehicleDocumentArchiveKind;
  documentId: string;
  archived: boolean;
  archiveId?: string | null;
  hash?: string | null;
  error?: string | null;
};

const documentIdFor = (kind: UsedVehicleDocumentArchiveKind, data: UsedVehicleDocumentData) => {
  const vinOrStock = data.vin || data.stock || "vehicle";
  return `${kind}-${vinOrStock}-${new Date().toISOString().slice(0, 10)}`;
};

const pageForKind = (kind: UsedVehicleDocumentArchiveKind) =>
  kind === "ftc_buyers_guide"
    ? { orientation: "portrait" as const, width: 7.25, height: 11 }
    : { orientation: "portrait" as const, width: 8.5, height: 11 };

export const renderUsedVehicleElementToPdf = async (element: HTMLElement, kind: UsedVehicleDocumentArchiveKind) => {
  const page = pageForKind(kind);
  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
  });
  const image = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ orientation: page.orientation, unit: "in", format: [page.width, page.height] });
  pdf.addImage(image, "PNG", 0, 0, page.width, page.height, undefined, "FAST");
  return pdf;
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
  const context = buildPersistenceContext({
    tenantId,
    vehicleId,
    vin: data.vin,
    stock: data.stock,
  });

  const payload = {
    documentId,
    kind,
    vin: data.vin,
    stock: data.stock,
    year: data.year,
    make: data.make,
    model: data.model,
    mileage: data.mileage,
    salePrice: data.salePrice,
    warrantyMode: data.warrantyMode,
    warrantyDuration: data.warrantyDuration,
    warrantyMiles: data.warrantyMiles,
    warrantyPercent: data.warrantyPercent,
    systemsCovered: data.systemsCovered,
    createdBy: createdBy || null,
  };

  const archival = await archivePdf(pdf, payload, {
    tenantId,
    vin: data.vin,
    ymm: [data.year, data.make, data.model].filter(Boolean).join(" "),
  });

  const archive = await persistArchivedPdf(pdf, {
    docType: kind === "ftc_buyers_guide" ? "buyers_guide" : "disclosure",
    entityId: vehicleId || data.vin || data.stock || documentId,
    vin: data.vin || null,
    retentionYears: 7,
  });

  const metadata = {
    ...payload,
    archive,
    archiveHash: archival.hash,
    archiveHashPrefix: archival.hashPrefix,
    archivedAt: archival.timestamp,
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
    archived: archive.ok,
    archiveId: archive.archiveId || null,
    hash: archival.hash,
    error: archive.ok ? null : archive.error || "archive failed",
  };
};

export const archiveUsedVehicleComplianceElement = async (args: UsedVehicleElementArchiveInput) => {
  const pdf = await renderUsedVehicleElementToPdf(args.element, args.kind);
  return archiveUsedVehicleCompliancePdf({ ...args, pdf });
};

export const archiveUsedVehicleCompliancePacket = async (
  ftc: Omit<UsedVehicleElementArchiveInput, "kind">,
  k208: Omit<UsedVehicleElementArchiveInput, "kind">,
) => {
  const ftcResult = await archiveUsedVehicleComplianceElement({ ...ftc, kind: "ftc_buyers_guide" });
  const k208Result = await archiveUsedVehicleComplianceElement({ ...k208, kind: "k208_warranty" });
  return { ftc: ftcResult, k208: k208Result };
};
