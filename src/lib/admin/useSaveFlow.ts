import { useCallback, useRef, useState } from "react";

export type SavePhase = "idle" | "reviewing" | "saving" | "saved" | "failed" | "conflict";

export class SaveConflictError extends Error {
  constructor(message = "These settings changed since you opened them.") {
    super(message);
    this.name = "SaveConflictError";
  }
}

/**
 * Tracks the review and save lifecycle. "saved" is set only after the persist callback resolves, so the UI
 * never claims success before the server confirmed. A rejection keeps the draft with the caller.
 */
export function useSaveFlow() {
  const [phase, setPhase] = useState<SavePhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  const openReview = useCallback(() => setPhase("reviewing"), []);
  const closeReview = useCallback(() => setPhase((p) => (p === "reviewing" ? "idle" : p)), []);
  const dismiss = useCallback(() => {
    setPhase("idle");
    setMessage(null);
  }, []);

  const run = useCallback(async (persist: () => Promise<void>): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPhase("saving");
    setMessage(null);
    try {
      await persist();
      setPhase("saved");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The save did not complete.");
      setPhase(error instanceof SaveConflictError ? "conflict" : "failed");
      return false;
    } finally {
      inFlight.current = false;
    }
  }, []);

  return { phase, message, openReview, closeReview, dismiss, run };
}
