import type { SupportedStorage } from "@supabase/supabase-js";
import { brokeredPreviewStorage } from "@/integrations/supabase/previewAuthStorage";

type AuthStorage = Pick<SupportedStorage, "getItem" | "setItem" | "removeItem">;

const settle = (operation: void | Promise<void>): void => {
  if (operation instanceof Promise) void operation.catch(() => undefined);
};

export const createResilientAuthStorage = (
  broker: AuthStorage | undefined,
  fallback: AuthStorage,
): AuthStorage => ({
  async getItem(key) {
    if (broker) {
      try {
        const value = await broker.getItem(key);
        if (value !== null) return value;
      } catch {
        // The editor broker is best-effort; the browser copy is authoritative
        // whenever the editor is unavailable.
      }
    }
    return fallback.getItem(key);
  },
  setItem(key, value) {
    fallback.setItem(key, value);
    if (broker && broker !== fallback) settle(broker.setItem(key, value));
  },
  removeItem(key) {
    fallback.removeItem(key);
    if (broker && broker !== fallback) settle(broker.removeItem(key));
  },
});

export const resilientAuthStorage = (): SupportedStorage | undefined => {
  if (typeof window === "undefined") return undefined;
  return createResilientAuthStorage(brokeredPreviewStorage(), window.localStorage);
};