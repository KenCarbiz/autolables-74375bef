import { ChildPageFrame } from "@/components/admin/v2/AdminShell";
import { adminTabHref } from "@/lib/admin/sections";
import PrintSetupWizard from "@/pages/admin/views/documents/print/PrintSetupWizard";

// Set up printer: choose printer and paper, print a test sheet, adjust the print offset, then verify. The
// offset saves to dealer_print_settings through the existing print settings writer; confirmation is blocked
// until the proposed calibration migration is applied.

export default function PrintCalibrationPage() {
  return (
    <ChildPageFrame crumbs={[{ label: "Administration", href: "/admin" }, { label: "Printers & paper", href: adminTabHref("print-calibration") }, { label: "Set up printer" }]} title="Set up printer" subtitle="Align the print to your label stock, then confirm it with a printed test sheet.">
      <PrintSetupWizard />
    </ChildPageFrame>
  );
}
