import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useAudit } from "@/contexts/AuditContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { usePrepSignOff, type PrepSignOff as PrepSignOffRow, type InstallPhoto, type InstalledAccessory } from "@/hooks/usePrepSignOff";
import { useGetReady, type GetReadyRecord } from "@/hooks/useGetReady";
import { useEntitlements } from "@/hooks/useEntitlements";
import { usePrepDueDates, type PrepDueView } from "@/hooks/useApprovedFields";
import { NO_DUE_DATE_LABEL, canSetPrepDue } from "@/lib/approvedFields/prepDue";
import { derivePrepNextAction } from "@/lib/approvedFields/prepNextAction";
import { PrepDueEditor } from "@/components/admin/PrepDueEditor";
import { useEmailDistribution } from "@/hooks/useEmailDistribution";
import { AccessoryInstallPanel } from "@/components/admin/AccessoryInstallPanel";
import { EmailDistributionPanel } from "@/components/admin/EmailDistributionPanel";
import { GetReadySheet } from "@/components/admin/GetReadySheet";
import { StartGetReadyModal } from "@/components/admin/StartGetReadyModal";
import SignaturePad from "@/components/addendum/SignaturePad";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ShieldCheck, Camera, Check, X, AlertTriangle, Clock, CheckCircle2, ClipboardCheck, FileText, Image as ImageIcon, Upload, FileSignature, ArrowRight, Car, Wrench, ChevronLeft, Plus } from "lucide-react";
import EmptyState from "@/components/ui/empty-state";
import { LocalTabs, MetricStrip, PageBody, PageHeader, Button as ProductButton, Panel as ProductPanel, WorkTable, Th, Td, StatusText, type LocalTab } from "@/components/product";
import { uploadPhoto } from "@/lib/storage";

const taskLabel = (accs: Array<{ product_name: string }>) =>
  accs.length === 0 ? "No work listed" : accs.length === 1 ? accs[0].product_name : `${accs[0].product_name} +${accs.length - 1}`;

const vendorLabel = (accs: Array<{ installed_by?: string }>) => {
  const names = Array.from(new Set(accs.map((a) => (a.installed_by || "").trim()).filter(Boolean)));
  return names.length === 0 ? "Unknown" : names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
};

const DueCell = ({ view }: { view: PrepDueView | null }) => {
  if (!view || view.source === "none") return <span className="text-adm-muted">{NO_DUE_DATE_LABEL}</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={view.state === "overdue" ? "font-semibold text-adm-danger" : "text-adm-ink"} title={view.label}>{view.label}</span>
      {view.state === "overdue" && <StatusText tone="danger">Overdue</StatusText>}
    </span>
  );
};

const NextActionCell = ({ row, dueAt }: { row: PrepSignOffRow; dueAt: string | null }) => {
  const action = derivePrepNextAction(row, { dueAt });
  return (
    <p className={`truncate ${action.overdue ? "font-semibold text-adm-danger" : action.key === "none" ? "text-adm-muted" : "text-adm-ink"}`} title={action.label}>
      {action.label}
    </p>
  );
};

const PrepSignOff = () => {
  const { user, isAdmin } = useAuth();
  const { member } = useEntitlements();
  const { settings: dealerSettings } = useDealerSettings();
  const { currentStore, tenant } = useTenant();
  const { log } = useAudit();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = (searchParams.get("view") || "list") as "list" | "new" | "detail" | "installs";
  const id = searchParams.get("id") || "";
  // Single-store dealers (and Autocurb-synced tenants without a configured
  // store row) have no currentStore — fall back to the tenant id, which is the
  // store key the Get-Ready / Service surfaces already use.
  const storeId = currentStore?.id || tenant?.id || "";
  const { signOffs, pending, ready, loading: signOffsLoading, load: reloadSignOffs, createSignOff, signOff, reject, override, isListingAllowed } = usePrepSignOff(storeId);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const { records: getReadyRecords } = useGetReady(storeId);
  const prepDue = usePrepDueDates(signOffs, dealerSettings.dealer_timezone);
  const canEditDue = canSetPrepDue(member?.role ?? "", isAdmin);

  const filterParam = searchParams.get("filter");
  const filter: "all" | "pending" | "signed" | "rejected" =
    filterParam === "pending" || filterParam === "signed" || filterParam === "rejected" ? filterParam : "all";
  const [newForm, setNewForm] = useState({
    vin: "",
    ymm: "",
    stock_number: "",
    get_ready_record_id: "",
    inspection_form_type: "None",
    inspection_passed: false,
    foreman_name: user?.email?.split("@")[0] ?? "",
    notes: "",
    accessories: [] as InstalledAccessory[],
    install_photos: [] as InstallPhoto[],
  });
  const [foremanSig, setForemanSig] = useState<{ data: string; type: string } | null>(null);
  const [ackCheckbox, setAckCheckbox] = useState(false);
  const [overridePanel, setOverridePanel] = useState(false);
  const [overrideForm, setOverrideForm] = useState({ overriderName: "", reason: "" });
  const [dialogRef, setDialogRef] = useState<HTMLDialogElement | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<InstallPhoto | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectCategory, setRejectCategory] = useState<string>("paint");
  const [rejectNotes, setRejectNotes] = useState("");
  const [rejecting, setRejecting] = useState(false);

  useEffect(() => {
    if (!user) navigate("/login");
  }, [user, navigate]);

  // Hoisted above the view branches so the hook order never changes when the
  // ?view= param flips between list/new/detail/installs.
  const filtered = useMemo(() => {
    if (filter === "all") return signOffs;
    if (filter === "pending") return signOffs.filter(s => s.status === "pending");
    if (filter === "signed") return signOffs.filter(s => s.status === "signed");
    if (filter === "rejected") return signOffs.filter(s => s.status === "rejected");
    return signOffs;
  }, [signOffs, filter]);

  const signedToday = useMemo(() =>
    signOffs.filter(s => s.signed_at && new Date(s.signed_at).toDateString() === new Date().toDateString()).length,
    [signOffs]
  );

  const rejectedThisWeek = useMemo(() => {
    const now = Date.now();
    return signOffs.filter(s => s.status === "rejected" && (now - new Date(s.updated_at).getTime()) < 7 * 24 * 60 * 60 * 1000).length;
  }, [signOffs]);

  // QR deep links land on /prep?vin=<VIN> or /prep/<VIN>; both resolve to the
  // mobile work-event flow. The desktop page below stays for manager use.
  const vinDeepLink = (searchParams.get("vin") || "").trim();
  if (vinDeepLink) return <Navigate to={`/prep/${vinDeepLink.toUpperCase()}`} replace />;

  if (!storeId)
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="rounded-2xl bg-adm-surface border border-adm-border p-8 shadow-premium">
          <p className="text-adm-ink">Sign in to a dealership to continue.</p>
        </div>
      </div>
    );

  const viewTabs = (
    <LocalTabs
      label="Prep views"
      className="mb-6"
      tabs={[
        { key: "list", label: "Sign-Offs", to: "/prep", active: view !== "installs" },
        { key: "installs", label: "Install Proof", to: "/prep?view=installs", active: view === "installs" },
      ]}
    />
  );

  // INSTALL PROOF VIEW — the get-ready work surface (moved from /admin?tab=getready)
  if (view === "installs") {
    return (
      <div className="bg-adm-workspace px-4 py-4 sm:px-6 sm:py-6">
        <div className="max-w-6xl mx-auto">
          {viewTabs}
          <InstallProofView storeId={storeId} storeName={currentStore?.name || tenant?.name || "Your dealership"} />
        </div>
      </div>
    );
  }

  // LIST VIEW
  if (view === "list") {
    const loaded = !signOffsLoading;
    const selParam = searchParams.get("sel");
    const wide = typeof window !== "undefined" && window.innerWidth >= 1024;
    const selected = (selParam === null ? (wide ? filtered[0] : null) : filtered.find((x) => x.id === selParam)) ?? null;
    const select = (sid: string | null) => {
      const n = new URLSearchParams(searchParams);
      n.set("sel", sid ?? "");
      setSearchParams(n, { replace: true });
    };
    const addInstallPhoto = async (files: FileList | null) => {
      if (!selected || !files?.length) return;
      setUploadingId(selected.id);
      try {
        const added: InstallPhoto[] = [];
        for (const file of Array.from(files)) {
          try {
            const up = await uploadPhoto("prep-photos", file, { tenantId: tenant?.id, storeId, vin: selected.vin });
            if (up?.url) added.push({ url: up.url, caption: file.name, category: "after", uploaded_at: new Date().toISOString() });
          } catch { toast.error(`Could not upload ${file.name}`); }
        }
        if (added.length === 0) return;
        const { error } = await (supabase as any).from("prep_sign_offs").update({ install_photos: [...(selected.install_photos || []), ...added] }).eq("id", selected.id);
        if (error) { toast.error("The photo could not be saved to this sign-off."); return; }
        toast.success(added.length === 1 ? "Photo added" : `${added.length} photos added`);
        await reloadSignOffs();
      } finally {
        setUploadingId(null);
      }
    };
    return (
      <PageBody width="wide">
        <PageHeader
          title="Prep & Vendors"
          actions={<ProductButton variant="primary" onClick={() => setSearchParams({ view: "new" })}>Assign vendor</ProductButton>}
        />

        <LocalTabs
          label="Prep views"
          tabs={[
            ...(["all", "pending", "signed", "rejected"] as const).map((f): LocalTab => ({
              key: f,
              label: f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1),
              to: f === "all" ? "/prep" : `/prep?filter=${f}`,
              active: filter === f,
              count: loaded ? (f === "all" ? signOffs.length : signOffs.filter((x) => x.status === f).length) : null,
            })),
          ]}
        />

        <MetricStrip boxed numberFirst noBars
          label="Prep sign-off summary"
          metrics={[
            { label: "Total prep items", value: loaded ? signOffs.length : null, hint: "Across all vehicles", loading: !loaded },
            { label: "Awaiting proof", value: loaded ? pending.length : null, hint: "Need foreman sign-off", tone: "warning", loading: !loaded },
            { label: "Signed off today", value: loaded ? signedToday : null, hint: "Completed today", tone: "success", loading: !loaded },
            { label: "Rejected this week", value: loaded ? rejectedThisWeek : null, hint: "Sent back for rework", tone: "danger", loading: !loaded },
          ]}
        />

        {!loaded ? (
          <div role="status" aria-label="Loading" className="rounded-[6px] border border-adm-border bg-adm-surface p-6 text-[14px] text-adm-muted">Loading sign-offs…</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title={filter === "all" ? "No prep sign-offs yet" : `No ${filter} sign-offs`}
            description={filter === "all"
              ? "Request one when a vehicle is ready for final inspection. Sign-offs unlock publishing and attach an install audit to every addendum."
              : `This filter shows ${filter} sign-offs only; ${signOffs.length} ${signOffs.length === 1 ? "request exists" : "requests exist"} in total.`}
          />
        ) : (
          <div className="flex flex-col items-start gap-4 lg:flex-row">
            <div className="min-w-0 w-full flex-1">
            <WorkTable caption="Prep sign-offs" minWidth={0}>
              <thead>
                <tr>
                  <Th className="!px-2">Vehicle</Th>
                  <Th className="!px-2">Task</Th>
                  <Th className="!px-2">Vendor</Th>
                  <Th className="whitespace-nowrap !px-2">Proof</Th>
                  {prepDue.available && <Th className="whitespace-nowrap !px-2">Due</Th>}
                  <Th className="!px-2">Status</Th>
                  <Th className="whitespace-nowrap !px-2">Next action</Th>
                  <Th align="right" className="!px-2 whitespace-nowrap">Action</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id} className={`h-12 cursor-pointer ${selected?.id === s.id ? "bg-adm-selected" : "hover:bg-adm-workspace"}`} onClick={() => select(s.id)}>
                    <Td className="max-w-[260px] min-w-[220px] !px-2">
                      <p className="truncate text-[13px] font-semibold text-adm-ink" title={`${s.ymm || s.vin}${s.stock_number ? ` - Stock ${s.stock_number}` : ""}`}>{s.ymm || s.vin}</p>
                    </Td>
                    <Td className="max-w-[120px] !px-2">
                      <p className="truncate" title={taskLabel(s.accessories_installed)}>{taskLabel(s.accessories_installed)}</p>
                    </Td>
                    <Td className="whitespace-nowrap !px-2">{vendorLabel(s.accessories_installed)}</Td>
                    <Td className="whitespace-nowrap !px-2 text-adm-muted">{s.install_photos?.length ? `${s.install_photos.length} ${s.install_photos.length === 1 ? "photo" : "photos"}` : "Install photo"}</Td>
                    {prepDue.available && (
                      <Td className="whitespace-nowrap !px-2">
                        <DueCell view={prepDue.view(s)} />
                      </Td>
                    )}
                    <Td className="!px-2">
                      <StatusText tone={s.status === "pending" ? "warning" : s.status === "signed" ? "success" : s.status === "rejected" ? "danger" : "neutral"}>
                        {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                      </StatusText>
                    </Td>
                    <Td className="max-w-[200px] !px-2">
                      <NextActionCell row={s} dueAt={prepDue.view(s)?.dueAt ?? null} />
                    </Td>
                    <Td align="right" className="!px-2">
                      <button type="button" className="whitespace-nowrap text-[14px] font-medium text-adm-primary hover:underline" onClick={(e) => { e.stopPropagation(); select(s.id); }}>
                        {s.status === "pending" ? "Review" : "View"}
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </WorkTable>
            </div>
            {selected && (
              <>
              <aside aria-label="Sign-off detail" className="flex w-full shrink-0 flex-col self-start rounded-[6px] border border-adm-border bg-adm-surface lg:sticky lg:top-4 lg:w-[340px]">
                <div className="flex items-start justify-between gap-3 border-b border-adm-border px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[17px] leading-[24px] font-semibold text-adm-ink truncate">Detail work</p>
                    <p className="text-[13px] leading-[18px] text-adm-muted truncate">{selected.ymm || selected.vin}</p>
                  </div>
                  <button type="button" onClick={() => select(null)} aria-label="Close detail" className="w-9 h-9 grid place-items-center rounded-md text-adm-muted hover:bg-adm-workspace"><X className="w-5 h-5" /></button>
                </div>
                <div className="space-y-4 px-4 py-4 text-[14px] leading-[20px]">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-adm-ink">Install photo</p>
                    {selected.status === "pending" && (
                      <>
                        <input type="file" accept="image/*" multiple className="sr-only" id="prep-install-photo" onChange={(e) => { void addInstallPhoto(e.target.files); e.target.value = ""; }} />
                        <label htmlFor="prep-install-photo" className="inline-flex min-h-[36px] cursor-pointer items-center gap-2 rounded-[6px] border border-adm-border bg-adm-surface px-3 text-[14px] font-semibold text-adm-ink hover:bg-adm-workspace">
                          <Upload className="w-5 h-5" aria-hidden="true" /> {uploadingId === selected.id ? "Uploading" : "Upload photo"}
                        </label>
                      </>
                    )}
                  </div>
                  {selected.install_photos?.[0]?.url ? (
                    <img src={selected.install_photos[0].url} alt={selected.install_photos[0].caption || "Install photo"} className="w-full max-h-[180px] rounded-[4px] border border-adm-border object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  ) : (
                    <p className="rounded-[4px] border border-dashed border-adm-border px-3 py-6 text-center text-adm-muted">No install photo on file</p>
                  )}
                  <dl className="space-y-1.5">
                    {[
                      ["Vendor", vendorLabel(selected.accessories_installed)],
                      ["Foreman", selected.foreman_name || "Unknown"],
                      ["Status", selected.status.charAt(0).toUpperCase() + selected.status.slice(1)],
                      ["Updated", format(new Date(selected.updated_at), "MMM d, yyyy")],
                      ["Photos", String(selected.install_photos?.length || 0)],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-3"><dt className="text-adm-muted">{k}</dt><dd className="text-adm-ink text-right">{v}</dd></div>
                    ))}
                    {prepDue.available && (
                      <div className="flex justify-between gap-3"><dt className="text-adm-muted">Due</dt><dd className="text-right"><DueCell view={prepDue.view(selected)} /></dd></div>
                    )}
                  </dl>
                  {prepDue.available && canEditDue && (
                    <PrepDueEditor
                      dueAt={prepDue.view(selected)?.source === "set" ? prepDue.view(selected)?.dueAt ?? null : null}
                      timeZone={dealerSettings.dealer_timezone}
                      pending={prepDue.setDue.isPending}
                      onSave={(dueAt) =>
                        prepDue.setDue.mutate(
                          { prepId: selected.id, dueAt },
                          {
                            onSuccess: () => toast.success(dueAt ? "Due date set" : "Due date cleared"),
                            onError: (e) => toast.error(e instanceof Error ? e.message : "Due date could not be saved"),
                          },
                        )
                      }
                    />
                  )}
                  <div>
                    <p className="font-semibold text-adm-ink mb-1">Installed accessories</p>
                    {selected.accessories_installed.length === 0 ? (
                      <p className="text-adm-muted">None listed.</p>
                    ) : (
                      <ul className="divide-y divide-adm-border">
                        {selected.accessories_installed.map((a, i) => (
                          <li key={i} className="flex justify-between gap-3 py-1.5">
                            <span className="min-w-0 truncate text-adm-ink">{a.product_name}</span>
                            <span className="text-adm-muted whitespace-nowrap">{a.installed_date ? "Installed" : "Pending"}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="font-semibold text-adm-ink mb-1">Foreman signature</p>
                    {selected.foreman_signature_data ? (
                      <img src={selected.foreman_signature_data} alt={`Signature of ${selected.foreman_name}`} className="h-16 w-full rounded-[4px] border border-adm-border bg-white object-contain" />
                    ) : (
                      <p className="text-adm-muted">Not signed yet.</p>
                    )}
                    <p className="text-adm-muted">{selected.foreman_name}{selected.signed_at ? `, ${format(new Date(selected.signed_at), "MMM d, yyyy")}` : ""}</p>
                  </div>
                  {selected.notes && <p className="text-adm-muted">{selected.notes}</p>}
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-adm-border px-4 py-3">
                  <button type="button" className="text-[14px] font-semibold text-adm-primary hover:underline" onClick={() => navigate(`/prep/${selected.vin}`)}>Open mobile flow</button>
                  <ProductButton variant="primary" onClick={() => setSearchParams({ view: "detail", id: selected.id })}>
                    {selected.status === "pending" ? "Review and sign" : "Open sign-off"}
                  </ProductButton>
                </div>
              </aside>
              </>
            )}
          </div>
        )}
      </PageBody>
    );
  }

  // NEW VIEW
  if (view === "new") {
    const handleGetReadySelect = (recordId: string) => {
      const record = getReadyRecords.find(r => r.id === recordId);
      if (record) {
        setNewForm(prev => ({
          ...prev,
          get_ready_record_id: recordId,
          vin: record.vin,
          stock_number: record.stockNumber || "",
          ymm: record.ymm || "",
          accessories: (record.accessoriesToInstall || []).map(a => ({
            product_id: a.productId,
            product_name: a.productName,
            installed_date: a.installedDate || "",
            installed_by: a.installedBy || "",
            photo_urls: [],
          })),
        }));
      }
    };

    const handleCreateSignOff = async () => {
      if (!newForm.vin) {
        toast.error("VIN is required");
        return;
      }
      const { data, error } = await createSignOff({
        vin: newForm.vin,
        stock_number: newForm.stock_number,
        ymm: newForm.ymm,
        get_ready_record_id: newForm.get_ready_record_id,
        accessories_installed: newForm.accessories,
        inspection_passed: newForm.inspection_passed,
        inspection_form_type: newForm.inspection_form_type,
        // Strip transient upload-status markers from captions before saving
        install_photos: newForm.install_photos
          .filter((ph) => !ph.caption?.startsWith("__uploading:") && !ph.caption?.startsWith("__failed:"))
          .map((ph) => ({ ...ph, caption: ph.caption?.startsWith("__") ? "" : ph.caption })),
        foreman_name: newForm.foreman_name,
        notes: newForm.notes,
        createdBy: user?.id ?? null,
      });
      if (error || !data) {
        toast.error(error?.message || "Failed to create sign-off");
        return;
      }
      log({
        action: "prep_sign_off_created",
        entity_type: "prep_sign_off",
        entity_id: data.id,
        store_id: storeId,
        user_id: user?.id || "",
        details: { vin: newForm.vin, accessory_count: newForm.accessories.length },
      });
      toast.success("Sign-off request created");
      setSearchParams({ view: "detail", id: data.id });
    };

    return (
      <div className="bg-adm-workspace px-4 py-4 sm:px-6 sm:py-6">
        <div className="max-w-2xl mx-auto">
          <button onClick={() => setSearchParams({ view: "list" })} className="flex items-center gap-2 text-adm-primary hover:text-adm-primary mb-6 font-medium">
            <ChevronLeft className="w-4 h-4" /> Back to list
          </button>

          <div className="rounded-2xl bg-adm-surface border border-adm-border p-8 shadow-premium">
            <h2 className="text-[24px] leading-[32px] sm:text-[28px] sm:leading-[36px] font-bold text-adm-ink mb-6">Create Sign-Off Request</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-adm-ink mb-2">VIN *</label>
                <input
                  type="text"
                  placeholder="Vehicle Identification Number"
                  value={newForm.vin}
                  onChange={e => setNewForm(prev => ({ ...prev, vin: e.target.value.toUpperCase() }))}
                  className="w-full h-10 px-4 border border-adm-border rounded-md bg-adm-surface text-adm-ink focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-adm-ink mb-2">Get-Ready Record</label>
                <select
                  value={newForm.get_ready_record_id}
                  onChange={e => handleGetReadySelect(e.target.value)}
                  className="w-full h-10 px-4 border border-adm-border rounded-md bg-adm-surface text-adm-ink focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Select a record --</option>
                  {getReadyRecords.filter(r => !signOffs.find(s => s.vin === r.vin)).map(r => (
                    <option key={r.id} value={r.id}>{r.vin} - {r.ymm}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-adm-ink mb-2">YMM</label>
                  <input
                    type="text"
                    value={newForm.ymm}
                    onChange={e => setNewForm(prev => ({ ...prev, ymm: e.target.value }))}
                    className="w-full h-10 px-4 border border-adm-border rounded-md bg-adm-surface text-adm-ink"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-adm-ink mb-2">Stock Number</label>
                  <input
                    type="text"
                    value={newForm.stock_number}
                    onChange={e => setNewForm(prev => ({ ...prev, stock_number: e.target.value }))}
                    className="w-full h-10 px-4 border border-adm-border rounded-md bg-adm-surface text-adm-ink"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-adm-ink mb-2">Inspection Form</label>
                  <select
                    value={newForm.inspection_form_type}
                    onChange={e => setNewForm(prev => ({ ...prev, inspection_form_type: e.target.value }))}
                    className="w-full h-10 px-4 border border-adm-border rounded-md bg-adm-surface text-adm-ink"
                  >
                    <option value="None">None</option>
                    <option value="CT-K208">CT-K208</option>
                    <option value="PA Safety">PA Safety</option>
                    <option value="NY Inspection">NY Inspection</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 h-10">
                    <input
                      type="checkbox"
                      checked={newForm.inspection_passed}
                      onChange={e => setNewForm(prev => ({ ...prev, inspection_passed: e.target.checked }))}
                      className="w-4 h-4"
                    />
                    <span className="text-sm font-medium text-adm-ink">Inspection passed</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-adm-ink mb-2">Foreman Name</label>
                <input
                  type="text"
                  value={newForm.foreman_name}
                  onChange={e => setNewForm(prev => ({ ...prev, foreman_name: e.target.value }))}
                  className="w-full h-10 px-4 border border-adm-border rounded-md bg-adm-surface text-adm-ink"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-adm-ink mb-2">Accessories</label>
                <div className="space-y-2">
                  {newForm.accessories.map((acc, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-adm-workspace rounded-md">
                      <span className="text-adm-ink">{acc.product_name}</span>
                      {acc.installed_date ? (
                        <span className="text-xs text-green-600 font-medium">✓ Installed</span>
                      ) : (
                        <button
                          onClick={() => {
                            const updated = [...newForm.accessories];
                            updated[i] = {
                              ...acc,
                              installed_date: new Date().toISOString(),
                              installed_by: user?.email?.split("@")[0] || "",
                            };
                            setNewForm(prev => ({ ...prev, accessories: updated }));
                          }}
                          className="text-xs px-2 py-1 bg-adm-primary text-white rounded hover:bg-adm-primary-hover"
                        >
                          Mark Installed
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-adm-ink mb-2">Install Photos</label>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={async e => {
                    const files = Array.from(e.currentTarget.files || []);
                    // Per-photo status is encoded in the caption:
                    //   __uploading:<id>            — upload in progress
                    //   __failed:<id>:<filename>    — upload failed (show retry)
                    //   anything else (or "")       — upload complete
                    const stamps = files.map(() => crypto.randomUUID());
                    setNewForm(prev => ({
                      ...prev,
                      install_photos: [
                        ...prev.install_photos,
                        ...files.map((file, i) => ({
                          url: URL.createObjectURL(file),
                          category: "after" as const,
                          caption: `__uploading:${stamps[i]}`,
                          uploaded_at: new Date().toISOString(),
                        })),
                      ],
                    }));
                    e.currentTarget.value = "";
                    for (let i = 0; i < files.length; i++) {
                      let uploaded: Awaited<ReturnType<typeof uploadPhoto>> = null;
                      let uploadError = "Upload failed";
                      try {
                        uploaded = await uploadPhoto("prep-photos", files[i], {
                          tenantId: tenant?.id,
                          storeId,
                          vin: newForm.vin,
                        });
                      } catch (err) {
                        uploadError = err instanceof Error ? err.message : uploadError;
                      }
                      setNewForm(prev => ({
                        ...prev,
                        install_photos: prev.install_photos.map(ph =>
                          ph.caption === `__uploading:${stamps[i]}`
                            ? uploaded
                              ? { ...ph, url: uploaded.url, caption: "" }
                              : { ...ph, caption: `__failed:${stamps[i]}:${files[i].name}` }
                            : ph
                        ),
                      }));
                      if (!uploaded) toast.error(`Upload failed for ${files[i].name}: ${uploadError}`);
                    }
                  }}
                  className="block w-full text-sm text-adm-muted file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-adm-selected file:text-adm-primary"
                />

                {/* Upload status grid — thumbnails with spinner, failed badge,
                    or solid-checkmark once each file reaches Storage. */}
                {newForm.install_photos.length > 0 && (
                  <div className="mt-3 grid grid-cols-3 md:grid-cols-6 gap-2">
                    {newForm.install_photos.map((ph, i) => {
                      const isUploading = ph.caption?.startsWith("__uploading:");
                      const isFailed = ph.caption?.startsWith("__failed:");
                      return (
                        <div
                          key={i}
                          className={`relative aspect-square rounded-md overflow-hidden border ${
                            isFailed ? "border-adm-border" : isUploading ? "border-adm-warning-bg" : "border-adm-border"
                          } bg-adm-workspace`}
                        >
                          <img src={ph.url} alt="" className="w-full h-full object-cover" />
                          <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 text-[12px] leading-[18px] font-bold uppercase tracking-label bg-black/50 text-white flex items-center justify-between">
                            {isUploading ? (
                              <span className="inline-flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-adm-warning-bg animate-pulse" />
                                Uploading
                              </span>
                            ) : isFailed ? (
                              <span className="inline-flex items-center gap-1 text-adm-danger">
                                <span className="w-2 h-2 rounded-full bg-red-400" />
                                Failed
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-adm-success">
                                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                                Saved
                              </span>
                            )}
                            <button
                              onClick={() =>
                                setNewForm(prev => ({
                                  ...prev,
                                  install_photos: prev.install_photos.filter((_, idx) => idx !== i),
                                }))
                              }
                              className="text-white/70 hover:text-white"
                              title="Remove"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {newForm.install_photos.some((ph) => ph.caption?.startsWith("__uploading:")) && (
                  <p className="mt-2 text-[11px] text-adm-warning font-semibold">
                    Waiting on photo upload to finish before sign-off is allowed.
                  </p>
                )}
                {newForm.install_photos.some((ph) => ph.caption?.startsWith("__failed:")) && (
                  <p className="mt-2 text-[11px] text-adm-danger font-semibold">
                    Some photos failed to upload. Remove and try again to unblock sign-off.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-adm-ink mb-2">Notes</label>
                <textarea
                  value={newForm.notes}
                  onChange={e => setNewForm(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full h-24 px-4 py-2 border border-adm-border rounded-md bg-adm-surface text-adm-ink focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleCreateSignOff}
                  disabled={newForm.install_photos.some(
                    (ph) => ph.caption?.startsWith("__uploading:") || ph.caption?.startsWith("__failed:")
                  )}
                  className="flex-1 h-10 bg-adm-primary text-white rounded-md hover:bg-adm-primary-hover font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create Sign-Off Request
                </button>
                <button
                  onClick={() => setSearchParams({ view: "list" })}
                  className="h-10 px-6 border border-adm-border text-adm-ink rounded-md hover:bg-adm-workspace"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // DETAIL VIEW
  if (view === "detail") {
    const record = signOffs.find(s => s.id === id);
    if (!record) {
      return (
        <div className="bg-adm-workspace px-4 py-4 sm:px-6 sm:py-6">
          <div className="max-w-3xl mx-auto">
            <button onClick={() => setSearchParams({ view: "list" })} className="flex items-center gap-2 text-adm-primary hover:text-adm-primary mb-6 font-medium">
              <ChevronLeft className="w-4 h-4" /> Back to list
            </button>
            <div className="rounded-2xl bg-adm-surface border border-adm-border p-12 shadow-premium text-center">
              <p className="text-adm-ink">Sign-off not found</p>
            </div>
          </div>
        </div>
      );
    }

    const gate = isListingAllowed(record.vin);
    const statusColors: Record<string, string> = {
      pending: "bg-adm-warning-bg border-adm-warning-bg text-adm-warning",
      signed: "bg-green-100 border-green-300 text-green-900",
      rejected: "bg-red-100 border-adm-border text-adm-danger",
      overridden: "bg-orange-100 border-orange-300 text-orange-900",
    };

    const handleSignOff = async () => {
      if (!foremanSig?.data || !ackCheckbox) {
        toast.error("Signature and acknowledgment required");
        return;
      }
      try {
        await signOff(record.id, { foremanSignatureData: foremanSig.data, foremanIp: null });
        await log({
          action: "prep_sign_off_signed",
          entity_type: "prep_sign_off",
          entity_id: record.id,
          store_id: storeId,
          user_id: user?.id || "",
          details: { vin: record.vin, foreman_name: record.foreman_name, photo_count: record.install_photos?.length || 0 },
        });
        toast.success("Sign-off completed");
        setSearchParams({ view: "list" });
      } catch (err: any) {
        toast.error(err.message || "Sign-off failed");
      }
    };

    return (
      <div className="bg-adm-workspace px-4 py-4 sm:px-6 sm:py-6">
        <div className="max-w-4xl mx-auto">
          <button onClick={() => setSearchParams({ view: "list" })} className="flex items-center gap-2 text-adm-primary hover:text-adm-primary mb-6 font-medium">
            <ChevronLeft className="w-4 h-4" /> Back to list
          </button>

          <div className={`rounded-2xl border-2 p-4 mb-6 ${statusColors[record.status]}`}>
            <div className="flex items-center justify-between">
              <span className="font-bold">{record.status.toUpperCase()}</span>
              <span className="text-sm">{format(new Date(record.updated_at), "MMM d, h:mm a")}</span>
            </div>
          </div>

          <div className="rounded-2xl bg-adm-surface border border-adm-border p-6 shadow-premium mb-6">
            <h2 className="text-[17px] leading-[24px] font-semibold text-adm-ink mb-3">Vehicle</h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-adm-muted text-sm">VIN</p>
                <p className="text-adm-ink font-medium">{record.vin}</p>
              </div>
              <div>
                <p className="text-adm-muted text-sm">YMM</p>
                <p className="text-adm-ink font-medium">{record.ymm}</p>
              </div>
              <div>
                <p className="text-adm-muted text-sm">Stock</p>
                <p className="text-adm-ink font-medium">{record.stock_number}</p>
              </div>
            </div>
          </div>

          <div className={`rounded-2xl border-2 p-6 mb-6 ${gate.allowed ? "bg-green-50 border-green-200" : "bg-adm-danger-bg border-adm-border"}`}>
            <div className="flex items-start gap-3">
              {gate.allowed ? <Check className="w-5 h-5 text-green-600 mt-0.5" /> : <X className="w-5 h-5 text-adm-danger mt-0.5" />}
              <div>
                <p className="font-bold text-adm-ink">{gate.allowed ? "Ready to list" : "Listing locked"}</p>
                <p className={gate.allowed ? "text-green-700" : "text-adm-danger"}>{gate.allowed ? "Vehicle may be published to the public shopper portal." : gate.reason}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-adm-surface border border-adm-border p-6 shadow-premium mb-6">
            <h3 className="text-lg font-bold text-adm-ink mb-4">Accessories</h3>
            <div className="space-y-2">
              {record.accessories_installed.map((acc, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-adm-workspace rounded-md">
                  <span className="text-adm-ink">{acc.product_name}</span>
                  {acc.installed_date ? (
                    <span className="text-xs text-green-600 font-medium">
                      ✓ {format(new Date(acc.installed_date), "MMM d, h:mm a")} {acc.installed_by && `by ${acc.installed_by}`}
                    </span>
                  ) : (
                    <span className="text-xs bg-red-100 text-adm-danger px-2 py-1 rounded">Not yet installed</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {record.install_photos && record.install_photos.length > 0 && (
            <div className="rounded-2xl bg-adm-surface border border-adm-border p-6 shadow-premium mb-6">
              <h3 className="text-lg font-bold text-adm-ink mb-4">Install Photos</h3>
              <div className="grid grid-cols-4 gap-4">
                {record.install_photos.map((photo, i) => (
                  <button
                    key={i}
                    onClick={() => { setSelectedPhoto(photo); dialogRef?.showModal(); }}
                    className="h-20 bg-adm-workspace rounded-md overflow-hidden hover:opacity-75 transition"
                  >
                    <img src={photo.url} alt={`Install ${i}`} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
              <dialog
                ref={setDialogRef}
                className="rounded-2xl shadow-2xl backdrop:bg-black/50 p-4 max-w-2xl"
              >
                {selectedPhoto && (
                  <div>
                    <img src={selectedPhoto.url} alt="Full view" className="w-full rounded-lg" />
                    <button
                      onClick={() => dialogRef?.close()}
                      className="mt-4 w-full h-10 bg-gray-200 rounded-md hover:bg-gray-300"
                    >
                      Close
                    </button>
                  </div>
                )}
              </dialog>
            </div>
          )}

          <div className="rounded-2xl bg-adm-surface border border-adm-border p-6 shadow-premium mb-6">
            <h3 className="text-[17px] leading-[24px] font-semibold text-adm-ink mb-3">Inspection</h3>
            <div className="flex items-center justify-between">
              <span className="text-adm-ink">{record.inspection_form_type}</span>
              <span className={`text-xs px-2 py-1 rounded font-medium ${record.inspection_passed ? "bg-green-100 text-green-800" : "bg-red-100 text-adm-danger"}`}>
                {record.inspection_passed ? "Passed" : "Failed"}
              </span>
            </div>
          </div>

          {record.status === "pending" && (
            <div className="rounded-2xl bg-adm-surface border border-adm-border p-6 shadow-premium mb-6">
              <h3 className="text-lg font-bold text-adm-ink mb-4">Sign Off</h3>
              <div className="bg-adm-workspace p-4 rounded-lg mb-4 text-sm text-adm-ink space-y-1">
                <p>I confirm:</p>
                <ul className="list-disc list-inside space-y-1 mt-2">
                  <li>All accessories installed per spec</li>
                  <li>Installation photos documented</li>
                  <li>Inspection passed</li>
                  <li>Vehicle ready for public listing</li>
                </ul>
              </div>

              <label className="flex items-center gap-2 mb-4">
                <input
                  type="checkbox"
                  checked={ackCheckbox}
                  onChange={e => setAckCheckbox(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm text-adm-ink">I understand signing here unlocks this vehicle for public listing.</span>
              </label>

              <SignaturePad
                label="Foreman Signature"
                subtitle="Sign to unlock listing"
                onChange={(data, type) => setForemanSig({ data, type })}
              />

              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleSignOff}
                  disabled={!foremanSig?.data || !ackCheckbox}
                  className="flex-1 h-10 bg-adm-primary text-white rounded-md hover:bg-adm-primary-hover font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Sign & Unlock Listing
                </button>
                <button
                  onClick={() => {
                    setRejectCategory("paint");
                    setRejectNotes("");
                    setRejectOpen(true);
                  }}
                  className="h-10 px-4 border-2 border-adm-border text-adm-danger rounded-md hover:bg-adm-danger-bg font-medium"
                >
                  Reject
                </button>
                <button
                  onClick={() => setOverridePanel(!overridePanel)}
                  className="h-10 px-4 border-2 border-adm-warning-bg0 text-adm-warning rounded-md hover:bg-adm-warning-bg font-medium"
                >
                  Override
                </button>
              </div>

              {overridePanel && (
                <div className="mt-4 p-4 bg-adm-warning-bg border border-adm-warning-bg rounded-lg space-y-3">
                  <p className="text-sm text-adm-warning font-medium">Override logs a permanent compliance exception — use sparingly.</p>
                  <input
                    type="text"
                    placeholder="Override manager name"
                    value={overrideForm.overriderName}
                    onChange={e => setOverrideForm(prev => ({ ...prev, overriderName: e.target.value }))}
                    className="w-full h-10 px-4 border border-adm-warning-bg rounded-md bg-adm-surface text-adm-ink"
                  />
                  <input
                    type="text"
                    placeholder="Reason for override"
                    value={overrideForm.reason}
                    onChange={e => setOverrideForm(prev => ({ ...prev, reason: e.target.value }))}
                    className="w-full h-10 px-4 border border-adm-warning-bg rounded-md bg-adm-surface text-adm-ink"
                  />
                  <button
                    onClick={async () => {
                      await override(record.id, overrideForm);
                      await log({ action: "prep_sign_off_overridden", entity_type: "prep_sign_off", entity_id: record.id, store_id: storeId, user_id: user?.id || "", details: { vin: record.vin, reason: overrideForm.reason } });
                      toast.warning("Sign-off overridden");
                      setSearchParams({ view: "list" });
                    }}
                    className="w-full h-10 bg-amber-600 text-white rounded-md hover:bg-amber-700 font-medium"
                  >
                    Confirm Override
                  </button>
                </div>
              )}
            </div>
          )}

          {record.status === "signed" && (
            <div className="rounded-2xl bg-green-50 border-2 border-green-200 p-6 shadow-premium">
              {record.foreman_signature_data && (
                <img src={record.foreman_signature_data} alt="Foreman signature" className="h-24 object-contain mb-4" />
              )}
              <p className="text-adm-ink"><strong>Signed by:</strong> {record.foreman_name}</p>
              <p className="text-adm-muted"><strong>Date:</strong> {format(new Date(record.signed_at!), "MMM d, yyyy h:mm a")}</p>
            </div>
          )}

          {record.status === "rejected" && (
            <div className="rounded-2xl bg-adm-danger-bg border-2 border-adm-border p-6 shadow-premium">
              <p className="font-bold text-adm-danger mb-2">Rejection Reason</p>
              <p className="text-adm-danger">{record.rejection_reason}</p>
            </div>
          )}

          {record.status === "overridden" && (
            <div className="rounded-2xl bg-orange-50 border-2 border-orange-200 p-6 shadow-premium">
              <p className="font-bold text-orange-900 mb-2">Override Notes</p>
              <p className="text-orange-800">Overridden — review compliance risk.</p>
            </div>
          )}
        </div>

        {rejectOpen && record && (
          <RejectModal
            vin={record.vin}
            category={rejectCategory}
            notes={rejectNotes}
            submitting={rejecting}
            onCategory={setRejectCategory}
            onNotes={setRejectNotes}
            onClose={() => setRejectOpen(false)}
            onSubmit={async () => {
              setRejecting(true);
              const full = `[${rejectCategory}] ${rejectNotes.trim() || "(no additional notes)"}`;
              await reject(record.id, full);
              await log({
                action: "prep_sign_off_rejected",
                entity_type: "prep_sign_off",
                entity_id: record.id,
                store_id: storeId,
                user_id: user?.id || "",
                details: { vin: record.vin, category: rejectCategory, notes: rejectNotes.trim() || null },
              });
              setRejecting(false);
              setRejectOpen(false);
              toast.success("Sign-off rejected");
              setSearchParams({ view: "list" });
            }}
          />
        )}
      </div>
    );
  }

  return null;
};

// Get-Ready install-proof work surface (moved from /admin?tab=getready):
// records list with per-accessory photo+signature proof and the
// "send to inventory / notify F&I" completion step. Config (the service
// catalog) stays on Admin > Get-Ready Setup.
const InstallProofView = ({ storeId, storeName }: { storeId: string; storeName: string }) => {
  const { settings } = useDealerSettings();
  const { user } = useAuth();
  const { records: getReadyRecords, getPending: getPendingGetReady, validateTimeline, markAccessoryInstalled, markInventory, createGetReady, completeItem } = useGetReady(storeId);
  const { sendGetReadyComplete, sending: emailSending } = useEmailDistribution(storeId);
  const [startGetReadyOpen, setStartGetReadyOpen] = useState(false);
  const [sheetRecord, setSheetRecord] = useState<GetReadyRecord | null>(null);
  const [completingItem, setCompletingItem] = useState<string | null>(null);


  return (
    <div className="space-y-4">
      <EmailDistributionPanel storeId={storeId} />

      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-adm-primary" />
            <h3 className="text-sm font-semibold text-adm-ink">Vehicle Get-Ready Tracker</h3>
          </div>
          <p className="text-xs text-adm-muted mt-0.5">
            Track vehicle preparation from acquisition to inventory-ready. Proves accessories installed before listing date.
          </p>
        </div>
        <button
          onClick={() => setStartGetReadyOpen(true)}
          className="h-10 px-4 rounded-xl bg-adm-primary text-white text-sm font-semibold hover:bg-adm-primary-hover shadow-sm shadow-blue-600/30 ring-1 ring-inset ring-white/15 inline-flex items-center gap-2 shrink-0"
        >
          <Plus className="w-4 h-4" /> Start Get-Ready
        </button>
      </div>
      <StartGetReadyModal open={startGetReadyOpen} onClose={() => setStartGetReadyOpen(false)} onCreate={createGetReady} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <InstallStat icon={Clock} label="Pending" value={getReadyRecords.filter(r => r.status === "pending" || r.status === "in_progress").length} color="text-adm-warning" />
        <InstallStat icon={CheckCircle2} label="Ready" value={getReadyRecords.filter(r => r.status === "ready").length} color="text-adm-success" />
        <InstallStat icon={Car} label="In Inventory" value={getReadyRecords.filter(r => r.status === "inventory").length} color="text-adm-primary" />
        <InstallStat icon={FileText} label="Total" value={getReadyRecords.length} color="text-adm-ink" />
      </div>

      <div className="bg-adm-surface rounded-xl border border-adm-border shadow-premium overflow-hidden">
        {getReadyRecords.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Clock className="w-8 h-8 text-adm-muted/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-adm-ink">No get-ready records yet</p>
            <p className="text-xs text-adm-muted mt-1">When you create a sticker for a vehicle, a get-ready record can be generated automatically.</p>
          </div>
        ) : (
          <div>
            <div className="px-5 py-2.5 bg-adm-workspace text-[12px] leading-[18px] font-semibold uppercase tracking-wider text-adm-muted flex items-center justify-between">
              <span>{getReadyRecords.length} vehicle{getReadyRecords.length !== 1 ? "s" : ""}</span>
              <span>{getPendingGetReady().length} pending</span>
            </div>
            {getReadyRecords.map(record => {
              const timeline = validateTimeline(record);
              const completedItems = record.items.filter(i => i.status === "complete").length;
              const totalItems = record.items.length;
              const pct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

              return (
                <div key={record.id} className="px-5 py-4 border-b border-adm-border last:border-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-adm-ink truncate">{record.ymm}</p>
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                          record.status === "inventory" ? "bg-adm-selected text-adm-primary" :
                          record.status === "ready" ? "bg-adm-success-bg text-adm-success" :
                          "bg-adm-warning-bg text-adm-warning"
                        }`}>{record.status.replace(/_/g, " ")}</span>
                        {record.inspectionRequired && (
                          <span
                            className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                              record.inspectionComplete ? "bg-adm-success-bg text-adm-success" : "bg-adm-warning-bg text-adm-warning"
                            }`}
                            title={record.inspectionComplete ? "Safety inspection on file" : "Safety inspection required before delivery"}
                          >
                            {record.inspectionComplete ? "Inspection done" : "Inspection due"}
                            {record.inspectionFormType ? ` · ${record.inspectionFormType}` : ""}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-adm-muted">
                        <span className="font-mono">{record.vin}</span>
                        {record.stockNumber && <span>Stock: {record.stockNumber}</span>}
                        <button
                          onClick={() => setSheetRecord(record)}
                          className="inline-flex items-center gap-1 text-[10px] font-semibold text-navy hover:underline"
                        >
                          Installer sheet
                        </button>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-3 text-[10px]">
                        <span className="text-adm-muted">Acquired: <strong className="text-adm-ink">{record.acquiredDate ? format(new Date(record.acquiredDate), "M/d/yy") : "—"}</strong></span>
                        <span className="text-adm-muted">Get-Ready: <strong className="text-adm-ink">{record.getReadyCompleteDate ? format(new Date(record.getReadyCompleteDate), "M/d/yy") : "In progress"}</strong></span>
                        <span className="text-adm-muted">Inventory: <strong className="text-adm-ink">{record.inventoryDate ? format(new Date(record.inventoryDate), "M/d/yy") : "Pending"}</strong></span>
                      </div>

                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-adm-workspace rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${pct === 100 ? "bg-adm-success-bg0" : "bg-adm-selected0"}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] text-adm-muted tabular-nums">{completedItems}/{totalItems}</span>
                      </div>

                      {/* Work checklist. Completing the last item is what
                          moves the record to "ready" — the step that unlocks
                          "send to inventory". */}
                      {totalItems > 0 && (
                        <div className="mt-3 rounded-lg border border-adm-border divide-y divide-border">
                          {record.items.map(item => {
                            const done = item.status === "complete";
                            const busy = completingItem === `${record.id}:${item.id}`;
                            return (
                              <div key={item.id} className="flex items-center justify-between gap-2 px-3 py-2">
                                <div className="min-w-0">
                                  <p className={`text-xs font-medium truncate ${done ? "text-adm-muted line-through" : "text-adm-ink"}`}>{item.label}</p>
                                  {done && item.completedAt && (
                                    <p className="text-[10px] text-adm-muted">
                                      {format(new Date(item.completedAt), "M/d/yy")}{item.completedBy ? ` · ${item.completedBy}` : ""}
                                    </p>
                                  )}
                                </div>
                                {done ? (
                                  <CheckCircle2 className="w-4 h-4 text-adm-success shrink-0" />
                                ) : (
                                  <button
                                    disabled={busy}
                                    onClick={async () => {
                                      setCompletingItem(`${record.id}:${item.id}`);
                                      try {
                                        await completeItem(record.id, item.id, user?.email?.split("@")[0] || "staff");
                                        toast.success(`${item.label} marked complete`);
                                      } catch {
                                        toast.error("Couldn't mark that step complete");
                                      } finally {
                                        setCompletingItem(null);
                                      }
                                    }}
                                    className="h-7 px-2.5 rounded-md border border-adm-border text-[10px] font-semibold text-adm-ink hover:bg-adm-workspace disabled:opacity-60 shrink-0"
                                  >
                                    {busy ? "Saving…" : "Mark done"}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}



                      {!timeline.valid && (
                        <div className="mt-2 space-y-1">
                          {timeline.warnings.map((w, i) => (
                            <p key={i} className="text-[10px] text-adm-danger font-medium flex items-start gap-1">
                              <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" /> {w}
                            </p>
                          ))}
                        </div>
                      )}

                      {/* Per-accessory install proof: photos + signature per
                          pending accessory; installed rows collapse to summary
                          chips. Flows into the Audit-Defense Packet. */}
                      {record.accessoriesToInstall && record.accessoriesToInstall.length > 0 && (
                        <div className="mt-3">
                          <AccessoryInstallPanel
                            record={record}
                            onMarkInstalled={async (recordId, productId, installedBy, proof) => {
                              await markAccessoryInstalled(recordId, productId, installedBy, proof);
                            }}
                          />
                        </div>
                      )}

                      {/* Completion: notify the F&I distribution then move the
                          record to inventory; no subscribers still moves it. */}
                      {record.status === "ready" && (
                        <div className="mt-3 flex items-center justify-end">
                          <button
                            disabled={emailSending}
                            onClick={async () => {
                              const accessories = (record.accessoriesToInstall || []).map(a => ({
                                name: a.productName,
                                installed: a.installed,
                                installedDate: a.installedDate,
                                installedBy: a.installedBy,
                                photoCount: (a.install_photos || []).length,
                                signed: !!a.installer_signature_data,
                              }));
                              const sent = await sendGetReadyComplete({
                                dealerName: storeName || settings.dealer_name || "Your dealership",
                                vehicleYmm: record.ymm,
                                vehicleVin: record.vin,
                                stockNumber: record.stockNumber,
                                acquiredDate: record.acquiredDate,
                                getReadyStartDate: record.getReadyStartDate,
                                getReadyCompleteDate: record.getReadyCompleteDate || new Date().toISOString(),
                                accessories,
                                deepLinkUrl: `${window.location.origin}/admin?tab=files`,
                              });
                              await markInventory(record.id);
                              if (sent) {
                                toast.success("Notified F&I distribution · moved to inventory");
                              } else {
                                toast.info("Moved to inventory · no F&I subscribers on file yet");
                              }
                            }}
                            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-gradient-to-r from-[#3BB4FF] to-[#1E90FF] text-white text-xs font-display font-black shadow-premium hover:brightness-110 disabled:opacity-60"
                          >
                            {emailSending ? "Sending…" : "Send to inventory · notify F&I"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {sheetRecord && (
        <GetReadySheet
          open={!!sheetRecord}
          onClose={() => setSheetRecord(null)}
          record={sheetRecord}
          dealerName={storeName || settings.dealer_name}
        />
      )}
    </div>
  );
};

const InstallStat = ({ icon: Icon, label, value, color }: { icon: typeof FileText; label: string; value: number; color: string }) => (
  <div className="bg-adm-surface rounded-xl border border-adm-border shadow-premium p-4">
    <Icon className={`w-4 h-4 ${color} mb-2`} />
    <div className="text-2xl font-semibold tracking-tight font-display tabular-nums text-adm-ink">{value}</div>
    <p className="text-[11px] text-adm-muted mt-0.5">{label}</p>
  </div>
);

interface RejectModalProps {
  vin: string;
  category: string;
  notes: string;
  submitting: boolean;
  onCategory: (c: string) => void;
  onNotes: (n: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

const REJECT_CATEGORIES: Array<{ id: string; label: string }> = [
  { id: "paint",            label: "Paint / finish defect" },
  { id: "mechanical",       label: "Mechanical issue" },
  { id: "electrical",       label: "Electrical issue" },
  { id: "interior",         label: "Interior damage / stain" },
  { id: "missing_parts",    label: "Missing parts or accessories" },
  { id: "install_quality",  label: "Installation quality" },
  { id: "documentation",    label: "Documentation missing" },
  { id: "recall",           label: "Open / unresolved recall" },
  { id: "other",             label: "Other (explain in notes)" },
];

const RejectModal = ({
  vin, category, notes, submitting,
  onCategory, onNotes, onClose, onSubmit,
}: RejectModalProps) => {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end md:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-adm-surface w-full md:max-w-lg md:rounded-2xl rounded-t-[28px] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pt-2 md:hidden flex justify-center">
          <div className="w-10 h-1 rounded-full bg-slate-300" />
        </div>
        <div className="px-5 py-4 border-b border-adm-border">
          <h3 className="text-base font-black font-display tracking-tight text-adm-ink">
            Reject prep sign-off
          </h3>
          <p className="text-[11px] text-adm-muted mt-0.5 font-mono">VIN {vin}</p>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-[12px] leading-[18px] font-bold uppercase tracking-label text-adm-muted">
              Reason *
            </label>
            <select
              value={category}
              onChange={(e) => onCategory(e.target.value)}
              className="mt-1 w-full h-11 rounded-lg border border-adm-border px-3 text-sm bg-adm-surface"
            >
              {REJECT_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[12px] leading-[18px] font-bold uppercase tracking-label text-adm-muted">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => onNotes(e.target.value)}
              rows={3}
              placeholder="Specifics the service/detail team needs to fix..."
              className="mt-1 w-full rounded-lg border border-adm-border p-3 text-sm focus:outline-none focus:border-adm-border focus:ring-2 focus:ring-red-500/20"
            />
          </div>
          <div className="rounded-lg bg-adm-warning-bg border border-adm-warning-bg p-3 text-[11px] text-adm-warning">
            Rejecting keeps the listing locked. The vehicle won't be publishable
            until prep runs again and a foreman signs off.
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="h-10 px-4 rounded-lg text-sm font-semibold text-adm-muted hover:bg-adm-workspace"
            >
              Cancel
            </button>
            <button
              onClick={onSubmit}
              disabled={submitting}
              className="h-10 px-5 rounded-lg bg-red-600 text-white font-display font-black text-sm hover:brightness-110 disabled:opacity-50"
            >
              {submitting ? "Rejecting…" : "Reject sign-off"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrepSignOff;
