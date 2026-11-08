import { useEffect, useState } from "react";

const NARROW = "(max-width: 767px)";
export function useIsNarrow() {
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(NARROW).matches;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return narrow;
}
