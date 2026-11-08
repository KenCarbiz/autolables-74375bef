import { useLocation } from "react-router-dom";

/** True for a design fixture opened with ?state=dirty, which depicts a change waiting for review. */
export function useFixtureDirty(active: boolean): boolean {
  const { search } = useLocation();
  return active && new URLSearchParams(search).get("state") === "dirty";
}
