import { useLocation } from "react-router-dom";

export type WaveEVariant = "default" | "empty" | "error" | "readonly" | "stale" | "trial" | "suspended" | "unlimited";
const VARIANTS: readonly WaveEVariant[] = ["default", "empty", "error", "readonly", "stale", "trial", "suspended", "unlimited"];

/** The ?state= variant of a design fixture. Live pages always read "default". */
export function useWaveEVariant(active: boolean): WaveEVariant {
  const { search } = useLocation();
  if (!active) return "default";
  const raw = new URLSearchParams(search).get("state") as WaveEVariant | null;
  return raw && VARIANTS.includes(raw) ? raw : "default";
}
