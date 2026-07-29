import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A shopper opened /v3/<vin>, tapped Documents, and got "Something went wrong".
// The one button on that screen sent them to /dashboard, which EntitlementGate
// bounces to /login -- so a customer following an emailed link ended up at a
// dealer sign-in form with their vehicle gone.
//
// Two independent faults. These pin both, because each is invisible in review:
// the hook order only diverges on a cold cache, and the recovery button only
// misfires once something else has already crashed.

const ROOT = join(__dirname, "..", "..", "..");
const docs = readFileSync(join(ROOT, "src/pages/VehiclePassportDocuments.tsx"), "utf8");
const boundary = readFileSync(join(ROOT, "src/components/layout/ErrorBoundary.tsx"), "utf8");

// Everything below the first `if (loading) return` runs on the loaded render
// only. A hook there makes render 2 call more hooks than render 1 (React #310),
// which is why a warm React Query cache hid it: with the listing already
// cached, `loading` is false on the very first render and the counts agree.
const afterGuard = (src: string) => {
  const at = src.indexOf("if (loading) return <DocSkeleton />;");
  expect(at).toBeGreaterThan(-1);
  return src.slice(at);
};

describe("the Documents page calls the same hooks on a cold cache as on a warm one", () => {
  it("calls no hook after the loading guard", () => {
    const tail = afterGuard(docs);
    // Top-level only: hooks inside a nested component defined further down are
    // that component's own, and are fine.
    const offenders = tail
      .split("\n")
      .filter((l) => /^ {0,4}(const|let|var)?\s*[^/]*\buse[A-Z]\w*\s*\(/.test(l))
      .filter((l) => !l.trim().startsWith("//"));
    expect(offenders).toEqual([]);
  });

  it("still filters the request chips against what is already on the page", () => {
    // The fix removed a useMemo; it must not have removed the behaviour.
    expect(docs).toMatch(/REQUEST_OPTIONS\.filter\(\(o\) => !o\.satisfiedBy\?\.some\(\(k\) => present\.has\(k\)\)\)/);
  });
});

describe("a crash on a customer page never becomes a dealer login", () => {
  it("recovers by reloading rather than leaving the page", () => {
    expect(boundary).toMatch(/window\.location\.reload\(\)/);
  });

  it("offers /dashboard only when the visitor is not on a customer surface", () => {
    const dash = boundary.indexOf('window.location.href = "/dashboard"');
    expect(dash).toBeGreaterThan(-1);
    // The dashboard escape hatch is inside a `!customer` branch.
    expect(boundary.slice(0, dash)).toMatch(/\{!customer && \(/);
  });

  it("treats every anonymous passport route as a customer surface", () => {
    for (const p of ["/v/", "/v3/", "/v-classic/", "/vehicle/", "/sign/", "/deal/"]) {
      expect(boundary).toContain(`"${p}"`);
    }
  });

  it("does not show a shopper a raw stack message", () => {
    expect(boundary).toMatch(/this\.state\.error && !customer/);
  });
});
