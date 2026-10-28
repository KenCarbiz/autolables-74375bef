import { Link } from "react-router-dom";
import PrintSettingsPanel from "@/components/admin/PrintSettingsPanel";
import { adminTabHref } from "@/lib/admin/sections";
import { AdminCard, KeyValueList, StatusChip } from "@/components/admin/v2/primitives";
import { useDocumentsReadiness } from "./readiness";

// Print & Calibration: the dealer print profile editor (writer: the
// dealer_print_settings upsert inside useDealerPrintSettings, unchanged) and
// the same calibration status the Approval rules readiness panel reads.

export default function PrintCalibrationView() {
  const readiness = useDocumentsReadiness();
  const cal = readiness.items[0];
  const tone = cal.state === "ok" ? "success" : cal.state === "needs" ? "warning" : "neutral";

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] gap-4 items-start">
      <AdminCard id="print-settings">
        <PrintSettingsPanel />
      </AdminCard>

      <AdminCard title="Calibration status" description="What the readiness check on Approval rules reads for this dealership.">
        <StatusChip tone={tone} icon>{cal.chip}</StatusChip>
        <KeyValueList
          className="mt-4"
          rows={[
            { label: cal.detailLabel, value: cal.detailValue },
            { label: "Scope", value: "This dealership, default location" },
            { label: "Test sheets", value: "Open in a new tab from the wizard and are not recorded. Keep the printed sheet with its date." },
          ]}
        />
        <p className="mt-4 text-[12px] leading-[18px] text-adm-muted">
          Label templates and paper size are on <Link to={adminTabHref("templates")} className="font-semibold text-adm-primary hover:underline">Templates</Link>.
        </p>
      </AdminCard>
    </div>
  );
}
