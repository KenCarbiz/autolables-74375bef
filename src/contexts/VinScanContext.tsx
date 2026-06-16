import { createContext, useContext } from "react";

export interface VinScanApi {
  /**
   * Device-aware VIN scan entry point. On a touch device with a camera it
   * opens the live lot scanner; on desktop it shows the QR hand-off so the
   * user can continue on their phone next to the car.
   */
  openScan: () => void;
}

export const VinScanContext = createContext<VinScanApi | null>(null);

// Hook for any Scan VIN button. Falls back to plain navigation if used
// outside the provider (shouldn't happen for gated pages inside AppShell).
export const useVinScan = (): VinScanApi =>
  useContext(VinScanContext) ?? { openScan: () => { window.location.href = "/scan"; } };

// Shared decision used by the provider (and safe to reuse elsewhere).
export const prefersLiveScanner = (): boolean => {
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const hasCamera = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  return touch && hasCamera;
};
