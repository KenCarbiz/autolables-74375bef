import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { resolveOperatingState } from "@/lib/dealerState";
import { Button, EmptyState, Panel, StatusText, Td, Th, WorkTable, type Tone } from "@/components/product";
import { SectionHeading } from "./primitives";
import { ALL, filterLibrary, libraryRows, type LibraryType } from "./libraryData";

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

  const rows = useMemo(() => filterLibrary(all, { jurisdiction, type, query }), [all, jurisdiction, type, query]);
  const selected = rows.find((r) => r.id === selectedId) || rows[0] || null;
  const filtered = jurisdiction !== ALL || type !== ALL || query.trim() !== "";
  const clear = () => {
    setJurisdiction(ALL);
    setType(ALL);
    setQuery("");
  };

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Library"
        description="Requirements the platform builds into your documents, with the authority behind each. Reference material, not legal advice: verify against the official source before relying on a row."
      />

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[14px] text-adm-muted">
          Jurisdiction
          <select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} className={FIELD} aria-label="Jurisdiction">
            <option value={ALL}>All</option>
            {jurisdictions.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[14px] text-adm-muted">
          Type
          <select value={type} onChange={(e) => setType(e.target.value)} className={FIELD} aria-label="Type">
            <option value={ALL}>All</option>
            <option value="Law">Law</option>
            <option value="Dealer policy">Dealer policy</option>
            <option value="Product check">Product check</option>
          </select>
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
        <Button variant="primary" onClick={clear} disabled={!filtered}>Clear filters</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <Panel flush>
          {rows.length === 0 ? (
            <EmptyState title="No requirement matches these filters" detail="Clear a filter or change the search." compact />
          ) : (
            <WorkTable caption="Compliance requirements" minWidth={720}>
              <thead>
                <tr>
                  <Th className="px-2.5">Jurisdiction</Th>
                  <Th className="px-2.5">Requirement</Th>
                  <Th className="px-2.5">Type</Th>
                  <Th className="px-2.5">Source</Th>
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
                      <Td className="whitespace-nowrap px-2.5 text-adm-muted">{r.jurisdiction}</Td>
                      <Td className="max-w-[210px] truncate px-2.5 font-semibold">
                        <button type="button" onClick={() => setSelectedId(r.id)} className="max-w-full truncate text-left hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary">{r.requirement}</button>
                      </Td>
                      <Td className="whitespace-nowrap px-2.5"><StatusText tone={TYPE_TONE[r.type]}>{r.type}</StatusText></Td>
                      <Td className="max-w-[150px] truncate px-2.5 text-adm-muted">{r.source}</Td>
                      <Td className="max-w-[110px] truncate px-2.5 text-adm-muted">{r.workflow}</Td>
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
