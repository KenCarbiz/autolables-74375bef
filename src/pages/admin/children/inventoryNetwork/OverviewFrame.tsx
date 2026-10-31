import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ADMIN_SECTIONS, adminTabHref, firstVisibleTab, visibleSections } from "@/lib/admin/sections";
import { useAdminVisibility } from "@/components/admin/v2/useAdminVisibility";
import "./overview.css";

export interface ScopePicker { groups: Array<{ id: string; name: string }>; groupId: string; groupName: string; storeName: string | null; onChange: (id: string) => void }

export default function OverviewFrame({ scope, main, children }: { scope?: ScopePicker; main?: ReactNode; children?: ReactNode }) {
  const { ctx } = useAdminVisibility();
  const visible = visibleSections(ctx);
  const sections = visible.length ? visible : [...ADMIN_SECTIONS];
  return (
    <div className="invnet-ov-page">
      <div className="invnet-ov">
        <nav aria-label="Breadcrumb" className="breadcrumbs">
          <Link to="/admin">Administration</Link> / <Link to={adminTabHref("inventory-feed")} className="crumb">Integrations</Link> / <span aria-current="page">Inventory network</span>
        </nav>
        <div className="page-head">
          <div>
            <h1>Inventory network</h1>
            <p>Know what arrived, what applied, and what shoppers can see.</p>
          </div>
          {scope && (
            <div className="scope-picker">
              <small>ACCOUNT / STORE</small>
              <b>{scope.groupName}{scope.storeName ? ` / ${scope.storeName}` : ""}</b> ▾
              <select id="inv-group" aria-label="Dealer group" value={scope.groupId} onChange={(e) => scope.onChange(e.target.value)}>
                {scope.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          )}
        </div>
        <nav aria-label="Administration sections" className="tabs">
          {sections.map((s) => {
            const target = firstVisibleTab(s, ctx) ?? s.tabs[0];
            const active = s.id === "integrations";
            return <Link key={s.id} to={adminTabHref(target.id)} aria-current={active ? "page" : undefined}>{s.label}</Link>;
          })}
        </nav>
        {main}
      </div>
      {children}
    </div>
  );
}
