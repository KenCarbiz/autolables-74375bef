import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import SignaturePad from "@/components/addendum/SignaturePad";
import { AddendumDisclosurePacket, type PacketProduct } from "@/components/addendum/AddendumDisclosurePacket";
import { needsUsedCarWarranty } from "@/lib/vehicleCondition";
import { useEmailDistribution } from "@/hooks/useEmailDistribution";
import { useReviewRequest } from "@/hooks/useReviewRequest";
import { toast } from "sonner";
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
import SB766DisclosurePanel from "@/components/addendum/SB766DisclosurePanel";
import TransactionAuditRecord from "@/components/addendum/TransactionAuditRecord";

interface ProductSnapshot {
  id: string;
  name: string;
  subtitle: string | null;
  warranty: string | null;
  badge_type: string;
  price: number;
  price_label: string | null;
  disclosure: string | null;
  // True (or absent) when this installed accessory's price is already
  // in the advertised price — itemized, never additive. False marks a
  // dealer-installed upcharge added above the advertised price.
  price_in_advertised?: boolean;
}

interface ReturnStatus {
  addendum_id: string;
  signing_id: string | null;
  signed_at: string | null;
  return_window_closes_at: string | null;
  return_status: string | null;
  return_requested_at: string | null;
  vehicle_vin: string | null;
  vehicle_ymm: string | null;
  dealer_snapshot: any;
}

const MobileSigning = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // Device-aware default: phones/tablets get the easier page-by-page wizard;
  // desktop stays on the full single-page document. The customer can still
  // force this document on mobile via the wizard's "Full document →" link
  // (which adds ?doc=1) so we don't bounce them back.
  useEffect(() => {
    if (!token) return;
    if (params.get("doc") === "1") return;
    const isHandheld =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(pointer: coarse)").matches || window.innerWidth < 768);
    if (isHandheld) navigate(`/review/${token}`, { replace: true });
  }, [token, params, navigate]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [addendum, setAddendum] = useState<any>(null);
  const [error, setError] = useState("");
  // Funnel telemetry: fire opened once on load, started once on first
  // user interaction. Refs because we don't want React re-renders to
  // re-fire.
  const openedFiredRef = useRef(false);
  const startedFiredRef = useRef(false);
  // SB 766: return window state loaded after a signed-addendum visit
  const [returnStatus, setReturnStatus] = useState<ReturnStatus | null>(null);
  const [returnModalOpen, setReturnModalOpen] = useState(false);

  const [initials, setInitials] = useState<Record<string, string>>({});
  const [optionalSelections, setOptionalSelections] = useState<Record<string, string>>({});
  const [customerName, setCustomerName] = useState("");
  const [customerSig, setCustomerSig] = useState({ data: "", type: "draw" as "draw" | "type" });
  const [bulkInitials, setBulkInitials] = useState("");
  const { sendPacket } = useEmailDistribution();
  const { queueReviewRequest } = useReviewRequest();

  // FTC Buyers Guide warranty acknowledgment
  const [warrantyAck, setWarrantyAck] = useState(false);
  const [deliveryMileage, setDeliveryMileage] = useState("");
  // Addendum/sticker matching acknowledgment
  const [stickerMatchAck, setStickerMatchAck] = useState(false);
  // Payment walk — single confirmation that the customer saw the base
  // vehicle price, the add-ons they elected, and the resulting total.
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  // Price overrides — sales manager can discount accessories (NOT doc fee)
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>({});
  const [showPriceEdit, setShowPriceEdit] = useState(false);
  // E-SIGN Act consent — required before any signature can be captured
  const [esignConsent, setEsignConsent] = useState(false);
  const [showFullConsent, setShowFullConsent] = useState(false);
  // CA SB 766 (eff 10/1/2026) — 3-day return ack + financing disclosure
  const [sb766ThreeDayAck, setSb766ThreeDayAck] = useState(false);
  const [sb766Disclosure, setSb766Disclosure] = useState<FinancingDisclosure | null>(null);
  const [auditRecord, setAuditRecord] = useState<{
    dealId: string; vin: string | null; signedAt: string; customerName: string;
    ip: string | null; userAgent: string | null; contentHash: string;
    location: { latitude?: number | null; longitude?: number | null } | null;
  } | null>(null);

  useEffect(() => {
    if (!token) return;
    loadAddendum();
  }, [token]);

  const loadAddendum = async () => {
    const { data, error } = await supabase.rpc("get_addendum_by_token", { _token: token });
    if (error || !data || data.length === 0) {
      setError("Invalid or expired signing link.");
      setLoading(false);
      return;
    }
    const doc = data[0];
    setAddendum(doc);
    setInitials((doc.initials as Record<string, string>) || {});
    setOptionalSelections((doc.optional_selections as Record<string, string>) || {});
    if (doc.status === "signed") {
      // Already signed — render the post-sign screen (with SB 766
      // return flow when applicable) instead of erroring out.
      setSubmitted(true);
      const { data: rs } = await (supabase as any).rpc("get_signing_return_status", { _signing_token: token });
      const first = Array.isArray(rs) ? rs[0] : rs;
      if (first) setReturnStatus(first as ReturnStatus);
    }
    setLoading(false);
    fireFunnelEvent("signing_link_opened", openedFiredRef);
    if (doc.status !== "signed") emitTimelineEvent("customer_opened");
  };

  // Fires a single tenant-scoped audit event server-side via the
  // record_signing_event RPC. Silently swallows errors so a telemetry
  // blip never blocks the signer.
  const fireFunnelEvent = (
    event: "signing_link_opened" | "signing_link_started",
    ref: React.MutableRefObject<boolean>,
  ) => {
    if (ref.current || !token) return;
    ref.current = true;
    (supabase as any).rpc("record_signing_event", {
      _signing_token: token,
      _event: event,
      _details: {
        ua: typeof navigator !== "undefined" ? navigator.userAgent : null,
      },
    }).catch(() => { /* best-effort telemetry */ });
  };

  // Called from any onChange/onFocus in the form below. The ref
  // guards against spamming the RPC on every keystroke.
  const markStarted = () => {
    fireFunnelEvent("signing_link_started", startedFiredRef);
    emitTimelineEvent("reviewing");
  };

  // Customer-side timeline event (DocuSign-style), keyed by token via a
  // definer RPC. Best-effort; never blocks the signer.
  const emitTimelineEvent = (event: string, details: Record<string, unknown> = {}) => {
    if (!token) return;
    (supabase as any)
      .rpc("record_addendum_event", { _signing_token: token, _event: event, _channel: null, _details: details })
      .then(() => {}, () => { /* events table may still be propagating */ });
  };

  const products: ProductSnapshot[] = addendum?.products_snapshot || [];
  const installed = products.filter((p) => p.badge_type === "installed");
  const optional = products.filter((p) => p.badge_type === "optional");
  // An installed accessory whose price is already in the advertised price
  // is non-elective — the customer agreed to it by buying at the
  // advertised price, so it's acknowledged with an initial. An installed
  // accessory priced ABOVE the advertised price is a dealer upcharge the
  // customer must affirmatively ELECT: same symmetric Accept/Decline as an
  // optional add-on, plus an initial when kept. Declining means they pay
  // the advertised price and the upcharge is not billed.
  const isAddedOn = (p: ProductSnapshot) =>
    p.badge_type === "installed" && p.price_in_advertised === false;
  const includedInstalled = installed.filter((p) => p.price_in_advertised !== false);
  const addedInstalled = installed.filter((p) => p.price_in_advertised === false);
  // Every item that requires an affirmative Accept/Decline election.
  const electable = products.filter((p) => p.badge_type === "optional" || isAddedOn(p));
  // Whether this deal is financed. Drives the add-on election language:
  // the "won't change your interest rate" clause only makes sense — and
  // is only defensible — when there's a rate in play.
  const isFinanced = !!addendum?.financing_input;

  // A small set of optional products carry their own statutory per-item
  // acknowledgment rule (GAP waivers, vehicle service contracts, and
  // credit insurance/debt-cancellation products). Those keep a separate
  // initial. Every other discretionary add-on (paint protection, nitrogen,
  // etch, etc.) is elected with a single Accept/Decline — no per-item
  // initial — so the flow stops feeling like a gauntlet. The Accept choice
  // is itself the affirmative, hashed election under FTC Act §5.
  const STATUTORY_INITIAL_KEYWORDS = [
    "gap",
    "service contract",
    "vehicle service",
    "vsc",
    "extended warranty",
    "extended service",
    "credit life",
    "credit insurance",
    "credit disability",
    "debt cancellation",
    "guaranteed asset",
  ];
  const requiresStatutoryInitials = (name: string) =>
    STATUTORY_INITIAL_KEYWORDS.some((k) => name.toLowerCase().includes(k));
  // Included installed items always carry a customer initial (the red-team
  // layer hard-blocks an unsigned installed product). An above-advertised
  // upcharge or a statutory optional needs one only when the customer is
  // actually keeping it — declining shouldn't demand an initial.
  const needsInitials = (p: ProductSnapshot) =>
    (p.badge_type === "installed" && p.price_in_advertised !== false) ||
    (isAddedOn(p) && optionalSelections[p.id] === "accept") ||
    (p.badge_type === "optional" &&
      requiresStatutoryInitials(p.name) &&
      optionalSelections[p.id] === "accept");

  // One calm banner over the whole optional section instead of a scary
  // disclosure stamped under every line. Same FTC Act §5 substance —
  // optional, no effect on price or (when financed) rate — framed so the
  // customer feels in control, not interrogated. The exact text the
  // customer saw is hashed into the signed payload as the election record.
  const ADDON_ELECTION_BANNER = isFinanced
    ? "These add-ons are optional and yours to choose. Adding or skipping any of them won't change your vehicle price or your interest rate. Accept the ones you want and decline the rest."
    : "These add-ons are optional and yours to choose. Adding or skipping any of them won't change your vehicle price. Accept the ones you want and decline the rest.";
  const ADDON_ELECTION_DISCLOSURE_VERSION = "ael-2026-06-14";

  // Payment walk math, split by what the advertised price already
  // covers. An installed accessory is "included" (price_in_advertised
  // !== false) when its price is already in the online/lot price — it's
  // itemized for transparency but NEVER added again. Anything additive
  // is either a dealer-installed upcharge above advertised
  // (price_in_advertised === false) or an optional add-on the customer
  // accepted. That additive subtotal is the number the customer confirms,
  // so an elected add-on can't surface as a silent contract line later.
  const effectivePrice = (p: ProductSnapshot) => priceOverrides[p.id] ?? p.price;
  const includedItems = includedInstalled;
  // Only items the customer affirmatively elected roll into the total —
  // an above-advertised upcharge they declined is never billed.
  const addedItems = electable.filter((p) => optionalSelections[p.id] === "accept");
  const includedTotal = includedItems.reduce((s, p) => s + effectivePrice(p), 0);
  const addedTotal = addedItems.reduce((s, p) => s + effectivePrice(p), 0);
  // The advertised price is only reliably present on some addendum rows
  // (the accessory addendum doesn't always carry the base vehicle price).
  // When we have it, anchor the walk and show the final all-in; when we
  // don't, show the additions and point to the purchase agreement.
  const advertisedPrice = typeof addendum?.vehicle_price === "number" ? addendum.vehicle_price : null;
  const finalAllIn = advertisedPrice != null ? advertisedPrice + addedTotal : null;

  const handleFillAll = () => {
    if (!bulkInitials.trim()) return;
    setInitials((prev) => {
      const filled: Record<string, string> = { ...prev };
      products.forEach((p) => {
        if (needsInitials(p)) filled[p.id] = bulkInitials.toUpperCase();
      });
      return filled;
    });
  };

  const handleSubmit = async () => {
    if (!esignConsent) {
      toast.error("Please accept the Electronic Records Disclosure before signing.");
      return;
    }
    const missingInitials = products.filter((p) => needsInitials(p) && !initials[p.id]?.trim());
    if (missingInitials.length > 0) {
      toast.error(`Please initial all ${missingInitials.length} product(s).`);
      return;
    }
    const missingSelections = electable.filter((p) => !optionalSelections[p.id]);
    if (missingSelections.length > 0) {
      toast.error(`Please accept or decline every optional and added item.`);
      return;
    }
    // FTC Used Car Rule warranty + mileage only gates used/CPO units.
    if (needsUsedCarWarranty(addendum?.vehicle_condition) && !warrantyAck) {
      toast.error("Please acknowledge the warranty status.");
      return;
    }
    if (needsUsedCarWarranty(addendum?.vehicle_condition) && !deliveryMileage.trim()) {
      toast.error("Please confirm mileage at delivery.");
      return;
    }
    if (!stickerMatchAck) {
      toast.error("Please acknowledge the window sticker matches this addendum.");
      return;
    }
    if (!paymentConfirmed) {
      toast.error("Please confirm your price breakdown.");
      return;
    }
    if (isSb766Applicable(addendum?.vehicle_state, addendum?.vehicle_price) && !sb766ThreeDayAck) {
      toast.error("Please acknowledge the California 3-Day Right to Cancel notice.");
      return;
    }
    if (!customerSig.data) {
      toast.error("Please provide your signature.");
      return;
    }

    setSubmitting(true);

    // Fetch compliance context in parallel with IP + geoloc. We do
    // this at signing time so every recorded signature carries:
    //  - the public IP seen at the moment of signature
    //  - a best-effort client geolocation (with user consent, null
    //    if denied or unavailable; never blocks submit)
    //  - the install-history snapshot of every product shown on the
    //    addendum (from prep_sign_offs), so later audit reviewers
    //    can prove the accessory was installed prior to sale and
    //    when
    //  - the state rule set that applied at the moment of signing,
    //    so if the statute changes later we can show what rule the
    //    disclosure was built against
    //  - a frozen ComplianceValidator report (PASS/WARN/FAIL)
    const consent = buildConsentRecord();
    const [customerIp, geoloc, prepSnapshot, installProofs] = await Promise.all([
      fetchClientIp(),
      fetchGeoloc(),
      (async () => {
        try {
          const { data } = await (supabase as any)
            .from("prep_sign_offs")
            .select(
              "id,vin,accessories_installed,inspection_passed,inspection_form_type,foreman_name,signed_at,listing_unlocked"
            )
            .eq("vin", addendum.vehicle_vin)
            .eq("listing_unlocked", true)
            .order("signed_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          return data || null;
        } catch {
          return null;
        }
      })(),
      (async () => {
        try {
          const { data } = await (supabase as any)
            .from("install_proofs")
            .select("id,product_name,installer_name,installer_company,installed_at,photo_path,created_at")
            .eq("vehicle_vin", addendum.vehicle_vin)
            .order("created_at", { ascending: false });
          return data || [];
        } catch {
          return [];
        }
      })(),
    ]);

    const stateCode = (addendum.vehicle_state || "").toString().toUpperCase() || null;
    const stateRule = stateCode ? getStateRule(stateCode) : null;

    const complianceDraft = {
      state: stateCode || "",
      vehiclePrice: addendum.vehicle_price,
      docFeeAmount: products.find((p) =>
        p.name.toLowerCase().includes("doc")
      )?.price,
      stickerText: products.map((p) => `${p.name} ${p.disclosure || ""}`).join(" "),
      products: products.map((p) => {
        const isElectable = p.badge_type === "optional" || isAddedOn(p);
        // A declined above-advertised upcharge isn't billed, so it isn't a
        // charged installed line — represent it as optional so the
        // installed-initials red-team rule doesn't demand an initial on
        // something the customer turned down.
        const effBadge =
          isAddedOn(p) && optionalSelections[p.id] !== "accept" ? "optional" : p.badge_type;
        return {
          id: p.id,
          name: p.name,
          price: p.price,
          badge_type: effBadge,
          disclosure: p.disclosure || undefined,
          // An electable item's per-item sign-off is its affirmative
          // Accept/Decline election; non-elective installed items rely on
          // the initial.
          separate_signoff: isElectable
            ? !!optionalSelections[p.id]
            : !!initials[p.id]?.trim(),
        };
      }),
      spanishVersion: consent.language?.startsWith("es") || false,
      threeDayAck: sb766ThreeDayAck,
    };
    const complianceFindings = validateAddendum(complianceDraft);
    const complianceSummary = summarizeFindings(complianceFindings);

    // Red-team hard-block — defense in depth on top of the dealer-
    // side block in Index.tsx. Re-running here with the customer's
    // actual initials / esign consent / sign timestamp surfaces any
    // fail-severity issues that aren't visible until the customer is
    // in the flow (e.g. missing initials on installed products).
    const redTeamFindings = runComplianceRedTeam({
      ...complianceDraft,
      customerName,
      initialsByProductId: initials,
      esignConsentAccepted: esignConsent,
      signedAt: new Date().toISOString(),
      // Only pass vehicleCondition / buyersGuideAttached if the
      // addendum row has them explicitly populated. Omitting leaves
      // those rules inert instead of false-failing on older rows.
      ...(addendum.vehicle_condition ? { vehicleCondition: addendum.vehicle_condition } : {}),
      ...(typeof addendum.buyers_guide_id !== "undefined"
        ? { buyersGuideAttached: addendum.buyers_guide_id != null }
        : {}),
    });
    const redTeamSummary = summarizeRedTeam(redTeamFindings);
    if (redTeamSummary.blocker) {
      // Shopper-side is the defense-in-depth layer. The dealer-side
      // block in Index.tsx handles the primary enforcement (and
      // logs `compliance_block` to audit_log with rule ids). If we
      // land here it's an edge case \u2014 legacy link, dealer bypassed
      // the builder, etc. Surface the top failing rules and stop.
      const top = redTeamFindings.filter((f) => f.severity === "fail").slice(0, 2).map((f) => f.rule).join(" \u2022 ");
      toast.error(`Blocked: ${top}${redTeamSummary.fail > 2 ? " \u2026" : ""}`);
      return;
    }

    // Canonical payload = everything that influenced the customer's
    // decision PLUS the dealer's compliance context. This is what the
    // SHA-256 hash covers.
    const canonicalPayload = {
      addendum_id: addendum.id,
      vehicle_vin: addendum.vehicle_vin,
      vehicle_ymm: addendum.vehicle_ymm,
      vehicle_state: stateCode,
      vehicle_price: addendum.vehicle_price ?? null,
      products_snapshot: addendum.products_snapshot,
      price_overrides: priceOverrides,
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

    // Unified signing path: record_customer_signing RPC validates the
    // token server-side, writes one addendum_signings row, mirrors
    // legacy addendums columns for backward compat, and emits the
    // audit_log event in one transaction. See migration 20260418110000.
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
      _price_overrides: priceOverrides as any,
    });

    setSubmitting(false);
    if (error) {
      // Fall back to the legacy direct-update path if the RPC isn't
      // deployed yet (e.g. migration still propagating in Lovable).
      // eslint-disable-next-line no-console
      console.warn("record_customer_signing RPC failed, falling back", error);
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
          price_overrides: priceOverrides as any,
        } as any)
        .eq("signing_token", token!);
      if (legacyErr) {
        toast.error("Failed to submit. Please try again.");
        console.error(legacyErr);
        return;
      }
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
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
            <svg className="w-6 h-6 text-slate-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            </svg>
          </div>
          <h1 className="text-2xl font-black font-display tracking-tight text-slate-950">Cannot open</h1>
          <p className="text-sm text-slate-600 mt-2">{error}</p>
          <a
            href="/lookup"
            className="mt-6 inline-flex items-center justify-center h-11 px-5 rounded-xl bg-slate-950 text-white text-sm font-bold hover:bg-slate-900 transition-colors"
          >
            Look up my signing link
          </a>
        </div>
      </div>
    );
  }

  if (submitted) {
    const signedAt = new Date().toLocaleString();
    const dealerName = addendum?.dealer_snapshot?.name || "Your Dealership";
    const dealerPhone = addendum?.dealer_snapshot?.phone as string | undefined;
    return (
      <div className="min-h-screen bg-white">
        <div className="max-w-lg mx-auto px-4 pt-10 pb-10 space-y-6">
          {/* Hero confirmation — one dark slab, no smiley checks,
              no floating chrome. Tesla's "Order placed" cadence. */}
          <div className="rounded-3xl bg-slate-950 text-white p-7 md:p-9 relative overflow-hidden">
            <div className="relative">
              <p className="text-[10px] uppercase tracking-[0.22em] text-emerald-400 font-semibold">Signed</p>
              <h1 className="mt-2 text-4xl md:text-5xl font-black font-display tracking-[-0.03em] leading-[0.95]">
                You're done.
              </h1>
              <p className="mt-3 text-[13px] text-white/75 leading-relaxed max-w-sm">
                {dealerName} has a hashed, time-stamped copy. A signed packet is on its way to your email.
              </p>
            </div>
          </div>

          {/* Receipt — mono-uppercase labels, tight meta grid */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-slate-500">Vehicle</p>
              <p className="text-sm font-bold text-slate-950 mt-1">{addendum.vehicle_ymm || "Vehicle"}</p>
              {addendum.vehicle_vin && (
                <p className="text-[10px] font-mono text-slate-500 break-all">VIN · {addendum.vehicle_vin}</p>
              )}
            </div>
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-slate-500">Signed by</p>
              <p className="text-sm font-bold text-slate-950 mt-1">{customerName || "—"}</p>
              <p className="text-[10px] font-mono text-slate-500">{signedAt}</p>
            </div>
          </div>

          <div className="border-t border-slate-200" />

          {/* SB 766 — 3-day return window. Only renders when the
              signing row was stamped with return_window_closes_at
              (i.e. CA, used under $50k, on/after Oct 1 2026). */}
          {returnStatus?.return_window_closes_at && (
            <ReturnWindowBand
              status={returnStatus}
              onRequest={() => setReturnModalOpen(true)}
            />
          )}

          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-slate-500">Legally binding</p>
            <p className="text-[12px] text-slate-700 leading-relaxed mt-1">
              Every product, price, initial, and consent you reviewed is SHA-256 hashed and stored with your IP and device info — defensible under the federal E-SIGN Act and your state's UETA.
            </p>
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

          {dealerPhone && (
            <a
              href={`tel:${dealerPhone}`}
              className="block w-full h-12 rounded-xl border border-slate-200 text-slate-950 text-sm font-bold inline-flex items-center justify-center hover:bg-slate-50"
            >
              Call {dealerName}
            </a>
          )}

          <p className="text-center text-[10px] font-mono uppercase tracking-wider text-slate-400 pt-2">
            You can close this page. A copy is on its way.
          </p>
        </div>

        {returnModalOpen && returnStatus && (
          <ReturnRequestModal
            token={token!}
            status={returnStatus}
            onClose={() => setReturnModalOpen(false)}
            onRequested={(requestedAt) => {
              setReturnStatus({ ...returnStatus, return_status: "requested", return_requested_at: requestedAt });
              setReturnModalOpen(false);
              toast.success("Return requested. The dealer will reach out.");
            }}
          />
        )}
      </div>
    );
  }

  // Progress — compute completion percentage of the required fields so the
  // customer can see how much is left.
  const initialItems = products.filter((p) => needsInitials(p));
  const initialsDoneCount = initialItems.filter((p) => (initials[p.id] || "").trim()).length;
  const electableSelectedCount = electable.filter((p) => !!optionalSelections[p.id]).length;
  const usedCar = needsUsedCarWarranty(addendum?.vehicle_condition);
  const requirements = [
    { label: "E-SIGN consent",  done: esignConsent },
    { label: "Required initials", done: initialItems.length === 0 || initialsDoneCount === initialItems.length },
    { label: "Options chosen",    done: electable.length === 0 || electableSelectedCount === electable.length },
    ...(usedCar ? [
      { label: "Warranty acknowledged",    done: warrantyAck },
      { label: "Delivery mileage",         done: deliveryMileage.trim().length > 0 },
    ] : []),
    { label: "Sticker match acknowledged", done: stickerMatchAck },
    { label: "Price confirmed",          done: paymentConfirmed },
    { label: "Signature",                done: !!customerSig.data },
  ];
  const doneCount = requirements.filter((r) => r.done).length;
  const progressPct = Math.round((doneCount / requirements.length) * 100);

  return (
    <div className="min-h-screen bg-white">
      <h1 className="sr-only">Sign your vehicle addendum</h1>
      {/* Sticky progress — solid slate track, Tesla cadence. Label
          reads as a step count so the customer always knows where
          they are, not a decorative gradient. */}
      <div className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.18em] font-semibold">
            <span className="text-slate-500">Sign &amp; initial</span>
            <span className="tabular-nums text-slate-950">
              {doneCount}/{requirements.length} · {progressPct}%
            </span>
          </div>
          <div className="mt-2 h-1 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-slate-950 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      <div className="px-4 pt-6 pb-4">
        <div
          className="max-w-lg mx-auto space-y-6"
          onFocusCapture={markStarted}
          onTouchStartCapture={markStarted}
        >
          {/* Vehicle is the hero. No wrapper card, no drop shadow —
              just confident typography. */}
          <div>
            {addendum.vehicle_ymm && (
              <h1 className="text-3xl md:text-4xl font-black font-display tracking-[-0.03em] leading-[0.95] text-slate-950">
                {addendum.vehicle_ymm}
              </h1>
            )}
            <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500 font-mono uppercase tracking-wider flex-wrap">
              <span>Dealer addendum</span>
              {addendum.vehicle_vin && <span className="break-all">VIN · {addendum.vehicle_vin}</span>}
            </div>
            {(() => {
              const d = addendum.dealer_snapshot || {};
              const addr = [d.address, [d.city, d.state].filter(Boolean).join(", "), d.zip].filter(Boolean).join(" · ");
              if (!d.name && !addr) return null;
              return (
                <div className="mt-1 text-[11px] text-slate-500">
                  {d.name && <span className="font-semibold text-slate-700">{d.name}</span>}
                  {addr && <span>{d.name ? " · " : ""}{addr}</span>}
                </div>
              );
            })()}
            <a
              href={token ? `/review/${token}` : "#"}
              className="no-print mt-2 inline-block text-[11px] text-slate-500 hover:text-slate-900 underline decoration-dotted underline-offset-2"
              title="Walk through it step by step instead"
            >
              Prefer guided steps? →
            </a>
          </div>

        {/* Fill All Initials */}
        <div className="bg-card rounded-xl p-5 shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Quick Fill — Your Initials</p>
          <div className="flex gap-2">
            <input
              value={bulkInitials}
              onChange={(e) => setBulkInitials(e.target.value.toUpperCase())}
              placeholder="e.g. JD"
              className="flex-1 h-12 border-2 border-border rounded-lg px-4 text-lg font-bold text-center uppercase bg-background text-foreground placeholder:text-muted-foreground/40"
            />
            <button onClick={handleFillAll} className="px-5 h-12 bg-teal text-primary-foreground rounded-lg font-bold text-sm">
              Fill All
            </button>
          </div>
        </div>

        {/* Products */}
        <div className="bg-card rounded-xl p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-bold font-barlow-condensed text-foreground">Your package — choose what's included</h2>

          {includedInstalled.map((p) => (
            <div key={p.id} className="border border-border rounded-lg p-3 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-bold bg-navy text-primary-foreground px-1.5 py-0.5 rounded">Pre-Installed</span>
                  <p className="text-sm font-semibold text-foreground mt-1">{p.name}</p>
                  {p.warranty && <p className="text-[10px] text-muted-foreground">{p.warranty}</p>}
                </div>
                <p className="text-sm font-bold text-foreground">${p.price.toFixed(2)}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-muted-foreground">INITIALS:</span>
                <input
                  value={initials[p.id] || ""}
                  onChange={(e) => setInitials((prev) => ({ ...prev, [p.id]: e.target.value.toUpperCase() }))}
                  placeholder="____"
                  className={`w-20 h-10 border-2 rounded-lg px-2 text-base font-bold text-center uppercase bg-background text-foreground ${initials[p.id]?.trim() ? "border-teal" : "border-action"}`}
                />
              </div>
            </div>
          ))}

          {addedInstalled.length > 0 && (
            <div className="border-t border-border pt-4 space-y-3">
              <div className="rounded-lg border border-gold/40 bg-gold/5 p-3">
                <p className="text-sm font-semibold text-foreground">Dealer-installed — above the advertised price</p>
                <p className="text-[13px] text-muted-foreground leading-snug mt-1">
                  These are on the vehicle but priced above the advertised price, so they're yours to accept or decline.
                  Decline and you pay the advertised price — you won't be charged for these.
                </p>
              </div>

              {addedInstalled.map((p) => {
                const choice = optionalSelections[p.id];
                return (
                  <div key={p.id} className="border border-border rounded-lg p-3 space-y-2.5">
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-[10px] font-bold bg-orange-600 text-white px-1.5 py-0.5 rounded">Added above advertised</span>
                        <p className="text-sm font-semibold text-foreground mt-1">{p.name}</p>
                        {p.warranty && <p className="text-[10px] text-muted-foreground">{p.warranty}</p>}
                      </div>
                      <p className="text-sm font-bold text-foreground">${effectivePrice(p).toFixed(2)}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setOptionalSelections((prev) => ({ ...prev, [p.id]: "accept" }))}
                        className={`flex-1 h-10 rounded-lg text-sm font-bold border-2 ${choice === "accept" ? "border-teal bg-teal text-primary-foreground" : "border-border text-foreground"}`}
                      >
                        Add it
                      </button>
                      <button
                        onClick={() => setOptionalSelections((prev) => ({ ...prev, [p.id]: "decline" }))}
                        className={`flex-1 h-10 rounded-lg text-sm font-bold border-2 ${choice === "decline" ? "border-slate-400 bg-slate-100 text-foreground" : "border-border text-foreground"}`}
                      >
                        No thanks
                      </button>
                    </div>
                    {choice === "accept" && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold text-muted-foreground">INITIALS:</span>
                        <input
                          value={initials[p.id] || ""}
                          onChange={(e) => setInitials((prev) => ({ ...prev, [p.id]: e.target.value.toUpperCase() }))}
                          placeholder="____"
                          className={`w-20 h-10 border-2 rounded-lg px-2 text-base font-bold text-center uppercase bg-background text-foreground ${initials[p.id]?.trim() ? "border-teal" : "border-action"}`}
                        />
                        <span className="text-[10px] text-muted-foreground">Initial to confirm this above-advertised charge.</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {optional.length > 0 && (
            <div className="border-t border-border pt-4 space-y-3">
              <div className="rounded-lg border border-teal/30 bg-teal/5 p-3">
                <p className="text-sm font-semibold text-foreground">Optional add-ons — yours to choose</p>
                <p className="text-[13px] text-muted-foreground leading-snug mt-1">{ADDON_ELECTION_BANNER}</p>
              </div>

              {optional.map((p) => {
                const choice = optionalSelections[p.id];
                const showInitials = needsInitials(p) && choice === "accept";
                return (
                  <div key={p.id} className="border border-border rounded-lg p-3 space-y-2.5">
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-[10px] font-bold bg-orange-600 text-white px-1.5 py-0.5 rounded">Optional</span>
                        <p className="text-sm font-semibold text-foreground mt-1">{p.name}</p>
                      </div>
                      <p className="text-sm font-bold text-foreground">${effectivePrice(p).toFixed(2)}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setOptionalSelections((prev) => ({ ...prev, [p.id]: "accept" }))}
                        className={`flex-1 h-10 rounded-lg text-sm font-bold border-2 ${choice === "accept" ? "border-teal bg-teal text-primary-foreground" : "border-border text-foreground"}`}
                      >
                        Add it
                      </button>
                      <button
                        onClick={() => setOptionalSelections((prev) => ({ ...prev, [p.id]: "decline" }))}
                        className={`flex-1 h-10 rounded-lg text-sm font-bold border-2 ${choice === "decline" ? "border-slate-400 bg-slate-100 text-foreground" : "border-border text-foreground"}`}
                      >
                        No thanks
                      </button>
                    </div>
                    {showInitials && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold text-muted-foreground">INITIALS:</span>
                        <input
                          value={initials[p.id] || ""}
                          onChange={(e) => setInitials((prev) => ({ ...prev, [p.id]: e.target.value.toUpperCase() }))}
                          placeholder="____"
                          className={`w-20 h-10 border-2 rounded-lg px-2 text-base font-bold text-center uppercase bg-background text-foreground ${initials[p.id]?.trim() ? "border-teal" : "border-action"}`}
                        />
                        <span className="text-[10px] text-muted-foreground">Initial to confirm this add-on.</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Price Confirmation — sales manager can discount accessories */}
        <div className="bg-card rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold font-barlow-condensed text-foreground">Confirm Pricing</h2>
            <button
              onClick={() => setShowPriceEdit(!showPriceEdit)}
              className={`text-[10px] font-semibold px-2.5 py-1 rounded ${showPriceEdit ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              {showPriceEdit ? "Done Editing" : "Adjust Prices"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Review and confirm all pricing before the customer signs. Accessories may be discounted by a sales manager.
          </p>

          <div className="space-y-2">
            {products.map(p => {
              const originalPrice = p.price;
              const currentPrice = priceOverrides[p.id] ?? originalPrice;
              const isDiscounted = currentPrice < originalPrice;
              const isDocFee = p.name.toLowerCase().includes("doc") || p.name.toLowerCase().includes("conveyance") || p.name.toLowerCase().includes("processing fee") || p.name.toLowerCase().includes("documentation");

              return (
                <div key={p.id} className={`flex items-center justify-between p-2.5 rounded-lg border ${isDiscounted ? "border-emerald-200 bg-emerald-50/50" : "border-border"}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      p.badge_type === "installed" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
                    }`}>
                      {p.badge_type === "installed" ? "Installed" : "Optional"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {showPriceEdit && !isDocFee ? (
                      <div className="flex items-center gap-1">
                        {isDiscounted && (
                          <span className="text-xs text-muted-foreground line-through tabular-nums">${originalPrice.toFixed(2)}</span>
                        )}
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                          <input
                            type="number"
                            step="0.01"
                            value={currentPrice}
                            onChange={e => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val) && val >= 0 && val <= originalPrice) {
                                setPriceOverrides(prev => ({ ...prev, [p.id]: val }));
                              }
                            }}
                            className="w-24 h-9 pl-5 pr-2 rounded-md border border-border bg-background text-sm font-semibold text-right tabular-nums outline-none focus:border-primary"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="text-right">
                        {isDiscounted && <p className="text-[10px] text-muted-foreground line-through tabular-nums">${originalPrice.toFixed(2)}</p>}
                        <p className={`text-sm font-bold tabular-nums ${isDiscounted ? "text-emerald-700" : "text-foreground"}`}>
                          ${currentPrice.toFixed(2)}
                        </p>
                      </div>
                    )}
                    {isDocFee && showPriceEdit && (
                      <div className="text-right">
                        <p className="text-sm font-bold text-foreground tabular-nums">${currentPrice.toFixed(2)}</p>
                        <p className="text-[8px] text-destructive font-semibold">Cannot discount</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {Object.keys(priceOverrides).length > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <p className="text-xs text-emerald-800 font-medium">
                Price adjustments applied. Original prices and discounts will be recorded in the compliance audit trail.
              </p>
            </div>
          )}
        </div>

        {/* FTC Warranty Acknowledgment + Mileage — used/CPO only (16 CFR 455). */}
        {needsUsedCarWarranty(addendum?.vehicle_condition) && (
        <div className="bg-card rounded-xl p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-bold font-barlow-condensed text-foreground">FTC Warranty Acknowledgment</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Federal law requires that you acknowledge the warranty status of this vehicle as disclosed
            on the FTC Buyers Guide displayed on the vehicle, and confirm the odometer mileage at delivery.
          </p>

          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1">
              Mileage at Time of Delivery
            </label>
            <input
              value={deliveryMileage}
              onChange={(e) => setDeliveryMileage(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="e.g. 45230"
              inputMode="numeric"
              className={`w-full h-12 border-2 rounded-lg px-4 text-base font-bold text-center bg-background text-foreground ${deliveryMileage.trim() ? "border-teal" : "border-action"}`}
            />
            {deliveryMileage && (
              <p className="text-xs text-muted-foreground mt-1 text-center">
                {parseInt(deliveryMileage).toLocaleString()} miles
              </p>
            )}
          </div>

          <button
            onClick={() => setWarrantyAck(!warrantyAck)}
            className={`w-full flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-all ${
              warrantyAck ? "border-teal bg-teal/5" : "border-border"
            }`}
          >
            <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
              warrantyAck ? "border-teal bg-teal text-white" : "border-border"
            }`}>
              {warrantyAck && <span className="text-sm font-bold">✓</span>}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">I acknowledge the warranty status</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                I have reviewed the FTC Buyers Guide on this vehicle. I understand the warranty
                status (As-Is, Implied, or Warranty) as disclosed. I confirm the mileage reading
                above is accurate at the time of delivery.
              </p>
            </div>
          </button>
        </div>
        )}

        {/* Window Sticker / Addendum Match Acknowledgment */}
        <div className="bg-card rounded-xl p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-bold font-barlow-condensed text-foreground">Addendum Acknowledgment</h2>
          <button
            onClick={() => setStickerMatchAck(!stickerMatchAck)}
            className={`w-full flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-all ${
              stickerMatchAck ? "border-teal bg-teal/5" : "border-border"
            }`}
          >
            <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
              stickerMatchAck ? "border-teal bg-teal text-white" : "border-border"
            }`}>
              {stickerMatchAck && <span className="text-sm font-bold">✓</span>}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">I confirm the sticker matches this addendum</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                I acknowledge that: (1) this addendum matches the window sticker on the vehicle;
                (2) I have been given time to review both documents; (3) my initials and signature
                below constitute acceptance of the products and pricing as disclosed; (4) I understand
                that optional items can be declined with no impact on my purchase or financing.
              </p>
            </div>
          </button>
        </div>

        {/* Payment walk — split by what the advertised price already
            covers. Included accessories are shown for transparency but
            never re-charged; only genuine additions roll up to the number
            the customer confirms. One confirmation, hashed into the
            signed payload, so nothing can surface as a silent line later. */}
        <div className="bg-card rounded-xl p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-bold font-barlow-condensed text-foreground">Your price breakdown</h2>

          {advertisedPrice != null && (
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <span className="text-sm font-medium text-foreground">Advertised price</span>
              <span className="text-sm font-bold text-foreground tabular-nums">${advertisedPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          )}

          {includedItems.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground bg-muted/40 px-3 py-2">
                Already included in {advertisedPrice != null ? "that price" : "your advertised price"}
              </p>
              <div className="divide-y divide-border">
                {includedItems.map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-sm text-muted-foreground truncate pr-3">{p.name}</span>
                    <span className="text-xs font-medium text-muted-foreground tabular-nums">${effectivePrice(p).toFixed(2)} · included</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border overflow-hidden">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground bg-muted/40 px-3 py-2">
              Added to your price
            </p>
            {addedItems.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">Nothing added — you're paying the advertised price.</p>
            ) : (
              <div className="divide-y divide-border">
                {addedItems.map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-sm text-foreground truncate pr-3">
                      {p.name}
                      <span className="ml-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                        {p.badge_type === "installed" ? "Dealer-installed" : "Optional"}
                      </span>
                    </span>
                    <span className="text-sm font-semibold text-foreground tabular-nums">+${effectivePrice(p).toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between px-3 py-2.5 bg-muted/30">
                  <span className="text-sm font-semibold text-foreground">Total added</span>
                  <span className="text-sm font-bold text-foreground tabular-nums">+${addedTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            )}
          </div>

          {finalAllIn != null && (
            <div className="flex items-center justify-between rounded-lg border-2 border-teal/40 bg-teal/5 px-3 py-3">
              <span className="text-sm font-bold text-foreground">Your total</span>
              <span className="text-base font-black text-foreground tabular-nums">${finalAllIn.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Accessories already included in the advertised price are shown for transparency and are not charged again.
            {finalAllIn != null
              ? " Your total is the advertised price plus only what you added."
              : " The amounts above are added to your vehicle's advertised price; your full out-the-door figure is on your purchase agreement."}
            {" "}This excludes tax, title, license, and any financing charges.
          </p>
          <button
            onClick={() => setPaymentConfirmed(!paymentConfirmed)}
            className={`w-full flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-all ${
              paymentConfirmed ? "border-teal bg-teal/5" : "border-border"
            }`}
          >
            <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
              paymentConfirmed ? "border-teal bg-teal text-white" : "border-border"
            }`}>
              {paymentConfirmed && <span className="text-sm font-bold">✓</span>}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">This breakdown is correct</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                I reviewed what's already included in the advertised price and each item added to it, and I confirm the amounts above.
              </p>
            </div>
          </button>
        </div>

        {/* CA SB 766 — only renders for California vehicles under $50k after 10/1/2026 */}
        <SB766DisclosurePanel
          vehicleState={addendum?.vehicle_state}
          vehiclePrice={addendum?.vehicle_price}
          financingInput={addendum?.financing_input}
          threeDayAck={sb766ThreeDayAck}
          onThreeDayAck={setSb766ThreeDayAck}
          onDisclosureChange={setSb766Disclosure}
        />

        {/* Canonical disclosure packet — same content as the dealer document
            and the guided wizard, so this full form is fully defendable. */}
        <AddendumDisclosurePacket
          state={addendum?.vehicle_state}
          vehiclePrice={addendum?.vehicle_price}
          vehicleCondition={addendum?.vehicle_condition || undefined}
          products={(addendum?.products_snapshot as PacketProduct[]) || []}
          dealer={addendum?.dealer_snapshot || undefined}
        />

        {/* E-SIGN Act consent — REQUIRED before signature */}
        <div className="bg-card rounded-xl p-5 shadow-sm space-y-3">
          <h2 className="text-sm font-bold font-barlow-condensed text-foreground">
            Electronic Records & Signatures Consent
          </h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Federal law (E-SIGN Act, 15 U.S.C. §7001) and your state's UETA
            require that you consent before conducting this transaction electronically.
          </p>

          {!showFullConsent ? (
            <button
              onClick={() => setShowFullConsent(true)}
              className="text-xs font-semibold text-[#1E90FF] hover:underline"
            >
              Read the full disclosure →
            </button>
          ) : (
            <div className="max-h-48 overflow-y-auto rounded-lg bg-muted/40 border border-border p-3 text-[11px] text-foreground whitespace-pre-line leading-relaxed">
              {ESIGN_CONSENT_TEXT}
            </div>
          )}

          <button
            onClick={() => setEsignConsent(!esignConsent)}
            className={`w-full flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-all ${
              esignConsent ? "border-teal bg-teal/5" : "border-border"
            }`}
          >
            <div
              className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                esignConsent ? "border-teal bg-teal text-white" : "border-border"
              }`}
            >
              {esignConsent && <span className="text-sm font-bold">✓</span>}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">
                I consent to use electronic records and signatures for this transaction
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                I understand I can request a paper copy at no charge, I can withdraw
                consent at any time before signing, and my electronic signature is
                legally equivalent to a handwritten one under ESIGN/UETA.
              </p>
            </div>
          </button>
        </div>

        {/* Signature */}
        <div className="bg-card rounded-xl p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-bold font-barlow-condensed text-foreground">Your Signature</h2>
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Full name (printed)"
            className="w-full h-12 border-2 border-border rounded-lg px-4 text-base bg-background text-foreground placeholder:text-muted-foreground/40"
          />
          <SignaturePad
            label="Customer Signature"
            subtitle="Sign above to acknowledge receipt"
            onChange={(data, type) => setCustomerSig({ data, type })}
          />
        </div>

        {/* Submit — Tesla-cadence commitment verb. Solid slate, no
            chrome, no emoji. Once pressed, the addendum is hashed,
            archived, and delivered. */}
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full h-14 bg-slate-950 text-white rounded-xl font-display font-bold text-base tracking-tight disabled:opacity-50 hover:bg-slate-900 transition-colors"
        >
          {submitting ? "Signing…" : "Sign and finalize"}
        </button>
        <p className="text-center text-[10px] font-mono uppercase tracking-wider text-slate-500">
          By signing, you're hashed, archived, and legally bound.
        </p>
        </div>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// SB 766 return-window UI
// ──────────────────────────────────────────────────────────────

const ReturnWindowBand = ({
  status,
  onRequest,
}: {
  status: ReturnStatus;
  onRequest: () => void;
}) => {
  const closesAt = status.return_window_closes_at ? new Date(status.return_window_closes_at) : null;
  const now = new Date();
  const expired = closesAt ? now > closesAt : false;
  const alreadyRequested = status.return_status === "requested" || status.return_status === "completed";

  const fmt = (d: Date) =>
    d.toLocaleString(undefined, {
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });

  return (
    <div className="rounded-2xl border border-slate-300 bg-slate-50 p-4 md:p-5">
      <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-slate-500 font-semibold">
        California 3-day right to cancel (SB 766)
      </p>
      {alreadyRequested ? (
        <p className="mt-2 text-sm font-bold text-slate-950">
          Return requested
          {status.return_requested_at && (
            <span className="block text-[11px] font-mono font-normal text-slate-500 mt-1">
              {fmt(new Date(status.return_requested_at))}
            </span>
          )}
        </p>
      ) : expired ? (
        <p className="mt-2 text-sm font-bold text-slate-600">
          Return window closed
          {closesAt && (
            <span className="block text-[11px] font-mono font-normal text-slate-500 mt-1">
              Closed {fmt(closesAt)}
            </span>
          )}
        </p>
      ) : (
        <>
          <p className="mt-2 text-base font-bold text-slate-950">
            Return by {closesAt ? fmt(closesAt) : "—"}
          </p>
          <p className="mt-1 text-[12px] text-slate-600 leading-relaxed">
            Under $50k, unconditional right to cancel within 3 calendar days.
            400-mile cap, $1/mile over 250 (capped at $150), and a 1.5% restocking fee ($200–$600).
          </p>
          <button
            onClick={onRequest}
            className="mt-3 w-full h-11 rounded-xl bg-slate-950 text-white text-sm font-bold hover:bg-slate-900 transition-colors"
          >
            Request return
          </button>
        </>
      )}
    </div>
  );
};

const ReturnRequestModal = ({
  token,
  status,
  onClose,
  onRequested,
}: {
  token: string;
  status: ReturnStatus;
  onClose: () => void;
  onRequested: (requestedAt: string) => void;
}) => {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    const { data, error } = await (supabase as any).rpc("request_return", {
      _signing_token: token,
      _reason: reason.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error("Couldn't submit. Try calling the dealer directly.");
      return;
    }
    const result = data as { ok?: boolean; reason?: string };
    if (!result?.ok) {
      const msg = {
        unknown_token: "This signing link isn't recognized.",
        not_signed: "This purchase isn't signed yet.",
        not_eligible: "This purchase doesn't qualify for the 3-day right to cancel.",
        window_closed: "The 3-day return window has closed.",
      }[result?.reason || ""] || "Couldn't submit.";
      toast.error(msg);
      return;
    }
    onRequested(new Date().toISOString());
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white w-full md:max-w-md md:rounded-2xl rounded-t-[28px] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pt-2 md:hidden flex justify-center">
          <div className="w-10 h-1 rounded-full bg-slate-300" />
        </div>
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-black font-display tracking-tight">Request return</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">{status.vehicle_ymm || "Vehicle"}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center" aria-label="Close">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-700 leading-relaxed">
            <p className="font-bold text-slate-900 mb-1">What happens next</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>The dealer is notified immediately and has your request on record.</li>
              <li>Return the vehicle in the same condition within the 3-day window.</li>
              <li>The dealer may retain a 1.5% restocking fee ($200–$600) and charge $1/mile over 250 (capped at $150).</li>
            </ul>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Reason (optional)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Anything that would help the dealer process the return."
              className="mt-1 w-full rounded-lg border border-slate-200 p-3 text-sm focus:outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
            />
          </div>

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full h-12 rounded-xl bg-slate-950 text-white font-display font-bold text-sm disabled:opacity-50 hover:bg-slate-900 transition-colors"
          >
            {submitting ? "Requesting…" : "Request return"}
          </button>
          <p className="text-center text-[10px] font-mono uppercase tracking-wider text-slate-400">
            This is an exercise of your SB 766 right. It cannot be waived.
          </p>
        </div>
      </div>
    </div>
  );
};

export default MobileSigning;
