import { useMemo, useState } from "react";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useInstantSave } from "@/hooks/useInstantSave";
import { PACKET_MODULES } from "@/lib/packetModules";
import { PackageOpen } from "lucide-react";

// Store-wide customer packet template: which passport modules new scans show
// by default. Per-vehicle overrides live on the Vehicle File's Shopper
// Passport Builder and always win over this template.
const PacketDefaultsPanel = () => {
  const { settings, updateSettings, loading } = useDealerSettings();
  const [defaults, setDefaults] = useState<Record<string, boolean>>(settings.packet_module_defaults || {});
  const [historyLinks, setHistoryLinks] = useState<boolean>(settings.history_report_links_enabled !== false);

  const draft = useMemo(
    () => ({ packet_module_defaults: defaults, history_report_links_enabled: historyLinks }),
    [defaults, historyLinks],
  );
  useInstantSave(draft, (v) => updateSettings(v), { ready: !loading, toastId: "packet-defaults" });

  const isOn = (id: string) => defaults[id] !== false;
  const toggle = (id: string) => setDefaults((d) => ({ ...d, [id]: d[id] === false }));
  const offCount = PACKET_MODULES.filter((m) => !isOn(m.id)).length;

  return (
    <div id="packet-defaults" className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><PackageOpen className="w-[18px] h-[18px] text-blue-600" /></span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-foreground">Customer Packet Defaults</h3>
          <p className="text-[12.5px] text-slate-500 mt-0.5">
            The store-wide template for what shoppers see on every vehicle passport. Individual vehicles can
            override any module from their Vehicle File. Recall, price, and verified installs always show.
            Changes save automatically.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
        {PACKET_MODULES.map((m) => {
          const on = isOn(m.id);
          return (
            <button
              key={m.id}
              onClick={() => toggle(m.id)}
              aria-pressed={on}
              className={`flex items-center justify-between gap-3 text-left rounded-xl border px-3.5 py-2.5 transition ${on ? "border-border bg-background hover:border-blue-300" : "border-border bg-muted/40 opacity-80 hover:opacity-100"}`}
            >
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-foreground truncate">{m.label}</span>
                <span className="block text-[11.5px] text-slate-500 truncate">{m.desc}</span>
              </span>
              <span className={`shrink-0 inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11px] font-bold ${on ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-500 border border-slate-200"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-slate-400"}`} /> {on ? "On" : "Off"}
              </span>
            </button>
          );
        })}
      </div>
      {offCount > 0 && (
        <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
          {offCount} module{offCount === 1 ? "" : "s"} hidden by default across the store. Vehicles with their own
          override are not affected.
        </p>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-border pt-3.5 mt-4">
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-foreground">CARFAX / AutoCheck report links</p>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Store-wide kill switch for your dealer-paid history report links (harvested nightly from your own
            website). Turn OFF if your subscription lapses so shoppers never land on a paywall. Overrides the
            module toggle above.
          </p>
        </div>
        <label className="flex items-center gap-2 shrink-0 cursor-pointer select-none">
          <input type="checkbox" checked={historyLinks} onChange={(e) => setHistoryLinks(e.target.checked)} className="w-4 h-4 accent-blue-600" />
          <span className="text-[13px] font-semibold">{historyLinks ? "Enabled" : "Off"}</span>
        </label>
      </div>
    </div>
  );
};

export default PacketDefaultsPanel;
