import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import Seo from "@/components/Seo";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useGetReady } from "@/hooks/useGetReady";
import { useInstallerInvoices, type InstallerInvoiceRow } from "@/hooks/useInstallerInvoices";
import { deriveInvoice, serviceCatalogPrices, type DerivedInvoice, type InvoiceLine } from "@/lib/invoices";
import { toCsv, downloadCsv } from "@/components/admin/tablePrimitives";
import {
  Button, EmptyState, InlineNote, LocalTabs, MetricStrip, PageBody, PageHeader, Panel, StatusText, Td, Th, WorkTable,
  type LocalTab,
} from "@/components/product";
import { fmtDay } from "@/components/detail/parts";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type InvoiceTab = "ready" | "invoiced" | "paid";

const TAB_LABEL: Record<InvoiceTab, string> = { ready: "Ready to invoice", invoiced: "Invoiced", paid: "Paid" };

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

interface InvoiceEntry {
  derived: DerivedInvoice;
  invoice: InstallerInvoiceRow | undefined;
  tab: InvoiceTab;
  lines: InvoiceLine[];
  total: number;
  date: string | null;
}

const workSummary = (lines: InvoiceLine[]) => {
  if (lines.length === 0) return "No billable lines";
  return lines.length === 1 ? lines[0].label : `${lines[0].label} +${lines.length - 1} more`;
};

const printInvoice = (e: InvoiceEntry, dealerName: string) => {
  const rows = e.lines
    .map((l) => `<tr><td>${esc(l.kind === "accessory" ? "Accessory install" : "Service")}</td><td>${esc(l.label)}${l.detail ? `<div class="sub">${esc(l.detail)}</div>` : ""}</td><td style="text-align:right">${esc(money(l.amount))}</td></tr>`)
    .join("");
  const w = window.open("", "_blank", "width=700,height=800");
  if (!w) { toast.error("Allow pop-ups to print the invoice"); return; }
  const number = e.invoice?.invoice_number || "Draft";
  w.document.write(`<html><head><title>Invoice ${esc(number)} ${esc(e.derived.vin)}</title>
    <style>body{font-family:Inter,Arial,sans-serif;color:#0F172A;padding:32px}h1{font-size:20px;margin:0}p{color:#64748B;margin:4px 0 16px}
    table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #E6E8EC;font-size:14px;text-align:left;vertical-align:top}
    .sub{color:#64748B;font-size:12px}tfoot td{font-weight:700;border-top:2px solid #0F172A}.meta{font-size:12px;color:#64748B;margin-bottom:16px}</style></head><body>
    <h1>${esc(dealerName)} Installer Invoice</h1>
    <p>${esc(e.derived.ymm || "Vehicle")} &middot; VIN ${esc(e.derived.vin)}</p>
    <div class="meta">Invoice ${esc(number)}${e.derived.stockNumber ? ` &middot; Stock ${esc(e.derived.stockNumber)}` : ""}${e.derived.roNumber ? ` &middot; RO ${esc(e.derived.roNumber)}` : ""} &middot; Status: ${esc(TAB_LABEL[e.tab])}</div>
    <table><thead><tr><th>Type</th><th>Work performed</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="2">Total</td><td style="text-align:right">${esc(money(e.total))}</td></tr></tfoot></table>
    </body></html>`);
  w.document.close();
  w.focus();
  w.print();
};

const InstallerInvoices = () => {
  const { tenant, currentStore } = useTenant();
  const { settings } = useDealerSettings();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const { records, loading: recordsLoading } = useGetReady(currentStore?.id || "");
  const { rows, loading, available, markInvoiced, markPaid } = useInstallerInvoices(tenantId);
  const [productPrices, setProductPrices] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const stateParam = params.get("state");
  const tab: InvoiceTab = stateParam === "invoiced" || stateParam === "paid" ? stateParam : "ready";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("products").select("id, price");
      if (cancelled || !data) return;
      const map: Record<string, number> = {};
      for (const p of data as { id: string; price: number }[]) map[p.id] = Number(p.price) || 0;
      setProductPrices(map);
    })();
    return () => { cancelled = true; };
  }, []);

  const servicePrices = useMemo(() => serviceCatalogPrices(settings.get_ready_services), [settings.get_ready_services]);

  const entries = useMemo<InvoiceEntry[]>(() => {
    const byRecord = new Map<string, InstallerInvoiceRow>();
    for (const r of rows) byRecord.set(r.get_ready_record_id, r);
    const dateOf = new Map(records.map((r) => [r.id, r.getReadyCompleteDate || r.createdAt || null]));
    const out: InvoiceEntry[] = [];
    for (const r of records) {
      const d = deriveInvoice(r, productPrices, servicePrices);
      if (!d) continue;
      const inv = byRecord.get(d.recordId);
      out.push({
        derived: d,
        invoice: inv,
        tab: inv ? (inv.status === "paid" ? "paid" : "invoiced") : "ready",
        lines: inv ? inv.line_items : d.lines,
        total: inv ? Number(inv.total) : d.total,
        date: inv ? (inv.paid_at && inv.status === "paid" ? inv.paid_at : inv.invoiced_at) : dateOf.get(d.recordId) ?? null,
      });
    }
    return out;
  }, [records, rows, productPrices, servicePrices]);

  const counts = useMemo(() => {
    const c = { ready: 0, invoiced: 0, paid: 0 };
    const sum = { ready: 0, invoiced: 0, paid: 0 };
    for (const e of entries) { c[e.tab] += 1; sum[e.tab] += e.total; }
    return { c, sum };
  }, [entries]);

  const shown = useMemo(() => entries.filter((e) => e.tab === tab), [entries, tab]);
  const shownTotal = shown.reduce((s, e) => s + e.total, 0);
  const isLoading = loading || recordsLoading;

  const tabs: LocalTab[] = (Object.keys(TAB_LABEL) as InvoiceTab[]).map((key) => ({
    key,
    label: TAB_LABEL[key],
    to: key === "ready" ? "/invoices" : `/invoices?state=${key}`,
    count: isLoading ? null : counts.c[key],
    active: tab === key,
  }));

  const act = async (e: InvoiceEntry) => {
    const key = e.invoice?.id ?? e.derived.recordId;
    setBusy(key);
    const ok = e.invoice ? await markPaid(e.invoice.id) : await markInvoiced(e.derived);
    setBusy(null);
    if (ok) toast.success(e.invoice ? "Marked paid" : "Marked invoiced");
    else toast.error(e.invoice ? "Could not update the invoice" : "Could not save the invoice");
  };

  const exportCsv = () => {
    type CsvRow = { invoice: string; status: string; vin: string; ymm: string; stock: string; ro: string; kind: string; label: string; detail: string; amount: number };
    const flat: CsvRow[] = [];
    for (const e of entries) {
      for (const l of e.lines) {
        flat.push({
          invoice: e.invoice?.invoice_number || "", status: e.invoice?.status || "open", vin: e.derived.vin, ymm: e.derived.ymm,
          stock: e.derived.stockNumber, ro: e.derived.roNumber, kind: l.kind, label: l.label, detail: l.detail, amount: l.amount,
        });
      }
    }
    if (flat.length === 0) { toast.error("Nothing to export yet"); return; }
    downloadCsv(`installer-invoices-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(flat, [
      { header: "Invoice", get: (r) => r.invoice },
      { header: "Status", get: (r) => r.status },
      { header: "VIN", get: (r) => r.vin },
      { header: "Vehicle", get: (r) => r.ymm },
      { header: "Stock", get: (r) => r.stock },
      { header: "RO", get: (r) => r.ro },
      { header: "Type", get: (r) => r.kind },
      { header: "Line item", get: (r) => r.label },
      { header: "Detail", get: (r) => r.detail },
      { header: "Amount", get: (r) => r.amount.toFixed(2) },
    ]));
  };

  const nextAction = (e: InvoiceEntry) => (e.tab === "ready" ? "Mark invoiced" : e.tab === "invoiced" ? "Mark paid" : null);

  return (
    <PageBody width="wide">
      <Seo title="Installer invoices" path="/invoices" description="Invoices for installed accessories and internal services" />
      <PageHeader
        title="Installer invoices"
        description="Invoices for installed accessories and services from completed Get Ready work."
        actions={<Button variant="secondary" onClick={exportCsv}>Export CSV</Button>}
      />
      <LocalTabs label="Invoice state" tabs={tabs} />
      <MetricStrip
        label="Installer invoice totals"
        metrics={[
          { label: "Ready to invoice", value: isLoading ? null : counts.c.ready, loading: isLoading, tone: "danger", hint: money(counts.sum.ready) },
          { label: "Invoiced (open)", value: isLoading ? null : counts.c.invoiced, loading: isLoading, tone: "info", hint: money(counts.sum.invoiced) },
          { label: "Paid", value: isLoading ? null : counts.c.paid, loading: isLoading, tone: "success", hint: money(counts.sum.paid) },
          { label: "Outstanding", value: isLoading ? null : money(counts.sum.ready + counts.sum.invoiced), loading: isLoading, tone: "neutral", hint: "Not yet paid" },
        ]}
      />
      {!available && (
        <InlineNote tone="warning" title="Invoice status cannot be saved yet.">
          Apply migration 20260704000000_get_ready_invoices.sql to enable invoiced and paid tracking. Line items are still derived live.
        </InlineNote>
      )}
      {isLoading ? (
        <Panel><div className="h-40" role="status" aria-label="Loading" /></Panel>
      ) : shown.length === 0 ? (
        <EmptyState
          title={entries.length === 0 ? "No billable Get Ready work yet" : `Nothing is ${TAB_LABEL[tab].toLowerCase()}`}
          detail={entries.length === 0 ? "Vehicles appear here once an accessory install or internal service is completed in Get Ready." : undefined}
        />
      ) : (
        <Panel flush>
          <WorkTable caption="Installer invoices" minWidth={900}>
            <thead>
              <tr>
                <Th>{tab === "ready" ? "Completed" : tab === "paid" ? "Paid" : "Invoiced"}</Th>
                <Th>RO</Th>
                <Th>Vehicle</Th>
                <Th>VIN</Th>
                <Th>Work performed</Th>
                <Th align="right">Amount</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => {
                const key = e.invoice?.id ?? e.derived.recordId;
                const next = nextAction(e);
                return (
                  <tr key={e.derived.recordId} className="hover:bg-adm-workspace">
                    <Td className="whitespace-nowrap">{fmtDay(e.date)}</Td>
                    <Td className="whitespace-nowrap">{e.derived.roNumber || "Unknown"}</Td>
                    <Td className="max-w-[170px]"><span className="block truncate font-semibold">{e.derived.ymm || "Vehicle"}</span></Td>
                    <Td className="whitespace-nowrap font-mono text-[12px]">{e.derived.vin}</Td>
                    <Td className="max-w-[170px]"><span className="block truncate">{workSummary(e.lines)}</span></Td>
                    <Td align="right" className="whitespace-nowrap">{money(e.total)}</Td>
                    <Td>
                      <StatusText tone={e.tab === "paid" ? "success" : e.tab === "invoiced" ? "info" : "warning"}>{TAB_LABEL[e.tab]}</StatusText>
                    </Td>
                    <Td align="right">
                      <span className="inline-flex items-center justify-end gap-2">
                        {available && next ? (
                          <button
                            type="button"
                            disabled={busy === key}
                            onClick={() => act(e)}
                            className="whitespace-nowrap text-[14px] font-semibold text-adm-primary hover:underline disabled:opacity-50"
                          >
                            {next}
                          </button>
                        ) : null}
                        <DropdownMenu>
                          <DropdownMenuTrigger aria-label={`More actions for ${e.derived.ymm || e.derived.vin}`} className="rounded-[6px] p-1 text-adm-muted hover:bg-adm-workspace">
                            <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => printInvoice(e, settings.dealer_name)}>Print invoice</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </WorkTable>
          <div className="flex items-center justify-between border-t border-adm-border px-4 py-3 text-[13px] leading-[18px] text-adm-muted">
            <span>{shown.length} in {TAB_LABEL[tab]}</span>
            <span className="text-[14px] text-adm-ink">Total <span className="font-semibold tabular-nums">{money(shownTotal)}</span></span>
          </div>
        </Panel>
      )}
    </PageBody>
  );
};

export default InstallerInvoices;
