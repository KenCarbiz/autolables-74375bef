import { useState } from "react";
import { FileText } from "lucide-react";
import { AdminButton } from "@/components/admin/v2/primitives";
import { Crumbs } from "@/components/detail/parts";
import { FilterSelect, PageBody, PageHeader } from "@/components/product";
import { adminTabHref } from "@/lib/admin/sections";

// Dealer-only picker for the served customer Passport. It sets the preview
// parameters the served page already understands and loads that page in a
// frame; nothing here restyles or reimplements the Passport.

const SCENARIOS = [
  { key: "new", label: "New vehicle" },
  { key: "used", label: "Used vehicle" },
] as const;

const DENSITIES = [
  { key: "standard", label: "Standard" },
  { key: "sparse", label: "Sparse data" },
] as const;

const STATES = [
  { key: "passport", label: "Customer Passport" },
  { key: "verification", label: "Verification report" },
] as const;

const previewSrc = (scenario: string, density: string, state: string): string => {
  if (state === "verification") return "/v/demo/verification?preview=1&scenario=review";
  const key = density === "sparse" ? "sparse" : scenario === "used" ? "usedfee" : "new2026";
  return `/v/demo?preview=1&scenario=${key}`;
};

export default function CustomerPreviewPage() {
  const [scenario, setScenario] = useState<string>("new");
  const [density, setDensity] = useState<string>("standard");
  const [state, setState] = useState<string>("passport");
  const [src, setSrc] = useState<string | null>(null);

  return (
    <PageBody width="wide">
      <Crumbs items={[{ label: "Administration", to: "/admin" }, { label: "Customer Experience", to: adminTabHref("customer-previews") }, { label: "Passport preview" }]} />
      <PageHeader
        title="Customer Passport Preview — Dealer View Only"
        description="This preview uses the existing production component. The customer-facing Passport design is unchanged."
      />
      <form
        aria-label="Preview settings"
        className="flex flex-wrap items-end gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setSrc(previewSrc(scenario, density, state));
        }}
      >
        <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-[13px] leading-[18px] text-adm-ink">
          Scenario
          <FilterSelect label="Scenario" className="h-9 w-full" value={scenario} onChange={setScenario} disabled={state === "verification"} options={SCENARIOS.map((s) => ({ value: s.key, label: s.label }))} />
        </label>
        <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-[13px] leading-[18px] text-adm-ink">
          Vehicle
          <FilterSelect label="Vehicle" className="h-9 w-full" value="example" onChange={() => undefined} disabled options={[{ value: "example", label: "Example vehicle" }]} />
        </label>
        <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-[13px] leading-[18px] text-adm-ink">
          Data density
          <FilterSelect label="Data density" className="h-9 w-full" value={density} onChange={setDensity} disabled={state === "verification"} options={DENSITIES.map((s) => ({ value: s.key, label: s.label }))} />
        </label>
        <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-[13px] leading-[18px] text-adm-ink">
          Verification state
          <FilterSelect label="Verification state" className="h-9 w-full" value={state} onChange={setState} options={STATES.map((s) => ({ value: s.key, label: s.label }))} />
        </label>
        <AdminButton type="submit" variant="primary" className="min-h-[36px] px-6">Generate preview</AdminButton>
      </form>
      <section aria-label="Preview" className="overflow-hidden rounded-[6px] border border-adm-border bg-adm-surface">
        {src ? (
          <iframe title="Customer Passport preview" src={src} className="block h-[760px] w-full border-0" />
        ) : (
          <div className="flex h-[240px] flex-col items-center justify-center gap-2 bg-adm-workspace text-center">
            <FileText className="h-10 w-10 text-adm-muted" strokeWidth={1.5} aria-hidden="true" />
            <p className="text-[20px] leading-[28px] font-semibold text-adm-ink">Existing approved customer Passport renders here</p>
            <p className="text-[14px] leading-[20px] text-adm-muted">Choose a scenario and select Generate preview.</p>
          </div>
        )}
      </section>
    </PageBody>
  );
}
