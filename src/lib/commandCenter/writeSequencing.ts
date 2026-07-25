// ──────────────────────────────────────────────────────────────────────
// The two pieces of sequencing every command surface depends on, extracted so
// they can be exercised without mounting a screen: both used to live inside
// useCommandCenter with no test at all.
// ──────────────────────────────────────────────────────────────────────

/**
 * A load that outlived its component, or that a newer load has already
 * overtaken, must not commit — the older response used to land last and paint
 * the previous vehicle's package over the one on screen.
 */
export interface LoadSequencer {
  begin(): number;
  accepts(request: number): boolean;
  mount(): void;
  unmount(): void;
}

export function createLoadSequencer(): LoadSequencer {
  let latest = 0;
  let mounted = true;
  return {
    begin: () => ++latest,
    accepts: (request: number) => mounted && request === latest,
    mount: () => { mounted = true; },
    unmount: () => { mounted = false; },
  };
}

export interface WriteResult { ok: boolean; error?: string }

/**
 * document_lifecycle_events is append-only, so an unchanged value must not be
 * rewritten: a note textarea blurs on every tab-out and a checkbox can be
 * clicked back and forth, and each identical row buries the events that matter
 * (authorization, packet release) deeper in the log.
 *
 * The skip is never decided against a snapshot a write already in flight is
 * about to invalidate:
 *  - a second submit of the SAME value awaits the in-flight write and reports
 *    its real outcome, so a failed save is never reported as saved;
 *  - a submit of a DIFFERENT value always writes;
 *  - the only short-circuit is a value the caller reports as already persisted.
 *
 * The caller's `persisted` snapshot refreshes on render, so there is a very
 * short window after a write settles in which it still reads the old value.
 * That window is deliberately left alone: caching "what this queue last wrote"
 * to close it would also skip a genuine re-entry of a value some OTHER user had
 * since changed, silently losing the manager's note. A redundant append-only row
 * is the safe side of that trade; a dropped write is not.
 */
export interface LatestWriteQueue {
  submit(args: {
    key: string;
    value: string;
    /** The value the last load reported, when the caller has one. */
    persisted?: string;
    run: () => Promise<WriteResult>;
    /** Runs only after a successful write, before the result is returned. */
    afterWrite?: () => Promise<void>;
  }): Promise<WriteResult>;
}

export function createLatestWriteQueue(): LatestWriteQueue {
  const inFlight = new Map<string, { value: string; promise: Promise<WriteResult> }>();

  const submit: LatestWriteQueue["submit"] = async ({ key, value, persisted, run, afterWrite }) => {
    const pending = inFlight.get(key);
    if (pending) {
      if (pending.value === value) return pending.promise;
    } else if (persisted !== undefined && persisted === value) {
      return { ok: true };
    }

    const promise = (async (): Promise<WriteResult> => {
      const res = await run();
      if (res.ok && afterWrite) await afterWrite();
      return res;
    })();
    inFlight.set(key, { value, promise });
    try {
      return await promise;
    } finally {
      if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
    }
  };

  return { submit };
}
