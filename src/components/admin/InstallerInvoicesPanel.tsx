import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useGetReady } from "@/hooks/useGetReady";
import { useInstallerInvoices, type InstallerInvoiceRow } from "@/hooks/useInstallerInvoices";
import { deriveInvoice, serviceCatalogPrices, type DerivedInvoice, type InvoiceLine } from "@/lib/invoices";
import { toCsv, downloadCsv } from "@/components/admin/tablePrimitives";
import { toast } from "sonner";
import { FileText, Printer, Download, CheckCircle2, Loader2, Receipt } from "lucide-react";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

interface PrintableInvoice {
  vin: string;
  ymm: string;
  stockNumber: string;
  roNumber: string;
  invoiceNumber: string;
  status: string;
  lines: InvoiceLine[];
  total: number;
}

const printInvoice = (inv: PrintableInvoice, dealerName: string) => {
  const rows = inv.lines
    .map((l) => `<tr><td>${esc(l.kind === "accessory" ? "Accessory install" : "Service")}</td><td>${esc(l.label)}${l.detail ? `<div class="sub">${esc(l.detail)}</div>` : ""}</td><td style="text-align:right">${esc(money(l.amount))}</td></tr>`)
    .join("");
  const w = window.open("", "_blank", "width=700,height=800");
  if (!w) { toast.error("Allow pop-ups to print the invoice"); return; }
  w.document.write(`<html><head><title>Invoice ${esc(inv.invoiceNumber)} — ${esc(inv.vin)}</title>
    <style>body{font-family:Inter,Arial,sans-serif;color:#0F172A;padding:32px}h1{font-size:20px;margin:0}p{color:#64748B;margin:4px 0 16px}
    table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #E6E8EC;font-size:14px;text-align:left;vertical-align:top}
    .sub{color:#64748B;font-size:12px}tfoot td{font-weight:700;border-top:2px solid #0F172A}.meta{font-size:12px;color:#64748B;margin-bottom:16px}</style></head><body>
    <h1>${esc(dealerName)} — Installer Invoice</h1>
    <p>${esc(inv.ymm || "Vehicle")} &middot; VIN ${esc(inv.vin)}</p>
    <div class="meta">Invoice ${esc(inv.invoiceNumber)}${inv.stockNumber ? ` &middot; Stock ${esc(inv.stockNumber)}` : ""}${inv.roNumber ? ` &middot; RO ${esc(inv.roNumber)}` : ""} &middot; Status: ${esc(inv.status)}</div>
    <table><thead><tr><th>Type</th><th>Work performed</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="2">Total</td><td style="text-align:right">${esc(money(inv.total))}</td></tr></tfoot></table>
    </body></html>`);
  w.document.close();
  w.focus();
  w.print();
};

// Installer Invoices — Supabase-backed, derived from completed get-ready
// work: installed accessories (priced from the product catalog) and internal
// services performed (cost captured on the get-ready item, service-catalog
// fallback). Marking a vehicle invoiced freezes the lines in
// get_ready_invoices; a second action marks it paid.
export default function InstallerInvoicesPanel() {
  const { tenant, currentStore } = useTenant();
  const { settings } = useDealerSettings();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const { records } = useGetReady(currentStore?.id || "");
  const { rows, loading, available, markInvoiced, markPaid } = useInstallerInvoices(tenantId);
  const [productPrices, setProductPrices] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);

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
  const byRecord = useMemo(() => {
    const map = new Map<string, InstallerInvoiceRow>();
    for (const r of rows) map.set(r.get_ready_record_id, r);
    return map;
  }, [rows]);

  const derived = useMemo(
    () => records
      .map((r) => deriveInvoice(r, productPrices, servicePrices))
      .filter((d): d is DerivedInvoice => d !== null),
    [records, productPrices, servicePrices],
  );

  const stats = useMemo(() => ({
    invoiceable: derived.filter((d) => !byRecord.has(d.recordId)).length,
    invoiced: rows.filter((r) => r.status === "invoiced").length,
    paid: rows.filter((r) => r.status === "paid").length,
    outstanding: rows.filter((r) => r.status === "invoiced").reduce((sum, r) => sum + Number(r.total), 0),
  }), [derived, byRecord, rows]);

  const onMarkInvoiced = async (d: DerivedInvoice) => {
    setBusy(d.recordId);
    const ok = await markInvoiced(d);
    setBusy(null);
    if (ok) toast.success("Marked invoiced");
    else toast.error("Couldn't save the invoice");
  };

  const onMarkPaid = async (row: InstallerInvoiceRow) => {
    setBusy(row.id);
    const ok = await markPaid(row.id);
    setBusy(null);
    if (ok) toast.success("Marked paid");
    else toast.error("Couldn't update the invoice");
  };

  const exportCsv = () => {
    type CsvRow = { invoice: string; status: string; vin: string; ymm: string; stock: string; ro: string; kind: string; label: string; detail: string; amount: number };
    const flat: CsvRow[] = [];
    for (const d of derived) {
      const inv = byRecord.get(d.recordId);
      const lines = inv ? inv.line_items : d.lines;
      for (const l of lines) {
        flat.push({
          invoice: inv?.invoice_number || "",
          status: inv?.status || "open",
          vin: d.vin,
          ymm: d.ymm,
          stock: d.stockNumber,
          ro: d.roNumber,
          kind: l.kind,
          label: l.label,
          detail: l.detail,
          amount: l.amount,
        });
      }
    }
    if (flat.length === 0) { toast.error("Nothing to export yet"); return; }
    const csv = toCsv(flat, [
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
    ]);
    downloadCsv(`installer-invoices-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-foreground inline-flex items-center gap-1.5">
            <Receipt className="w-4 h-4 text-blue-600" /> Installer Invoices
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
            Billable work derived from completed Get-Ready records — accessory installs priced from your
            product catalog plus internal services performed. Mark each vehicle invoiced, then paid.
          </p>
        </div>
        <button onClick={exportCsv} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-border text-xs font-semibold hover:bg-muted">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatMini icon={FileText} label="Ready to invoice" value={String(stats.invoiceable)} color="text-amber-600" />
        <StatMini icon={Receipt} label="Invoiced" value={String(stats.invoiced)} color="text-blue-600" />
        <StatMini icon={CheckCircle2} label="Paid" value={String(stats.paid)} color="text-emerald-600" />
        <StatMini icon={FileText} label="Outstanding" value={money(stats.outstanding)} color="text-foreground" />
      </div>

      {!available && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Invoice status can't be saved yet — apply migration{" "}
          <span className="font-mono">20260704000000_get_ready_invoices.sql</span> to enable
          mark-as-invoiced and paid tracking. Line items below are still derived live.
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" /></div>
      ) : derived.length === 0 ? (
        <div className="bg-card rounded-xl border border-border shadow-premium px-5 py-10 text-center">
          <Receipt className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm font-semibold text-foreground">No billable get-ready work yet</p>
          <p className="text-xs text-muted-foreground mt-1">Vehicles appear here as soon as an accessory install or internal service is completed in Get-Ready.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {derived.map((d) => {
            const inv = byRecord.get(d.recordId);
            const lines = inv ? inv.line_items : d.lines;
            const total = inv ? Number(inv.total) : d.total;
            const status = inv?.status || "open";
            const printable: PrintableInvoice = {
              vin: d.vin, ymm: d.ymm, stockNumber: d.stockNumber, roNumber: d.roNumber,
              invoiceNumber: inv?.invoice_number || "Draft", status, lines, total,
            };
            return (
              <div key={d.recordId} className="bg-card rounded-xl border border-border shadow-premium overflow-hidden">
                <div className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap border-b border-border">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{d.ymm || "Vehicle"}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">
                      {d.vin}{d.stockNumber ? ` · Stock ${d.stockNumber}` : ""}{d.roNumber ? ` · RO ${d.roNumber}` : ""}{inv ? ` · ${inv.invoice_number}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                      status === "paid" ? "bg-emerald-50 text-emerald-700"
                      : status === "invoiced" ? "bg-blue-50 text-blue-700"
                      : "bg-amber-50 text-amber-700"
                    }`}>{status}</span>
                    <button onClick={() => printInvoice(printable, settings.dealer_name)} title="Print invoice" className="h-8 px-2.5 rounded-lg border border-border text-[11px] font-semibold inline-flex items-center gap-1 hover:bg-muted">
                      <Printer className="w-3.5 h-3.5" /> Print
                    </button>
                    {available && !inv && (
                      <button disabled={busy === d.recordId} onClick={() => onMarkInvoiced(d)} className="h-8 px-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-50">
                        {busy === d.recordId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Receipt className="w-3.5 h-3.5" />} Mark invoiced
                      </button>
                    )}
                    {available && inv && inv.status === "invoiced" && (
                      <button disabled={busy === inv.id} onClick={() => onMarkPaid(inv)} className="h-8 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-50">
                        {busy === inv.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Mark paid
                      </button>
                    )}
                  </div>
                </div>
                <div className="divide-y divide-border/60">
                  {lines.map((l, i) => (
                    <div key={i} className="px-5 py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{l.label}</p>
                        <p className="text-[10px] text-muted-foreground">{l.kind === "accessory" ? "Accessory install" : "Service"}{l.detail ? ` · ${l.detail}` : ""}</p>
                      </div>
                      <p className="text-xs font-bold tabular-nums">{money(l.amount)}</p>
                    </div>
                  ))}
                  <div className="px-5 py-2.5 flex items-center justify-between bg-muted/30">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Total</p>
                    <p className="text-sm font-extrabold tabular-nums">{money(total)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatMini({ icon: Icon, label, value, color }: { icon: typeof FileText; label: string; value: string; color: string }) {
  return (
    <div className="bg-card rounded-xl border border-border p-3.5">
      <Icon className={`w-4 h-4 ${color}`} />
      <p className={`text-lg font-bold tabular-nums mt-1 ${color}`}>{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}
