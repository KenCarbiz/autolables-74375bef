import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2, Layers } from "lucide-react";
import { useWindowSticker, type TemplateOptions } from "@/hooks/useWindowSticker";

// Manual OEM template selection.
//
// The engine picks the template; this control only lets an authorized
// user override it, and only among templates compatible with the
// vehicle's canonical make — its own brand, or the neutral AutoLabels
// design. Another manufacturer's template is never offered, and the
// server refuses it independently even if it were.

interface Props {
  tenantId: string;
  vehicleId: string;
  canEdit: boolean;
  onChanged?: () => void;
}

export default function TemplateOverrideControl({ tenantId, vehicleId, canEdit, onChanged }: Props) {
  const { templateOptions, setTemplate, busy } = useWindowSticker();
  const [state, setState] = useState<TemplateOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<string>("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await templateOptions(tenantId, vehicleId);
      setState(res);
      setChoice(res.current_override?.template_key || res.automatic_template_key || "");
      setError(null);
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  }, [tenantId, vehicleId, templateOptions]);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <p className="text-[11.5px] text-rose-600 inline-flex items-start gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> Couldn't load template options: {error}
      </p>
    );
  }
  if (!state) return <div className="h-10 bg-muted rounded animate-pulse" />;

  const current = state.current_override?.template_key || state.automatic_template_key;
  const dirty = choice !== current;
  const reasonRequired = dirty;

  const apply = async () => {
    if (!choice) return;
    try {
      const res = await setTemplate(tenantId, vehicleId, choice, reason.trim());
      toast.success(res.cleared
        ? "Template returned to automatic selection. Regenerate to apply it as a new version."
        : "Template override saved. Regenerate to apply it as a new version.");
      setReason("");
      await load();
      onChanged?.();
    } catch (e) {
      const detail = String((e as Error).message || e);
      toast.error(/incompatible_template/i.test(detail)
        ? "That template belongs to a different manufacturer and cannot be applied to this vehicle."
        : /insufficient_permission/i.test(detail)
          ? "Changing the template needs manager authority."
          : `Couldn't change the template: ${detail}`);
    }
  };

  return (
    <div className="rounded-xl border border-border p-3.5 space-y-2.5">
      <div className="flex items-center gap-2">
        <Layers className="w-4 h-4 text-blue-600" />
        <h4 className="text-[13px] font-bold text-foreground">OEM template</h4>
        {state.canonical_make && (
          <span className="text-[11px] text-muted-foreground">canonical make: {state.canonical_make}</span>
        )}
      </div>

      <div className="space-y-1.5">
        {state.options.map((o) => (
          <label
            key={o.templateKey}
            className={`flex items-start gap-2 rounded-lg border p-2.5 ${
              choice === o.templateKey ? "border-blue-600 bg-blue-50/40" : "border-border"
            } ${canEdit ? "cursor-pointer" : "opacity-70"}`}
          >
            <input
              type="radio"
              name={`template-${vehicleId}`}
              className="mt-0.5"
              checked={choice === o.templateKey}
              disabled={!canEdit}
              onChange={() => setChoice(o.templateKey)}
            />
            <span className="min-w-0">
              <span className="block text-[12.5px] font-semibold text-foreground">
                {o.label}
                {o.isAutomatic && (
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                    Automatic
                  </span>
                )}
                {o.templateKey === current && (
                  <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-blue-700">
                    <Check className="w-3 h-3" /> In use
                  </span>
                )}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {o.layoutFamily} · {o.themeVersion}
                {o.neutral ? " · no manufacturer identity" : ""}
              </span>
            </span>
          </label>
        ))}
      </div>

      {state.current_override && (
        <p className="text-[11px] text-amber-700">
          Overridden: {state.current_override.reason}
        </p>
      )}

      {canEdit && dirty && (
        <>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this template applies to this vehicle (required)"
            className="w-full h-9 px-3 rounded-md border border-border bg-background text-[12.5px]"
            aria-label="Reason for the template change"
          />
          <button
            type="button"
            onClick={apply}
            disabled={busy || (reasonRequired && !reason.trim())}
            className="h-8 px-3 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Save template choice
          </button>
        </>
      )}
      <p className="text-[11px] text-muted-foreground">
        Only this vehicle's own brand and the neutral AutoLabels design are offered. Saving records the change;
        the sticker adopts it on the next regeneration as a new version.
      </p>
    </div>
  );
}
