import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ConnecticutK208Document,
  DEFAULT_USED_VEHICLE_DOCUMENT_DATA,
  FtcBuyersGuideDocument,
  type UsedVehicleDocumentData,
} from "@/lib/ctMvp/usedVehicleDocuments";

type PrintPayload = {
  data?: UsedVehicleDocumentData;
  preview?: "ftc" | "k208";
};

const UsedVehicleDocumentsPrint = () => {
  const [params] = useSearchParams();
  const payload = useMemo<PrintPayload>(() => {
    const key = params.get("h");
    if (!key) return {};
    try {
      return JSON.parse(localStorage.getItem(key) || "{}") as PrintPayload;
    } catch {
      return {};
    }
  }, [params]);

  const data = payload.data || DEFAULT_USED_VEHICLE_DOCUMENT_DATA;
  const preview = payload.preview || "ftc";

  useEffect(() => {
    const t = window.setTimeout(() => window.print(), 350);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen bg-slate-200 py-6 print:bg-white print:p-0">
      <style>{`
        @media print {
          @page { size: auto; margin: 0.25in; }
          body { background: white !important; }
          .print-controls { display: none !important; }
        }
      `}</style>
      <div className="print-controls mx-auto mb-4 flex max-w-[8.5in] items-center justify-between rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <div>
          <p className="text-sm font-bold text-foreground">Print {preview === "ftc" ? "FTC Buyers Guide" : "Connecticut K208"}</p>
          <p className="text-xs text-muted-foreground">Use your browser print dialog for PDF or paper output.</p>
        </div>
        <button onClick={() => window.print()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">Print</button>
      </div>
      {preview === "ftc" ? <FtcBuyersGuideDocument data={data} /> : <ConnecticutK208Document data={data} />}
    </div>
  );
};

export default UsedVehicleDocumentsPrint;
