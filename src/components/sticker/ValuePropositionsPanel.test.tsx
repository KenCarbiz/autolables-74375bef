import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { emptyProgram, type DealerProgram } from "@/lib/dealerPrograms";
import ValuePropositionsPanel, { type ValuePropositionsPanelProps } from "./ValuePropositionsPanel";

const program = (id: string, title: string, extra: Partial<DealerProgram> = {}): DealerProgram => ({
  ...emptyProgram(), id, title, supportingLine: `${title} details`, disclosure: `${title} terms apply.`, showOnSticker: true, ...extra,
});

const programs = [program("program-1", "Lifetime powertrain"), program("program-2", "Free first service")];

const renderPanel = (over: Partial<ValuePropositionsPanelProps> = {}) => {
  const props: ValuePropositionsPanelProps = {
    programs,
    omitted: new Set(),
    onToggleIncluded: vi.fn(),
    canManage: false,
    imageLibrary: [],
    uploading: false,
    onAdd: vi.fn(),
    onSave: vi.fn(),
    onUpload: vi.fn(),
    ...over,
  };
  render(<ValuePropositionsPanel {...props} />);
  return props;
};

describe("ValuePropositionsPanel for a salesperson (no add-on authority)", () => {
  it("shows the approved programs and their claims, read-only", () => {
    renderPanel();
    expect(screen.getByText("2 on this addendum")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Free first service" })).toBeInTheDocument();
    expect(screen.getByText("Lifetime powertrain details")).toBeInTheDocument();
    expect(screen.getByText("Lifetime powertrain terms apply.")).toBeInTheDocument();
    expect(screen.getByText(/changed by an add-on manager/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add value proposition/ })).toBeNull();
    expect(screen.queryByLabelText("Headline")).toBeNull();
    expect(screen.queryByLabelText("Disclosure")).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop offering on addenda" })).toBeNull();
    expect(screen.queryByText("Upload")).toBeNull();
  });

  it("selects another program and leaves it off this addendum without touching the dealer library", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Free first service" }));
    expect(screen.getByText("Free first service details")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include on this addendum" }));
    expect(props.onToggleIncluded).toHaveBeenCalledWith("program-2", false);
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onAdd).not.toHaveBeenCalled();
  });

  it("puts a withheld program back on this addendum", () => {
    const props = renderPanel({ omitted: new Set(["program-1"]) });
    expect(screen.getByText("1 on this addendum")).toBeInTheDocument();
    expect(screen.getByText("Left off")).toBeInTheDocument();
    const include = screen.getByRole("checkbox", { name: "Include on this addendum" });
    expect(include).not.toBeChecked();
    fireEvent.click(include);
    expect(props.onToggleIncluded).toHaveBeenCalledWith("program-1", true);
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("says who can add programs when none are offered", () => {
    renderPanel({ programs: [] });
    expect(screen.getByText(/An add-on manager can add them/)).toBeInTheDocument();
  });
});

describe("ValuePropositionsPanel for an add-on manager", () => {
  it("edits the dealer library entry and adds new programs", () => {
    const props = renderPanel({ canManage: true, onAdd: vi.fn(() => "program-3") });
    fireEvent.change(screen.getByLabelText("Headline"), { target: { value: "Lifetime powertrain warranty" } });
    expect(props.onSave).toHaveBeenCalledWith("program-1", { title: "Lifetime powertrain warranty" });
    fireEvent.change(screen.getByLabelText("Disclosure"), { target: { value: "See dealer." } });
    expect(props.onSave).toHaveBeenCalledWith("program-1", { disclosure: "See dealer." });
    fireEvent.click(screen.getByRole("button", { name: /Add value proposition/ }));
    expect(props.onAdd).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Stop offering on addenda" }));
    expect(props.onSave).toHaveBeenCalledWith("program-1", { showOnSticker: false });
  });

  it("chooses for this addendum the same way a salesperson does", () => {
    const props = renderPanel({ canManage: true });
    fireEvent.click(screen.getByRole("checkbox", { name: "Include on this addendum" }));
    expect(props.onToggleIncluded).toHaveBeenCalledWith("program-1", false);
    expect(props.onSave).not.toHaveBeenCalled();
  });
});
