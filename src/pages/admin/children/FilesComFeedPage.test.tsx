import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import FilesComFeedPage from "./FilesComFeedPage";
import { renderInFixture } from "@/pages/admin/views/integrations/testHarness";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), auth: { user: { id: "u1" }, isAdmin: false, loading: false } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: mocks.invoke } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: null, currentStore: null }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "admin" }, loading: false }) }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: { dealer_timezone: "UTC" }, loading: false }) }));

describe("FilesComFeedPage", () => {
  it("a dealer admin without the platform role sees no connector data and triggers no call", () => {
    renderInFixture(<FilesComFeedPage />, {});
    expect(screen.getByText("Platform administrators only")).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
