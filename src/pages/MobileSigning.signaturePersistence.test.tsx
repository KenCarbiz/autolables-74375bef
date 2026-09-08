import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// ──────────────────────────────────────────────────────────────────────
// The signing page is the legal record. Two invariants live here:
//
//  1. A signature that did NOT persist can never render as signed. The legacy
//     fallback writes public.addendums directly, the signer is anonymous, and
//     that table has no anon policy — so the UPDATE matches zero rows and
//     supabase-js still resolves with `error: null`. Only the returned row
//     proves the write landed.
//  2. The submit button may not come back to life while a signing write is
//     still in flight, or a double-tap issues two of them.
//
// Both are driven through the real page, not a hand-called predicate.
// ──────────────────────────────────────────────────────────────────────

const TOKEN = "11111111-2222-4333-8444-555555555555";

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void }
const defer = <T,>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

// What the anon addendums UPDATE hands back. `[]` is the production bug shape.
let addendumUpdateResult: Deferred<{ data: unknown; error: { message: string } | null }>;
let recordedEvents: Array<{ event: string; details: Record<string, unknown> }>;
let addendumUpdateCalls: number;

const addendumRow = () => ({
  id: "add-1",
  vehicle_vin: "5N1AL1F83VC332076",
  vehicle_ymm: "2026 INFINITI QX60",
  vehicle_state: "CT",
  vehicle_condition: "new",
  vehicle_price: 52000,
  products_snapshot: [],
  initials: {},
  optional_selections: {},
  status: "ready",
  dealer_snapshot: { name: "Harte INFINITI" },
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      if (fn === "get_addendum_by_token") return Promise.resolve({ data: [addendumRow()], error: null });
      if (fn === "record_customer_signing") {
        return Promise.resolve({ data: null, error: { message: "function public.record_customer_signing does not exist" } });
      }
      if (fn === "record_addendum_event") {
        recordedEvents.push({ event: String(args._event), details: (args._details || {}) as Record<string, unknown> });
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self, eq: self, order: self, limit: self, update: self,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(onFulfilled),
      });
      if (table === "addendums") {
        chain.update = () => { addendumUpdateCalls += 1; return chain; };
        chain.select = () => addendumUpdateResult.promise;
      }
      return chain;
    },
  },
}));

vi.mock("@/lib/esign", () => ({
  ESIGN_CONSENT_TEXT: "Electronic records disclosure.",
  buildConsentRecord: () => ({ version: "test-1", user_agent: "vitest", language: "en-US" }),
  fetchClientIp: () => Promise.resolve("203.0.113.9"),
  fetchGeoloc: () => Promise.resolve(null),
  hashPayload: () => Promise.resolve("deadbeef"),
}));

vi.mock("@/lib/stickerStudio/useSigningDocuments", () => ({
  useSigningDocuments: () => ({ documents: [], loading: false }),
  signingDocumentRefs: () => [],
}));

vi.mock("@/hooks/useEmailDistribution", () => ({ useEmailDistribution: () => ({ sendPacket: vi.fn() }) }));
vi.mock("@/hooks/useReviewRequest", () => ({ useReviewRequest: () => ({ queueReviewRequest: vi.fn() }) }));

vi.mock("@/components/addendum/SignaturePad", () => ({
  default: ({ onChange }: { onChange: (d: string, t: "draw" | "type") => void }) => (
    <button onClick={() => onChange("data:image/png;base64,AAAA", "draw")}>mock-sign</button>
  ),
}));

const toastErrors: string[] = [];
vi.mock("sonner", () => ({
  toast: {
    error: (m: string) => { toastErrors.push(m); },
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

import MobileSigning from "./MobileSigning";

const renderPage = () => render(
  <MemoryRouter initialEntries={[`/sign/${TOKEN}?doc=1`]}>
    <Routes><Route path="/sign/:token" element={<MobileSigning />} /></Routes>
  </MemoryRouter>,
);

const clickText = (text: string) => fireEvent.click(screen.getByText(text));

// Fill every gate this addendum actually has: no products means no initials and
// no elections, and a NEW car skips the used-car warranty + mileage block.
const completeForm = async () => {
  await screen.findByText("2026 INFINITI QX60");
  clickText("I consent to use electronic records and signatures for this transaction");
  clickText("I confirm the sticker matches this addendum");
  clickText("This breakdown is correct");
  fireEvent.change(screen.getByPlaceholderText("Full name (printed)"), { target: { value: "Jamie Rivera" } });
  clickText("mock-sign");
};

const submitButton = () => screen.getByRole("button", { name: /Sign and finalize|Signing…/ });

beforeEach(() => {
  recordedEvents = [];
  toastErrors.length = 0;
  addendumUpdateCalls = 0;
  addendumUpdateResult = defer();
});

describe("MobileSigning — a signature that did not persist never renders as signed", () => {
  it("shows Not signed (never the confirmation) when the anon UPDATE matches zero rows", async () => {
    renderPage();
    await completeForm();

    // The production shape of the bug: no error, no rows.
    addendumUpdateResult.resolve({ data: [], error: null });
    fireEvent.click(submitButton());

    await screen.findByText("Not signed");
    expect(screen.queryByText("You're done.")).toBeNull();
    expect(toastErrors.some((m) => /could not be saved/i.test(m))).toBe(true);
  });

  it("tells the dealer, on the deal timeline, that the attempt did not go through", async () => {
    renderPage();
    await completeForm();
    addendumUpdateResult.resolve({ data: [], error: null });
    fireEvent.click(submitButton());

    await screen.findByText("Not signed");
    const failed = recordedEvents.find((e) => e.event === "customer_sign_failed");
    expect(failed).toBeDefined();
    expect(failed?.details.reason).toBe("legacy_update_matched_no_rows");
    expect(recordedEvents.some((e) => e.event === "customer_signed")).toBe(false);
  });

  it("renders the signed confirmation when the write actually landed", async () => {
    renderPage();
    await completeForm();
    addendumUpdateResult.resolve({ data: [{ id: "add-1" }], error: null });
    fireEvent.click(submitButton());

    await screen.findByText("You're done.");
    expect(screen.queryByText("Not signed")).toBeNull();
    expect(recordedEvents.some((e) => e.event === "customer_signed")).toBe(true);
  });
});

describe("MobileSigning — no double-submit window", () => {
  it("keeps the button disabled until the signing write settles", async () => {
    renderPage();
    await completeForm();

    fireEvent.click(submitButton());
    await waitFor(() => expect(addendumUpdateCalls).toBe(1));

    // The write is still in flight. A second tap must not issue another one.
    expect(submitButton()).toBeDisabled();
    fireEvent.click(submitButton());
    expect(addendumUpdateCalls).toBe(1);

    addendumUpdateResult.resolve({ data: [], error: null });
    await screen.findByText("Not signed");
    expect(submitButton()).not.toBeDisabled();
    expect(addendumUpdateCalls).toBe(1);
  });
});
