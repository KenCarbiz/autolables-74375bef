import { AdminCard } from "@/components/admin/v2/primitives";
import { DOCUMENT_DEFAULT_KEYS, validateDocumentDefaults } from "./brandModel";
import { useBrandForm } from "./useBrandForm";
import { BrandSaveBar } from "./BrandSaveBar";
import { SelectField } from "./fields";
import { PaymentEstimatorSummaryCard } from "./paymentEstimator/summary";

// Per-dealer defaults the generators pull when a vehicle is started, and the
// entry to the selected store's Passport payment estimator. Unpictured in the
// reference set; rehomed here from the legacy Branding tab.

const LAYOUTS = [
  { value: "standard", label: "Standard" },
  { value: "premium", label: "Premium" },
  { value: "compact", label: "Compact" },
];

const FTC = [
  { value: "as_is", label: "As-Is, no warranty" },
  { value: "implied", label: "Implied warranties only" },
  { value: "dealer", label: "Dealer warranty" },
];

export default function DocumentDefaultsView() {
  const form = useBrandForm(DOCUMENT_DEFAULT_KEYS, validateDocumentDefaults);
  const { draft, set } = form;

  return (
    <div className="space-y-4">
      <AdminCard title="Sticker and document defaults" description="What each generator pulls by default when you start a new or used vehicle.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SelectField label="New-car addendum" value={draft.default_new_addendum || "standard"} options={LAYOUTS} onChange={(v) => set("default_new_addendum", v)} />
          <SelectField label="Used-car window sticker" value={draft.default_used_window || "standard"} options={LAYOUTS} onChange={(v) => set("default_used_window", v)} />
          <SelectField label="Used-car addendum" value={draft.default_used_addendum || "standard"} options={LAYOUTS} onChange={(v) => set("default_used_addendum", v)} />
          <SelectField label="FTC used-car warranty (Buyers Guide)" value={draft.default_ftc_warranty || "as_is"} options={FTC} onChange={(v) => set("default_ftc_warranty", v)} />
        </div>
      </AdminCard>

      <PaymentEstimatorSummaryCard />

      <BrandSaveBar form={form} />
    </div>
  );
}
