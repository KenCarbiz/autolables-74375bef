import { useDealerSettings } from "@/contexts/DealerSettingsContext";

/**
 * useDealerSettings, or null outside DealerSettingsProvider. Administration
 * navigation chrome (Browse settings, store scope) also renders inside child
 * pages that are tested in isolation; the app itself always mounts the
 * provider. useDealerSettings calls useContext unconditionally before it
 * throws, so catching keeps the hook order stable.
 */
export function useOptionalDealerSettings(): ReturnType<typeof useDealerSettings> | null {
  try {
    return useDealerSettings();
  } catch {
    return null;
  }
}
