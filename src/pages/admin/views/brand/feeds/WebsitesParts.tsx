import { useState } from "react";
import { cn } from "@/lib/utils";
import { AdminButton } from "@/components/admin/v2/primitives";
import { AdminIcon, AdminIconTile, ChipInput, DetailDrawer, FieldRow, INPUT_CLASS, SortableList, StatusBadge, useIsNarrow, type StatusState } from "@/components/admin/v3/editor";
import { checkUrl, conditionRows, parseLabels, type ProviderSpec } from "./websitesModel";
import { reasonText, type PriceTestResult } from "./priceTest";
import { Banner } from "./bits";

export const UrlStatus = ({ value, hosts, name }: { value: string; hosts?: string[]; name?: string }) => {
  const check = checkUrl(value, hosts, name);
  const state: StatusState = check.state === "empty" ? "setup_required" : check.state === "invalid" ? "failed" : check.mismatch ? "stale" : "enabled";
  const label = check.state === "empty" ? "No address saved" : check.state === "invalid" ? "Address not valid" : check.mismatch ? "Check the address" : "Format valid";
  return <StatusBadge state={state} label={label} />;
};

export const UrlField = ({ id, label, value, onChange, error, disabled, placeholder, hosts, name, help }: {
  id: string; label: string; value: string; onChange: (v: string) => void; error?: string; disabled?: boolean; placeholder?: string; hosts?: string[]; name?: string; help?: string;
}) => {
  const check = checkUrl(value, hosts, name);
  const narrow = useIsNarrow();
  return (
    <FieldRow label={label} htmlFor={id} error={error} help={error ? undefined : check.state === "valid" && check.mismatch ? undefined : help}>
      {(p) => (
        <>
          {narrow ? (
            <textarea {...p} rows={value.length > 34 ? 2 : 1} inputMode="url" autoComplete="off" spellCheck={false} value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value.replace(/\s+/g, ""))} className={cn(INPUT_CLASS, "h-auto min-h-[44px] py-2 break-all resize-none")} />
          ) : (
            <input {...p} type="text" inputMode="url" autoComplete="off" value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={INPUT_CLASS} />
          )}
          {check.state === "valid" && check.mismatch && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[13px] leading-[18px] text-adm-warning font-medium">
              <AdminIcon name="alert" size="inline" className="mt-px" />
              <span>{check.mismatch}</span>
            </p>
          )}
        </>
      )}
    </FieldRow>
  );
};

const Cap = ({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "muted" }) => (
  <div className="flex items-start justify-between gap-3 py-1.5">
    <dt className="text-[13px] leading-[18px] text-adm-muted">{label}</dt>
    <dd className={cn("text-[13px] leading-[18px] font-medium text-right", tone === "ok" ? "text-adm-success" : tone === "warn" ? "text-adm-warning" : "text-adm-ink")}>{value}</dd>
  </div>
);

export const ProviderCapabilities = ({ provider, value }: { provider: ProviderSpec; value: string }) => {
  const check = checkUrl(value, provider.hosts, provider.name);
  return (
    <dl className="divide-y divide-adm-divider border-t border-adm-divider">
      <Cap label="Address saved" value={check.state === "empty" ? "No" : "Yes"} tone={check.state === "empty" ? "muted" : "ok"} />
      <Cap label="Address format" value={check.state === "empty" ? "Nothing to check" : check.state === "invalid" ? "Not valid" : check.mismatch ? "Valid, domain differs" : "Valid"} tone={check.state === "invalid" || (check.state === "valid" && check.mismatch) ? "warn" : check.state === "valid" ? "ok" : "muted"} />
      <Cap label="Live connection" value={`None with ${provider.name}`} tone="muted" />
      <Cap label="Prices verified" value="Not by this setting" tone="muted" />
    </dl>
  );
};

export const ProviderCard = ({ provider, value, onChange, error, canEdit, onDetails }: { provider: ProviderSpec; value: string; onChange: (v: string) => void; error?: string; canEdit: boolean; onDetails: () => void }) => {
  const check = checkUrl(value, provider.hosts, provider.name);
  const narrow = useIsNarrow();
  if (narrow) {
    return (
      <li data-provider={provider.id}>
        <button type="button" onClick={onDetails} className="w-full flex items-center gap-3 rounded-xl border border-adm-divider bg-adm-surface px-3 py-1.5 min-h-[56px] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary">
          <span aria-hidden="true" data-logo-slot="" className="flex flex-shrink-0 items-center justify-center w-16 h-10 rounded-md border border-adm-divider bg-adm-workspace text-adm-muted"><AdminIcon name="link" /></span>
          <span className="min-w-0 flex-1 flex flex-col items-start gap-1">
            <span className="text-[15px] leading-[20px] font-semibold text-adm-ink">{provider.name}</span>
            <UrlStatus value={value} hosts={provider.hosts} name={provider.name} />
          </span>
          <span className="sr-only">, open details</span>
          <AdminIcon name="chevron-right" className="text-adm-muted flex-shrink-0" />
        </button>
      </li>
    );
  }
  const actions = (
    <div className="flex items-center gap-2 flex-wrap">
      <AdminButton variant="secondary" onClick={onDetails}>Capabilities</AdminButton>
      {check.state === "valid" && (
        <a href={check.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 min-h-[40px] max-sm:min-h-[44px] px-2 text-[14px] font-semibold text-adm-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary rounded-md">
          Open page <AdminIcon name="external-link" size="inline" /><span className="sr-only">(opens in a new tab)</span>
        </a>
      )}
    </div>
  );
  return (
    <li className="md:[&:last-child:nth-child(odd)]:col-span-2 rounded-xl border border-adm-divider bg-adm-surface p-4 max-sm:p-3 flex flex-col gap-3 max-sm:gap-2 min-w-0" data-provider={provider.id}>
      <div className="flex items-center gap-3 flex-wrap">
        <span aria-hidden="true" data-logo-slot="" className="flex flex-shrink-0 items-center justify-center w-36 min-w-[144px] h-12 min-h-[48px] rounded-md border border-adm-divider bg-adm-workspace text-adm-muted">
          <AdminIcon name="link" />
        </span>
        <div className="min-w-0 flex flex-col gap-1 items-start">
          <h3 className="text-[16px] leading-[22px] font-semibold text-adm-ink">{provider.name}</h3>
          <UrlStatus value={value} hosts={provider.hosts} name={provider.name} />
        </div>
      </div>
      {canEdit ? (
        <UrlField id={`provider-${provider.id}`} label="Listing page address" value={value} onChange={onChange} error={error} hosts={provider.hosts} name={provider.name} placeholder={`https://www.${provider.hosts[0]}/...`} />
      ) : (
        <div>
          <p className="text-[14px] font-medium text-adm-ink">Listing page address</p>
          <p className="mt-1 text-[14px] break-all text-adm-ink">{value.trim() || <span className="italic text-adm-muted">Not set</span>}</p>
        </div>
      )}
      <details className="group border-t border-adm-divider">
        <summary className="flex items-center justify-between min-h-[44px] cursor-pointer text-[14px] font-semibold text-adm-primary list-none">Details<AdminIcon name="chevron-down" className="group-open:rotate-180" /></summary>
        <ProviderCapabilities provider={provider} value={value} />
      </details>
      <div className="mt-auto">{actions}</div>
    </li>
  );
};

export const ProviderDrawer = ({ provider, value, onChange, error, canEdit, onClose }: { provider: ProviderSpec | null; value: string; onChange: (v: string) => void; error?: string; canEdit: boolean; onClose: () => void }) => (
  <DetailDrawer open={!!provider} onClose={onClose} title={provider ? `${provider.name} listing page` : "Listing page"} description="What this address does today, and what it does not."
    footer={<AdminButton variant="primary" onClick={onClose}>Done</AdminButton>}>
    {provider && (
      <>
        {canEdit && <UrlField id={`drawer-${provider.id}`} label="Listing page address" value={value} onChange={onChange} error={error} hosts={provider.hosts} name={provider.name} placeholder={`https://www.${provider.hosts[0]}/...`} help="Changes stay in your draft until you review and apply them on the page." />}
        <div>
          <h3 className="text-[14px] font-semibold text-adm-ink">Capabilities</h3>
          <ProviderCapabilities provider={provider} value={value} />
        </div>
        <Banner tone="neutral" icon="info" title="A saved address is not a connection">
          {provider.use} AutoLabels does not log in to {provider.name}, send it inventory or receive leads from it through this setting. Feed delivery to providers is managed in Integrations, not here.
        </Banner>
      </>
    )}
  </DetailDrawer>
);

export const LabelList = ({ labels, onChange, canEdit, error }: { labels: string[]; onChange: (next: string[]) => void; canEdit: boolean; error?: string }) => {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const add = () => {
    const v = text.trim();
    if (!v) return;
    if (v.includes(",")) return setProblem("Add one label at a time. Commas separate labels in storage.");
    if (labels.some((l) => l.toLowerCase() === v.toLowerCase())) return setProblem(`"${v}" is already in the list.`);
    onChange([...labels, v]);
    setText("");
    setProblem(null);
  };
  const items = labels.map((l, i) => ({ id: `${i}:${l.toLowerCase()}`, label: l }));
  return (
    <div className="space-y-3">
      {labels.length === 0 ? (
        <p className="rounded-lg border border-dashed border-adm-border bg-adm-workspace px-4 py-4 text-[14px] text-adm-muted">No labels saved. Add the wording your website prints beside the selling price, such as Internet Price.</p>
      ) : canEdit ? (
        <SortableList label="Price labels in priority order" items={items} onChange={(next) => onChange(next.map((i) => i.label))}
          renderItem={(i) => (
            <span className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-6 h-6 flex-shrink-0 rounded-full bg-adm-selected text-adm-primary text-[13px] font-semibold" aria-hidden="true">{items.findIndex((x) => x.id === i.id) + 1}</span>
              <span className="font-medium min-w-0 flex-1 break-words">{i.label}</span>
              <button type="button" onClick={() => onChange(labels.filter((_, idx) => idx !== items.findIndex((x) => x.id === i.id)))} aria-label={`Remove ${i.label}`} className="inline-flex flex-shrink-0 items-center justify-center w-10 h-10 max-sm:w-11 max-sm:h-11 rounded-md text-adm-muted hover:bg-adm-workspace hover:text-adm-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary">
                <AdminIcon name="close" />
              </button>
            </span>
          )} />
      ) : (
        <ol aria-label="Price labels in priority order" className="space-y-2">
          {labels.map((l, i) => (
            <li key={l} className="flex items-center gap-2 rounded-lg border border-adm-divider px-3 py-2 text-[14px]"><span className="w-6 h-6 rounded-full bg-adm-selected text-adm-primary text-[13px] font-semibold inline-flex items-center justify-center" aria-hidden="true">{i + 1}</span>{l}</li>
          ))}
        </ol>
      )}
      {canEdit && (
        <FieldRow label="Add a label" htmlFor="price-label-add" error={problem ?? error}>
          {(p) => (
            <div className="flex flex-col sm:flex-row gap-2">
              <input {...p} value={text} placeholder="Internet Price" onChange={(e) => { setText(e.target.value); setProblem(null); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} className={INPUT_CLASS} />
              <AdminButton variant="secondary" onClick={add} disabled={!text.trim()} className="sm:w-auto whitespace-nowrap shrink-0 sm:min-w-[132px]"><AdminIcon name="plus" />Add label</AdminButton>
            </div>
          )}
        </FieldRow>
      )}
      <p className="max-sm:hidden text-[13px] leading-[18px] text-adm-muted">The crawler reads the first label that has a dollar amount beside it, so put the label for your selling price first. Matching ignores capital letters.</p>
    </div>
  );
};

const money = (n: number) => `$${Number(n).toLocaleString("en-US")}`;

export const PriceTestResultPanel = ({ result, labels }: { result: PriceTestResult; labels: string[] }) => {
  if (result.error) {
    return (
      <div className="space-y-3" data-test-result={result.paused ? "paused" : "error"}>
        <Banner tone={result.paused ? "warning" : "danger"} icon={result.paused ? "clock" : "alert"} title={result.paused ? "The price check is paused" : "The test could not run"}>
          {result.error}.{result.paused ? " Nothing was read or rendered. The saved labels and your draft are unchanged." : " Nothing was stored."}
        </Banner>
      </div>
    );
  }
  const found = result.price != null;
  const why = found ? null : reasonText(result.reason);
  const used = result.configured_labels?.length ? result.configured_labels : labels;
  return (
    <div className="space-y-3" data-test-result={found ? "match" : result.reason ?? "none"}>
      <div className={cn("rounded-xl border px-4 py-3 flex items-start gap-3", found ? "border-adm-success/30 bg-adm-success-bg" : "border-adm-warning/30 bg-adm-warning-bg")}>
        <AdminIcon name={found ? "check-circle" : "alert"} size="card" className={cn("mt-0.5", found ? "text-adm-success" : "text-adm-warning")} />
        <div className="min-w-0">
          <p className="text-[16px] leading-[24px] font-semibold text-adm-ink">{found ? `Price read: ${money(result.price as number)}` : why!.title}</p>
          <p className="text-[14px] leading-[20px] text-adm-ink/80">{found ? "This is what the crawler would record for this one page. It is a test; nothing was saved." : why!.fix}</p>
        </div>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[14px] leading-[20px]">
        <div className="flex justify-between gap-3 border-b border-adm-divider py-1.5"><dt className="text-adm-muted">Matched label</dt><dd className="font-medium text-right">{result.matched_label || "None"}</dd></div>
        <div className="flex justify-between gap-3 border-b border-adm-divider py-1.5"><dt className="text-adm-muted">Extracted value</dt><dd className="font-medium text-right">{found ? money(result.price as number) : "None"}</dd></div>
        <div className="flex justify-between gap-3 border-b border-adm-divider py-1.5"><dt className="text-adm-muted">Failure reason</dt><dd className="font-medium text-right">{found ? "None" : result.reason?.replace(/_/g, " ") ?? "No price extracted"}</dd></div>
        <div className="flex justify-between gap-3 border-b border-adm-divider py-1.5"><dt className="text-adm-muted">Read from</dt><dd className="font-medium text-right">{result.source && result.source !== "none" ? result.source.replace(/_/g, " ") : "Nothing"}</dd></div>
        {result.msrp != null && <div className="flex justify-between gap-3 border-b border-adm-divider py-1.5"><dt className="text-adm-muted">MSRP on the page</dt><dd className="font-medium text-right">{money(result.msrp)}</dd></div>}
        <div className="flex justify-between gap-3 border-b border-adm-divider py-1.5"><dt className="text-adm-muted">Page rendering</dt><dd className="font-medium text-right">{result.rendered ? "A rendered copy was used" : "Plain page read"}</dd></div>
        {result.http_status ? <div className="flex justify-between gap-3 border-b border-adm-divider py-1.5"><dt className="text-adm-muted">Page response</dt><dd className="font-medium text-right">HTTP {result.http_status}</dd></div> : null}
        <div className="flex justify-between gap-3 border-b border-adm-divider py-1.5"><dt className="text-adm-muted">Finance parameters</dt><dd className="font-medium text-right">{result.strip_finance_params === false ? "Kept in the address" : "Removed from the address"}</dd></div>
      </dl>
      {result.render_error && <p className="text-[13px] leading-[18px] text-adm-warning font-medium">Render note: {result.render_error}</p>}
      {Array.isArray(result.candidates) && result.candidates.length > 0 && (
        <div>
          <h4 className="text-[14px] font-semibold text-adm-ink">Every dollar amount found near a label</h4>
          <ul className="mt-2 divide-y divide-adm-divider border border-adm-divider rounded-lg">
            {result.candidates.slice(0, 12).map((c, i) => (
              <li key={`${c.value}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-[14px]">
                <span className="min-w-0 break-words"><span className="font-semibold tabular-nums">{money(c.value)}</span> <span className="text-adm-muted">{c.label}</span></span>
                {c.label.toLowerCase() === (result.matched_label ?? "").toLowerCase() && result.matched_label ? <StatusBadge state="enabled" label="Matched" /> : <span className="text-[13px] text-adm-muted">{c.source.replace(/_/g, " ")}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[13px] leading-[18px] text-adm-muted">Labels used: {used.length ? used.join(", ") : "none"}. This test does not prove other marketplaces show the same price.</p>
    </div>
  );
};

export const ConditionMapping = ({ terms, onChange, canEdit }: { terms: string[]; onChange: (next: string[]) => void; canEdit: boolean }) => {
  const narrow = useIsNarrow();
  const rows = conditionRows(terms);
  const unmapped = rows.filter((r) => !r.canonical).length;
  return (
    <div className="space-y-4">
      {canEdit && <ChipInput label="Condition terms your team uses" values={terms} onChange={onChange} placeholder="Type a term and press Enter" />}
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-adm-border bg-adm-workspace px-4 py-4 text-[14px] text-adm-muted">No terms saved. AutoLabels falls back to New, Demo, Used and CPO when this list is empty.</p>
      ) : narrow ? (
        <ul aria-label="Condition term mapping" className="grid grid-cols-2 gap-2">
          {rows.map((r, i) => (
            <li key={`${i}:${r.term}`} className="rounded-lg border border-adm-divider px-3 py-2.5">
              <div className="flex flex-col items-start gap-1">
                <span className="text-[14px] font-semibold text-adm-ink break-words min-w-0">{r.term}</span>
                {r.canonical ? <StatusBadge state={r.canonical === "new" ? "visible_with_data" : "enabled"} label={r.canonical === "cpo" ? "CPO (used)" : r.canonical === "new" ? "New" : "Used"} /> : <StatusBadge state="failed" label="Not mapped" />}
              </div>
              {!r.canonical && <p className="mt-1 text-[13px] leading-[18px] text-adm-muted">{r.note}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <div role="table" aria-label="Condition term mapping" className="rounded-lg border border-adm-divider divide-y divide-adm-divider overflow-hidden">
          <div role="row" className="hidden md:grid grid-cols-[minmax(0,180px)_minmax(0,160px)_minmax(0,1fr)] gap-4 bg-adm-workspace px-4 py-2 text-[13px] font-semibold text-adm-muted">
            <span role="columnheader">Your term</span><span role="columnheader">Stored as</span><span role="columnheader">What happens</span>
          </div>
          {rows.map((r, i) => (
            <div role="row" key={`${i}:${r.term}`} className="grid md:grid-cols-[minmax(0,180px)_minmax(0,160px)_minmax(0,1fr)] gap-x-4 gap-y-1 px-4 py-3 items-center">
              <span role="cell" className="text-[14px] font-semibold text-adm-ink break-words">{r.term}</span>
              <span role="cell">{r.canonical ? <StatusBadge state={r.canonical === "new" ? "visible_with_data" : "enabled"} label={r.canonical === "cpo" ? "CPO (used)" : r.canonical === "new" ? "New" : "Used"} /> : <StatusBadge state="failed" label="Not mapped" />}</span>
              <span role="cell" className="text-[14px] leading-[20px] text-adm-muted">{r.note}</span>
            </div>
          ))}
        </div>
      )}
      {unmapped > 0 && <Banner tone="warning" title={unmapped === 1 ? "One term has no mapping" : `${unmapped} terms have no mapping`}>Terms the rules do not recognise are never guessed. Rename them to include New, Used, Certified or CPO.</Banner>}
      <p className="max-sm:hidden text-[13px] leading-[18px] text-adm-muted">The mapping follows fixed rules and cannot be edited term by term. This list only decides which labels your team can pick; it never changes your feed.</p>
    </div>
  );
};

export { parseLabels, AdminIconTile };
