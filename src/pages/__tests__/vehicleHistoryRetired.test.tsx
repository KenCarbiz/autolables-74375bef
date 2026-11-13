import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import VehicleHistoryRedirect from "@/components/passport/VehicleHistoryRedirect";

const ROOT = join(__dirname, "..", "..", "..");
const app = readFileSync(join(ROOT, "src/App.tsx"), "utf8");

function Where() {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
}

describe("the standalone History & Title page is retired", () => {
  it("App.tsx no longer routes or imports the page, and routes the old path to the redirect", () => {
    expect(app).not.toMatch(/pages\/VehiclePassportHistory/);
    expect(app).toMatch(/path="\/v\/:slug\/vehicle-history" element=\{<VehicleHistoryRedirect \/>\}/);
  });

  it("the page file is gone and the registry no longer lists it", () => {
    expect(existsSync(join(ROOT, "src/pages/VehiclePassportHistory.tsx"))).toBe(false);
    expect(readFileSync(join(ROOT, "src/lib/passport/publicSurface.ts"), "utf8")).not.toMatch(/vehicle-history/);
  });

  it("an old link lands on the Passport and keeps its query string", () => {
    render(
      <MemoryRouter initialEntries={["/v/demo/vehicle-history?preview=1&scenario=new2026"]}>
        <Routes>
          <Route path="/v/:slug/vehicle-history" element={<VehicleHistoryRedirect />} />
          <Route path="/v/:slug" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("where").textContent).toBe("/v/demo?preview=1&scenario=new2026");
  });
});
