import "@testing-library/jest-dom";

// jsdom has no IntersectionObserver — stub it so scroll-spy effects mount.
if (typeof globalThis.IntersectionObserver === "undefined") {
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  Object.defineProperty(globalThis, "IntersectionObserver", { writable: true, value: IO });
}

// Some suites opt into @vitest-environment node (no window at all).
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}

// The MarketCheck master switch defaults to off. Suites written before it
// existed assert the database gates, so they run with the policy bypassed;
// callPolicy.test.ts covers the switch itself.
process.env.MARKETCHECK_MODE ??= "unrestricted";
