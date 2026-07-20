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
