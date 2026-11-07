import { useCallback, useMemo, useState } from "react";

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set && b instanceof Set) || a.size !== b.size) return false;
    const rest = Array.from(b);
    return Array.from(a).every((x) => {
      const i = rest.findIndex((y) => deepEqual(x, y));
      if (i < 0) return false;
      rest.splice(i, 1);
      return true;
    });
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map && b instanceof Map) || a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !deepEqual(v, b.get(k))) return false;
    return true;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) if (!deepEqual(ao[k], bo[k])) return false;
  return true;
}

export type DraftErrors<T> = Partial<Record<keyof T & string, string>>;

export interface EditorDraftChange<T> {
  key: keyof T & string;
  before: T[keyof T];
  after: T[keyof T];
}

export interface UseEditorDraftOptions<T extends Record<string, unknown>> {
  /** Tenant or store identity. A different scope never inherits the previous scope's draft. */
  scopeKey: string;
  /** Bump when the baseline is reloaded from the server; the draft restarts from it. */
  generation?: number;
  /** The persisted values. Undefined while loading. */
  baseline: T | undefined;
  validate?: (draft: T) => DraftErrors<T>;
}

/**
 * Draft state for a settings editor. The hook holds values only: it has no save, no autosave and never
 * writes on load. The caller persists, then calls markSaved once the server has confirmed.
 */
export function useEditorDraft<T extends Record<string, unknown>>({ scopeKey, generation = 0, baseline, validate }: UseEditorDraftOptions<T>) {
  const identity = `${scopeKey}#${generation}`;
  const [edit, setEdit] = useState<{ identity: string; draft: T } | null>(null);
  const [saved, setSaved] = useState<{ identity: string; from: T | undefined; values: T } | null>(null);

  const savedValues = saved && saved.identity === identity && deepEqual(saved.from, baseline) ? saved.values : undefined;
  const base = savedValues ?? baseline;
  const draft = edit && edit.identity === identity ? edit.draft : base;

  const changes = useMemo<EditorDraftChange<T>[]>(() => {
    if (!base || !draft) return [];
    const keys = new Set([...Object.keys(base), ...Object.keys(draft)]) as Set<keyof T & string>;
    const out: EditorDraftChange<T>[] = [];
    for (const key of keys) if (!deepEqual(base[key], draft[key])) out.push({ key, before: base[key], after: draft[key] });
    return out;
  }, [base, draft]);

  const errors = useMemo<DraftErrors<T>>(() => (draft && validate ? validate(draft) : {}), [draft, validate]);

  const patch = useCallback(
    (next: Partial<T>) => {
      if (!base) return;
      setEdit((cur) => {
        const current = cur && cur.identity === identity ? cur.draft : base;
        return { identity, draft: { ...current, ...next } };
      });
    },
    [base, identity],
  );

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => patch({ [key]: value } as unknown as Partial<T>), [patch]);

  const reset = useCallback(() => setEdit(null), []);

  const markSaved = useCallback(
    (confirmed?: T) => {
      const values = confirmed ?? draft;
      if (!values) return;
      setSaved({ identity, from: baseline, values });
      setEdit(null);
    },
    [draft, identity, baseline],
  );

  return {
    draft,
    baseline: base,
    ready: base !== undefined,
    dirty: changes.length > 0,
    changes,
    changedKeys: changes.map((c) => c.key),
    errors,
    valid: Object.keys(errors).length === 0,
    set,
    patch,
    reset,
    markSaved,
  };
}
