import { rewriteForState } from "@/lib/stateRewriter";
import { canonicalCondition } from "@/lib/vehicleCondition";
import { getStateCompliance } from "@/data/stateCompliance";

// Canonical, context-free disclosure packet shared by every signing surface
// (dealer print, /sign document, /review wizard) so the customer always sees
// the same complete, compliant content regardless of how they sign. Takes the
// data as props — no dealer settings/tenant context — so it renders on the
// public token pages too.

export interface PacketProduct {
  id?: string;
  name?: string;
  subtitle?: string | null;
  price?: number;
  badge_type?: string;
  benefit_justification?: string | null;
  benefit_justification_optional?: string | null;
  disclosure?: string | null;
}

export interface PacketDealer {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  license_number?: string;
  phone?: string;
}

const money = (n?: number) =>
  typeof n === "number" ? n.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "";

export function AddendumDisclosurePacket({
  state,
  vehiclePrice,
  docFeeAmount,
  vehicleCondition,
  language = "en",
  products = [],
  dealer,
  className = "",
}: {
  state?: string | null;
  vehiclePrice?: number | null;
  docFeeAmount?: number;
  // Accept a raw dealer label (Demo, Factory CPO, …) or a canonical value;
  // we normalize so the FTC Buyers Guide only attaches to used/cpo units.
  vehicleCondition?: string | null;
  language?: "en" | "es";
  products?: PacketProduct[];
  dealer?: PacketDealer;
  className?: string;
}) {
  const pack = rewriteForState(state || "", {
    vehiclePrice: vehiclePrice ?? undefined,
    docFeeAmount,
    vehicleCondition: canonicalCondition(vehicleCondition),
    saleConductedInSpanish: language === "es",
  });
  const blocks = pack.blocks.filter((b) => b.language === language || b.language === "en");

  const dealerAddr = dealer
    ? [dealer.address, [dealer.city, dealer.state].filter(Boolean).join(", "), dealer.zip].filter(Boolean).join(" · ")
    : "";

  return (
    <div className={`space-y-4 text-slate-800 ${className}`}>
      {/* Licensed seller identity */}
      {(dealer?.name || dealerAddr || dealer?.license_number) && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Licensed seller</p>
          {dealer?.name && <p className="text-sm font-bold text-slate-900 mt-1">{dealer.name}</p>}
          {dealerAddr && <p className="text-[12px] text-slate-600">{dealerAddr}</p>}
          <p className="text-[12px] text-slate-600">
            {dealer?.phone ? `Tel ${dealer.phone}` : ""}
            {dealer?.phone && dealer?.license_number ? " · " : ""}
            {dealer?.license_number ? `Dealer Lic #${dealer.license_number}` : ""}
          </p>
        </div>
      )}

      {/* Every product, full benefit + legal disclosure text */}
      {products.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <p className="text-sm font-bold text-slate-900">Products on this addendum</p>
          {products.map((p, i) => {
            const benefit = (p.benefit_justification || p.benefit_justification_optional || "").trim();
            const isOptional = p.badge_type === "optional";
            return (
              <div key={p.id || i} className="border-t border-slate-100 pt-3 first:border-0 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-900">{p.name}</p>
                    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${isOptional ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                      {isOptional ? "Optional — accept or decline" : "Pre-installed · included in price"}
                    </span>
                  </div>
                  {typeof p.price === "number" && (
                    <p className="text-[13px] font-bold tabular-nums text-slate-900 shrink-0">{money(p.price)}</p>
                  )}
                </div>
                {p.subtitle && <p className="text-[12px] text-slate-500 mt-1">{p.subtitle}</p>}
                {benefit && <p className="text-[12px] text-slate-700 mt-1 whitespace-pre-line leading-snug">{benefit}</p>}
                {p.disclosure && <p className="text-[11px] text-slate-500 mt-1 whitespace-pre-line leading-snug">{p.disclosure}</p>}
              </div>
            );
          })}
        </div>
      )}

      {/* State + federal statutory disclosure pack (FTC Buyers Guide, E-SIGN,
          voluntary add-ons, doc-fee, state-specific) — verbatim. */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-bold text-slate-900">{pack.stateName} required disclosures &amp; consumer rights</p>
        <div className="mt-3 space-y-3">
          {blocks.map((b) => (
            <div key={b.id} className="border-t border-slate-100 pt-3 first:border-0 first:pt-0">
              <p className="text-[12px] font-bold text-slate-900">
                {b.title}
                {b.required && <span className="ml-1 text-[9px] font-bold uppercase tracking-wider text-rose-600">Required</span>}
              </p>
              <p className="text-[12px] text-slate-700 mt-1 whitespace-pre-line leading-snug">{b.body}</p>
              {b.citation && <p className="text-[10px] text-slate-400 mt-0.5">{b.citation}</p>}
            </div>
          ))}

          {/* General notices that live outside the per-state block engine but
              are still required on the customer record (parity with the dealer
              page): sales-contract notice, post-sale add-on window, retention. */}
          {(() => {
            const c = getStateCompliance(state || "");
            return (
              <>
                {c.salesContractClause && (
                  <div className="border-t border-slate-100 pt-3">
                    <p className="text-[12px] font-bold text-slate-900">Sales contract notice</p>
                    <p className="text-[12px] text-slate-700 mt-1 whitespace-pre-line leading-snug">{c.salesContractClause}</p>
                  </div>
                )}
                {c.postSalePurchaseWindowDays > 0 && (
                  <div className="border-t border-slate-100 pt-3">
                    <p className="text-[12px] font-bold text-slate-900">Post-sale purchase window</p>
                    <p className="text-[12px] text-slate-700 mt-1 leading-snug">
                      Under {c.stateName} law you have up to {c.postSalePurchaseWindowDays} days after the date of
                      sale to purchase any optional add-on listed here. Contact the dealership within this window to
                      add a previously declined product.
                    </p>
                  </div>
                )}
                {c.recordRetentionYears > 0 && (
                  <div className="border-t border-slate-100 pt-3">
                    <p className="text-[12px] font-bold text-slate-900">Record retention</p>
                    <p className="text-[12px] text-slate-700 mt-1 leading-snug">
                      This document and its signing records are retained for at least {c.recordRetentionYears} years
                      under applicable federal and {c.stateName} requirements.
                    </p>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
