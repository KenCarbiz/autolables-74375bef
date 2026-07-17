import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";

import { Copy, Check, Code, ShieldX } from "lucide-react";
import { toast } from "sonner";

// Website Integration — dealer-facing generator for the /embed.js widget.
// The dealer chooses VIN-detection method + button styling, sees a live
// preview (the real embed script loaded into a mock VDP card), and copies
// the ready-to-paste snippet for their VDP template. Only /v/ passports are
// ever surfaced — nothing internal is exposed via the script.

type DetectMode = "template" | "selector" | "auto";
type Position = "right" | "left";

const APP_ORIGIN = typeof window !== "undefined" ? window.location.origin : "https://autolabels.io";
const SAMPLE_VIN = "1N4BL4BV1RN360195"; // any real VIN in the demo tenant works

const WebsiteEmbed = () => {
  const { tenant } = useTenant();
  const { isAdmin } = useAuth();
  const [role] = useState<string | null>(null);
  const canManage = isAdmin || hasDealerCapability(role, "can_manage_settings", isAdmin);

  const [mode, setMode] = useState<DetectMode>("template");
  const [selector, setSelector] = useState<string>(".vdp-vin");
  const [label, setLabel] = useState<string>("View Vehicle Passport");
  const [position, setPosition] = useState<Position>("right");
  const [accent, setAccent] = useState<string>("#2563EB");
  const [copied, setCopied] = useState<boolean>(false);

  const tenantId = tenant?.id || "";

  const snippet = useMemo(() => {
    const attrs = [
      `src="${APP_ORIGIN}/embed.js"`,
      tenantId ? `data-autolabels-tenant="${tenantId}"` : null,
      mode === "template" ? `data-autolabels-vin="{{VIN}}"` : null,
      mode === "selector" ? `data-vin-selector="${selector}"` : null,
      label && label !== "View Vehicle Passport" ? `data-label="${label}"` : null,
      position !== "right" ? `data-position="${position}"` : null,
      accent && accent.toUpperCase() !== "#2563EB" ? `data-accent="${accent}"` : null,
      "async",
    ].filter(Boolean).join("\n        ");
    return `<script ${attrs}></script>`;
  }, [tenantId, mode, selector, label, position, accent]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      toast.success("Snippet copied");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Copy failed — select the code and copy manually");
    }
  };

  if (!canManage) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <ShieldX className="w-10 h-10 text-slate-400 mx-auto mb-3" />
        <h1 className="text-lg font-bold">Admin access required</h1>
        <p className="text-sm text-slate-500 mt-1">Only settings managers can configure the website widget.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Website Integration</h1>
          <p className="text-sm text-slate-500 mt-1">Add a "Vehicle Passport" slide-out to your VDP with one script tag.</p>
        </div>
        <Link to="/admin" className="text-sm text-slate-500 hover:text-slate-900">← Admin</Link>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Config */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-5">
          <h2 className="text-sm font-semibold text-slate-900">Configuration</h2>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">VIN detection</label>
            <div className="space-y-2">
              {([
                ["template", "Template token", "Best. Paste {{VIN}} into the snippet where your VDP renders the vehicle's VIN."],
                ["selector", "CSS selector", "Point at an element whose text or data-vin holds the VIN."],
                ["auto", "Auto-detect", "JSON-LD, meta itemprop, or a 17-char VIN in the URL. Use as a last resort."],
              ] as [DetectMode, string, string][]).map(([m, title, hint]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition ${mode === m ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300"}`}
                >
                  <div className="text-sm font-semibold text-slate-900">{title}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{hint}</div>
                </button>
              ))}
            </div>
          </div>

          {mode === "selector" && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">CSS selector</label>
              <input value={selector} onChange={(e) => setSelector(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-slate-200 text-sm" placeholder=".vdp-vin" />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Button label</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-slate-200 text-sm" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Position</label>
              <select value={position} onChange={(e) => setPosition(e.target.value as Position)} className="w-full h-9 px-3 rounded-lg border border-slate-200 text-sm">
                <option value="right">Bottom right</option>
                <option value="left">Bottom left</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Accent color</label>
              <div className="flex items-center gap-2">
                <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="h-9 w-12 rounded border border-slate-200 cursor-pointer" />
                <input value={accent} onChange={(e) => setAccent(e.target.value)} className="flex-1 h-9 px-3 rounded-lg border border-slate-200 text-sm font-mono uppercase" />
              </div>
            </div>
          </div>
        </section>

        {/* Preview */}
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Live preview</h2>
          <p className="text-xs text-slate-500">A mock VDP card with your live widget. Click the launcher.</p>
          <EmbedPreview vin={SAMPLE_VIN} tenant={tenantId} label={label} position={position} accent={accent} />
        </section>
      </div>

      {/* Snippet */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Code className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-900">Install snippet</h2>
          </div>
          <button onClick={copy} className="inline-flex items-center gap-2 h-8 px-3 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800">
            {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
          </button>
        </div>
        <pre className="rounded-lg bg-slate-950 text-slate-100 text-xs font-mono p-4 overflow-x-auto whitespace-pre-wrap">{snippet}</pre>
        <div className="text-xs text-slate-600 space-y-1.5">
          <p><strong>Where to paste:</strong> your VDP template, just before <code className="text-slate-800 bg-slate-100 px-1 rounded">&lt;/body&gt;</code>.</p>
          {mode === "template" && (
            <p><strong>Template token:</strong> replace <code className="text-slate-800 bg-slate-100 px-1 rounded">{"{{VIN}}"}</code> with your VDP's VIN merge tag (e.g. <code className="text-slate-800 bg-slate-100 px-1 rounded">[[vehicle.vin]]</code>).</p>
          )}
          <p>The widget is async, lazy-loads the passport iframe on first open, and only surfaces the public <code className="text-slate-800 bg-slate-100 px-1 rounded">/v/&lt;VIN&gt;</code> passport — no internal data is exposed.</p>
        </div>
      </section>
    </div>
  );
};

// Live in-page preview: a mock VDP card with an iframe pointed at the sample
// VIN's passport in ?embed=1 mode. Reflects the dealer's chosen position,
// accent, and label choices. We reload the iframe when the launcher is
// pressed so shoppers see the freshest data.
const EmbedPreview = ({ vin, tenant, label, position, accent }: { vin: string; tenant: string; label: string; position: Position; accent: string }) => {
  const [open, setOpen] = useState(false);
  const src = `${APP_ORIGIN}/v/${vin}?embed=1${tenant ? `&t=${tenant}` : ""}&preview=1`;
  return (
    <div className="relative rounded-xl border border-slate-200 bg-white overflow-hidden" style={{ height: 420 }}>
      {/* Mock VDP */}
      <div className="p-4 space-y-3">
        <div className="h-32 rounded-lg bg-gradient-to-br from-slate-200 to-slate-300" />
        <div className="h-4 w-2/3 rounded bg-slate-200" />
        <div className="h-4 w-1/2 rounded bg-slate-200" />
        <div className="h-4 w-3/4 rounded bg-slate-200" />
        <div className="text-[10px] text-slate-400 mt-1">VIN {vin}</div>
      </div>

      {/* Launcher */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute bottom-3 rounded-full text-white text-xs font-semibold px-3.5 py-2 shadow-lg inline-flex items-center gap-1.5"
        style={{ background: accent, [position]: 12 } as React.CSSProperties}
      >
        <span>{label}</span>
      </button>

      {/* Drawer */}
      {open && (
        <>
          <div onClick={() => setOpen(false)} className="absolute inset-0 bg-slate-900/50 z-10" />
          <div className={`absolute top-0 ${position === "right" ? "right-0" : "left-0"} bottom-0 z-20 w-[300px] bg-slate-50 shadow-2xl flex flex-col`}>
            <div className="flex items-center justify-between px-3 py-2 bg-slate-900 text-white text-xs font-semibold">
              <span>Vehicle Passport · {vin.slice(-6)}</span>
              <button onClick={() => setOpen(false)} className="w-6 h-6 rounded hover:bg-white/10">×</button>
            </div>
            <iframe title="Passport preview" src={src} className="flex-1 w-full border-0 bg-slate-50" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
          </div>
        </>
      )}
    </div>
  );
};

export default WebsiteEmbed;
