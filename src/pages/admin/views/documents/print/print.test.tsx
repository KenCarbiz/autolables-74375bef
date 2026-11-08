import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AdminFixtureProvider } from "@/lib/admin/dataSource";
import { WAVE_D_PRINT_FIXTURES } from "@/pages/admin/fixtures/WaveDPrintFixtures";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  upsert: vi.fn(),
  del: vi.fn(),
  role: "owner" as string,
}));

vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: () => {}, success: () => {} }) }));
vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: { id: "tenant-test", name: "Example Group" }, currentStore: null, stores: [{ id: "loc-a", name: "Example Honda", city: "X", state: "ST" }, { id: "loc-b", name: "Example Toyota", city: "X", state: "ST" }] }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: mocks.role } }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => Promise.resolve({ data: mocks.rows, error: null }) }),
      upsert: (...a: unknown[]) => { mocks.upsert(...a); return Promise.resolve({ error: null }); },
      delete: () => ({ eq: () => ({ eq: (...a: unknown[]) => { mocks.del(...a); return Promise.resolve({ error: null }); } }) }),
    }),
  },
}));

import PrintSetupWizard from "./PrintSetupWizard";
import PrintCalibrationView from "../PrintCalibrationView";

const base = { label_mode: "white", x_offset_inches: 0, y_offset_inches: 0, scale_percentage: 100, top_safe_margin_inches: 0.25, left_safe_margin_inches: 0.25, show_crop_marks: false, show_safe_area: false, updated_at: "2026-11-01T00:00:00Z" };

const renderIt = (ui: React.ReactElement, url = "/") => render(<MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>);

beforeEach(() => {
  mocks.upsert.mockReset();
  mocks.del.mockReset();
  mocks.role = "owner";
  mocks.rows = [
    { ...base, id: "p-default", location_id: null, printer_name: "Example front office" },
    { ...base, id: "p-b", location_id: "loc-b", printer_name: "Example service printer", x_offset_inches: 0.1 },
  ];
});

describe("Set up printer wizard", () => {
  it("the verify step is blocked and has no save", async () => {
    renderIt(<PrintSetupWizard />, "/?profile=loc-b");
    await screen.findByRole("heading", { name: "Choose printer and paper" });
    fireEvent.click(screen.getByRole("button", { name: /Verify and save/ }));
    expect((await screen.findAllByText(/Not verified/)).length).toBeGreaterThan(0);
    expect(document.querySelector("[data-blocked-feature]")?.textContent).toContain("20261114010000");
    const confirm = screen.getByRole("button", { name: "Confirm alignment unavailable" });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("switch", { name: /I printed the test sheet/ })).toBeDisabled();
    const enabledActions = screen.getAllByRole("button").filter((b) => !(b as HTMLButtonElement).disabled && /^(review|apply|save|confirm|verify)/i.test(b.textContent ?? ""));
    expect(enabledActions).toEqual([]);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("never claims verification or matching margins from the profile alone", async () => {
    renderIt(<PrintSetupWizard />, "/?profile=loc-b");
    await screen.findByRole("heading", { name: "Choose printer and paper" });
    fireEvent.click(screen.getByRole("button", { name: /Verify and save/ }));
    expect(screen.queryByText(/margins match/i)).toBeNull();
    expect(screen.queryByText("Confirmed by a person")).toBeNull();
    expect(screen.getAllByText("Not verified").length).toBeGreaterThan(0);
  });

  it("moves the print with explicit increments and saves only the selected profile through the writer", async () => {
    renderIt(<PrintSetupWizard />, "/?profile=loc-b");
    await screen.findByRole("heading", { name: "Choose printer and paper" });
    fireEvent.click(screen.getByRole("button", { name: /Adjust alignment/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Move print right 0.05 in" }));
    fireEvent.click(screen.getByRole("button", { name: "Move print down 0.05 in" }));
    expect(screen.getByText("0.150 in right")).toBeInTheDocument();
    expect(screen.getByText("0.050 in down")).toBeInTheDocument();
    expect(mocks.upsert).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    const dialog = await screen.findByRole("dialog", { name: "Review printer changes" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(mocks.upsert).toHaveBeenCalledTimes(1));
    const [payload, opts] = mocks.upsert.mock.calls[0];
    expect(payload).toMatchObject({ tenant_id: "tenant-test", location_id: "loc-b", x_offset_inches: 0.15, y_offset_inches: 0.05, scale_percentage: 100, printer_name: "Example service printer" });
    expect(opts).toEqual({ onConflict: "tenant_id,location_id" });
    expect(mocks.upsert.mock.calls.every(([p]) => (p as { location_id: unknown }).location_id === "loc-b")).toBe(true);
  });

  it("explains millimeter steps and keeps the stored value in inches", async () => {
    renderIt(<PrintSetupWizard />, "/?profile=loc-b");
    await screen.findByRole("heading", { name: "Choose printer and paper" });
    fireEvent.click(screen.getByRole("button", { name: /Adjust alignment/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "Millimeters" }));
    fireEvent.click(screen.getByRole("radio", { name: "1 mm" }));
    fireEvent.click(screen.getByRole("button", { name: "Move print left 1 mm" }));
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    const dialog = await screen.findByRole("dialog", { name: "Review printer changes" });
    expect(within(dialog).getByText("1.54 mm right")).toBeInTheDocument();
  });

  it("blocks apply on a typed value outside the range instead of clamping it", async () => {
    renderIt(<PrintSetupWizard />, "/?profile=loc-b");
    await screen.findByRole("heading", { name: "Choose printer and paper" });
    fireEvent.click(screen.getByRole("button", { name: /Adjust alignment/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Advanced/ }));
    fireEvent.change(screen.getByLabelText(/Scale \(percent\)/), { target: { value: "140" } });
    expect(screen.getByText(/Keep scale between 80 and 120/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("opens the test sheet without printing, and cancelling records nothing", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    renderIt(<PrintSetupWizard />, "/?profile=loc-b");
    await screen.findByRole("heading", { name: "Choose printer and paper" });
    fireEvent.click(screen.getAllByRole("button", { name: /Print test/ })[0]);
    expect(screen.getByText(/Actual size/, { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/Headers and footers/, { selector: "strong" })).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open test sheet" }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0][0])).toContain("/print/test-label?h=");
    expect(print).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Record test sheet printed" })).toBeDisabled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    open.mockRestore();
    print.mockRestore();
  });

  it("does not add a role gate the server does not enforce", async () => {
    mocks.role = "sales";
    renderIt(<PrintSetupWizard />, "/?profile=loc-b");
    await screen.findByRole("heading", { name: "Choose printer and paper" });
    expect(screen.queryByText(/view this profile but not change it/)).toBeNull();
    expect(screen.getByRole("button", { name: /Adjust alignment/ })).toBeInTheDocument();
  });
});

describe("Printer profiles", () => {
  it("shows a card per profile with scope and an honest confirmation status", async () => {
    renderIt(<PrintCalibrationView />);
    const cards = await screen.findAllByRole("heading", { level: 3 });
    expect(cards.map((c) => c.textContent)).toEqual(["Example front office", "Example service printer"]);
    expect(screen.getAllByText("Not verified").length).toBe(2);
    expect(screen.queryByText("Confirmed by a person")).toBeNull();
    expect(screen.getAllByText(/Letter 8.5 x 11 in/).length).toBeGreaterThan(0);
  });

  it("editing one profile writes only that location and leaves the other row alone", async () => {
    renderIt(<PrintCalibrationView />);
    await screen.findByText("Example service printer");
    fireEvent.click(screen.getByRole("button", { name: "Edit Example service printer" }));
    const input = await screen.findByLabelText(/Printer label/);
    fireEvent.change(input, { target: { value: "Example renamed printer" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(mocks.upsert).toHaveBeenCalledTimes(1));
    expect(mocks.upsert.mock.calls[0][0]).toMatchObject({ location_id: "loc-b", printer_name: "Example renamed printer", x_offset_inches: 0.1 });
    expect(mocks.upsert.mock.calls.some(([p]) => (p as { location_id: unknown }).location_id === null)).toBe(false);
    expect(await screen.findByText("Example front office")).toBeInTheDocument();
  });

  it("refuses a second profile for a location that already has one", async () => {
    mocks.rows = [{ ...base, id: "p-a", location_id: "loc-a", printer_name: "Only" }];
    renderIt(<PrintCalibrationView />);
    await screen.findByText("Only");
    fireEvent.click(screen.getByRole("button", { name: "Add profile" }));
    const dialog = await screen.findByRole("dialog");
    const scope = within(dialog).getByLabelText("Location") as HTMLSelectElement;
    expect([...scope.options].map((o) => o.value)).not.toContain("loc-a");
  });

  it("deleting confirms what changes and removes only that row", async () => {
    renderIt(<PrintCalibrationView />);
    await screen.findByText("Example service printer");
    fireEvent.keyDown(screen.getByRole("button", { name: "More actions for Example service printer" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete profile" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Other profiles are not changed/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete profile" }));
    await waitFor(() => expect(mocks.del).toHaveBeenCalledWith("tenant_id", "tenant-test"));
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("is empty with a working Set up printer action when nothing is saved", async () => {
    mocks.rows = [];
    renderIt(<PrintCalibrationView />);
    expect(await screen.findByText("No printer profile yet")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Set up printer/ }).length).toBeGreaterThan(0);
  });

  it("keeps the dealership default from being deleted and offers reset instead", async () => {
    renderIt(<PrintCalibrationView />);
    await screen.findByText("Example front office");
    fireEvent.keyDown(screen.getByRole("button", { name: "More actions for Example front office" }), { key: "Enter" });
    expect(await screen.findByText("The dealership default cannot be deleted")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Delete profile" })).toBeNull();
  });

  it("states that any member can edit, matching the row-level security", async () => {
    mocks.role = "sales";
    renderIt(<PrintCalibrationView />);
    await screen.findByText("Example service printer");
    expect(screen.getByRole("button", { name: "Edit Example service printer" })).toBeInTheDocument();
    expect(screen.getByText(/Any signed-in member of this dealership can change printer profiles/)).toBeInTheDocument();
  });
});

describe("fixtures", () => {
  it("render from fixture data and never write", async () => {
    const fx = WAVE_D_PRINT_FIXTURES["v3-print-profiles"].fixture;
    mocks.rows = [];
    renderIt(<AdminFixtureProvider fixture={fx}><PrintCalibrationView /></AdminFixtureProvider>);
    expect(await screen.findByText("Example finance office printer")).toBeInTheDocument();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
