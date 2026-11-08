import type { ReactNode } from "react";
import { useIsNarrow } from "@/components/admin/v3/editor";

export interface StackColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** The row's name: the first column when none is marked. Shown as the card title on narrow screens. */
  primary?: boolean;
  className?: string;
}

/**
 * Small read tables: a real table from 768px up, stacked cards below, so no
 * name is clipped and nothing scrolls sideways on a phone.
 */
export function StackedRows<T>({ caption, columns, rows, rowKey }: { caption: string; columns: StackColumn<T>[]; rows: T[]; rowKey: (row: T) => string }) {
  const narrow = useIsNarrow();
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary);
  if (narrow) {
    return (
      <ul aria-label={caption} className="divide-y divide-adm-divider">
        {rows.map((row) => (
          <li key={rowKey(row)} className="px-4 py-3 space-y-1.5">
            <div className="text-[15px] leading-[22px] font-semibold text-adm-ink break-words">{primary.cell(row)}</div>
            <dl className="grid grid-cols-[minmax(84px,auto)_1fr] gap-x-4 gap-y-1 text-[14px] leading-[20px]">
              {rest.map((c) => (
                <div key={c.id} className="contents">
                  <dt className="text-adm-muted">{c.header}</dt>
                  <dd className="min-w-0 break-words">{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <table className="w-full border-collapse text-left text-[14px] leading-[20px] text-adm-ink">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.id} scope="col" className="bg-adm-workspace px-4 py-2.5 text-[13px] leading-[18px] font-semibold text-adm-muted border-b border-adm-divider">{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)} className="border-b border-adm-divider last:border-b-0">
            {columns.map((c) => (
              <td key={c.id} className={`px-4 py-3 align-top break-words ${c.className ?? ""}`}>{c.cell(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
