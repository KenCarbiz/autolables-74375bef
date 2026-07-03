import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { ArrowRight, CheckCircle2, Printer, Globe } from "lucide-react";

// Chains the used-car-manager loop across the lifecycle screens. Reads the
// same station joins the Ready Board aggregates, then tells each screen what
// just finished and where those vehicles go next:
//   /recon  estimate approved            -> Prep & Install (/prep)
//   /prep   sign-off + install proof     -> Service Desk (/service)
//   /service K-208 signed + title filed  -> Ready Board (/ready-board)
//   /ready-board vehicle fully ready     -> print sticker + publish (/inventory)

export type LifecycleStage = "recon" | "prep" | "service" | "ready-board";

interface VehicleRow { id: string; vin: string; ymm: string | null; condition: string | null; }

const isUsed = (c: string | null) => ["used", "cpo", "certified"].includes(String(c || "used").toLowerCase());

export default function NextStepBanner({ stage }: { stage: LifecycleStage }) {
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [prepDone, setPrepDone] = useState<Set<string>>(new Set());
  const [k208Done, setK208Done] = useState<Set<string>>(new Set());
  const [titleDone, setTitleDone] = useState<Set<string>>(new Set());
  const [reconApproved, setReconApproved] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const [list, ps, si, docs, re] = await Promise.all([
      (supabase as any).from("vehicle_listings").select("id, vin, ymm, condition").eq("tenant_id", tenantId).limit(500),
      (supabase as any).from("prep_sign_offs").select("vin").eq("tenant_id", tenantId).eq("listing_unlocked", true),
      (supabase as any).from("safety_inspections").select("vin").eq("tenant_id", tenantId).eq("status", "signed"),
      (supabase as any).from("vehicle_documents").select("vin").eq("tenant_id", tenantId).in("doc_type", ["title_front", "mco_front"]),
      (supabase as any).from("recon_estimates").select("vin").eq("tenant_id", tenantId).in("status", ["approved", "partially_approved"]),
    ]);
    setVehicles((list.data as VehicleRow[]) || []);
    setPrepDone(new Set(((ps.data as { vin: string }[]) || []).map((r) => r.vin)));
    setK208Done(new Set(((si.data as { vin: string }[]) || []).map((r) => r.vin)));
    setTitleDone(new Set(((docs.data as { vin: string }[]) || []).map((r) => r.vin)));
    setReconApproved(new Set(((re.data as { vin: string }[]) || []).map((r) => r.vin)));
    setLoaded(true);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const banner = useMemo(() => {
    if (!loaded) return null;
    const byVin = new Map(vehicles.map((v) => [v.vin, v]));
    const serviceDone = (vin: string) => {
      const v = byVin.get(vin);
      return titleDone.has(vin) && (!v || !isUsed(v.condition) || k208Done.has(vin));
    };

    if (stage === "recon") {
      const vins = [...reconApproved].filter((vin) => !prepDone.has(vin));
      if (vins.length === 0) return null;
      return {
        message: `Recon approved on ${vins.length} vehicle${vins.length === 1 ? "" : "s"} — next stop is Prep & Install.`,
        actions: [{ label: "Next: Prep & Install", onClick: () => navigate("/prep") }],
      };
    }

    if (stage === "prep") {
      const vins = [...prepDone].filter((vin) => !serviceDone(vin));
      if (vins.length === 0) return null;
      return {
        message: `${vins.length} vehicle${vins.length === 1 ? "" : "s"} cleared prep and install proof — next is the Service Desk for the K-208 and title.`,
        actions: [{ label: "Next: Service Desk", onClick: () => navigate("/service") }],
      };
    }

    if (stage === "service") {
      const vins = vehicles.filter((v) => serviceDone(v.vin)).map((v) => v.vin);
      if (vins.length === 0) return null;
      return {
        message: `${vins.length} vehicle${vins.length === 1 ? "" : "s"} have the K-208 and title on file — review them on the Ready Board.`,
        actions: [{ label: "Next: Ready Board", onClick: () => navigate("/ready-board") }],
      };
    }

    const readyVehicles = vehicles.filter((v) =>
      prepDone.has(v.vin) && (!isUsed(v.condition) || k208Done.has(v.vin)),
    );
    if (readyVehicles.length === 0) return null;
    const first = readyVehicles[0];
    return {
      message: `${readyVehicles.length} vehicle${readyVehicles.length === 1 ? "" : "s"} ready for the lot — print the window sticker and publish.`,
      actions: [
        {
          label: "Print sticker",
          icon: Printer,
          onClick: () => navigate(`${isUsed(first.condition) ? "/used-car-sticker" : "/new-car-sticker"}?vehicleId=${first.id}`),
        },
        { label: "Publish from Inventory", icon: Globe, onClick: () => navigate("/inventory") },
      ],
    };
  }, [loaded, stage, vehicles, prepDone, k208Done, titleDone, reconApproved, navigate]);

  if (!tenantId || !banner) return null;

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2.5 min-w-0">
        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
        <span className="text-[13px] text-emerald-800 font-medium">{banner.message}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {banner.actions.map((a: { label: string; icon?: typeof Printer; onClick: () => void }) => (
          <button
            key={a.label}
            onClick={a.onClick}
            className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            {a.icon ? <a.icon className="w-3.5 h-3.5" /> : null}
            {a.label}
            {!a.icon && <ArrowRight className="w-3.5 h-3.5" />}
          </button>
        ))}
      </div>
    </div>
  );
}
