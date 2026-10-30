import { Link } from "react-router-dom";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";
import { AdminCard, AdminLinkButton, KeyValueList, StatusChip } from "@/components/admin/v2/primitives";
import { useDocumentsReadiness } from "./readiness";

// Print & Calibration: the calibration status the Approval rules readiness
// panel reads, and the way into the Printer Calibration page, which edits the
// dealer print profile (dealer_print_settings upsert, unchanged).

export default function PrintCalibrationView() {
  const readiness = useDocumentsReadiness();
  const cal = readiness.items[0];
  const tone = cal.state === "ok" ? "success" : cal.state === "needs" ? "warning" : "neutral";

  return (
    <AdminCard id="print-settings" title="Printer calibration" description="What the readiness check on Approval rules reads for this dealership." action={<AdminLinkButton to={ADMIN_CHILD_ROUTES.printCalibration} variant="primary">Open printer calibration</AdminLinkButton>}>
      <StatusChip tone={tone} icon>{cal.chip}</StatusChip>
      <KeyValueList
        className="mt-4"
        rows={[
          { label: cal.detailLabel, value: cal.detailValue },
          { label: "Scope", value: "This dealership, default location" },
          { label: "Test sheets", value: "Open in a new tab from the calibration page and are not recorded. Keep the printed sheet with its date." },
        ]}
      />
      <p className="mt-4 text-[12px] leading-[18px] text-adm-muted">
        Label templates and paper size are on <Link to={adminTabHref("templates")} className="font-semibold text-adm-primary hover:underline">Templates</Link>.
      </p>
    </AdminCard>
  );
}
