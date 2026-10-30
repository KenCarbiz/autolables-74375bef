import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { resolveOperatingState } from "@/lib/dealerState";
import { Button, FilterSelect, EmptyState, LocalTabs, Panel, StatusText, Td, Th, WorkTable, type LocalTab, type Tone } from "@/components/product";
import { ALL, FEDERAL_AND_PRODUCT_ROWS, filterLibrary, libraryRows, type LibraryRow, type LibraryType } from "./libraryData";

const TYPE_TONE: Record<LibraryType, Tone> = {
  Law: "info",
  "Dealer policy": "warning",
  "Product check": "neutral",
};

const FIELD = "h-10 rounded-md border border-adm-border bg-adm-surface px-3 text-[14px] text-adm-ink focus:outline-none focus:ring-2 focus:ring-adm-primary";

export const LibrarySection = () => {
  const { currentStore } = useTenant();
  const { settings } = useDealerSettings();
  const dealerState = resolveOperatingState(settings, currentStore?.state);
  const all = useMemo(() => libraryRows(dealerState), [dealerState]);
  const jurisdictions = useMemo(() => Array.from(new Set(all.map((r) => r.jurisdiction))), [all]);
  const [jurisdiction, setJurisdiction] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [params] = useSearchParams();
  const dealerStateName = useMemo(() => all.find((r) => !FEDERAL_AND_PRODUCT_ROWS.includes(r))?.jurisdiction ?? null, [all]);
  const scopes = useMemo(() => {
    const isOther = (r: LibraryRow) => r.type === "Law" && r.jurisdiction !== "Federal" && r.jurisdiction !== dealerStateName;
    const defs: { key: string; label: string; test: (r: LibraryRow) => boolean }[] = [
      { key: "all", label: "All", test: () => true },
      { key: "federal", label: "Federal", test: (r) => r.jurisdiction === "Federal" },
      ...(dealerStateName ? [{ key: "state", label: dealerStateName, test: (r: LibraryRow) => r.jurisdiction === dealerStateName }] : []),
      { key: "other", label: "Other states", test: isOther },
      { key: "dealer", label: "Dealer policy", test: (r) => r.type === "Dealer policy" },
      { key: "product", label: "Product checks", test: (r) => r.type === "Product check" },
    ];
    return defs.filter((d) => d.key === "all" || all.some(d.test));
  }, [all, dealerStateName]);
  const scopeKey = scopes.find((d) => d.key === params.get("scope"))?.key ?? "all";
  const scopeTest = scopes.find((d) => d.key === scopeKey)?.test ?? (() => true);
  const scopeTabs: LocalTab[] = scopes.map((d) => ({ key: d.key, label: d.label, to: `/compliance?tab=library${d.key === "all" ? "" : `&scope=${d.key}`}`, active: d.key === scopeKey }));
  const rows = useMemo(() => filterLibrary(all, { jurisdiction, type, query }).filter(scopeTest), [all, jurisdiction, type, query, scopeTest]);
  const selected = rows.find((r) => r.id === selectedId) || rows[0] || null;
  const filtered = jurisdiction !== ALL || type !== ALL || query.trim() !== "";
  const clear = () => {
    setJurisdiction(ALL);
    setType(ALL);
    setQuery("");
  };

  return (
    <div className="space-y-4">
      <LocalTabs label="Jurisdiction" tabs={scopeTabs} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[14px] text-adm-muted">
          Jurisdiction
          <FilterSelect label="Jurisdiction" className="min-w-[120px]" value={jurisdiction} onChange={setJurisdiction} options={[{ value: ALL, label: "All" }, ...jurisdictions.map((j) => ({ value: j, label: j }))]} />
        </label>
        <label className="flex items-center gap-2 text-[14px] text-adm-muted">
          Type
          <FilterSelect label="Type" className="min-w-[140px]" value={type} onChange={setType} options={[{ value: ALL, label: "All" }, { value: "Law", label: "Law" }, { value: "Dealer policy", label: "Dealer policy" }, { value: "Product check", label: "Product check" }]} />
        </label>
        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-adm-muted" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search requirements, source, or keyword"
            aria-label="Search the library"
            className={`${FIELD} w-full pl-10`}
          />
        </label>
        <span className="text-[14px] text-adm-muted tabular-nums">{rows.length} of {all.length} items</span>
        <Button variant="primary" onClick={clear}>Clear filters</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <Panel flush>
          {rows.length === 0 ? (
            <EmptyState title="No requirement matches these filters" detail="Clear a filter or change the search." compact />
          ) : (
            <WorkTable caption="Compliance requirements" minWidth={660}>
              <thead>
                <tr>
                  <Th className="px-2.5">Jurisdiction</Th>
                  <Th className="px-2.5">Requirement</Th>
                  <Th className="px-2.5">Type</Th>
                  <Th className="px-2.5">Source</Th>
                  <Th className="px-2.5">Reviewed</Th>
                  <Th className="px-2.5">Workflow</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const on = selected?.id === r.id;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className={`cursor-pointer ${on ? "bg-adm-selected" : "hover:bg-adm-workspace"}`}
                      aria-selected={on}
                    >
                      <Td className="whitespace-nowrap px-2.5 py-2 text-adm-muted">{r.jurisdiction}</Td>
                      <Td className="px-2.5 py-2 font-semibold text-[13px] leading-[18px]">
                        <button type="button" onClick={() => setSelectedId(r.id)} className="line-clamp-2 text-left hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary">{r.requirement}</button>
                      </Td>
                      <Td className="whitespace-nowrap px-2.5 py-2 text-adm-muted">{r.type}</Td>
                      <Td className="px-2.5 py-2 text-[13px] leading-[18px] text-adm-muted"><span className="line-clamp-2">{r.source}</span></Td>
                      <Td className="whitespace-nowrap px-2.5 py-2 text-adm-muted">{r.reviewed ?? "Unknown"}</Td>
                      <Td className="px-2.5 py-2 text-[13px] leading-[18px] text-adm-muted"><span className="line-clamp-2">{r.workflow}</span></Td>
                    </tr>
                  );
                })}
              </tbody>
            </WorkTable>
          )}
        </Panel>

        <aside aria-label="Selected requirement">
          {selected ? (
            <Panel title={selected.requirement} titleSize="md" inset="sm">
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-adm-muted">
                <span>{selected.jurisdiction}</span>
                <StatusText tone={TYPE_TONE[selected.type]}>{selected.type}</StatusText>
              </div>
              <dl className="mt-3 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[14px] leading-[20px]">
                <dt className="text-adm-muted">Source</dt>
                <dd className="text-adm-ink">{selected.source}</dd>
                <dt className="text-adm-muted">Last reviewed</dt>
                <dd className="text-adm-ink">{selected.reviewed ?? "Not recorded"}</dd>
                {selected.effective && (
                  <>
                    <dt className="text-adm-muted">Effective</dt>
                    <dd className="text-adm-ink">{selected.effective}</dd>
                  </>
                )}
              </dl>
              <h4 className="mt-4 text-[14px] leading-[20px] font-semibold text-adm-ink">Summary</h4>
              <p className="mt-1 text-[14px] leading-[20px] text-adm-ink">{selected.summary}</p>
              {selected.requirements.length > 0 && (
                <>
                  <h4 className="mt-4 text-[14px] leading-[20px] font-semibold text-adm-ink">Key requirements</h4>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-[14px] leading-[20px] text-adm-ink">
                    {selected.requirements.map((q, i) => <li key={i}>{q}</li>)}
                  </ul>
                </>
              )}
              <h4 className="mt-4 text-[14px] leading-[20px] font-semibold text-adm-ink">Applies in AutoLabels</h4>
              <p className="mt-1 text-[14px] leading-[20px] text-adm-ink">{selected.applies}</p>
              <p className="mt-4 text-[14px] leading-[20px]">
                {selected.sourceUrl ? (
                  <a href={selected.sourceUrl} target="_blank" rel="noreferrer" className="font-semibold text-adm-primary hover:underline">View official source</a>
                ) : (
                  <span className="text-adm-muted">No official source link is recorded for this row.</span>
                )}
              </p>
            </Panel>
          ) : (
            <Panel title="Requirement detail" titleSize="md" inset="sm">
              <p className="text-[14px] leading-[20px] text-adm-muted">Select a requirement to see its source and what it means here.</p>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
};
export default LibrarySection;
