import { useEffect, useRef } from "react";
import { toast } from "sonner";

// Debounced instant-save for admin settings panels: any change to `value`
// after mount is persisted automatically and confirmed with a "Saved" toast
// (deduped per toastId). `ready:false` keeps re-baselining so async hydration
// never writes back what was just loaded; `enabled:false` holds a dirty draft
// (e.g. while it fails validation) until it becomes saveable again.
export const useInstantSave = <T,>(
  value: T,
  save: (value: T) => Promise<boolean>,
  opts?: { enabled?: boolean; ready?: boolean; delay?: number; toastId?: string },
) => {
  const saveRef = useRef(save);
  saveRef.current = save;
  const prevValueRef = useRef(value);
  const dirtyRef = useRef(false);
  const wasReadyRef = useRef(opts?.ready !== false);
  const enabled = opts?.enabled !== false;
  const ready = opts?.ready !== false;
  const delay = opts?.delay ?? 800;
  const toastId = opts?.toastId ?? "settings-instant-save";

  useEffect(() => {
    if (!ready || !wasReadyRef.current) {
      prevValueRef.current = value;
      dirtyRef.current = false;
      wasReadyRef.current = ready;
      return;
    }
    if (prevValueRef.current !== value) {
      prevValueRef.current = value;
      dirtyRef.current = true;
    }
    if (!dirtyRef.current || !enabled) return;
    const t = setTimeout(async () => {
      const ok = await saveRef.current(value);
      if (ok) {
        dirtyRef.current = false;
        toast.success("Saved", { id: toastId });
      }
    }, delay);
    return () => clearTimeout(t);
  }, [value, ready, enabled, delay, toastId]);
};
