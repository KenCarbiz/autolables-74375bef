import { useLocation } from "react-router-dom";

export type WaveCVariant = "default" | "empty" | "invalid" | "readonly" | "error" | "blocked";
const VARIANTS: readonly WaveCVariant[] = ["default", "empty", "invalid", "readonly", "error", "blocked"];

/** The ?state= variant of a design fixture. Live pages always read "default". */
export function useWaveCVariant(active: boolean): WaveCVariant {
  const { search } = useLocation();
  if (!active) return "default";
  const raw = new URLSearchParams(search).get("state") as WaveCVariant | null;
  return raw && VARIANTS.includes(raw) ? raw : "default";
}
