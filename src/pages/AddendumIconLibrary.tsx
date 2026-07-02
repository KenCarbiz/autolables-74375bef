import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, Download } from "lucide-react";
import AddendumIcon from "@/components/addendum-icons/AddendumIcon";
import { ADDENDUM_ICON_DEFS, ADDENDUM_ICON_METADATA } from "@/components/addendum-icons/iconMetadata";
import { searchAddendumIcons } from "@/components/addendum-icons/iconRegistry";
import { CATEGORY_LABEL, type AddendumIconCategory, type AddendumIconStatus } from "@/components/addendum-icons/iconTypes";
import { ADDENDUM_ICON_COLORS, type AddendumIconColor } from "@/components/addendum-icons/colorTokens";

// /admin/design-system/addendum-icons — the review surface for the icon
// library. Every icon renders in the four operating colors so the set is
// judged inside the real app, not from generated contact sheets. Status
// badges make placeholder / custom_required gaps visible at a glance.

const VARIANTS: AddendumIconColor[] = ["blue", "green", "purple", "orange"];

const STATUS_STYLE: Record<AddendumIconStatus, string> = {
  ready: "bg-emerald-50 text-emerald-700 border-emerald-200",
  placeholder: "bg-slate-100 text-slate-500 border-slate-200",
  custom_required: "bg-amber-50 text-amber-700 border-amber-200",
};

const STATUS_LABEL: Record<AddendumIconStatus, string> = {
  ready: "Ready",
  placeholder: "Placeholder",
  custom_required: "Custom required",
};

const AddendumIconLibrary = () => {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AddendumIconCategory | "all">("all");
  const [status, setStatus] = useState<AddendumIconStatus | "all">("all");

  const icons = useMemo(() => {
    let list = searchAddendumIcons(query);
    if (category !== "all") list = list.filter((i) => i.category === category);
    if (status !== "all") list = list.filter((i) => i.status === status);
    return list;
  }, [query, category, status]);

  const counts = useMemo(() => ({
    total: ADDENDUM_ICON_DEFS.length,
    ready: ADDENDUM_ICON_DEFS.filter((i) => i.status === "ready").length,
    custom: ADDENDUM_ICON_DEFS.filter((i) => i.status === "custom_required").length,
  }), []);

  const copyId = (id: string) => {
    navigator.clipboard?.writeText(id).then(
      () => toast.success(`${id} copied`),
      () => toast.error("Couldn't copy"),
    );
  };

  const exportManifest = () => {
    const blob = new Blob([JSON.stringify(ADDENDUM_ICON_METADATA, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "addendum-icon-manifest.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#0F172A] px-4 sm:px-6 py-6">
      <div className="mx-auto max-w-[1200px]">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight">Addendum Icon Library</h1>
            <p className="text-[13px] text-[#64748B] mt-1">
              {counts.total} icons · {counts.ready} ready · {counts.custom} awaiting custom artwork. One SVG per icon, currentColor, locked tokens.
            </p>
          </div>
          <button onClick={exportManifest} className="shrink-0 inline-flex items-center gap-1.5 h-10 px-4 rounded-xl border border-[#E6E8EC] bg-white text-sm font-semibold hover:border-[#2563EB]">
            <Download className="w-4 h-4" /> Export manifest
          </button>
        </div>

        <div className="mt-5 flex flex-col sm:flex-row gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by ID, name, or tag…"
            className="h-11 px-4 rounded-xl border border-[#E6E8EC] bg-white text-sm outline-none focus:border-[#2563EB] flex-1"
          />
          <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className="h-11 px-3 rounded-xl border border-[#E6E8EC] bg-white text-sm outline-none focus:border-[#2563EB]">
            <option value="all">All categories</option>
            {(Object.keys(CATEGORY_LABEL) as AddendumIconCategory[]).map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="h-11 px-3 rounded-xl border border-[#E6E8EC] bg-white text-sm outline-none focus:border-[#2563EB]">
            <option value="all">All statuses</option>
            <option value="ready">Ready</option>
            <option value="placeholder">Placeholder</option>
            <option value="custom_required">Custom required</option>
          </select>
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {icons.map((def) => (
            <div key={def.iconId} className="rounded-2xl bg-white border border-[#E6E8EC] p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[14px] font-bold leading-tight">{def.name}</p>
                    <span className={`text-[10px] font-bold rounded-full border px-2 py-0.5 ${STATUS_STYLE[def.status]}`}>{STATUS_LABEL[def.status]}</span>
                  </div>
                  <p className="text-[11px] text-[#94A3B8] mt-0.5">{def.iconId} · {CATEGORY_LABEL[def.category]} · {def.source}</p>
                </div>
                <button onClick={() => copyId(def.iconId)} aria-label={`Copy ${def.iconId}`} className="shrink-0 w-8 h-8 rounded-lg border border-[#E6E8EC] text-[#94A3B8] hover:text-[#2563EB] hover:border-[#2563EB] inline-flex items-center justify-center">
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="mt-3 flex items-center gap-3">
                {VARIANTS.map((color) => (
                  <span key={color} className="w-12 h-12 rounded-xl bg-[#F8FAFC] border border-[#F1F5F9] flex items-center justify-center" title={`${def.iconId} · ${color} ${ADDENDUM_ICON_COLORS[color]}`}>
                    <AddendumIcon iconId={def.iconId} color={color} size={24} />
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-[#64748B] mt-2.5 leading-snug">{def.recommendedUse}</p>
            </div>
          ))}
        </div>

        {icons.length === 0 && (
          <p className="text-center text-[13px] text-[#94A3B8] py-16">No icons match this search.</p>
        )}
      </div>
    </div>
  );
};

export default AddendumIconLibrary;
