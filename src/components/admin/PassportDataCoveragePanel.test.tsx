import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import rows from "@/lib/vehicleData/__fixtures__/acceptanceVehicles.json";

const state: { result: { data: unknown; error: unknown } } = { result: { data: null, error: null } };
const eqCalls: Array<[string, unknown]> = [];

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = (c: string, v: unknown) => { eqCalls.push([c, v]); return chain; };
  chain.maybeSingle = () => Promise.resolve(state.result);
  return { supabase: { from: () => chain } };
});
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-1" } }) }));

import PassportDataCoveragePanel from "./PassportDataCoveragePanel";

const QX80 = (rows as Array<Record<string, unknown>>).find((r) => r.vin === "JN8AZ3CCXT9624250");

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><PassportDataCoveragePanel /></MemoryRouter>
    </QueryClientProvider>,
  );
};

const lookup = (vin: string) => {
  fireEvent.change(screen.getByPlaceholderText("17-character VIN"), { target: { value: vin } });
  fireEvent.click(screen.getByRole("button", { name: /Check coverage/ }));
};

describe("PassportDataCoveragePanel", () => {
  beforeEach(() => { eqCalls.length = 0; });

  it("renders the category table and the collapsed crosswalk for a real row", async () => {
    state.result = { data: { ...QX80, status: "published" }, error: null };
    const { container } = mount();
    lookup("jn8az3ccxt9624250");
    await waitFor(() => expect(screen.getByText(/Coverage for JN8AZ3CCXT9624250/)).toBeInTheDocument());
    expect(eqCalls).toContainEqual(["tenant_id", "tenant-1"]);
    expect(eqCalls).toContainEqual(["vin", "JN8AZ3CCXT9624250"]);
    expect(screen.getByRole("table", { name: "Passport data coverage by category" })).toBeInTheDocument();
    const details = container.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toMatch(/Field-level crosswalk/);
    expect(screen.getByText("New provider fields not yet mapped")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN|\{"/);
  });

  it("fails closed with an error and no report when the query fails", async () => {
    state.result = { data: null, error: { message: "boom" } };
    mount();
    lookup("JN8AZ3CCXT9624250");
    await waitFor(() => expect(screen.getByText("Coverage could not be loaded")).toBeInTheDocument());
    expect(screen.queryByText(/Coverage for/)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("rejects a malformed VIN without querying", () => {
    state.result = { data: null, error: null };
    mount();
    fireEvent.change(screen.getByPlaceholderText("17-character VIN"), { target: { value: "SHORT" } });
    expect(screen.getByRole("button", { name: /Check coverage/ })).toBeDisabled();
    expect(eqCalls.length).toBe(0);
  });
});
