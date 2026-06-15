import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useAudit } from "@/contexts/AuditContext";
import { usePrepSignOff, type InstallPhoto, type InstalledAccessory } from "@/hooks/usePrepSignOff";
import { useGetReady } from "@/hooks/useGetReady";
import SignaturePad from "@/components/addendum/SignaturePad";
import { toast } from "sonner";
import { format } from "date-fns";
import { ShieldCheck, Camera, Check, X, AlertTriangle, ClipboardCheck, Image as ImageIcon, Upload, FileSignature, ArrowRight, Car, Wrench, ChevronLeft } from "lucide-react";
import EmptyState from "@/components/ui/empty-state";
import { uploadPhoto } from "@/lib/storage";

const PrepSignOff = () => {
  const { user } = useAuth();
  const { currentStore, tenant } = useTenant();
  const { log } = useAudit();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = (searchParams.get("view") || "list") as "list" | "new" | "detail";
  const id = searchParams.get("id") || "";
  const storeId = currentStore?.id || "";
  const { signOffs, pending, ready, createSignOff, signOff, reject, override, isListingAllowed } = usePrepSignOff(storeId);
  const { records: getReadyRecords } = useGetReady(storeId);

  const [filter, setFilter] = useState<"all" | "pending" | "signed" | "rejected">("all");
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

  if (!currentStore)
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="rounded-2xl bg-card border border-border p-8 shadow-premium">
          <p className="text-foreground">Select a store to continue.</p>
        </div>
      </div>
    );

  // LIST VIEW
  if (view === "list") {
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

    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Prep & Install Sign-Off</h1>
              <p className="text-muted-foreground mt-2">Shop foreman approves every vehicle before it hits the lot.</p>
            </div>
            <button
              onClick={() => setSearchParams({ view: "new" })}
              className="h-10 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
            >
              + New Sign-Off Request
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="rounded-2xl bg-card border border-border p-6 shadow-premium">
              <p className="text-muted-foreground text-sm font-medium">Pending sign-off</p>
              <p className="text-3xl font-bold text-amber-500 mt-2">{pending.length}</p>
            </div>
            <div className="rounded-2xl bg-card border border-border p-6 shadow-premium">
              <p className="text-muted-foreground text-sm font-medium">Signed off today</p>
              <p className="text-3xl font-bold text-green-600 mt-2">{signedToday}</p>
            </div>
            <div className="rounded-2xl bg-card border border-border p-6 shadow-premium">
              <p className="text-muted-foreground text-sm font-medium">Rejected this week</p>
              <p className="text-3xl font-bold text-red-600 mt-2">{rejectedThisWeek}</p>
            </div>
            <div className="rounded-2xl bg-card border border-border p-6 shadow-premium">
              <p className="text-muted-foreground text-sm font-medium">Ready for listing</p>
              <p className="text-3xl font-bold text-slate-900 mt-2">{ready.length}</p>
            </div>
          </div>

          <div className="flex gap-2 mb-6">
            {["all", "pending", "signed", "rejected"].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f as any)}
                className={`px-4 py-2 rounded-md font-medium transition ${
                  filter === f ? "bg-blue-600 text-white" : "bg-card border border-border text-foreground hover:border-blue-300"
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="No prep sign-offs yet"
              description="Request one when a vehicle is ready for final inspection. Sign-offs unlock publishing and attach an install audit to every addendum."
            />
          ) : (
            <div className="rounded-2xl bg-card border border-border shadow-premium overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted border-b border-border">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Status</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Vehicle</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Accessories</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Photos</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Foreman</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Updated</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map(s => (
                    <tr key={s.id} className="hover:bg-muted/50 transition">
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${
                          s.status === "pending" ? "bg-amber-100 text-amber-800" :
                          s.status === "signed" ? "bg-green-100 text-green-800" :
                          s.status === "rejected" ? "bg-red-100 text-red-800" :
                          "bg-orange-100 text-orange-800"
                        }`}>
                          {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <p className="font-medium text-foreground">{s.vin}</p>
                        <p className="text-muted-foreground">{s.ymm} • {s.stock_number}</p>
                      </td>
                      <td className="px-6 py-4 text-sm text-foreground">
                        {s.accessories_installed.filter(a => a.installed_date).length} of {s.accessories_installed.length}
                      </td>
                      <td className="px-6 py-4 text-sm text-foreground">{s.install_photos?.length || 0}</td>
                      <td className="px-6 py-4 text-sm text-foreground">{s.foreman_name}</td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">{format(new Date(s.updated_at), "MMM d, h:mm a")}</td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => setSearchParams({ view: "detail", id: s.id })}
                          className="px-3 py-1 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 font-medium"
                        >
                          Review & Sign
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
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
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-2xl mx-auto">
          <button onClick={() => setSearchParams({ view: "list" })} className="flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-6 font-medium">
            <ChevronLeft className="w-4 h-4" /> Back to list
          </button>

          <div className="rounded-2xl bg-card border border-border p-8 shadow-premium">
            <h2 className="text-2xl font-bold text-foreground mb-6">Create Sign-Off Request</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">VIN *</label>
                <input
                  type="text"
                  placeholder="Vehicle Identification Number"
                  value={newForm.vin}
                  onChange={e => setNewForm(prev => ({ ...prev, vin: e.target.value.toUpperCase() }))}
                  className="w-full h-10 px-4 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Get-Ready Record</label>
                <select
                  value={newForm.get_ready_record_id}
                  onChange={e => handleGetReadySelect(e.target.value)}
                  className="w-full h-10 px-4 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Select a record --</option>
                  {getReadyRecords.filter(r => !signOffs.find(s => s.vin === r.vin)).map(r => (
                    <option key={r.id} value={r.id}>{r.vin} - {r.ymm}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">YMM</label>
                  <input
                    type="text"
                    value={newForm.ymm}
                    onChange={e => setNewForm(prev => ({ ...prev, ymm: e.target.value }))}
                    className="w-full h-10 px-4 border border-border rounded-md bg-background text-foreground"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Stock Number</label>
                  <input
                    type="text"
                    value={newForm.stock_number}
                    onChange={e => setNewForm(prev => ({ ...prev, stock_number: e.target.value }))}
                    className="w-full h-10 px-4 border border-border rounded-md bg-background text-foreground"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Inspection Form</label>
                  <select
                    value={newForm.inspection_form_type}
                    onChange={e => setNewForm(prev => ({ ...prev, inspection_form_type: e.target.value }))}
                    className="w-full h-10 px-4 border border-border rounded-md bg-background text-foreground"
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
                    <span className="text-sm font-medium text-foreground">Inspection passed</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Foreman Name</label>
                <input
                  type="text"
                  value={newForm.foreman_name}
                  onChange={e => setNewForm(prev => ({ ...prev, foreman_name: e.target.value }))}
                  className="w-full h-10 px-4 border border-border rounded-md bg-background text-foreground"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Accessories</label>
                <div className="space-y-2">
                  {newForm.accessories.map((acc, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-muted rounded-md">
                      <span className="text-foreground">{acc.product_name}</span>
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
                          className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                        >
                          Mark Installed
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Install Photos</label>
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
                  className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-blue-50 file:text-blue-700"
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
                            isFailed ? "border-red-400" : isUploading ? "border-amber-300" : "border-emerald-300"
                          } bg-muted`}
                        >
                          <img src={ph.url} alt="" className="w-full h-full object-cover" />
                          <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 text-[10px] font-bold uppercase tracking-label bg-black/50 text-white flex items-center justify-between">
                            {isUploading ? (
                              <span className="inline-flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-amber-300 animate-pulse" />
                                Uploading
                              </span>
                            ) : isFailed ? (
                              <span className="inline-flex items-center gap-1 text-red-300">
                                <span className="w-2 h-2 rounded-full bg-red-400" />
                                Failed
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-emerald-300">
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
                  <p className="mt-2 text-[11px] text-amber-700 font-semibold">
                    Waiting on photo upload to finish before sign-off is allowed.
                  </p>
                )}
                {newForm.install_photos.some((ph) => ph.caption?.startsWith("__failed:")) && (
                  <p className="mt-2 text-[11px] text-red-600 font-semibold">
                    Some photos failed to upload. Remove and try again to unblock sign-off.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Notes</label>
                <textarea
                  value={newForm.notes}
                  onChange={e => setNewForm(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full h-24 px-4 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleCreateSignOff}
                  disabled={newForm.install_photos.some(
                    (ph) => ph.caption?.startsWith("__uploading:") || ph.caption?.startsWith("__failed:")
                  )}
                  className="flex-1 h-10 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create Sign-Off Request
                </button>
                <button
                  onClick={() => setSearchParams({ view: "list" })}
                  className="h-10 px-6 border border-border text-foreground rounded-md hover:bg-muted"
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
        <div className="min-h-screen bg-background p-6">
          <div className="max-w-3xl mx-auto">
            <button onClick={() => setSearchParams({ view: "list" })} className="flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-6 font-medium">
              <ChevronLeft className="w-4 h-4" /> Back to list
            </button>
            <div className="rounded-2xl bg-card border border-border p-12 shadow-premium text-center">
              <p className="text-foreground">Sign-off not found</p>
            </div>
          </div>
        </div>
      );
    }

    const gate = isListingAllowed(record.vin);
    const statusColors: Record<string, string> = {
      pending: "bg-amber-100 border-amber-300 text-amber-900",
      signed: "bg-green-100 border-green-300 text-green-900",
      rejected: "bg-red-100 border-red-300 text-red-900",
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
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto">
          <button onClick={() => setSearchParams({ view: "list" })} className="flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-6 font-medium">
            <ChevronLeft className="w-4 h-4" /> Back to list
          </button>

          <div className={`rounded-2xl border-2 p-4 mb-6 ${statusColors[record.status]}`}>
            <div className="flex items-center justify-between">
              <span className="font-bold">{record.status.toUpperCase()}</span>
              <span className="text-sm">{format(new Date(record.updated_at), "MMM d, h:mm a")}</span>
            </div>
          </div>

          <div className="rounded-2xl bg-card border border-border p-6 shadow-premium mb-6">
            <h2 className="text-lg font-bold text-foreground mb-3">Vehicle</h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-muted-foreground text-sm">VIN</p>
                <p className="text-foreground font-medium">{record.vin}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-sm">YMM</p>
                <p className="text-foreground font-medium">{record.ymm}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-sm">Stock</p>
                <p className="text-foreground font-medium">{record.stock_number}</p>
              </div>
            </div>
          </div>

          <div className={`rounded-2xl border-2 p-6 mb-6 ${gate.allowed ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
            <div className="flex items-start gap-3">
              {gate.allowed ? <Check className="w-5 h-5 text-green-600 mt-0.5" /> : <X className="w-5 h-5 text-red-600 mt-0.5" />}
              <div>
                <p className="font-bold text-foreground">{gate.allowed ? "Ready to list" : "Listing locked"}</p>
                <p className={gate.allowed ? "text-green-700" : "text-red-700"}>{gate.allowed ? "Vehicle may be published to the public shopper portal." : gate.reason}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-card border border-border p-6 shadow-premium mb-6">
            <h3 className="text-lg font-bold text-foreground mb-4">Accessories</h3>
            <div className="space-y-2">
              {record.accessories_installed.map((acc, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-muted rounded-md">
                  <span className="text-foreground">{acc.product_name}</span>
                  {acc.installed_date ? (
                    <span className="text-xs text-green-600 font-medium">
                      ✓ {format(new Date(acc.installed_date), "MMM d, h:mm a")} {acc.installed_by && `by ${acc.installed_by}`}
                    </span>
                  ) : (
                    <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">Not yet installed</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {record.install_photos && record.install_photos.length > 0 && (
            <div className="rounded-2xl bg-card border border-border p-6 shadow-premium mb-6">
              <h3 className="text-lg font-bold text-foreground mb-4">Install Photos</h3>
              <div className="grid grid-cols-4 gap-4">
                {record.install_photos.map((photo, i) => (
                  <button
                    key={i}
                    onClick={() => { setSelectedPhoto(photo); dialogRef?.showModal(); }}
                    className="h-20 bg-muted rounded-md overflow-hidden hover:opacity-75 transition"
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

          <div className="rounded-2xl bg-card border border-border p-6 shadow-premium mb-6">
            <h3 className="text-lg font-bold text-foreground mb-3">Inspection</h3>
            <div className="flex items-center justify-between">
              <span className="text-foreground">{record.inspection_form_type}</span>
              <span className={`text-xs px-2 py-1 rounded font-medium ${record.inspection_passed ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                {record.inspection_passed ? "Passed" : "Failed"}
              </span>
            </div>
          </div>

          {record.status === "pending" && (
            <div className="rounded-2xl bg-card border border-border p-6 shadow-premium mb-6">
              <h3 className="text-lg font-bold text-foreground mb-4">Sign Off</h3>
              <div className="bg-muted p-4 rounded-lg mb-4 text-sm text-foreground space-y-1">
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
                <span className="text-sm text-foreground">I understand signing here unlocks this vehicle for public listing.</span>
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
                  className="flex-1 h-10 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Sign & Unlock Listing
                </button>
                <button
                  onClick={() => {
                    setRejectCategory("paint");
                    setRejectNotes("");
                    setRejectOpen(true);
                  }}
                  className="h-10 px-4 border-2 border-red-600 text-red-600 rounded-md hover:bg-red-50 font-medium"
                >
                  Reject
                </button>
                <button
                  onClick={() => setOverridePanel(!overridePanel)}
                  className="h-10 px-4 border-2 border-amber-500 text-amber-600 rounded-md hover:bg-amber-50 font-medium"
                >
                  Override
                </button>
              </div>

              {overridePanel && (
                <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
                  <p className="text-sm text-amber-900 font-medium">Override logs a permanent compliance exception — use sparingly.</p>
                  <input
                    type="text"
                    placeholder="Override manager name"
                    value={overrideForm.overriderName}
                    onChange={e => setOverrideForm(prev => ({ ...prev, overriderName: e.target.value }))}
                    className="w-full h-10 px-4 border border-amber-300 rounded-md bg-white text-foreground"
                  />
                  <input
                    type="text"
                    placeholder="Reason for override"
                    value={overrideForm.reason}
                    onChange={e => setOverrideForm(prev => ({ ...prev, reason: e.target.value }))}
                    className="w-full h-10 px-4 border border-amber-300 rounded-md bg-white text-foreground"
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
              <p className="text-foreground"><strong>Signed by:</strong> {record.foreman_name}</p>
              <p className="text-muted-foreground"><strong>Date:</strong> {format(new Date(record.signed_at!), "MMM d, yyyy h:mm a")}</p>
            </div>
          )}

          {record.status === "rejected" && (
            <div className="rounded-2xl bg-red-50 border-2 border-red-200 p-6 shadow-premium">
              <p className="font-bold text-red-900 mb-2">Rejection Reason</p>
              <p className="text-red-800">{record.rejection_reason}</p>
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
        className="bg-white w-full md:max-w-lg md:rounded-2xl rounded-t-[28px] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pt-2 md:hidden flex justify-center">
          <div className="w-10 h-1 rounded-full bg-slate-300" />
        </div>
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="text-base font-black font-display tracking-tight text-slate-900">
            Reject prep sign-off
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5 font-mono">VIN {vin}</p>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-label text-slate-500">
              Reason *
            </label>
            <select
              value={category}
              onChange={(e) => onCategory(e.target.value)}
              className="mt-1 w-full h-11 rounded-lg border border-slate-200 px-3 text-sm bg-white"
            >
              {REJECT_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-label text-slate-500">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => onNotes(e.target.value)}
              rows={3}
              placeholder="Specifics the service/detail team needs to fix..."
              className="mt-1 w-full rounded-lg border border-slate-200 p-3 text-sm focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
            />
          </div>
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-[11px] text-amber-900">
            Rejecting keeps the listing locked. The vehicle won't be publishable
            until prep runs again and a foreman signs off.
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="h-10 px-4 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100"
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
