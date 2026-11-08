import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useSearchParams } from "react-router-dom";
import { V3Header, V3Page } from "@/components/admin/v3/AdminV3";
import { AdminButton } from "@/components/admin/v2/primitives";
import {
  AdminIcon, ADMIN_ICON_NAMES, AdvancedDisclosure, BlockedFeatureNotice, ChipInput, ColorField, DataTable, DetailDrawer, DraftActionBar,
  EditorEmpty, EditorLayout, FieldGroup, FieldRow, INPUT_CLASS, LogoSlot, MetricCard, PreviewOnlyNotice, ReviewChangesDialog,
  LeaveGuardDialog, useIsNarrow, ScopeLabel, SelectField, useLeaveGuard, SectionCard, SortableList, StatusBadge, WeekScheduleEditor, type DaySchedule, type StatusState, type WeekSchedule, WEEK_DAYS,
  type DataColumn, type SortableItem,
} from "@/components/admin/v3/editor";
import { STATUS_META } from "@/components/admin/v3/editor/StatusBadge";

// Development gallery for the Admin 96 editor foundation. Every label below is an obviously fake fixture value.

interface Row { id: string; name: string; kind: string; status: StatusState; updated: string }
const KINDS = ["Sample alpha", "Sample beta", "Sample gamma"];
const ROWS: Row[] = Array.from({ length: 60 }, (_, i) => ({
  id: `row-${i + 1}`,
  name: `Fixture item ${String(i + 1).padStart(2, "0")}`,
  kind: KINDS[i % 3],
  status: (["enabled", "disabled", "stale", "failed"] as StatusState[])[i % 4],
  updated: `2000-01-${String((i % 28) + 1).padStart(2, "0")}`,
}));
const COLUMNS: DataColumn<Row>[] = [
  { id: "name", header: "Name", primary: true, cell: (r) => r.name },
  { id: "kind", header: "Type", cell: (r) => r.kind },
  { id: "status", header: "Status", cell: (r) => <StatusBadge state={r.status} /> },
  { id: "updated", header: "Updated", align: "right", cell: (r) => r.updated },
];

const OPEN: DaySchedule = { open: true, from: "09:00", to: "18:00" };
const OVERNIGHT: DaySchedule = { open: true, from: "20:00", to: "02:00" };
const INITIAL_WEEK = Object.fromEntries(WEEK_DAYS.map((d) => [d, d === "Sunday" ? { open: false, from: "10:00", to: "16:00" } : d === "Saturday" ? { open: true, from: "09:00", to: "09:00" } : d === "Friday" ? OVERNIGHT : d === "Thursday" ? { open: true, from: "09:00", to: "24:00" } : d === "Wednesday" ? { open: true, from: "00:00", to: "00:00", allDay: true } : OPEN])) as WeekSchedule;

const Block = ({ title, children }: { title: string; children: ReactNode }) => (
  <section aria-label={title} className="space-y-3">
    <h2 className="text-[13px] leading-[18px] font-semibold uppercase tracking-wide text-adm-muted">{title}</h2>
    {children}
  </section>
);

const GuardDemo = () => {
  const guard = useLeaveGuard(true);
  return (
    <>
      <p className="text-[14px] text-adm-muted">Guard is armed on this page (?guard=1). Follow the link, or press Back, to see the dialog.</p>
      <Link to="/admin" className="inline-flex items-center min-h-[44px] text-[14px] font-semibold text-adm-primary hover:underline">Go to Administration</Link>
      <LeaveGuardDialog open={guard.pending} onStay={guard.stay} onLeave={guard.leave} />
    </>
  );
};

export default function EditorGallery() {
  const [search, setSearch] = useSearchParams();
  const drawerOpen = search.get("drawer") === "1";
  const reviewOpen = search.get("review") === "1";
  const setFlag = (key: string, on: boolean) => {
    const next = new URLSearchParams(search);
    if (on) next.set(key, "1"); else next.delete(key);
    setSearch(next, { replace: true });
  };

  const [color, setColor] = useState("#2457D6");
  const [badColor, setBadColor] = useState("#24G7");
  const [lightLogo, setLightLogo] = useState<string | null>(null);
  useEffect(() => () => { if (lightLogo) URL.revokeObjectURL(lightLogo); }, [lightLogo]);
  const [items, setItems] = useState<SortableItem[]>([{ id: "a", label: "Fixture module A" }, { id: "b", label: "Fixture module B" }, { id: "c", label: "Fixture module C" }]);
  const [chips, setChips] = useState(["fixture-one", "fixture-two"]);
  const [week, setWeek] = useState<WeekSchedule>(INITIAL_WEEK);
  const [detail, setDetail] = useState<Row | null>(drawerOpen ? ROWS[2] : null);
  const narrow = useIsNarrow();
  const iconGrid = (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
                {ADMIN_ICON_NAMES.map((n) => (
                  <li key={n} className="flex flex-col items-center gap-1 rounded-lg border border-adm-divider bg-adm-surface px-2 py-3 text-[12px] text-adm-muted">
                    <AdminIcon name={n} size="card" className="text-adm-ink" />
                    <span className="break-all text-center">{n}</span>
                  </li>
                ))}
              </ul>
  );
  const stateList = useMemo(() => Object.keys(STATUS_META) as StatusState[], []);

  return (
    <V3Page>
      <V3Header
        crumbs={[{ label: "Administration", href: "/admin" }, { label: "Editor components" }]}
        title="Editor components"
        description="Development gallery. Every value is a fixture; nothing here is saved."
      />
      <div className="mt-6 space-y-10">
        <Block title="Layout, section cards and fields">
          <EditorLayout preview={<SectionCard title="Preview" icon="eye" description="Draft values"><PreviewOnlyNotice /></SectionCard>}>
            <SectionCard title="Fixture section" icon="building" description="Section cards carry a soft icon tile, a title and one line of help." actions={<AdminButton>Section action</AdminButton>}>
              <FieldGroup legend="Basic details" description="Field rows pair a visible label with help and an inline error.">
                <FieldRow label="Display name" help="Shown to shoppers." required>
                  {(p) => <input {...p} className={INPUT_CLASS} defaultValue="Fixture Motors" />}
                </FieldRow>
                <FieldRow label="Phone" error="Enter a 10 digit phone number." required>
                  {(p) => <input {...p} className={INPUT_CLASS} defaultValue="555-01" />}
                </FieldRow>
                <FieldRow label="Notes" optional help="Optional text.">
                  {(p) => <input {...p} className={INPUT_CLASS} disabled defaultValue="Read-only fixture" />}
                </FieldRow>
              </FieldGroup>
              <AdvancedDisclosure>
                <FieldRow label="Fixture advanced option">{(p) => <input {...p} className={INPUT_CLASS} />}</FieldRow>
              </AdvancedDisclosure>
            </SectionCard>
          </EditorLayout>
        </Block>

        <Block title="Scope labels">
          <div className="flex flex-col gap-2">
            <ScopeLabel scope="all_rooftops" source="inherited" />
            <ScopeLabel scope="rooftop" rooftopName="Fixture Rooftop North" source="custom" />
          </div>
        </Block>

        {search.get("guard") === "1" && <Block title="Leave guard"><GuardDemo /></Block>}

        <Block title="Status vocabulary">
          <div className="flex flex-wrap gap-2">{stateList.map((s) => <StatusBadge key={s} state={s} />)}</div>
        </Block>

        <Block title="Blocked and preview-only notices">
          <SectionCard title="Fixture feature" icon="database" description="Backing column is not deployed.">
            <BlockedFeatureNotice migrationId="00000000000000_fixture_example" feature="Fixture setting">
              <div className="mt-2 flex items-center gap-2">
                <input aria-label="Fixture blocked input" disabled className={INPUT_CLASS} defaultValue="Disabled" />
              </div>
            </BlockedFeatureNotice>
          </SectionCard>
        </Block>

        <Block title="Draft action bar states">
          <div className="space-y-3">
            <DraftActionBar className="static" state={{ kind: "unchanged" }} onDiscard={() => {}} onReview={() => {}} />
            <DraftActionBar className="static" state={{ kind: "dirty", count: 3 }} onDiscard={() => {}} onReview={() => setFlag("review", true)} />
            <DraftActionBar className="static" state={{ kind: "invalid", reason: "Primary color is not a valid HEX value." }} onDiscard={() => {}} onReview={() => {}} />
            <DraftActionBar className="static" state={{ kind: "reviewing" }} onDiscard={() => {}} onReview={() => {}} />
            <DraftActionBar className="static" state={{ kind: "saving" }} onDiscard={() => {}} onReview={() => {}} />
            <DraftActionBar className="static" state={{ kind: "saved" }} onDiscard={() => {}} onReview={() => {}} />
            <DraftActionBar className="static" state={{ kind: "failed", message: "The server did not respond" }} onDiscard={() => {}} onReview={() => {}} onRetry={() => {}} />
            <DraftActionBar className="static" state={{ kind: "conflict" }} onDiscard={() => {}} onReview={() => {}} onRefresh={() => {}} />
          </div>
        </Block>

        <Block title="Metrics">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Fixture count" value={42} unit="items" scope="All fixtures" source="Fixture source" refreshedAt="2000-01-01 09:00" icon="car" />
            <MetricCard label="Real zero" value={0} unit="items" scope="All fixtures" source="Fixture source" refreshedAt="2000-01-01 09:00" icon="checklist" />
            <MetricCard label="Could not read" value={null} scope="All fixtures" source="Fixture source" refreshedAt={null} icon="alert" unavailableReason="The source did not answer." />
            <MetricCard label="Text value" value="4 of 6" scope="Fixture rooftop" icon="check-square" />
          </div>
        </Block>

        <Block title="Inputs">
          <div className="grid gap-4 lg:grid-cols-2 items-start">
            <div className="space-y-4 min-w-0">
              <SectionCard title="Colors" icon="palette">
                <ColorField name="Fixture primary" role="Primary" value={color} onChange={setColor} />
                <ColorField name="Fixture invalid" role="Accent" value={badColor} onChange={setBadColor} />
                <ColorField name="Fixture pale" value="#F5F5A0" onChange={() => {}} />
              </SectionCard>
              <SectionCard title="Tags" icon="tag">
                <ChipInput label="Fixture tags" values={chips} onChange={setChips} />
              </SectionCard>
            </div>
            <div className="space-y-4 min-w-0">
              <SectionCard title="Logos" icon="image">
                <div className="grid gap-4 sm:grid-cols-2">
                  <LogoSlot label="Logo for light backgrounds" src={lightLogo} guidance="PNG or SVG, transparent, up to 2 MB." onSelectFile={(f) => setLightLogo(URL.createObjectURL(f))} onRemove={() => setLightLogo(null)} />
                  <LogoSlot label="Logo for dark backgrounds" surface="dark" uploading progress={45} error="Fixture error: file could not be read." onSelectFile={() => {}} />
                </div>
              </SectionCard>
              <SectionCard title="Sortable list" icon="list">
                <SortableList label="Fixture modules" items={items} onChange={setItems} />
              </SectionCard>
            </div>
          </div>
          <SectionCard title="Weekly hours" icon="clock" description="Saturday shows a zero-length range. Friday is overnight, Thursday closes at midnight, Wednesday is open 24 hours.">
            <WeekScheduleEditor
              value={week}
              onChange={setWeek}
              timezoneSlot={<FieldRow label="Time zone" className="max-w-md">{(p) => <SelectField {...p}><option>Fixture / Zone</option></SelectField>}</FieldRow>}
            />
          </SectionCard>
        </Block>

        <Block title="Table with 60 rows, plus empty, error and loading">
          <DataTable caption="Fixture items" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} searchText={(r) => `${r.name} ${r.kind}`} rowLabel={(r) => r.name} onOpenRow={(r) => { setDetail(r); setFlag("drawer", true); }} filters={<SelectField aria-label="Filter by type" wrapperClassName="w-auto"><option>All types</option></SelectField>} />
          <div className="grid gap-4 lg:grid-cols-3">
            <DataTable caption="Empty fixtures" columns={COLUMNS} rows={[]} rowKey={(r) => r.id} searchText={() => ""} emptyTitle="No fixtures yet" emptyDescription="Add the first fixture to see it here." />
            <DataTable caption="Failing fixtures" columns={COLUMNS} rows={undefined} error={{ message: "The fixture service did not answer.", onRetry: () => {} }} rowKey={(r) => r.id} />
            <DataTable caption="Loading fixtures" columns={COLUMNS} rows={undefined} loading rowKey={(r) => r.id} />
          </div>
        </Block>

        <Block title="Empty states and artwork">
          <div className="grid gap-4 sm:grid-cols-3">
            {(["activity", "documents", "no-preview"] as const).map((a) => (
              <div key={a} className="rounded-xl border border-adm-divider bg-adm-surface"><EditorEmpty artwork={a} title={`Empty ${a}`} description="Quiet, decorative artwork." /></div>
            ))}
          </div>
        </Block>

        <Block title={`Icon set (${ADMIN_ICON_NAMES.length})`}>
          {narrow ? <AdvancedDisclosure title="Show all icons">{iconGrid}</AdvancedDisclosure> : iconGrid}
        </Block>
      </div>

      <DetailDrawer open={drawerOpen && detail !== null} onClose={() => setFlag("drawer", false)} title={detail?.name ?? "Details"} description="Fixture detail drawer" footer={<><AdminButton onClick={() => setFlag("drawer", false)}>Close</AdminButton><AdminButton variant="primary">Fixture action</AdminButton></>}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
          <dt className="text-adm-muted">Type</dt><dd>{detail?.kind}</dd>
          <dt className="text-adm-muted">Updated</dt><dd>{detail?.updated}</dd>
          <dt className="text-adm-muted">Status</dt><dd>{detail && <StatusBadge state={detail.status} />}</dd>
        </dl>
        <hr className="border-adm-divider" />
        <p className="text-[14px] text-adm-muted">Fixture notes appear here. Long content scrolls inside the drawer body.</p>
      </DetailDrawer>

      <ReviewChangesDialog
        open={reviewOpen}
        scope="Fixture rooftop (store-specific)"
        timing="Takes effect on the next page load."
        changes={[
          { id: "name", label: "Display name", before: "Fixture Motors", after: "Fixture Motors East" },
          { id: "color", label: "Primary color", before: "#2457D6", after: "#1D46AE" },
          { id: "tagline", label: "Tagline", before: null, after: "Fixture tagline" },
        ]}
        impact={<p className="text-adm-muted">Impact slot: documents and customer pages that read these values.</p>}
        onCancel={() => setFlag("review", false)}
        onApply={() => setFlag("review", false)}
      />
    </V3Page>
  );
}
