import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { LeaveGuardDialog, useLeaveGuard } from "./LeaveGuard";
import { leaveGuardEntryCount } from "@/lib/admin/leaveGuardRegistry";

const Editor = ({ dirty }: { dirty: boolean }) => {
  const guard = useLeaveGuard(dirty);
  return <LeaveGuardDialog open={guard.pending} onStay={guard.stay} onLeave={guard.leave} />;
};
const Loc = () => <span data-testid="loc">{useLocation().pathname + useLocation().search + useLocation().hash}</span>;
const Nav = () => {
  const go = useNavigate();
  return (
    <>
      <button onClick={() => go("/a")}>to a</button>
      <button onClick={() => go("/b")}>to b</button>
      <button onClick={() => go("/c")}>to c</button>
    </>
  );
};

const Harness = ({ editorPath }: { editorPath: string }) => {
  const [dirty, setDirty] = useState(false);
  return (
    <BrowserRouter>
      <Nav />
      <Loc />
      <button onClick={() => setDirty((d) => !d)}>toggle dirty</button>
      <a href="#frag">fragment</a>
      <Routes>
        <Route path={editorPath} element={<Editor dirty={dirty} />} />
        <Route path="*" element={null} />
      </Routes>
    </BrowserRouter>
  );
};

const loc = () => screen.getByTestId("loc").textContent;
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 60)));
const pressBack = () => act(() => { window.history.back(); });
const pressForward = () => act(() => { window.history.forward(); });

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("leave guard history handling", () => {
  it("Back that leaves the editor route shows the dialog and keeps the location", async () => {
    render(<Harness editorPath="/b" />);
    fireEvent.click(screen.getByText("to a"));
    fireEvent.click(screen.getByText("to b"));
    expect(loc()).toBe("/b");
    fireEvent.click(screen.getByText("toggle dirty"));
    pressBack();
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    await settle();
    expect(loc()).toBe("/b");
    expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await settle();
    expect(loc()).toBe("/b");
    pressBack();
    fireEvent.click(await screen.findByRole("button", { name: "Discard and leave" }));
    await waitFor(() => expect(loc()).toBe("/a"));
  });

  it("Forward is guarded the same way", async () => {
    render(<Harness editorPath="/a" />);
    fireEvent.click(screen.getByText("to a"));
    fireEvent.click(screen.getByText("to b"));
    pressBack();
    await waitFor(() => expect(loc()).toBe("/a"));
    fireEvent.click(screen.getByText("toggle dirty"));
    pressForward();
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    await settle();
    expect(loc()).toBe("/a");
    fireEvent.click(screen.getByRole("button", { name: "Discard and leave" }));
    await waitFor(() => expect(loc()).toBe("/b"));
  });

  it("does nothing special when the draft is clean", async () => {
    render(<Harness editorPath="/b" />);
    fireEvent.click(screen.getByText("to a"));
    fireEvent.click(screen.getByText("to b"));
    pressBack();
    await waitFor(() => expect(loc()).toBe("/a"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("ignores hash-only navigation", async () => {
    render(<Harness editorPath="*" />);
    fireEvent.click(screen.getByText("to a"));
    fireEvent.click(screen.getByText("toggle dirty"));
    act(() => { window.location.hash = "#x"; });
    await settle();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("removes its registry entry on unmount", () => {
    const { unmount } = render(<Harness editorPath="*" />);
    expect(leaveGuardEntryCount()).toBe(1);
    unmount();
    expect(leaveGuardEntryCount()).toBe(0);
  });
});

describe("rapid double Back", () => {
  it("ends on the origin entry with the dialog shown", async () => {
    render(<Harness editorPath="/c" />);
    fireEvent.click(screen.getByText("to a"));
    fireEvent.click(screen.getByText("to b"));
    fireEvent.click(screen.getByText("to c"));
    fireEvent.click(screen.getByText("toggle dirty"));
    const origin = window.history.state?.idx;
    act(() => { window.history.back(); window.history.back(); });
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    await act(() => new Promise<void>((r) => setTimeout(r, 700)));
    expect(window.location.pathname).toBe("/c");
    expect(window.history.state?.idx).toBe(origin);
  });
});
