import { useState, useEffect, useRef, useMemo } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import SignaturePad from "@/components/addendum/SignaturePad";
import SB766DisclosurePanel from "@/components/addendum/SB766DisclosurePanel";
import TransactionAuditRecord from "@/components/addendum/TransactionAuditRecord";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { AddendumDisclosurePacket, type PacketProduct } from "@/components/addendum/AddendumDisclosurePacket";
import { needsUsedCarWarranty } from "@/lib/vehicleCondition";
import {
  ESIGN_CONSENT_TEXT,
  buildConsentRecord,
  fetchClientIp,
  fetchGeoloc,
  hashPayload,
} from "@/lib/esign";
import { getStateRule, validateAddendum, summarizeFindings } from "@/lib/stateCompliance";
import { runComplianceRedTeam, summarizeRedTeam } from "@/lib/complianceRedTeam";
import { isSb766Applicable, type FinancingDisclosure } from "@/lib/sb766";

// ──────────────────────────────────────────────────────────────
// Customer Review Mode — the guided, one-screen-at-a-time version
// of the remote signing flow. Same hashed, court-defensible payload
// as /sign/:token (MobileSigning), but the customer reviews a
// transaction, not a document: Purchase Summary hero → installed →
// optional → pricing → disclosures → sign. Big touch targets, a
// progress bar, scannable benefit bullets. The long compliance PDF
// is generated server-side from the signed payload, not shown here.
// ──────────────────────────────────────────────────────────────

interface ProductSnapshot {
  id: string;
  name: string;
  subtitle: string | null;
  warranty: string | null;
  badge_type: string;
  price: number;
  price_label: string | null;
  disclosure: string | null;
  price_in_advertised?: boolean;
  benefit_justification?: string | null;
  benefit_justification_optional?: string | null;
}

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Turn a benefit blob into scannable bullets. We never render the raw
// paragraph in a scroll box on the customer-facing review (FTC
// defensibility); we split on sentence/line boundaries into checkmark
// bullets the customer can actually read.
const toBullets = (text: string | null | undefined): string[] => {
  if (!text) return [];
  return text
    .split(/[\n•]|(?<=[.!?])\s+/)
    .map((s) => s.replace(/^[\s•\-–]+/, "").trim())
    .filter((s) => s.length > 1)
    .slice(0, 4);
};

const STATUTORY_INITIAL_KEYWORDS = [
  "gap", "service contract", "vehicle service", "vsc", "extended warranty",
  "extended service", "credit life", "credit insurance", "credit disability",
  "debt cancellation", "guaranteed asset",
];

const CustomerReview = () => {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [addendum, setAddendum] = useState<any>(null);
  const [error, setError] = useState("");
  const openedFiredRef = useRef(false);
  const startedFiredRef = useRef(false);

  const [step, setStep] = useState(0);
  const [initials, setInitials] = useState<Record<string, string>>({});
  const [optionalSelections, setOptionalSelections] = useState<Record<string, string>>({});
  const [customerName, setCustomerName] = useState("");
  const [customerSig, setCustomerSig] = useState({ data: "", type: "draw" as "draw" | "type" });
  const [cobuyerName, setCobuyerName] = useState("");
  const [cobuyerSig, setCobuyerSig] = useState({ data: "", type: "draw" as "draw" | "type" });
  const [warrantyAck, setWarrantyAck] = useState(false);
  const [deliveryMileage, setDeliveryMileage] = useState("");
  const [stickerMatchAck, setStickerMatchAck] = useState(false);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [esignConsent, setEsignConsent] = useState(false);
  const [showFullConsent, setShowFullConsent] = useState(false);
  const [finalChecklistAck, setFinalChecklistAck] = useState(false);
  const [sb766ThreeDayAck, setSb766ThreeDayAck] = useState(false);
  const [sb766Disclosure, setSb766Disclosure] = useState<FinancingDisclosure | null>(null);
  // Captured at submit so the post-sign Transaction Audit Record can render
  // the exact device/IP/hash that were sealed into the signed payload.
  const [auditRecord, setAuditRecord] = useState<{
    dealId: string; vin: string | null; signedAt: string; customerName: string;
    ip: string | null; userAgent: string | null; contentHash: string;
    location: { latitude?: number | null; longitude?: number | null } | null;
  } | null>(null);

  useEffect(() => {
    if (!token) return;
    loadAddendum();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadAddendum = async () => {
    const { data, error } = await supabase.rpc("get_addendum_by_token", { _token: token });
    if (error || !data || data.length === 0) {
      setError("Invalid or expired review link.");
      setLoading(false);
      return;
    }
    const doc = data[0];
    setAddendum(doc);
    setInitials((doc.initials as Record<string, string>) || {});
    setOptionalSelections((doc.optional_selections as Record<string, string>) || {});
    setCobuyerName((doc.cobuyer_name as string) || "");
    if (doc.status === "signed") setSubmitted(true);
    setLoading(false);
    fireFunnelEvent("signing_link_opened", openedFiredRef);
    if (doc.status !== "signed") emitTimelineEvent("customer_opened");
  };

  const fireFunnelEvent = (
    event: "signing_link_opened" | "signing_link_started",
    ref: React.MutableRefObject<boolean>,
  ) => {
    if (ref.current || !token) return;
    ref.current = true;
    (supabase as any).rpc("record_signing_event", {
      _signing_token: token,
      _event: event,
      _details: { ua: typeof navigator !== "undefined" ? navigator.userAgent : null, mode: "review" },
    }).catch(() => { /* best-effort telemetry */ });
  };
  const markStarted = () => {
    fireFunnelEvent("signing_link_started", startedFiredRef);
    emitTimelineEvent("reviewing");
  };

  // Appends a customer-side event to the addendum timeline (DocuSign-style),
  // keyed by the signing token via a definer RPC. Best-effort; never blocks.
  const emitTimelineEvent = (event: string, details: Record<string, unknown> = {}) => {
    if (!token) return;
    (supabase as any)
      .rpc("record_addendum_event", { _signing_token: token, _event: event, _channel: null, _details: details })
      .then(() => {}, () => { /* events table may still be propagating */ });
  };

  const products: ProductSnapshot[] = addendum?.products_snapshot || [];
  const installed = products.filter((p) => p.badge_type === "installed");
  const optional = products.filter((p) => p.badge_type === "optional");
  const isAddedOn = (p: ProductSnapshot) =>
    p.badge_type === "installed" && p.price_in_advertised === false;
  const includedInstalled = installed.filter((p) => p.price_in_advertised !== false);
  const addedInstalled = installed.filter((p) => p.price_in_advertised === false);
  const electable = products.filter((p) => p.badge_type === "optional" || isAddedOn(p));
  const isFinanced = !!addendum?.financing_input;
  // Two-buyer deals require a co-buyer signature too. Surfaces only when the
  // token row carries a co-buyer name (needs the field exposed by
  // get_addendum_by_token); otherwise the flow stays single-signer.
  const hasCobuyer = !!(addendum?.cobuyer_name && String(addendum.cobuyer_name).trim());

  const requiresStatutoryInitials = (name: string) =>
    STATUTORY_INITIAL_KEYWORDS.some((k) => name.toLowerCase().includes(k));
  const needsInitials = (p: ProductSnapshot) =>
    (p.badge_type === "installed" && p.price_in_advertised !== false) ||
    (isAddedOn(p) && optionalSelections[p.id] === "accept") ||
    (p.badge_type === "optional" && requiresStatutoryInitials(p.name) && optionalSelections[p.id] === "accept");

  const benefitOf = (p: ProductSnapshot) =>
    toBullets(p.benefit_justification) .concat(toBullets(p.benefit_justification_optional))
      .concat(p.warranty ? [p.warranty] : [])
      .slice(0, 4);

  const ADDON_ELECTION_BANNER = isFinanced
    ? "These add-ons are optional and yours to choose. Adding or skipping any of them won't change your vehicle price or your interest rate. Accept the ones you want and decline the rest."
    : "These add-ons are optional and yours to choose. Adding or skipping any of them won't change your vehicle price. Accept the ones you want and decline the rest.";
  const ADDON_ELECTION_DISCLOSURE_VERSION = "ael-2026-06-14";

  const effectivePrice = (p: ProductSnapshot) => p.price;
  const includedItems = includedInstalled;
  const addedItems = electable.filter((p) => optionalSelections[p.id] === "accept");
  const includedTotal = includedItems.reduce((s, p) => s + effectivePrice(p), 0);
  const addedTotal = addedItems.reduce((s, p) => s + effectivePrice(p), 0);
  const advertisedPrice = typeof addendum?.vehicle_price === "number" ? addendum.vehicle_price : null;
  const finalAllIn = advertisedPrice != null ? advertisedPrice + addedTotal : null;
  const docFeeProduct = products.find((p) => {
    const n = p.name.toLowerCase();
    return n.includes("doc") || n.includes("conveyance") || n.includes("processing fee") || n.includes("documentation");
  });

  const sb766Applies = isSb766Applicable(addendum?.vehicle_state, addendum?.vehicle_price);

  // ── Dynamic step list. Sections with no content collapse out so the
  // customer never sees an empty screen. ──────────────────────────
  const steps = useMemo(() => {
    const list: { id: string; label: string }[] = [{ id: "summary", label: "Your purchase" }];
    if (includedInstalled.length > 0) list.push({ id: "installed", label: "Installed" });
    if (addedInstalled.length > 0 || optional.length > 0) list.push({ id: "optional", label: "Add-ons" });
    list.push({ id: "pricing", label: "Pricing" });
    list.push({ id: "disclosures", label: "Disclosures" });
    list.push({ id: "sign", label: "Sign" });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products.length, addendum?.id]);

  const current = steps[Math.min(step, steps.length - 1)];

  // Per-step gating — Continue is disabled until the step's
  // requirements are satisfied.
  const initialItems = products.filter((p) => needsInitials(p));
  const installedDone = includedInstalled.every((p) => (initials[p.id] || "").trim().length > 0);
  const electableChosen = electable.every((p) => !!optionalSelections[p.id]);
  const electableInitialsDone = electable.every(
    (p) => !(needsInitials(p)) || (initials[p.id] || "").trim().length > 0,
  );
  // FTC Used Car Rule warranty + mileage only applies to used/CPO units; new
  // and demo cars skip it (and it must not gate their Continue).
  const isUsedCar = needsUsedCarWarranty(addendum?.vehicle_condition);
  const disclosuresDone =
    esignConsent && stickerMatchAck &&
    (!isUsedCar || (warrantyAck && deliveryMileage.trim().length > 0)) &&
    (!sb766Applies || sb766ThreeDayAck);

  const canAdvance = (() => {
    switch (current?.id) {
      case "installed": return installedDone;
      case "optional": return electableChosen && electableInitialsDone;
      case "pricing": return paymentConfirmed;
      case "disclosures": return disclosuresDone;
      case "sign": return finalChecklistAck && customerName.trim().length > 0 && !!customerSig.data
        && (!hasCobuyer || (cobuyerName.trim().length > 0 && !!cobuyerSig.data));
      default: return true;
    }
  })();

  const advanceHint = (() => {
    switch (current?.id) {
      case "installed": return "Initial each installed item to continue.";
      case "optional": return "Accept or decline each option to continue.";
      case "pricing": return "Confirm your price breakdown to continue.";
      case "disclosures": return "Complete the acknowledgments to continue.";
      case "sign": return "Add your name and signature to finish.";
      default: return "";
    }
  })();

  const goNext = () => {
    if (!canAdvance) { toast.error(advanceHint); return; }
    markStarted();
    if (step < steps.length - 1) {
      setStep((s) => s + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };
  const goBack = () => {
    if (step > 0) { setStep((s) => s - 1); window.scrollTo({ top: 0, behavior: "smooth" }); }
  };

  const handleSubmit = async () => {
    if (!esignConsent) { toast.error("Please accept the Electronic Records Disclosure."); return; }
    const missingInitials = products.filter((p) => needsInitials(p) && !initials[p.id]?.trim());
    if (missingInitials.length > 0) { toast.error(`Please initial all ${missingInitials.length} item(s).`); return; }
    if (electable.some((p) => !optionalSelections[p.id])) { toast.error("Please accept or decline every option."); return; }
    if (!warrantyAck) { toast.error("Please acknowledge the warranty status."); return; }
    if (!deliveryMileage.trim()) { toast.error("Please confirm mileage at delivery."); return; }
    if (!stickerMatchAck) { toast.error("Please acknowledge the window sticker matches this addendum."); return; }
    if (!paymentConfirmed) { toast.error("Please confirm your price breakdown."); return; }
    if (sb766Applies && !sb766ThreeDayAck) { toast.error("Please acknowledge the California 3-Day Right to Cancel notice."); return; }
    if (!customerSig.data) { toast.error("Please provide your signature."); return; }
    if (hasCobuyer && !cobuyerSig.data) { toast.error("The co-buyer also needs to sign."); return; }

    setSubmitting(true);
    const consent = buildConsentRecord();
    const [customerIp, geoloc, prepSnapshot, installProofs] = await Promise.all([
      fetchClientIp(),
      fetchGeoloc(),
      (async () => {
        try {
          const { data } = await (supabase as any)
            .from("prep_sign_offs")
            .select("id,vin,accessories_installed,inspection_passed,inspection_form_type,foreman_name,signed_at,listing_unlocked")
            .eq("vin", addendum.vehicle_vin)
            .eq("listing_unlocked", true)
            .order("signed_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          return data || null;
        } catch { return null; }
      })(),
      (async () => {
        try {
          const { data } = await (supabase as any)
            .from("install_proofs")
            .select("id,product_name,installer_name,installer_company,installed_at,photo_path,created_at")
            .eq("vehicle_vin", addendum.vehicle_vin)
            .order("created_at", { ascending: false });
          return data || [];
        } catch { return []; }
      })(),
    ]);

    const stateCode = (addendum.vehicle_state || "").toString().toUpperCase() || null;
    const stateRule = stateCode ? getStateRule(stateCode) : null;

    const complianceDraft = {
      state: stateCode || "",
      vehiclePrice: addendum.vehicle_price,
      docFeeAmount: docFeeProduct?.price,
      stickerText: products.map((p) => `${p.name} ${p.disclosure || ""}`).join(" "),
      products: products.map((p) => {
        const isElectable = p.badge_type === "optional" || isAddedOn(p);
        const effBadge = isAddedOn(p) && optionalSelections[p.id] !== "accept" ? "optional" : p.badge_type;
        return {
          id: p.id,
          name: p.name,
          price: p.price,
          badge_type: effBadge,
          disclosure: p.disclosure || undefined,
          // Carry the benefit text so the red-team sees the same justification
          // the dealer side did — without it, every installed line falsely
          // reads as "missing benefit justification" and blocks the customer.
          benefit_justification: p.benefit_justification || undefined,
          benefit_justification_optional: p.benefit_justification_optional || undefined,
          price_in_advertised: (p as { price_in_advertised?: boolean }).price_in_advertised,
          separate_signoff: isElectable ? !!optionalSelections[p.id] : !!initials[p.id]?.trim(),
        };
      }),
      spanishVersion: consent.language?.startsWith("es") || false,
      threeDayAck: sb766ThreeDayAck,
    };
    const complianceFindings = validateAddendum(complianceDraft);
    const complianceSummary = summarizeFindings(complianceFindings);

    const redTeamFindings = runComplianceRedTeam({
      ...complianceDraft,
      customerName,
      initialsByProductId: initials,
      esignConsentAccepted: esignConsent,
      signedAt: new Date().toISOString(),
      ...(addendum.vehicle_condition ? { vehicleCondition: addendum.vehicle_condition } : {}),
      ...(typeof addendum.buyers_guide_id !== "undefined" ? { buyersGuideAttached: addendum.buyers_guide_id != null } : {}),
    });
    // The customer can only resolve THEIR parts (initials, name, e-sign
    // consent) — and the wizard already gates those per step. Dealer-content
    // findings (missing benefit text, banned phrases, buyers-guide, prep) are
    // enforced on the dealer side before sending, so they must never dead-end
    // the customer here.
    const CUSTOMER_FIXABLE = new Set(["unsigned-installed", "customer-name-blank", "esign-consent-missing"]);
    const blockingFails = redTeamFindings.filter((f) => f.severity === "fail" && CUSTOMER_FIXABLE.has(f.id));
    if (blockingFails.length > 0) {
      toast.error(`Blocked: ${blockingFails.slice(0, 2).map((f) => f.rule).join(" • ")}`);
      setSubmitting(false);
      return;
    }

    const canonicalPayload = {
      addendum_id: addendum.id,
      vehicle_vin: addendum.vehicle_vin,
      vehicle_ymm: addendum.vehicle_ymm,
      vehicle_state: stateCode,
      vehicle_price: addendum.vehicle_price ?? null,
      products_snapshot: addendum.products_snapshot,
      review_mode: "guided",
      initials,
      optional_selections: optionalSelections,
      addon_election: {
        disclosure_version: ADDON_ELECTION_DISCLOSURE_VERSION,
        disclosure_text: ADDON_ELECTION_BANNER,
        financed: isFinanced,
        selections: optionalSelections,
      },
      payment_walk: {
        advertised_price: advertisedPrice,
        included_in_advertised_ids: includedItems.map((p) => p.id),
        included_in_advertised_total: includedTotal,
        added_above_advertised_ids: addedItems.map((p) => p.id),
        added_above_advertised_total: addedTotal,
        final_all_in: finalAllIn,
        confirmed: paymentConfirmed,
      },
      customer_name: customerName,
      warranty_ack: warrantyAck,
      sticker_match_ack: stickerMatchAck,
      payment_confirmed: paymentConfirmed,
      delivery_mileage: deliveryMileage,
      esign_consent_version: consent.version,
      sb766_three_day_return_ack: sb766ThreeDayAck || null,
      sb766_financing_disclosure: sb766Disclosure,
      prep_sign_off_snapshot: prepSnapshot,
      install_proofs_snapshot: installProofs,
      state_rule_snapshot: stateRule,
      compliance_findings: complianceFindings,
      compliance_summary: complianceSummary,
      signing_location: geoloc,
      user_agent: consent.user_agent,
      customer_ip: customerIp,
      signed_at: new Date().toISOString(),
    };
    const contentHash = await hashPayload(canonicalPayload);

    const acknowledgments = {
      warranty_ack: warrantyAck,
      sticker_match_ack: stickerMatchAck,
      sb766_three_day_return_ack: sb766ThreeDayAck || false,
      sb766_financing_disclosure: sb766Disclosure || null,
      initials,
      optional_selections: optionalSelections,
    };

    const { error } = await (supabase as any).rpc("record_customer_signing", {
      _signing_token: token!,
      _signer_type: "customer",
      _signer_name: customerName || null,
      _signer_email: null,
      _signer_phone: null,
      _signature_data: customerSig.data,
      _signature_type: customerSig.type,
      _ip_address: customerIp,
      _user_agent: consent.user_agent,
      _signing_location: geoloc as any,
      _content_hash: contentHash,
      _esign_consent: consent as any,
      _canonical_payload: canonicalPayload,
      _acknowledgments: acknowledgments,
      _delivery_mileage: deliveryMileage ? parseInt(deliveryMileage, 10) : null,
      _price_overrides: {} as any,
    });

    setSubmitting(false);
    if (error) {
      const { error: legacyErr } = await supabase
        .from("addendums")
        .update({
          initials: initials as any,
          optional_selections: optionalSelections as any,
          customer_name: customerName || null,
          customer_signature_data: customerSig.data,
          customer_signature_type: customerSig.type,
          customer_signed_at: new Date().toISOString(),
          status: "signed",
          content_hash: contentHash,
          esign_consent: consent as any,
          user_agent: consent.user_agent,
          delivery_mileage: deliveryMileage ? parseInt(deliveryMileage, 10) : null,
          sticker_match_ack: stickerMatchAck,
          warranty_ack: warrantyAck,
          customer_ip: customerIp,
          signing_location: geoloc as any,
          sb766_three_day_return_ack: sb766ThreeDayAck || null,
          sb766_financing_disclosure: sb766Disclosure as any,
        } as any)
        .eq("signing_token", token!);
      if (legacyErr) { toast.error("Failed to submit. Please try again."); return; }
    }
    // Co-buyer signature, recorded as a second signer on the same deal.
    if (hasCobuyer && cobuyerSig.data) {
      await (supabase as any).rpc("record_customer_signing", {
        _signing_token: token!,
        _signer_type: "cobuyer",
        _signer_name: cobuyerName || null,
        _signer_email: null,
        _signer_phone: null,
        _signature_data: cobuyerSig.data,
        _signature_type: cobuyerSig.type,
        _ip_address: customerIp,
        _user_agent: consent.user_agent,
        _signing_location: geoloc as any,
        _content_hash: contentHash,
        _esign_consent: consent as any,
        _canonical_payload: canonicalPayload,
        _acknowledgments: acknowledgments,
        _delivery_mileage: deliveryMileage ? parseInt(deliveryMileage, 10) : null,
        _price_overrides: {} as any,
      }).then(() => {}, () => { /* best-effort co-buyer record */ });
    }
    setAuditRecord({
      dealId: addendum.id,
      vin: addendum.vehicle_vin ?? null,
      signedAt: canonicalPayload.signed_at,
      customerName,
      ip: customerIp,
      userAgent: consent.user_agent,
      contentHash,
      location: geoloc as { latitude?: number | null; longitude?: number | null } | null,
    });
    emitTimelineEvent("customer_signed", { name: customerName });
    setSubmitted(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-mono uppercase tracking-[0.18em] text-slate-500">Loading</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-6">
        <div className="text-center max-w-sm">
          <h1 className="text-2xl font-black font-display tracking-tight text-slate-950">Cannot open</h1>
          <p className="text-sm text-slate-600 mt-2">{error}</p>
          <a href="/lookup" className="mt-6 inline-flex items-center justify-center h-11 px-5 rounded-xl bg-slate-950 text-white text-sm font-bold hover:bg-slate-900">
            Look up my link
          </a>
        </div>
      </div>
    );
  }

  if (submitted) {
    const signedAt = new Date().toLocaleString();
    const dealerName = addendum?.dealer_snapshot?.name || "Your Dealership";
    return (
      <div className="min-h-screen bg-white">
        <div className="max-w-xl mx-auto px-5 pt-10 pb-10 space-y-6">
          <div className="rounded-3xl bg-slate-950 text-white p-8 md:p-10">
            <p className="text-[10px] uppercase tracking-[0.22em] text-emerald-400 font-semibold">Signed</p>
            <h1 className="mt-2 text-4xl md:text-5xl font-black font-display tracking-[-0.03em] leading-[0.95]">You're done.</h1>
            <p className="mt-3 text-sm text-white/75 leading-relaxed max-w-sm">
              {dealerName} has a hashed, time-stamped copy. A signed packet is on its way to your email.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-slate-500">Vehicle</p>
              <p className="text-base font-bold text-slate-950 mt-1">{addendum.vehicle_ymm || "Vehicle"}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-slate-500">Signed by</p>
              <p className="text-base font-bold text-slate-950 mt-1">{customerName || "—"}</p>
              <p className="text-[10px] font-mono text-slate-500">{signedAt}</p>
            </div>
          </div>
          {auditRecord && (
            <TransactionAuditRecord
              dealId={auditRecord.dealId}
              vin={auditRecord.vin}
              signedAt={auditRecord.signedAt}
              customerName={auditRecord.customerName}
              ip={auditRecord.ip}
              userAgent={auditRecord.userAgent}
              contentHash={auditRecord.contentHash}
              location={auditRecord.location}
            />
          )}

          <p className="text-center text-[10px] font-mono uppercase tracking-wider text-slate-400 pt-2">
            You can close this page. A copy is on its way.
          </p>
        </div>
      </div>
    );
  }

  const progressPct = Math.round(((step + 1) / steps.length) * 100);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Sticky progress header — Step X of N + bar. iPad-sized. */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-2xl mx-auto px-5 py-3.5">
          <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.16em] font-semibold">
            <div className="flex items-center gap-2 min-w-0">
              {step > 0 && (
                <button
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900 normal-case tracking-normal"
                  aria-label="Go back a step"
                >
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
              )}
              <span className="text-slate-950">Step {step + 1} of {steps.length}</span>
            </div>
            <a
              href={token ? `/sign/${token}?doc=1` : "#"}
              className="text-slate-500 hover:text-slate-900 normal-case tracking-normal underline decoration-dotted underline-offset-2"
              title="See and sign the full single-page addendum instead"
            >
              Full document →
            </a>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full bg-slate-950 transition-all duration-300" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      </header>

      <main className="flex-1 px-5 py-6" onFocusCapture={markStarted} onTouchStartCapture={markStarted}>
        <div key={step} className="max-w-2xl mx-auto animate-in fade-in slide-in-from-right-4 duration-300">
          {current?.id === "summary" && (
            <SummaryStep
              ymm={addendum.vehicle_ymm}
              vin={addendum.vehicle_vin}
              installedCount={includedInstalled.length}
              installedTotal={includedTotal}
              optionalCount={electable.length}
              docFee={docFeeProduct?.price || 0}
              docFeeLabel={docFeeProduct?.name || "Doc Fee"}
              advertisedPrice={advertisedPrice}
              state={addendum.vehicle_state}
              dealerName={addendum.dealer_snapshot?.name}
              dealerLogo={addendum.dealer_snapshot?.logo_url}
            />
          )}

          {current?.id === "installed" && (
            <InstalledStep
              items={includedInstalled}
              initials={initials}
              setInitials={setInitials}
              benefitOf={benefitOf}
            />
          )}

          {current?.id === "optional" && (
            <OptionalStep
              added={addedInstalled}
              optional={optional}
              banner={ADDON_ELECTION_BANNER}
              selections={optionalSelections}
              setSelections={setOptionalSelections}
              initials={initials}
              setInitials={setInitials}
              needsInitials={needsInitials}
              benefitOf={benefitOf}
            />
          )}

          {current?.id === "pricing" && (
            <PricingStep
              advertisedPrice={advertisedPrice}
              includedItems={includedItems}
              addedItems={addedItems}
              addedTotal={addedTotal}
              finalAllIn={finalAllIn}
              confirmed={paymentConfirmed}
              setConfirmed={setPaymentConfirmed}
            />
          )}

          {current?.id === "disclosures" && (
            <DisclosuresStep
              isUsedCar={isUsedCar}
              esignConsent={esignConsent} setEsignConsent={setEsignConsent}
              showFullConsent={showFullConsent} setShowFullConsent={setShowFullConsent}
              warrantyAck={warrantyAck} setWarrantyAck={setWarrantyAck}
              deliveryMileage={deliveryMileage} setDeliveryMileage={setDeliveryMileage}
              stickerMatchAck={stickerMatchAck} setStickerMatchAck={setStickerMatchAck}
              addendum={addendum}
              sb766ThreeDayAck={sb766ThreeDayAck} setSb766ThreeDayAck={setSb766ThreeDayAck}
              setSb766Disclosure={setSb766Disclosure}
            />
          )}

          {current?.id === "sign" && (
            <SignStep
              ymm={addendum.vehicle_ymm}
              finalAllIn={finalAllIn}
              addedTotal={addedTotal}
              installedCount={includedInstalled.length}
              acceptedCount={addedItems.length}
              customerName={customerName} setCustomerName={setCustomerName}
              setCustomerSig={setCustomerSig}
              checklistAck={finalChecklistAck} setChecklistAck={setFinalChecklistAck}
              hasCobuyer={hasCobuyer}
              cobuyerName={cobuyerName} setCobuyerName={setCobuyerName}
              setCobuyerSig={setCobuyerSig}
            />
          )}
        </div>
      </main>

      {/* Sticky footer nav — Back / Continue, big targets. */}
      <footer className="sticky bottom-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200">
        <div className="max-w-2xl mx-auto px-5 py-3.5 flex items-center gap-3">
          {step > 0 && (
            <button
              onClick={goBack}
              className="h-14 px-5 rounded-2xl border-2 border-slate-200 text-slate-700 font-bold inline-flex items-center gap-1.5 hover:bg-slate-50"
            >
              <ChevronLeft className="w-5 h-5" /> Back
            </button>
          )}
          {current?.id === "sign" ? (
            <button
              onClick={handleSubmit}
              disabled={submitting || !canAdvance}
              className="flex-1 h-14 rounded-2xl bg-slate-950 text-white font-display font-bold text-lg tracking-tight disabled:opacity-40 hover:bg-slate-900 transition-colors"
            >
              {submitting ? "Signing…" : "Sign and finalize"}
            </button>
          ) : (
            <button
              onClick={goNext}
              disabled={!canAdvance}
              className="flex-1 h-14 rounded-2xl bg-slate-950 text-white font-display font-bold text-lg tracking-tight disabled:opacity-40 hover:bg-slate-900 transition-colors inline-flex items-center justify-center gap-1.5"
            >
              Continue <ChevronRight className="w-5 h-5" />
            </button>
          )}
        </div>
        {!canAdvance && advanceHint && (
          <p className="max-w-2xl mx-auto px-5 pb-3 -mt-1 text-center text-[11px] text-slate-500">{advanceHint}</p>
        )}
      </footer>
    </div>
  );
};

// ── Step 1: Purchase Summary hero ────────────────────────────────
const SummaryStep = ({
  ymm, vin, installedCount, installedTotal, optionalCount, docFee, docFeeLabel, advertisedPrice, state,
  dealerName, dealerLogo,
}: {
  ymm: string; vin: string; installedCount: number; installedTotal: number;
  optionalCount: number; docFee: number; docFeeLabel: string;
  advertisedPrice: number | null; state?: string | null;
  dealerName?: string; dealerLogo?: string;
}) => {
  const fullVin = (vin || "").trim();
  return (
    <div className="space-y-5">
      <div className="rounded-3xl bg-slate-950 text-white p-7 md:p-9">
        {(dealerLogo || dealerName) && (
          <div className="flex items-center gap-2.5 mb-5">
            {dealerLogo && (
              <img src={dealerLogo} alt={dealerName || ""} className="h-8 w-auto max-w-[140px] object-contain bg-white rounded-md p-1"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            )}
            {dealerName && <span className="text-sm font-semibold text-white/85">{dealerName}</span>}
          </div>
        )}
        <p className="text-[11px] uppercase tracking-[0.22em] text-white/60 font-semibold">Your purchase</p>
        <h1 className="mt-2 text-3xl md:text-4xl font-black font-display tracking-[-0.03em] leading-[0.97]">
          {ymm || "Your vehicle"}
        </h1>
        <p className="mt-2 text-[12px] font-mono uppercase tracking-wider text-white/50 break-all">
          {fullVin ? `VIN · ${fullVin}` : ""}{state ? `${fullVin ? "  ·  " : ""}${state}` : ""}
        </p>
        {advertisedPrice != null && (
          <p className="mt-5 text-4xl md:text-5xl font-black font-display tabular-nums tracking-[-0.02em]">
            {money(advertisedPrice)}
          </p>
        )}
        {advertisedPrice != null && (
          <p className="text-[11px] text-white/50 mt-1">Advertised price · before any options you add</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SummaryTile label="Installed products" value={`${installedCount}`} sub={installedCount ? `${money(installedTotal)} · in price` : "None"} />
        <SummaryTile label="Optional to review" value={`${optionalCount}`} sub={optionalCount ? "Your choice" : "None"} />
      </div>

      {docFee > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-slate-900">{docFeeLabel}</p>
            <p className="text-[11px] text-slate-500">Negotiable. Not a government fee.</p>
          </div>
          <p className="text-base font-black tabular-nums text-slate-900">{money(docFee)}</p>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-bold text-slate-900">Here's how this works</p>
        <ul className="mt-3 space-y-2.5">
          {[
            "Review what's already installed on your vehicle.",
            "Accept or decline any optional add-ons — your choice.",
            "Confirm your price, then sign. Takes about a minute.",
          ].map((t) => (
            <li key={t} className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-slate-950 text-white flex items-center justify-center flex-shrink-0 mt-0.5">
                <Check className="w-3 h-3" />
              </span>
              <span className="text-[13px] text-slate-700 leading-snug">{t}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

const SummaryTile = ({ label, value, sub }: { label: string; value: string; sub: string }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4">
    <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-slate-500">{label}</p>
    <p className="mt-1 text-3xl font-black font-display tabular-nums text-slate-950">{value}</p>
    <p className="text-[11px] text-slate-500">{sub}</p>
  </div>
);

// ── Step: Installed products review ──────────────────────────────
const InstalledStep = ({
  items, initials, setInitials, benefitOf,
}: {
  items: ProductSnapshot[];
  initials: Record<string, string>;
  setInitials: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  benefitOf: (p: ProductSnapshot) => string[];
}) => (
  <div className="space-y-4">
    <StepHeading title="Already on your vehicle" sub="These are installed and included in your advertised price. Initial each to confirm you reviewed it." />
    {items.map((p) => {
      const bullets = benefitOf(p);
      const done = (initials[p.id] || "").trim().length > 0;
      return (
        <div key={p.id} className={`rounded-2xl border-2 bg-white p-5 transition-colors ${done ? "border-emerald-300" : "border-slate-200"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Pre-installed</span>
              <p className="text-lg font-bold text-slate-900 mt-1.5">{p.name}</p>
              {p.subtitle && <p className="text-[13px] text-slate-500">{p.subtitle}</p>}
            </div>
            <p className="text-lg font-black tabular-nums text-slate-900 flex-shrink-0">{money(p.price)}</p>
          </div>
          {bullets.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                  <span className="text-[13px] text-slate-700 leading-snug">{b}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex items-center gap-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Your initials</span>
            <input
              value={initials[p.id] || ""}
              onChange={(e) => setInitials((prev) => ({ ...prev, [p.id]: e.target.value.toUpperCase() }))}
              placeholder="____"
              maxLength={5}
              className={`w-24 h-14 border-2 rounded-xl px-2 text-2xl font-black text-center uppercase bg-white text-slate-900 ${done ? "border-emerald-400" : "border-slate-300"}`}
            />
          </div>
        </div>
      );
    })}
  </div>
);

// One add-on card. MUST stay at module scope — defining it inside OptionalStep
// made it a new component type on every keystroke, remounting the initials
// input and dropping focus after each character.
const ProductCard = ({
  p, kind, choice, bullets, showInitials, initialsValue, onAccept, onDecline, onInitials,
}: {
  p: ProductSnapshot; kind: "added" | "optional";
  choice: string | undefined; bullets: string[]; showInitials: boolean;
  initialsValue: string;
  onAccept: () => void; onDecline: () => void; onInitials: (v: string) => void;
}) => {
    return (
      <div className={`rounded-2xl border-2 bg-white p-5 transition-colors ${choice === "accept" ? "border-emerald-300" : choice === "decline" ? "border-slate-200" : "border-amber-300"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${kind === "added" ? "bg-amber-100 text-amber-700" : "bg-amber-100 text-amber-700"}`}>
              {kind === "added" ? "Added above advertised" : "Optional"}
            </span>
            <p className="text-lg font-bold text-slate-900 mt-1.5">{p.name}</p>
            {p.subtitle && <p className="text-[13px] text-slate-500">{p.subtitle}</p>}
          </div>
          <p className="text-lg font-black tabular-nums text-slate-900 flex-shrink-0">{money(p.price)}</p>
        </div>
        {bullets.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                <span className="text-[13px] text-slate-700 leading-snug">{b}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            onClick={onAccept}
            className={`h-14 rounded-xl text-base font-bold border-2 ${choice === "accept" ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 text-slate-700"}`}
          >
            Add it
          </button>
          <button
            onClick={onDecline}
            className={`h-14 rounded-xl text-base font-bold border-2 ${choice === "decline" ? "border-slate-400 bg-slate-100 text-slate-700" : "border-slate-300 text-slate-700"}`}
          >
            No thanks
          </button>
        </div>
        {showInitials && (
          <div className="mt-3 flex items-center gap-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Initial to confirm</span>
            <input
              value={initialsValue}
              onChange={(e) => onInitials(e.target.value)}
              placeholder="____"
              maxLength={5}
              className={`w-24 h-14 border-2 rounded-xl px-2 text-2xl font-black text-center uppercase bg-white text-slate-900 ${initialsValue.trim() ? "border-emerald-400" : "border-slate-300"}`}
            />
          </div>
        )}
      </div>
    );
};

// ── Step: Optional + above-advertised add-ons ────────────────────
const OptionalStep = ({
  added, optional, banner, selections, setSelections, initials, setInitials, needsInitials, benefitOf,
}: {
  added: ProductSnapshot[]; optional: ProductSnapshot[]; banner: string;
  selections: Record<string, string>;
  setSelections: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  initials: Record<string, string>;
  setInitials: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  needsInitials: (p: ProductSnapshot) => boolean;
  benefitOf: (p: ProductSnapshot) => string[];
}) => {
  const card = (p: ProductSnapshot, kind: "added" | "optional") => (
    <ProductCard
      key={p.id}
      p={p}
      kind={kind}
      choice={selections[p.id]}
      bullets={benefitOf(p)}
      showInitials={needsInitials(p) && selections[p.id] === "accept"}
      initialsValue={initials[p.id] || ""}
      onAccept={() => setSelections((prev) => ({ ...prev, [p.id]: "accept" }))}
      onDecline={() => setSelections((prev) => ({ ...prev, [p.id]: "decline" }))}
      onInitials={(v) => setInitials((prev) => ({ ...prev, [p.id]: v.toUpperCase() }))}
    />
  );
  return (
    <div className="space-y-4">
      <StepHeading title="Your add-ons" sub="Optional — yours to choose." />
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-[13px] text-slate-700 leading-snug">
        {banner}
      </div>
      {added.map((p) => card(p, "added"))}
      {optional.map((p) => card(p, "optional"))}
    </div>
  );
};

// ── Step: Pricing breakdown ──────────────────────────────────────
const PricingStep = ({
  advertisedPrice, includedItems, addedItems, addedTotal, finalAllIn, confirmed, setConfirmed,
}: {
  advertisedPrice: number | null;
  includedItems: ProductSnapshot[];
  addedItems: ProductSnapshot[];
  addedTotal: number;
  finalAllIn: number | null;
  confirmed: boolean;
  setConfirmed: (v: boolean) => void;
}) => (
  <div className="space-y-4">
    <StepHeading title="Your price breakdown" sub="Everything you reviewed, in one place." />

    {advertisedPrice != null && (
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <span className="text-base font-semibold text-slate-900">Advertised price</span>
        <span className="text-base font-bold tabular-nums text-slate-900">{money(advertisedPrice)}</span>
      </div>
    )}

    {includedItems.length > 0 && (
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 bg-slate-50 px-5 py-2.5">
          Already included in that price
        </p>
        <div className="divide-y divide-slate-100">
          {includedItems.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-5 py-3">
              <span className="text-sm text-slate-600 truncate pr-3">{p.name}</span>
              <span className="text-xs font-medium text-slate-500 tabular-nums">{money(p.price)} · included</span>
            </div>
          ))}
        </div>
      </div>
    )}

    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 bg-slate-50 px-5 py-2.5">Added to your price</p>
      {addedItems.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-500">Nothing added — you're paying the advertised price.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {addedItems.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-5 py-3">
              <span className="text-sm text-slate-900 truncate pr-3">{p.name}</span>
              <span className="text-sm font-semibold text-slate-900 tabular-nums">+{money(p.price)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-5 py-3 bg-slate-50">
            <span className="text-sm font-semibold text-slate-900">Total added</span>
            <span className="text-sm font-bold text-slate-900 tabular-nums">+{money(addedTotal)}</span>
          </div>
        </div>
      )}
    </div>

    {finalAllIn != null && (
      <div className="flex items-center justify-between rounded-2xl border-2 border-slate-950 bg-slate-950 text-white px-5 py-5">
        <span className="text-base font-bold">Your total</span>
        <span className="text-2xl font-black tabular-nums">{money(finalAllIn)}</span>
      </div>
    )}

    <p className="text-[12px] text-slate-500 leading-relaxed px-1">
      Accessories already in the advertised price are shown for transparency and not charged again.
      This excludes tax, title, license, and any financing charges — your full out-the-door figure is on your purchase agreement.
    </p>

    <BigCheck checked={confirmed} onClick={() => setConfirmed(!confirmed)}
      title="This breakdown is correct"
      body="I reviewed what's already included and each item added to it, and I confirm the amounts above." />
  </div>
);

// ── Step: Disclosures ────────────────────────────────────────────
const DisclosuresStep = ({
  isUsedCar,
  esignConsent, setEsignConsent, showFullConsent, setShowFullConsent,
  warrantyAck, setWarrantyAck, deliveryMileage, setDeliveryMileage,
  stickerMatchAck, setStickerMatchAck, addendum,
  sb766ThreeDayAck, setSb766ThreeDayAck, setSb766Disclosure,
}: {
  isUsedCar: boolean;
  esignConsent: boolean; setEsignConsent: (v: boolean) => void;
  showFullConsent: boolean; setShowFullConsent: (v: boolean) => void;
  warrantyAck: boolean; setWarrantyAck: (v: boolean) => void;
  deliveryMileage: string; setDeliveryMileage: (v: string) => void;
  stickerMatchAck: boolean; setStickerMatchAck: (v: boolean) => void;
  addendum: any;
  sb766ThreeDayAck: boolean; setSb766ThreeDayAck: (v: boolean) => void;
  setSb766Disclosure: (v: FinancingDisclosure | null) => void;
}) => (
  <div className="space-y-4">
    <StepHeading title="A few acknowledgments" sub="Required by federal and state law before you sign." />

    {/* FTC Used Car Rule: only used/CPO units get the Buyers Guide warranty
        acknowledgment + delivery mileage. New and demo cars skip it. */}
    {isUsedCar && (
      <>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <p className="text-sm font-bold text-slate-900">Mileage at delivery</p>
          <input
            value={deliveryMileage}
            onChange={(e) => setDeliveryMileage(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="e.g. 45230"
            inputMode="numeric"
            className={`w-full h-14 border-2 rounded-xl px-4 text-lg font-bold text-center bg-white text-slate-900 ${deliveryMileage.trim() ? "border-emerald-400" : "border-slate-300"}`}
          />
          {deliveryMileage && <p className="text-xs text-slate-500 text-center">{parseInt(deliveryMileage).toLocaleString()} miles</p>}
        </div>

        <BigCheck checked={warrantyAck} onClick={() => setWarrantyAck(!warrantyAck)}
          title="I acknowledge the warranty status"
          body="I reviewed the FTC Buyers Guide on this vehicle and understand the warranty status (As-Is, Implied, or Warranty) as disclosed. The mileage above is accurate at delivery." />
      </>
    )}

    <BigCheck checked={stickerMatchAck} onClick={() => setStickerMatchAck(!stickerMatchAck)}
      title="The sticker matches this addendum"
      body="This addendum matches the window sticker on the vehicle, I had time to review both, and I understand optional items can be declined with no impact on my purchase or financing." />

    <SB766DisclosurePanel
      vehicleState={addendum?.vehicle_state}
      vehiclePrice={addendum?.vehicle_price}
      financingInput={addendum?.financing_input}
      threeDayAck={sb766ThreeDayAck}
      onThreeDayAck={setSb766ThreeDayAck}
      onDisclosureChange={setSb766Disclosure}
    />

    {/* Full canonical disclosure packet — identical content to the dealer
        document and the /sign full form, just laid out for the wizard. */}
    <AddendumDisclosurePacket
      state={addendum?.vehicle_state}
      vehiclePrice={addendum?.vehicle_price}
      vehicleCondition={addendum?.vehicle_condition || undefined}
      products={(addendum?.products_snapshot as PacketProduct[]) || []}
      dealer={addendum?.dealer_snapshot || undefined}
    />

    <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
      <p className="text-sm font-bold text-slate-900">Electronic Records & Signatures</p>
      <p className="text-xs text-slate-500 leading-relaxed">
        Federal law (E-SIGN Act, 15 U.S.C. §7001) and your state's UETA require your consent to sign electronically.
      </p>
      {!showFullConsent ? (
        <button onClick={() => setShowFullConsent(true)} className="text-xs font-semibold text-blue-600 hover:underline">
          Read the full disclosure →
        </button>
      ) : (
        <div className="max-h-48 overflow-y-auto rounded-lg bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-700 whitespace-pre-line leading-relaxed">
          {ESIGN_CONSENT_TEXT}
        </div>
      )}
      <BigCheck checked={esignConsent} onClick={() => setEsignConsent(!esignConsent)}
        title="I consent to electronic records and signatures"
        body="I can request a paper copy at no charge, can withdraw consent before signing, and my electronic signature is legally equivalent to a handwritten one." />
    </div>
  </div>
);

// ── Step: Sign ───────────────────────────────────────────────────
const SignStep = ({
  ymm, finalAllIn, addedTotal, installedCount, acceptedCount,
  customerName, setCustomerName, setCustomerSig, checklistAck, setChecklistAck,
  hasCobuyer, cobuyerName, setCobuyerName, setCobuyerSig,
}: {
  ymm: string; finalAllIn: number | null; addedTotal: number;
  installedCount: number; acceptedCount: number;
  customerName: string; setCustomerName: (v: string) => void;
  setCustomerSig: (v: { data: string; type: "draw" | "type" }) => void;
  checklistAck: boolean; setChecklistAck: (v: boolean) => void;
  hasCobuyer: boolean;
  cobuyerName: string; setCobuyerName: (v: string) => void;
  setCobuyerSig: (v: { data: string; type: "draw" | "type" }) => void;
}) => (
  <div className="space-y-4">
    <StepHeading title="Review and sign" sub="One last look before you sign." />

    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-slate-500">You're signing for</p>
      <p className="text-xl font-black font-display text-slate-900 mt-1">{ymm || "Your vehicle"}</p>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div><span className="text-slate-500">Installed reviewed</span><p className="font-bold text-slate-900">{installedCount}</p></div>
        <div><span className="text-slate-500">Options accepted</span><p className="font-bold text-slate-900">{acceptedCount}</p></div>
        {addedTotal > 0 && <div><span className="text-slate-500">Total added</span><p className="font-bold text-slate-900 tabular-nums">{money(addedTotal)}</p></div>}
        {finalAllIn != null && <div><span className="text-slate-500">Your total</span><p className="font-bold text-slate-900 tabular-nums">{money(finalAllIn)}</p></div>}
      </div>
    </div>

    {/* Customer Acknowledgment — the explicit disclosure-happened record
        the FTC looks for. Display block + one affirmative checkbox that is
        hashed into the signed payload. */}
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-sm font-bold text-slate-900">Customer acknowledgment</p>
      <ul className="mt-3 space-y-2">
        {[
          "The installed products listed were disclosed to me before purchase and are itemized on this addendum.",
          "The benefits represented for each product were disclosed to me.",
          "Pricing for every item was disclosed to me.",
          "I received warranty information where applicable.",
          "Optional products were voluntary and not required to buy, lease, or finance this vehicle.",
          "I expressly and voluntarily agreed to each optional product I accepted; none were a condition of purchase, lease, or financing.",
        ].map((t) => (
          <li key={t} className="flex items-start gap-2.5">
            <Check className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
            <span className="text-[13px] text-slate-700 leading-snug">{t}</span>
          </li>
        ))}
      </ul>
    </div>

    {/* Certification — read immediately before the pen. One affirmative
        statement that consolidates every disclosure the customer saw. */}
    <BigCheck checked={checklistAck} onClick={() => setChecklistAck(!checklistAck)}
      title="I agree and I'm ready to sign"
      body="Pricing and benefits were disclosed, optional products were voluntary, the required state disclosures were provided, I consented to electronic records, and I had the chance to ask questions." />

    <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
      <input
        value={customerName}
        onChange={(e) => setCustomerName(e.target.value)}
        placeholder="Full legal name (printed)"
        className="w-full h-14 border-2 border-slate-300 rounded-xl px-4 text-base bg-white text-slate-900 placeholder:text-slate-400"
      />
      <SignaturePad
        label={hasCobuyer ? "Buyer signature" : "Your signature"}
        subtitle="Sign above to finalize. Your signature is hashed and time-stamped."
        onChange={(data, type) => setCustomerSig({ data, type })}
      />
    </div>

    {hasCobuyer && (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <p className="text-sm font-bold text-slate-900">Co-buyer signature</p>
        <input
          value={cobuyerName}
          onChange={(e) => setCobuyerName(e.target.value)}
          placeholder="Co-buyer full legal name (printed)"
          className="w-full h-14 border-2 border-slate-300 rounded-xl px-4 text-base bg-white text-slate-900 placeholder:text-slate-400"
        />
        <SignaturePad
          label="Co-buyer signature"
          subtitle="The co-buyer signs here. Captured and time-stamped separately."
          onChange={(data, type) => setCobuyerSig({ data, type })}
        />
      </div>
    )}

    <p className="text-center text-[10px] font-mono uppercase tracking-wider text-slate-400">
      By signing, your acknowledgment is hashed, archived, and legally binding.
    </p>
  </div>
);

// ── Shared bits ──────────────────────────────────────────────────
const StepHeading = ({ title, sub }: { title: string; sub?: string }) => (
  <div className="mb-1">
    <h2 className="text-2xl md:text-3xl font-black font-display tracking-[-0.02em] text-slate-950">{title}</h2>
    {sub && <p className="mt-1.5 text-[13px] text-slate-600 leading-snug">{sub}</p>}
  </div>
);

const BigCheck = ({
  checked, onClick, title, body,
}: { checked: boolean; onClick: () => void; title: string; body: string }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-start gap-3.5 p-4 rounded-2xl border-2 text-left transition-all ${checked ? "border-emerald-400 bg-emerald-50/50" : "border-slate-200 bg-white"}`}
  >
    <div className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${checked ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300"}`}>
      {checked && <Check className="w-4 h-4" strokeWidth={3} />}
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-[15px] font-bold text-slate-900">{title}</p>
      <p className="text-[12px] text-slate-500 mt-0.5 leading-relaxed">{body}</p>
    </div>
  </button>
);

export default CustomerReview;
