import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";

// ──────────────────────────────────────────────────────────────────────
// PriceAuditPanel — per-vehicle price/doc-fee traceability.
//
// For every in-stock VIN, shows the parsed price breakdown:
//   advertised price (before doc) · doc fee · calculated sale price
//   (advertised + doc fee) · the stored website sale price · match/mismatch
//   · last checked · the price source URL.
//
// website_sale_price must equal advertised_price_before_doc + doc_fee. A
// price_parse_status of "warning" means the dealer site's displayed sale price
// disagreed with the calculation — surfaced as "Price parse mismatch. Review
// source page." Read-only.
// ──────────────────────────────────────────────────────────────────────

interface Row {
  vin: string;
  advertised_price_before_doc: number | null;
  doc_fee: number | null;
  website_sale_price: number | null;
  price_source_url: string | null;
  price_last_verified_at: string | null;
  price_parse_status: string | null;
  price_parse_notes: string | null;
  source_url: string | null;
}

const fmt = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString());
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

export const PriceAuditPanel = () => {
  const { tenant } = useTenant();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!tenant?.id) return;
      setLoading(true);
      const { data } = await (supabase as never as { from: (t: string) => any })
        .from("vehicle_listings")
        .select(
          "vin, advertised_price_before_doc, doc_fee, website_sale_price, price_source_url, price_last_verified_at, price_parse_status, price_parse_notes, source_url",
        )
        .eq("tenant_id", tenant.id)
        .not("advertised_price_before_doc", "is", null)
        .order("price_last_verified_at", { ascending: false })
        .limit(500);
      if (active) {
        setRows((data as Row[]) || []);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [tenant?.id]);

  const mismatchCount = rows.filter((r) => r.price_parse_status === "warning").length;

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-foreground">Price Audit</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Advertised price + doc fee = website sale price, traced per VIN.
          </p>
        </div>
        {mismatchCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full bg-red-100 text-red-700">
            <AlertTriangle className="w-3.5 h-3.5" />
            {mismatchCount} mismatch{mismatchCount === 1 ? "" : "es"}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5" />
            All reconciled
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground py-6 text-center">Loading price audit…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">No priced vehicles yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="font-semibold px-2 py-2">VIN</th>
                <th className="font-semibold px-2 py-2 text-right">Advertised</th>
                <th className="font-semibold px-2 py-2 text-right">Doc fee</th>
                <th className="font-semibold px-2 py-2 text-right">Calc. sale</th>
                <th className="font-semibold px-2 py-2 text-right">Website sale</th>
                <th className="font-semibold px-2 py-2">Status</th>
                <th className="font-semibold px-2 py-2">Checked</th>
                <th className="font-semibold px-2 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const calc =
                  r.advertised_price_before_doc != null
                    ? Number(r.advertised_price_before_doc) + Number(r.doc_fee || 0)
                    : null;
                const mismatch = r.price_parse_status === "warning";
                const url = r.price_source_url || r.source_url;
                return (
                  <tr key={r.vin} className="border-b border-border/60 align-top">
                    <td className="px-2 py-2 font-mono text-[11px]">{r.vin}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt(r.advertised_price_before_doc)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt(r.doc_fee)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt(calc)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt(r.website_sale_price)}</td>
                    <td className="px-2 py-2">
                      {mismatch ? (
                        <span
                          className="inline-flex items-center gap-1 text-red-700 font-semibold"
                          title={r.price_parse_notes || "Price parse mismatch. Review source page."}
                        >
                          <AlertTriangle className="w-3.5 h-3.5" /> Mismatch
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Match
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground whitespace-nowrap">{fmtDate(r.price_last_verified_at)}</td>
                    <td className="px-2 py-2">
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> View
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {mismatchCount > 0 && (
            <p className="text-[11px] text-red-700 mt-3 inline-flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Price parse mismatch. Review source page.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default PriceAuditPanel;
