import { useState } from "react";
import { Crumbs } from "@/components/detail/parts";
import { AdminButton, StatusChip } from "@/components/admin/v2/primitives";
import { PageBody, PageHeader } from "@/components/product";
import { adminTabHref } from "@/lib/admin/sections";

// Dealer-only picker for the served customer Passport. It sets the preview
// parameters the served page already understands and loads that page in a
// frame; nothing here restyles or reimplements the Passport.

const SCENARIOS = [
  { key: "new2026", label: "New vehicle" },
  { key: "usedfee", label: "Used vehicle with doc fee" },
  { key: "sparse", label: "Sparse data" },
] as const;

const STATES = [
  { key: "passport", label: "Customer Passport" },
  { key: "verification", label: "Verification report" },
] as const;

const selectCls = "h-10 w-full rounded-md border border-adm-border bg-adm-surface px-3 text-[14px] text-adm-ink outline-none focus:ring-2 focus:ring-adm-primary";

const previewSrc = (scenario: string, state: string): string =>
  state === "verification" ? "/v/demo/verification?preview=1&scenario=review" : `/v/demo?preview=1&scenario=${scenario}`;

export default function CustomerPreviewPage() {
  const [scenario, setScenario] = useState<string>("new2026");
  const [state, setState] = useState<string>("passport");
  const [src, setSrc] = useState<string | null>(null);

  return (
    <PageBody width="wide">
      <Crumbs items={[{ label: "Administration", to: "/admin" }, { label: "Customer Experience", to: adminTabHref("routing") }, { label: "Customer previews", to: adminTabHref("customer-previews") }, { label: "Dealer view" }]} />
      <PageHeader
        title={<span className="inline-flex flex-wrap items-center gap-3">Customer Passport Preview (Admin) <StatusChip tone="info">Dealer view only</StatusChip></span>}
        description="This preview uses the existing production component. The customer-facing Passport design is unchanged."
      />
      <form
        aria-label="Preview settings"
        className="flex flex-wrap items-end gap-4 rounded-[6px] border border-adm-border bg-adm-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          setSrc(previewSrc(scenario, state));
        }}
      >
        <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[13px] leading-[18px] text-adm-ink">
          Scenario
          <select className={selectCls} value={scenario} onChange={(e) => setScenario(e.target.value)} disabled={state === "verification"}>
            {SCENARIOS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[13px] leading-[18px] text-adm-ink">
          Vehicle
          <select className={selectCls} defaultValue="example" disabled>
            <option value="example">Example vehicle (synthetic)</option>
          </select>
        </label>
        <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[13px] leading-[18px] text-adm-ink">
          State
          <select className={selectCls} value={state} onChange={(e) => setState(e.target.value)}>
            {STATES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <AdminButton type="submit" variant="primary" className="min-h-[40px] px-6">Generate preview</AdminButton>
      </form>
      <section aria-label="Preview" className="overflow-hidden rounded-[6px] border border-adm-border bg-adm-surface">
        {src ? (
          <iframe title="Customer Passport preview" src={src} className="block h-[760px] w-full border-0" />
        ) : (
          <div className="flex h-[360px] flex-col items-center justify-center gap-2 bg-adm-workspace text-center">
            <p className="text-[20px] leading-[28px] font-semibold text-adm-ink">Existing approved customer Passport renders here</p>
            <p className="text-[14px] leading-[20px] text-adm-muted">Choose a scenario and select Generate preview. The current production component is unchanged.</p>
          </div>
        )}
      </section>
    </PageBody>
  );
}
