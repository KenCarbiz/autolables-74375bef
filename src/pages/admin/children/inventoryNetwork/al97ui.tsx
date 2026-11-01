import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ADMIN_SECTIONS, adminTabHref, firstVisibleTab, visibleSections } from "@/lib/admin/sections";
import { useAdminVisibility } from "@/components/admin/v2/useAdminVisibility";
import { useViewFixture } from "@/lib/admin/dataSource";
import type { Chip, InventoryNetworkFixture } from "./overviewModel";
import "./al97.css";

// Shared building blocks for the AL97 inventory network screens. The class
// names mirror the handoff scaffold and are scoped under .invnet-ov in al97.css.

export interface ScopePicker { groups: Array<{ id: string; name: string }>; groupId: string; groupName: string; onChange: (id: string) => void }

export function Al97Frame({ crumb, title, subtitle, scope, storeName, main, children }: {
  crumb: string; title: string; subtitle: ReactNode; scope?: ScopePicker; storeName?: string | null; main?: ReactNode; children?: ReactNode;
}) {
  const { ctx } = useAdminVisibility();
  const visible = visibleSections(ctx);
  const sections = visible.length ? visible : [...ADMIN_SECTIONS];
  return (
    <div className="invnet-ov-page">
      <div className="invnet-ov">
        <nav aria-label="Breadcrumb" className="breadcrumbs">
          <Link to="/admin">Administration</Link> / <Link to={adminTabHref("inventory-feed")} className="crumb">Integrations</Link> / <span aria-current="page">{crumb}</span>
        </nav>
        <div className="page-head">
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {scope && (
            <div className="scope-picker">
              <small>ACCOUNT / STORE</small>
              <b>{scope.groupName}{storeName ? ` / ${storeName}` : ""}</b> ▾
              <select id="inv-group" aria-label="Dealer group" value={scope.groupId} onChange={(e) => scope.onChange(e.target.value)}>
                {scope.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          )}
        </div>
        <nav aria-label="Administration sections" className="tabs">
          {sections.map((s) => {
            const target = firstVisibleTab(s, ctx) ?? s.tabs[0];
            return <Link key={s.id} to={adminTabHref(target.id)} aria-current={s.id === "integrations" ? "page" : undefined}>{s.label}</Link>;
          })}
        </nav>
        {main}
      </div>
      {children}
    </div>
  );
}

const PATHS = {
  warning: "M12 2L2 21h20zM12 8v6m0 3v1",
  store: "M3 10v11h18V10M2 10l2-7h16l2 7M8 21v-7h8v7M2 10c2 3 4 3 5 0 2 3 4 3 5 0 2 3 4 3 5 0 1 3 3 3 5 0",
  file: "M4 2h10l6 6v14H4zM14 2v6h6M7 12h10m-10 4h10",
  car: "M3 11l3-7h12l3 7M2 11h20v8H2zM5 19v3m14-3v3M5 15h3m8 0h3",
  history: "M3 10a9 9 0 1 1 1 8M3 3v7h7M12 7v5l4 2",
  shield: "M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6zM8 12l3 3 5-6",
} as const;

export type GlyphName = keyof typeof PATHS | "clock" | "info" | "plus" | "retry" | "settings" | "database";

export const Glyph = ({ name, className = "icon" }: { name: GlyphName; className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="#47617C" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name in PATHS ? <path d={PATHS[name as keyof typeof PATHS]} /> : <GlyphBody name={name} />}
  </svg>
);

function GlyphBody({ name }: { name: GlyphName }) {
  switch (name) {
    case "clock": return <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 3" /></>;
    case "info": return <><circle cx="12" cy="12" r="10" /><path d="M12 11v7m0-12v1" /></>;
    case "plus": return <path d="M12 2v20M2 12h20" />;
    case "retry": return <path d="M3 10a9 9 0 1 1 1 8M3 2v8h8" />;
    case "settings": return <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>;
    case "database": return <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 4 18 4 18 0V5M3 12c0 4 18 4 18 0" /></>;
    default: return null;
  }
}

export const ChipView = ({ chip }: { chip: Chip }) => <span className={`chip ${chip.tone === "neutral" ? "" : chip.tone}`}>{chip.label}</span>;

export const Banner = ({ tone, icon, title, detail }: { tone: "amber" | "blue" | "red"; icon: GlyphName; title: string; detail: string }) => (
  <div role="status" className={`banner ${tone}`}>
    <Glyph name={icon} />
    <div><strong>{title}</strong><p>{detail}</p></div>
  </div>
);

export interface MetricItem { label: string; value: string; sub: string; icon: GlyphName; known?: boolean }
export const Metrics = ({ items, label }: { items: MetricItem[]; label: string }) => (
  <ul className="stats" aria-label={label} style={{ listStyle: "none", margin: 0, padding: 0 }}>
    {items.map((s) => (
      <li key={s.label} className="metric">
        <Glyph name={s.icon} />
        <p>{s.label}</p>
        <b className={s.known === false ? "unknown" : undefined}>{s.value}</b>
        <small>{s.sub}</small>
      </li>
    ))}
  </ul>
);

export const Card = ({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) => (
  <section className="card" aria-labelledby={id}>
    <div className="card-head"><div><h2 id={id}>{title}</h2>{description && <p>{description}</p>}</div></div>
    {children}
  </section>
);

export const KeyVals = ({ rows }: { rows: Array<[string, ReactNode]> }) => (
  <dl className="keyvals">
    {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
  </dl>
);

export interface FlowItem { no: number; title: string; chip: Chip; note: string }
export const Flow = ({ steps }: { steps: FlowItem[] }) => (
  <ol className="flow" style={{ listStyle: "none", margin: 0, padding: 0 }}>
    {steps.map((f) => (
      <li key={f.no} className="step">
        <span className="step-no">{f.no}</span>
        <strong>{f.title}</strong>
        <ChipView chip={f.chip} />
        <small>{f.note}</small>
      </li>
    ))}
  </ol>
);

export const Savebar = ({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) => (
  <div className="savebar">
    <Glyph name="shield" />
    <div><strong>{title}</strong><p>{detail}</p></div>
    {action && <div className="push">{action}</div>}
  </div>
);

export function useNetFixture(): InventoryNetworkFixture | null {
  return useViewFixture<InventoryNetworkFixture>("inventory-network");
}

/** Development fixtures label their own synthetic values; live data never reads this. */
export function useFixtureCopy(): (key: string, live: string) => string {
  const fx = useNetFixture();
  return (key, live) => fx?.copy?.[key] ?? live;
}
