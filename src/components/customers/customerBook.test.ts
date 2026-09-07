import { describe, expect, it } from "vitest";
import { buildCustomerBook, type LeadRow } from "./customerBook";

const NOW = Date.parse("2026-09-07T12:00:00Z");
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

const lead = (over: Partial<LeadRow> = {}): LeadRow => ({
  id: "lead-1",
  name: "Dana Reyes",
  phone: "860-555-0134",
  email: "dana@example.com",
  vehicle_interest: "2024 Honda CR-V",
  vehicle_vin: "1HGCV1F3XLA000001",
  source: "website",
  sub_source: null,
  status: "new",
  notes: "",
  captured_at: ago(30),
  first_response_at: null,
  escalated_at: null,
  escalation_level: 0,
  routed_agent_id: null,
  ...over,
});

const event = (over: Record<string, unknown> = {}) => ({
  session_id: "s1",
  visitor_id: "v1",
  vin: "1HGCV1F3XLA000001",
  stock: "A123",
  vehicle_id: null,
  event_type: "passport_opened",
  document_type: null,
  source: "passport",
  device_type: "mobile",
  city: null,
  region: null,
  metadata: null,
  created_at: ago(2),
  occurred_at: ago(2),
  ...over,
});

const deal = (over: Record<string, unknown> = {}) => ({
  id: "deal-1",
  customer_name: "Dana Reyes",
  customer_email: "dana@example.com",
  vehicle_vin: "1HGCV1F3XLA000001",
  vehicle_ymm: "2024 Honda CR-V",
  vehicle_stock: "A123",
  selling_price: 31000,
  total_with_optional: 32500,
  status: "draft",
  lifecycle_status: "draft",
  price_verification_status: "pending",
  price_verification_delta: null,
  accepted_at: null,
  customer_signed_at: null,
  employee_signed_at: null,
  delivered_at: null,
  employee_name: "Sam Ortiz",
  signing_token: null,
  ready_at: null,
  created_at: ago(5),
  updated_at: ago(5),
  ...over,
});

describe("buildCustomerBook", () => {
  it("never attributes an anonymous session to a named lead", () => {
    const book = buildCustomerBook({
      now: NOW,
      leads: [lead()],
      events: [event(), event({ event_type: "customer_passport_reserve_clicked", created_at: ago(1), occurred_at: ago(1) })],
    });

    const named = book.customers.find((c) => c.identified);
    const anon = book.customers.find((c) => !c.identified);
    expect(named?.name).toBe("Dana Reyes");
    expect(named?.engagement.linked).toBe(false);
    expect(anon).toBeTruthy();
    expect(anon?.name).toBeNull();
    expect(anon?.bucket).toBe("hot");
    expect(anon?.nextAction.headline).toContain("No contact captured");
  });

  it("links engagement to a person only through a document request that carries the visitor id", () => {
    const book = buildCustomerBook({
      now: NOW,
      leads: [lead()],
      events: [event(), event({ event_type: "customer_passport_reserve_clicked", created_at: ago(1), occurred_at: ago(1) })],
      dwell: [{ session_id: "s1", vin: "1HGCV1F3XLA000001", module: "market-price", seconds: 90, last_at: ago(2) }],
      documentRequests: [
        {
          id: "req-1",
          customer_name: "Dana Reyes",
          customer_email: "dana@example.com",
          customer_phone: "860-555-0134",
          vin: "1HGCV1F3XLA000001",
          stock: "A123",
          vehicle_id: null,
          visitor_id: "v1",
          session_id: "s1",
          requested_documents: [],
          delivery_status: "sent",
          verification_status: "not_required",
          requested_at: ago(3),
          delivered_at: ago(3),
        },
      ],
    });

    expect(book.customers).toHaveLength(1);
    const dana = book.customers[0];
    expect(dana.identified).toBe(true);
    expect(dana.engagement.linked).toBe(true);
    expect(dana.engagement.dwellSeconds).toBe(90);
    expect(dana.bucket).toBe("hot");
    expect(dana.engagement.facts.every((f) => f.action.length > 0)).toBe(true);
  });

  it("counts view-only visitors instead of listing them as rows", () => {
    const book = buildCustomerBook({ now: NOW, events: [event({ visitor_id: "v9", session_id: "s9" })] });
    expect(book.customers).toHaveLength(0);
    expect(book.passiveVisitors).toBe(1);
  });

  it("blocks an unverified draft on price integrity and chases a stale signature", () => {
    const book = buildCustomerBook({
      now: NOW,
      deals: [
        deal(),
        deal({ id: "deal-2", lifecycle_status: "awaiting_customer", price_verification_status: "verified", signing_token: "tok", ready_at: ago(72) }),
      ],
    });

    const draft = book.deals.find((d) => d.id === "deal-1");
    const outForSignature = book.deals.find((d) => d.id === "deal-2");
    expect(draft?.state).toBe("draft");
    expect(draft?.priceIntegrity.state).toBe("unverified");
    expect(draft?.nextAction.headline).toBe("Verify the price");
    expect(outForSignature?.state).toBe("out_for_signature");
    expect(outForSignature?.nextAction.headline).toBe("Chase the signature");
  });

  it("surfaces an open SB 766 return window on the deal and the customer", () => {
    const closes = new Date(NOW + 2 * 86_400_000).toISOString();
    const book = buildCustomerBook({
      now: NOW,
      deals: [deal({ status: "signed", lifecycle_status: "fully_executed", customer_signed_at: ago(24) })],
      signings: [
        {
          id: "sig-1",
          addendum_id: "deal-1",
          vin: "1HGCV1F3XLA000001",
          signer_type: "customer",
          signer_name: "Dana Reyes",
          signed_at: ago(24),
          return_status: "eligible",
          return_window_closes_at: closes,
          return_requested_at: null,
          return_completed_at: null,
          return_reason: null,
        },
      ],
    });

    expect(book.deals[0].returnInfo?.status).toBe("eligible");
    expect(book.deals[0].nextAction.kind).toBe("return");
    expect(book.customers[0].returnStatus.label).toContain("Return window closes");
  });
});
