import type { GetReadyRecord } from "@/hooks/useGetReady";
import type { GetReadyService } from "@/contexts/DealerSettingsContext";

// Derives installer-invoice line items from completed get-ready work:
// accessory installs price from the product catalog; internal services carry
// the cost captured on the item (falling back to the service-catalog cost
// when the item predates cost capture). Pure — the panel freezes the result
// into get_ready_invoices when the dealer marks the vehicle invoiced.

export interface InvoiceLine {
  kind: "accessory" | "service";
  label: string;
  detail: string;
  amount: number;
}

export interface DerivedInvoice {
  recordId: string;
  vin: string;
  stockNumber: string;
  ymm: string;
  roNumber: string;
  lines: InvoiceLine[];
  total: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const serviceCatalogPrices = (services: GetReadyService[] | null | undefined): Record<string, number> => {
  const map: Record<string, number> = {};
  for (const s of services || []) {
    const cost = parseFloat(String(s.cost).replace(/[^0-9.]/g, ""));
    if (s.name.trim() && Number.isFinite(cost) && cost > 0) map[s.name.trim().toLowerCase()] = cost;
  }
  return map;
};

export const deriveInvoice = (
  record: GetReadyRecord,
  productPrices: Record<string, number>,
  servicePrices: Record<string, number> = {},
): DerivedInvoice | null => {
  const lines: InvoiceLine[] = [];

  for (const acc of record.accessoriesToInstall) {
    if (!acc.installed) continue;
    const when = acc.installedDate ? new Date(acc.installedDate).toLocaleDateString() : "";
    lines.push({
      kind: "accessory",
      label: acc.productName,
      detail: [acc.installedBy, when].filter(Boolean).join(" · "),
      amount: round2(productPrices[acc.productId] ?? 0),
    });
  }

  for (const item of record.items) {
    if (item.category !== "service" || item.status !== "complete") continue;
    const fallback = servicePrices[item.label.trim().toLowerCase()];
    const when = item.completedAt ? new Date(item.completedAt).toLocaleDateString() : "";
    lines.push({
      kind: "service",
      label: item.label,
      detail: [item.completedBy, when].filter(Boolean).join(" · "),
      amount: round2(item.cost ?? fallback ?? 0),
    });
  }

  if (lines.length === 0) return null;
  return {
    recordId: record.id,
    vin: record.vin,
    stockNumber: record.stockNumber,
    ymm: record.ymm,
    roNumber: record.roNumber,
    lines,
    total: round2(lines.reduce((sum, l) => sum + l.amount, 0)),
  };
};

export const nextInvoiceNumber = (vin: string, existing: string[]): string => {
  const base = `INV-${(vin || "VEHICLE").slice(-6).toUpperCase()}`;
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
};
