import { describe, it, expect } from "vitest";
import { deviceCategory, browserName } from "./qrTracking";

// These pure UA parsers feed QR scan analytics. (The module imports the
// Supabase client transitively; the test stub lets it load.)

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1",
  androidPhone: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
  androidTablet: "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  desktopChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  desktopFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  safari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  opera: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 OPR/105.0.0.0",
};

describe("deviceCategory", () => {
  it("classifies phones as mobile", () => {
    expect(deviceCategory(UA.iphone)).toBe("mobile");
    expect(deviceCategory(UA.androidPhone)).toBe("mobile");
  });

  it("classifies tablets as tablet (iPad and non-mobile Android)", () => {
    expect(deviceCategory(UA.ipad)).toBe("tablet");
    expect(deviceCategory(UA.androidTablet)).toBe("tablet");
  });

  it("classifies desktops as desktop", () => {
    expect(deviceCategory(UA.desktopChrome)).toBe("desktop");
    expect(deviceCategory(UA.desktopFirefox)).toBe("desktop");
    expect(deviceCategory("")).toBe("desktop");
  });
});

describe("browserName", () => {
  it("identifies Edge and Opera before Chrome (their UAs also contain Chrome)", () => {
    expect(browserName(UA.edge)).toBe("Edge");
    expect(browserName(UA.opera)).toBe("Opera");
  });

  it("identifies Chrome, Firefox, and Safari", () => {
    expect(browserName(UA.desktopChrome)).toBe("Chrome");
    expect(browserName(UA.desktopFirefox)).toBe("Firefox");
    expect(browserName(UA.safari)).toBe("Safari");
  });

  it("falls back to Other for unknown agents", () => {
    expect(browserName("curl/8.4.0")).toBe("Other");
  });
});
