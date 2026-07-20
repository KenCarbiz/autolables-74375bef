// Truthful "your session expired" detection. We can't tell an expired session
// from a first-time visitor at the gate (both have no user), so we remember
// whether a session was ever active THIS TAB. A gate that finds no user while
// the flag is set is a genuine lapse; an intentional sign-out clears the flag
// first, so logout never shows the expired banner.

const KEY = "al_had_session";

export const markSessionActive = (): void => {
  try { sessionStorage.setItem(KEY, "1"); } catch { /* best-effort */ }
};

// Called on an intentional sign-out so the next gate redirect reads as a normal
// login, not an expiry.
export const clearSessionActive = (): void => {
  try { sessionStorage.removeItem(KEY); } catch { /* best-effort */ }
};

// Reads AND clears the flag so the expired banner surfaces exactly once.
export const consumeSessionExpired = (): boolean => {
  try {
    if (sessionStorage.getItem(KEY) === "1") { sessionStorage.removeItem(KEY); return true; }
  } catch { /* best-effort */ }
  return false;
};
