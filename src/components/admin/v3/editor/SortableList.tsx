import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AdminIcon, IconButton } from "./AdminIcon";

export interface SortableItem {
  id: string;
  label: string;
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Reorderable list. The handle takes ArrowUp and ArrowDown; the up and down buttons and mouse drag do the same. */
export function SortableList<T extends SortableItem>({
  items,
  onChange,
  renderItem,
  label,
  className,
  disabled = false,
}: {
  items: T[];
  onChange: (next: T[]) => void;
  renderItem?: (item: T) => ReactNode;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  const [announce, setAnnounce] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const refocus = useRef<{ id: string; kind: "handle" | "up" | "down" } | null>(null);
  const nodes = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = null;
    nodes.current.get(`${target.id}:${target.kind}`)?.focus();
  });

  const move = (index: number, to: number, kind: "handle" | "up" | "down") => {
    if (disabled || to < 0 || to >= items.length) return;
    const item = items[index];
    refocus.current = { id: item.id, kind: to === 0 && kind === "up" ? "down" : to === items.length - 1 && kind === "down" ? "up" : kind };
    onChange(moveItem(items, index, to));
    setAnnounce(`${item.label} moved to position ${to + 1} of ${items.length}`);
  };

  const ref = (key: string) => (el: HTMLElement | null) => { if (el) nodes.current.set(key, el); else nodes.current.delete(key); };

  return (
    <div className={className}>
      <ul aria-label={label} className="space-y-2">
        {items.map((item, i) => (
          <li
            key={item.id}
            draggable={!disabled && dragId === item.id}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => { if (dragId && !disabled) e.preventDefault(); }}
            onDrop={(e) => {
              e.preventDefault();
              const from = items.findIndex((x) => x.id === dragId);
              setDragId(null);
              if (!disabled && from >= 0 && from !== i) {
                onChange(moveItem(items, from, i));
                setAnnounce(`${items[from].label} moved to position ${i + 1} of ${items.length}`);
              }
            }}
            className={cn("flex items-center gap-2 rounded-lg border border-adm-divider bg-adm-surface px-2 py-2", dragId === item.id && "opacity-60")}
          >
            <button
              type="button"
              ref={ref(`${item.id}:handle`)}
              disabled={disabled}
              aria-label={`Reorder ${item.label}. Use the up and down arrow keys.`}
              onMouseDown={() => setDragId(item.id)}
              onMouseUp={() => setDragId(null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp") { e.preventDefault(); move(i, i - 1, "handle"); }
                if (e.key === "ArrowDown") { e.preventDefault(); move(i, i + 1, "handle"); }
              }}
              className="inline-flex items-center justify-center w-10 h-10 max-sm:w-11 max-sm:h-11 rounded-md text-adm-muted cursor-grab hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-adm-primary"
            >
              <AdminIcon name="drag" />
            </button>
            <div className="min-w-0 flex-1 text-[14px] leading-[20px] text-adm-ink break-words">{renderItem ? renderItem(item) : item.label}</div>
            <IconButton ref={ref(`${item.id}:up`)} name="arrow-up" label={`Move ${item.label} up`} disabled={disabled || i === 0} onClick={() => move(i, i - 1, "up")} />
            <IconButton ref={ref(`${item.id}:down`)} name="arrow-down" label={`Move ${item.label} down`} disabled={disabled || i === items.length - 1} onClick={() => move(i, i + 1, "down")} />
          </li>
        ))}
      </ul>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
    </div>
  );
}
