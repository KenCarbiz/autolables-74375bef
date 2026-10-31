import { useMemo, useState } from "react";
import { ConsoleFrame } from "@/components/platformConsole/ConsoleFrame";
import { ConsoleIcon } from "@/components/platformConsole/icons";
import { ViewState, type Column } from "@/components/platformConsole/ui";
import { FootNote, Pill, RefTable, ReviewAction } from "@/components/platformConsole/uiB";
import { useConsoleView } from "@/lib/platformConsole/dataSource";
import { loadAudit, type AuditModel, type AuditRow } from "@/lib/platformConsole/live/audit";

const columns: Column<AuditRow>[] = [
  { key: "time", header: "Time / actor", width: "270px", render: (r) => r.timeActor },
  { key: "scope", header: "Scope", width: "160px", render: (r) => r.scope },
  { key: "action", header: "Action", width: "260px", render: (r) => r.action },
  { key: "outcome", header: "Outcome / reason", width: "360px", render: (r) => (r.outcome.tone ? <Pill tone={r.outcome.tone}>{r.outcome.label}</Pill> : r.outcome.label) },
  { key: "corr", header: "Correlation", width: "minmax(0,1fr)", render: (r) => r.correlation },
];

const selectCls = "h-11 w-[190px] appearance-none rounded-[6px] border border-[#D7E1ED] bg-white px-[14px] text-[13px] font-bold text-[#132A42] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#075BE8]";

export default function AuditView() {
  const view = useConsoleView<AuditModel>("audit", () => loadAudit());
  const m = view.data;
  return (
    <ConsoleFrame title="Platform audit" subtitle="Who changed what, in which store, with a reason and correlated evidence." onRefresh={view.isFixture ? undefined : view.refresh} refreshing={view.status === "loading"}>
      {view.status !== "ready" || !m ? (
        <ViewState status={view.status === "ready" ? "empty" : view.status} error={view.error} onRetry={view.refresh} what="audit history" />
      ) : (
        <AuditBody m={m} />
      )}
    </ConsoleFrame>
  );
}

function AuditBody({ m }: { m: AuditModel }) {
  const [store, setStore] = useState("");
  const [kind, setKind] = useState("");
  const stores = useMemo(() => [...new Set(m.rows.map((r) => r.scope))].sort(), [m.rows]);
  const kinds = useMemo(() => [...new Set(m.rows.map((r) => r.action))].sort(), [m.rows]);
  const rows = m.rows.filter((r) => (!store || r.scope === store) && (!kind || r.action === kind));
  const filtered = !!store || !!kind;
  return (
    <>
      <div className="flex flex-wrap items-start gap-3">
        <label className="sr-only" htmlFor="pc-audit-store">Store</label>
        <select id="pc-audit-store" value={store} onChange={(e) => setStore(e.target.value)} className={selectCls}>
          <option value="">All stores</option>
          {stores.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="sr-only" htmlFor="pc-audit-kind">Event type</label>
        <select id="pc-audit-kind" value={kind} onChange={(e) => setKind(e.target.value)} className={selectCls}>
          <option value="">All event types</option>
          {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <div className="ml-auto">
          <ReviewAction kind="audit_export" scope={filtered ? `audit:${store || "all"}:${kind || "all"}` : "audit:all"} label="Export filtered" icon="download" title="Export filtered audit history" summary="Exports are audited and credentials are excluded. Nothing is exported until the review is approved." facts={[{ label: "Rows in view", value: String(rows.length) }, { label: "Store", value: store || "All stores" }, { label: "Event type", value: kind || "All event types" }]} className="w-[190px] justify-start" submitLabel="Request export" />
        </div>
      </div>
      {m.unreadable.length > 0 && (
        <p role="status" className="flex items-center gap-2 text-[13px] text-[#885608]"><ConsoleIcon name="warning" size={16} />Not readable: {m.unreadable.join(", ")}. Rows from these sources are missing, not absent.</p>
      )}
      <RefTable rows={rows} columns={columns} rowKey={(r) => r.id} caption="Platform audit history" rowHeight={76} emptyNote={m.rowsNote} />
      <FootNote className={m.rows.length <= 5 ? "mt-[88px]" : "mt-2"}>{m.footnote}</FootNote>
    </>
  );
}
