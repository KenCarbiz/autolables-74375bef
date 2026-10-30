import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { Button, Panel, StatusText, Td, Th, WorkTable } from "@/components/product";
import { SectionHeading } from "./primitives";
import { complianceVinParam, vinDefenseHref } from "./childLinks";
import type { IssueRow } from "./complianceData";

export const VinDefenseSection = ({ rows, loading }: { rows: IssueRow[]; loading: boolean }) => {
  const navigate = useNavigate();
  const [vin, setVin] = useState("");
  const [q, setQ] = useState("");
  const clean = complianceVinParam(vin);

  const listed = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => !needle || [r.title, r.vin, r.stockNumber].filter(Boolean).join(" ").toLowerCase().includes(needle)).slice(0, 25);
  }, [rows, q]);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading title="VIN defense" description="Open a vehicle's evidence packet: every price snapshot, sticker, addendum, signature and audit event on record, hashed into one chain root." />
      <Panel inset="sm" bodyClassName="pt-4">
        <form
          className="flex flex-wrap items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (clean.length >= 11) navigate(vinDefenseHref(clean));
          }}
        >
          <div className="relative min-w-[260px] flex-1">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-adm-muted" aria-hidden="true" />
            <input
              value={vin}
              onChange={(e) => setVin(complianceVinParam(e.target.value))}
              placeholder="Enter a VIN"
              maxLength={17}
              aria-label="VIN"
              autoComplete="off"
              className="h-10 w-full rounded-md border border-adm-border bg-adm-surface pl-10 pr-3 font-mono text-[14px] text-adm-ink outline-none focus:ring-2 focus:ring-adm-primary"
            />
          </div>
          <Button type="submit" variant="primary" disabled={clean.length < 11}>Open packet</Button>
        </form>
      </Panel>
      <Panel title="In-stock vehicles" flush inset="sm" action={
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter vehicles" aria-label="Filter vehicles" className="h-9 w-56 rounded-md border border-adm-border bg-adm-surface px-3 text-[14px] outline-none focus:ring-2 focus:ring-adm-primary" />
      }>
        <WorkTable caption="In-stock vehicles" minWidth={640}>
          <thead>
            <tr>
              <Th>Vehicle</Th>
              <Th>Stock</Th>
              <Th>VIN</Th>
              <Th>Open issues</Th>
              <Th align="right">Evidence</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><Td className="text-adm-muted">Loading vehicles</Td><Td /><Td /><Td /><Td /></tr>
            ) : listed.length === 0 ? (
              <tr><Td className="text-adm-muted">No vehicles match.</Td><Td /><Td /><Td /><Td /></tr>
            ) : (
              listed.map((r) => (
                <tr key={r.vehicleId}>
                  <Td className="max-w-[280px] truncate font-medium">{r.title}</Td>
                  <Td className="font-mono text-[13px]">{r.stockNumber || "Unknown"}</Td>
                  <Td className="font-mono text-[13px]">{r.vin}</Td>
                  <Td>{r.issues.length === 0 ? <StatusText tone="success">Clear</StatusText> : <StatusText tone={r.critical > 0 ? "danger" : "warning"}>{r.issues.length} open</StatusText>}</Td>
                  <Td align="right"><Link to={vinDefenseHref(r.vin)} className="font-semibold text-adm-primary hover:underline">Open packet</Link></Td>
                </tr>
              ))
            )}
          </tbody>
        </WorkTable>
      </Panel>
    </div>
  );
};

export default VinDefenseSection;
