import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/product";
import { buildEditPatch, editFormFromVehicle, CONDITIONS, type EditVehicleForm } from "./editVehicle";
import type { VehicleRow } from "./types";

const FIELD = "h-10 w-full rounded-[6px] border border-adm-border bg-adm-surface px-3 text-[14px] text-adm-ink focus:outline-none focus:ring-2 focus:ring-adm-primary";

export const EditVehicleSheet = ({ vehicle, open, onOpenChange, onSaved }: {
  vehicle: VehicleRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) => {
  const [form, setForm] = useState<EditVehicleForm>(() => editFormFromVehicle(vehicle));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setForm(editFormFromVehicle(vehicle)); setError(null); }
  }, [open, vehicle]);

  const set = (key: keyof EditVehicleForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    const built = buildEditPatch(vehicle, form);
    if (built.ok === false) { setError(built.error); return; }
    if (Object.keys(built.patch).length === 0) { onOpenChange(false); return; }
    setSaving(true);
    setError(null);
    const { error: err } = await (supabase as any).from("vehicle_listings").update(built.patch).eq("id", vehicle.id);
    setSaving(false);
    if (err) { setError(String(err.message || "Save failed")); return; }
    toast.success("Vehicle updated");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[420px] p-0 flex flex-col gap-0 bg-adm-surface">
        <SheetHeader className="px-5 py-4 border-b border-adm-border">
          <SheetTitle className="text-[18px] leading-[26px] font-semibold text-adm-ink">Edit vehicle</SheetTitle>
          <SheetDescription className="text-[14px] text-adm-muted">VIN {vehicle.vin}. Price changes go through price review.</SheetDescription>
        </SheetHeader>
        <form
          className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4"
          onSubmit={(e) => { e.preventDefault(); void save(); }}
        >
          <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-adm-ink">
            Year, make and model
            <input className={FIELD} value={form.ymm} onChange={set("ymm")} />
          </label>
          <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-adm-ink">
            Trim
            <input className={FIELD} value={form.trim} onChange={set("trim")} />
          </label>
          <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-adm-ink">
            Mileage
            <input className={FIELD} inputMode="numeric" value={form.mileage} onChange={set("mileage")} />
          </label>
          <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-adm-ink">
            Condition
            <select className={FIELD} value={form.condition} onChange={set("condition")}>
              <option value="">Unknown</option>
              {CONDITIONS.map((c) => <option key={c} value={c}>{c === "cpo" ? "Certified pre-owned" : c[0].toUpperCase() + c.slice(1)}</option>)}
            </select>
          </label>
          {error && <p role="alert" className="text-[14px] text-adm-danger">{error}</p>}
        </form>
        <div className="px-5 py-3 border-t border-adm-border flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>{saving ? "Saving" : "Save changes"}</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default EditVehicleSheet;
