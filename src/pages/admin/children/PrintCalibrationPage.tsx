import { Crumbs } from "@/components/detail/parts";
import { PageBody, PageHeader } from "@/components/product";
import { adminTabHref } from "@/lib/admin/sections";
import PrintSetupWizard from "@/pages/admin/views/documents/print/PrintSetupWizard";

// Set up printer: choose printer and paper, print a test sheet, adjust the print offset, then verify. The
// offset saves to dealer_print_settings through the existing print settings writer; confirmation is blocked
// until the proposed calibration migration is applied.

export default function PrintCalibrationPage() {
  return (
    <PageBody width="wide">
      <Crumbs items={[{ label: "Administration", to: "/admin" }, { label: "Documents & Service", to: adminTabHref("templates") }, { label: "Print & Calibration", to: adminTabHref("print-calibration") }, { label: "Set up printer" }]} />
      <PageHeader title="Set up printer" description="Align the print to your label stock, then confirm it with a printed test sheet." />
      <PrintSetupWizard />
    </PageBody>
  );
}
