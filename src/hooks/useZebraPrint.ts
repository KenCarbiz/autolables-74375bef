import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// ──────────────────────────────────────────────────────────────
// useZebraPrint — Supabase-backed (Wave 13a).
//
// Was localStorage-only; queued jobs were trapped on the one
// browser that fired them. Now appends to public.zebra_print_jobs
// (migration 20260517020000) so the print queue follows the
// dealer across devices and the admin Print Queue tab can see
// the full history.
//
// Real Zebra CloudPrint integration is still TODO — the row is
// inserted with status 'queued' and stays there until a
// downstream worker (or manual ZPL paste) marks it printed.
// ──────────────────────────────────────────────────────────────

export interface ZebraPrintJob {
  id: string;
  vin: string;
  stockNumber: string;
  ymm: string;
  labelType: "stock_number" | "vin_barcode" | "key_tag";
  printerName: string;
  status: "queued" | "printing" | "printed" | "failed";
  zplContent: string;
  createdAt: string;
}

// Pure ZPL string builder for the supported label types. Kept
// out of the hook so other code can produce ZPL without
// triggering a render cycle.
export const generateZpl = (
  stockNumber: string,
  vin: string,
  ymm: string,
  labelType: string,
): string => {
  if (labelType === "stock_number") {
    return `^XA
^FO50,30^A0N,60,60^FD${stockNumber}^FS
^FO50,100^A0N,25,25^FD${ymm}^FS
^FO50,135^BY3^BCN,80,Y,N,N^FD${vin}^FS
^FO50,230^A0N,18,18^FDVIN: ${vin}^FS
^XZ`;
  }
  if (labelType === "vin_barcode") {
    return `^XA
^FO30,20^BY2^BCN,100,Y,N,N^FD${vin}^FS
^FO30,140^A0N,20,20^FD${ymm}^FS
^FO30,170^A0N,20,20^FDStock: ${stockNumber}^FS
^XZ`;
  }
  // key_tag
  return `^XA
^FO20,15^A0N,35,35^FD${stockNumber}^FS
^FO20,55^A0N,18,18^FD${ymm}^FS
^XZ`;
};

export const useZebraPrint = () => {
  const [printing, setPrinting] = useState(false);

  const printLabel = async (data: {
    vin: string;
    stockNumber: string;
    ymm: string;
    labelType: "stock_number" | "vin_barcode" | "key_tag";
    printerName?: string;
  }): Promise<ZebraPrintJob | null> => {
    setPrinting(true);
    try {
      const zpl = generateZpl(data.stockNumber, data.vin, data.ymm, data.labelType);
      const { data: row, error } = await (supabase as any)
        .from("zebra_print_jobs")
        .insert({
          vin: data.vin,
          stock_number: data.stockNumber,
          ymm: data.ymm,
          label_type: data.labelType,
          printer_name: data.printerName || "Default",
          status: "queued",
          zpl_content: zpl,
        })
        .select("*")
        .single();
      if (error || !row) return null;
      return {
        id: row.id,
        vin: row.vin,
        stockNumber: row.stock_number,
        ymm: row.ymm,
        labelType: row.label_type,
        printerName: row.printer_name,
        status: row.status,
        zplContent: row.zpl_content,
        createdAt: row.created_at,
      };
    } finally {
      setPrinting(false);
    }
  };

  return { printLabel, printing, generateZpl };
};
