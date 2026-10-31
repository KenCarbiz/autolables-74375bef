import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RepairApprovalControl } from "./RepairApprovalControl";

const base = { busy: false, nameOf: () => "Dana", formatAt: () => "Oct 31", onDecide: () => undefined };

describe("RepairApprovalControl", () => {
  it("shows Pending with help text and no setter for a non-approver", () => {
    render(<RepairApprovalControl {...base} record={{ approval: "pending", decidedBy: null, decidedAt: null }} canSet={false} />);
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getByText("Internal service-manager authorization, not customer consent")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("shows who and when for a decision and lets an approver change it", () => {
    const onDecide = vi.fn();
    render(<RepairApprovalControl {...base} onDecide={onDecide} record={{ approval: "approved", decidedBy: "u1", decidedAt: "2026-10-31T12:00:00Z" }} canSet />);
    expect(screen.getByText("Dana, Oct 31")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "not_approved" } });
    expect(onDecide).toHaveBeenCalledWith("not_approved");
  });
});
