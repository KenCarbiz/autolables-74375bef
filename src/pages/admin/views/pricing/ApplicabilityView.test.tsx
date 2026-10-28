import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { renderAdmin } from "@/test/adminRender";
import { resetSupabaseSpy, spyCalls, spyResponses, type SpyOp } from "@/test/mocks/supabaseSpy";
import { EXAMPLE_PRODUCT, EXAMPLE_RULE } from "@/pages/admin/fixtures/pricingFixtureData";

// The Applicability list through the real useProductRules writer: a refused
// save or delete is reported as an error, keeps the editor open and is never
// audited or announced as done.

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
const toastState = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: toastState.error, success: toastState.success, warning: () => {} }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" }, isAdmin: false, loading: false }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-1", name: "Example Motors" }, currentStore: { id: "store-1" }, loading: false }) }));
const auditState = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/contexts/AuditContext", () => ({ useAudit: () => ({ log: auditState.log, entries: [] }) }));

import ApplicabilityView from "./ApplicabilityView";

const REFUSED = { code: "42501", message: "permission denied for table product_rules" };
const RULE = { ...EXAMPLE_RULE, id: "r1", product_id: "p1", mileage_max: 80000 };
const writeOp = (ops: SpyOp[]) => ops.find((o) => o.op === "insert" || o.op === "update" || o.op === "delete")?.op ?? null;
const ruleWrites = () => spyCalls.filter((c) => c.kind === "table" && c.table === "product_rules" && ["insert", "update", "delete"].includes(c.op));

const refuse = (refused: string | null) => {
  spyResponses.tables.product_rules = (ops) => {
    const op = writeOp(ops);
    if (op && op === refused) return { data: null, error: REFUSED };
    if (op === "insert") return { data: { ...RULE, id: "r-new" }, error: null };
    if (op) return { data: null, error: null };
    return { data: [RULE], error: null };
  };
};

const renderView = async () => {
  renderAdmin(<ApplicabilityView />, { route: "/admin?tab=applicability" });
  await screen.findByText("1 rule");
};

const confirmSpy = vi.spyOn(window, "confirm");

beforeEach(() => {
  resetSupabaseSpy();
  auditState.log.mockClear();
  toastState.error.mockClear();
  toastState.success.mockClear();
  confirmSpy.mockReturnValue(true);
  spyResponses.tables.products = { data: [{ ...EXAMPLE_PRODUCT, id: "p1", is_active: true }], error: null };
});
afterEach(() => confirmSpy.mockReset());

describe("ApplicabilityView rule writes", () => {
  it("keeps the editor open with the typed values and shows the error when an edit is refused", async () => {
    refuse("update");
    await renderView();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit rule" });
    fireEvent.change(within(dialog).getByRole("spinbutton"), { target: { value: "60000" } });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" })); });
    expect(ruleWrites().map((c) => c.kind === "table" && c.op)).toEqual(["update"]);
    expect(toastState.error).toHaveBeenCalledWith(REFUSED.message);
    expect(toastState.success).not.toHaveBeenCalled();
    expect(auditState.log).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Edit rule" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByRole("spinbutton")).toHaveValue(60000);
  });

  it("keeps the editor open and audits nothing when a new rule is refused", async () => {
    refuse("insert");
    await renderView();
    fireEvent.click(screen.getAllByRole("button", { name: "Add rule" })[1]);
    const dialog = screen.getByRole("dialog", { name: "Add rule" });
    fireEvent.change(within(dialog).getByPlaceholderText("2020"), { target: { value: "2022" } });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" })); });
    expect(toastState.error).toHaveBeenCalledWith(REFUSED.message);
    expect(toastState.success).not.toHaveBeenCalled();
    expect(auditState.log).not.toHaveBeenCalled();
    expect(within(screen.getByRole("dialog", { name: "Add rule" })).getByPlaceholderText("2020")).toHaveValue("2022");
  });

  it("shows the error and audits nothing when a delete is refused", async () => {
    refuse("delete");
    await renderView();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete" })); });
    expect(ruleWrites().map((c) => c.kind === "table" && c.op)).toEqual(["delete"]);
    expect(toastState.error).toHaveBeenCalledWith(REFUSED.message);
    expect(toastState.success).not.toHaveBeenCalled();
    expect(auditState.log).not.toHaveBeenCalled();
    expect(screen.getByText("1 rule")).toBeInTheDocument();
  });

  it("closes the editor, announces and audits a save the database accepts", async () => {
    refuse(null);
    await renderView();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save rule" })); });
    expect(toastState.success).toHaveBeenCalledWith("Rule updated");
    expect(toastState.error).not.toHaveBeenCalled();
    expect(auditState.log).toHaveBeenCalledWith(expect.objectContaining({ action: "rule_updated", entity_id: "r1" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
