import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  ColorField, DataTable, DraftActionBar, ReviewChangesDialog, SortableList, StatusBadge, deriveDraftBarState, draftBarText,
  BlockedFeatureNotice, MetricCard, ScopeLabel, ADMIN_ICON_NAMES, type DataColumn, type SortableItem, type StatusState,
} from ".";
import { STATUS_META } from "./StatusBadge";

describe("StatusBadge", () => {
  it("always renders text for every state", () => {
    for (const s of Object.keys(STATUS_META) as StatusState[]) {
      const { unmount } = render(<StatusBadge state={s} />);
      expect(screen.getByText(STATUS_META[s].label)).toBeInTheDocument();
      unmount();
    }
    render(<StatusBadge state="blocked_schema" />);
    expect(screen.getByText("Needs database update")).toBeInTheDocument();
  });
});

describe("DraftActionBar", () => {
  const noop = () => {};
  it("describes each state and disables Review unless dirty", () => {
    const { rerender } = render(<DraftActionBar state={{ kind: "unchanged" }} onDiscard={noop} onReview={noop} />);
    expect(screen.getByRole("status")).toHaveTextContent("No changes");
    expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
    rerender(<DraftActionBar state={{ kind: "dirty", count: 3 }} onDiscard={noop} onReview={noop} />);
    expect(screen.getByRole("status")).toHaveTextContent("3 unsaved changes");
    expect(screen.getByRole("button", { name: "Review changes" })).toBeEnabled();
    rerender(<DraftActionBar state={{ kind: "invalid", reason: "Color is invalid" }} onDiscard={noop} onReview={noop} />);
    expect(screen.getByRole("status")).toHaveTextContent("Color is invalid");
    expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
  });
  it("failed keeps the draft and offers retry; conflict offers refresh", () => {
    const retry = vi.fn();
    const { rerender } = render(<DraftActionBar state={{ kind: "failed" }} onDiscard={noop} onReview={noop} onRetry={retry} />);
    expect(screen.getByRole("status")).toHaveTextContent("Your changes are kept");
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    expect(retry).toHaveBeenCalled();
    rerender(<DraftActionBar state={{ kind: "conflict" }} onDiscard={noop} onReview={noop} onRefresh={noop} />);
    expect(screen.getByRole("button", { name: "Refresh and review" })).toBeInTheDocument();
  });
  it("saved only comes from a saved phase with no pending changes", () => {
    expect(deriveDraftBarState({ phase: "saved", dirty: false, changeCount: 0 })).toEqual({ kind: "saved" });
    expect(deriveDraftBarState({ phase: "idle", dirty: false, changeCount: 0 })).toEqual({ kind: "unchanged" });
    expect(draftBarText({ kind: "saving" })).toBe("Saving changes");
  });
});

describe("ReviewChangesDialog", () => {
  it("shows old and new values, scope and timing, and returns focus", async () => {
    const Host = () => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open review</button>
          <ReviewChangesDialog open={open} scope="Fixture rooftop" timing="Immediately" changes={[{ id: "a", label: "Name", before: "Old", after: "New" }]} impact={<span>Impact here</span>} onCancel={() => setOpen(false)} onApply={() => setOpen(false)} />
        </>
      );
    };
    render(<Host />);
    const opener = screen.getByRole("button", { name: "Open review" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    const item = within(dialog).getByRole("list", { name: "Changed fields" });
    expect(item).toHaveTextContent("CurrentOld");
    expect(item).toHaveTextContent("NewNew");
    expect(within(dialog).getByText("Fixture rooftop")).toBeInTheDocument();
    expect(within(dialog).getByText("Immediately")).toBeInTheDocument();
    expect(within(dialog).getByText("Impact here")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });
});

describe("ColorField", () => {
  it("validates, normalizes on blur and reports contrast", () => {
    const Host = () => {
      const [v, setV] = useState("#24G7");
      return <ColorField name="Primary" value={v} onChange={setV} />;
    };
    render(<Host />);
    const input = screen.getByLabelText("Primary") as HTMLInputElement;
    expect(screen.getByRole("alert")).toHaveTextContent("Not a valid HEX");
    fireEvent.change(input, { target: { value: "2457d6" } });
    fireEvent.blur(input);
    expect(input.value).toBe("#2457D6");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/On white/).closest("li")).toHaveTextContent("Passes AA");
    const pale = render(<ColorField name="Pale" value="#F5F5A0" onChange={() => {}} />);
    expect(within(pale.container).getByText(/On white/).closest("li")).toHaveTextContent("Fails AA");
  });
});

interface R { id: string; name: string }
const rows: R[] = Array.from({ length: 60 }, (_, i) => ({ id: `r${i}`, name: `Fixture ${i + 1}` }));
const cols: DataColumn<R>[] = [{ id: "n", header: "Name", primary: true, cell: (r) => r.name }];

describe("DataTable", () => {
  it("paginates 25/50/100 and searches", async () => {
    render(<DataTable caption="Fixtures" columns={cols} rows={rows} rowKey={(r) => r.id} searchText={(r) => r.name} />);
    expect(screen.getByText("Showing 1 to 25 of 60")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText("Showing 26 to 50 of 60")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "100" } });
    expect(screen.getByText("Showing 1 to 60 of 60")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Fixture 60" } });
    expect(screen.getByText("Showing 1 to 1 of 1")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nomatch" } });
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });
  it("keeps empty, error and loading distinct", () => {
    const { rerender, container } = render(<DataTable caption="Fixtures" columns={cols} rows={[]} rowKey={(r) => r.id} emptyTitle="Nothing yet" />);
    expect(screen.getByText("Nothing yet")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("data-table-state", "empty");
    rerender(<DataTable caption="Fixtures" columns={cols} rows={undefined} error={{ message: "Boom" }} rowKey={(r) => r.id} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Boom");
    expect(container.firstElementChild).toHaveAttribute("data-table-state", "error");
    rerender(<DataTable caption="Fixtures" columns={cols} rows={undefined} loading rowKey={(r) => r.id} />);
    expect(container.firstElementChild).toHaveAttribute("data-table-state", "loading");
  });
  it("opens a row from the keyboard-reachable button", () => {
    const open = vi.fn();
    render(<DataTable caption="Fixtures" columns={cols} rows={rows} rowKey={(r) => r.id} onOpenRow={open} rowLabel={(r) => r.name} />);
    fireEvent.click(screen.getByRole("button", { name: "Open details for Fixture 1" }));
    expect(open).toHaveBeenCalledWith(rows[0]);
  });
});

describe("SortableList", () => {
  it("reorders from the keyboard and announces", () => {
    const Host = () => {
      const [items, setItems] = useState<SortableItem[]>([{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }]);
      return <SortableList label="Modules" items={items} onChange={setItems} />;
    };
    render(<Host />);
    const handle = screen.getByRole("button", { name: /Reorder A/ });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    const labels = within(screen.getByRole("list", { name: "Modules" })).getAllByRole("listitem").map((li) => li.textContent?.replace(/Reorder.*arrow keys\./, ""));
    expect(labels[0]).toContain("B");
    expect(screen.getByText("A moved to position 2 of 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Move C up" }));
    expect(screen.getByText("C moved to position 2 of 3")).toBeInTheDocument();
  });
});

describe("misc", () => {
  it("blocked notice names the migration and has no save", () => {
    render(<BlockedFeatureNotice migrationId="20260101_fixture" />);
    expect(screen.getByText(/Not saved yet: needs database update/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });
  it("metric card shows Unknown distinct from zero", () => {
    const { rerender } = render(<MetricCard label="L" value={null} />);
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    rerender(<MetricCard label="L" value={0} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });
  it("scope label is unambiguous", () => {
    render(<MemoryRouter><ScopeLabel scope="rooftop" rooftopName="Fixture North" source="inherited" /></MemoryRouter>);
    expect(screen.getByText("Fixture North")).toBeInTheDocument();
    expect(screen.getByText("Inherited from group")).toBeInTheDocument();
  });
  it("exposes all 84 semantic icons", () => {
    expect(ADMIN_ICON_NAMES).toHaveLength(84);
  });
});
