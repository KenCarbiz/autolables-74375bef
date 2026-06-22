import { supabase } from "@/integrations/supabase/client";

export type VehicleCondition = "new" | "used" | "cpo" | "demo" | "factory_cpo" | "loaner" | "ev" | string | null | undefined;

export type SelfAwareVehicle = {
  id?: string | null;
  tenant_id?: string | null;
  store_id?: string | null;
  vin?: string | null;
  stock_number?: string | null;
  stock?: string | null;
  ymm?: string | null;
  year?: string | number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  condition?: VehicleCondition;
  mileage?: string | number | null;
  price?: string | number | null;
  fuel_type?: string | null;
  title_status?: string | null;
  cpo_status?: string | null;
  is_demo?: boolean | null;
};

export type DealerAutomationSettings = {
  auto_create_work_from_scraper?: boolean;
  auto_create_print_tasks?: boolean;
  auto_send_used_to_get_ready?: boolean;
  auto_send_new_to_get_ready?: boolean;
  auto_check_standard_prep?: boolean;
  require_manager_approval_before_print?: boolean;
  require_manager_approval_before_passport_publish?: boolean;
  enable_cpo_detection?: boolean;
  enable_demo_detection?: boolean;
  enable_ev_detection?: boolean;
};

export type WorkItemDraft = {
  work_type: string;
  title: string;
  description: string;
  department: "inventory" | "sales" | "service" | "detail" | "compliance" | "manager" | "finance" | "third_party" | "passport" | "print";
  priority?: "low" | "normal" | "high" | "urgent";
  metadata?: Record<string, unknown>;
};

const conditionText = (vehicle: SelfAwareVehicle) => `${vehicle.condition || ""} ${vehicle.cpo_status || ""} ${vehicle.title_status || ""}`.toLowerCase();
const vehicleName = (vehicle: SelfAwareVehicle) => vehicle.ymm || [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ") || vehicle.vin || "Vehicle";
const stock = (vehicle: SelfAwareVehicle) => vehicle.stock_number || vehicle.stock || vehicle.vin?.slice(-6) || null;

export const classifyVehicle = (vehicle: SelfAwareVehicle, settings: DealerAutomationSettings = {}) => {
  const text = conditionText(vehicle);
  const fuel = `${vehicle.fuel_type || ""}`.toLowerCase();
  const title = `${vehicle.title_status || ""}`.toLowerCase();
  const condition = `${vehicle.condition || ""}`.toLowerCase();

  const isCpo = settings.enable_cpo_detection !== false && (condition === "cpo" || text.includes("cpo") || text.includes("certified"));
  const isFactoryCpo = isCpo && (text.includes("factory") || text.includes("manufacturer"));
  const isDemo = settings.enable_demo_detection !== false && (!!vehicle.is_demo || condition === "demo" || text.includes("demo") || text.includes("loaner") || text.includes("program"));
  const isEv = settings.enable_ev_detection !== false && (condition === "ev" || fuel.includes("electric") || fuel.includes("ev") || text.includes("electric"));
  const isNew = condition === "new" && !isDemo;
  const isUsed = !isNew || condition === "used" || isCpo || isDemo || title.includes("used");

  return {
    kind: isFactoryCpo ? "factory_cpo" : isCpo ? "cpo" : isDemo ? "demo" : isNew ? "new" : isEv ? "ev" : "used",
    isNew,
    isUsed,
    isCpo,
    isFactoryCpo,
    isDemo,
    isEv,
  };
};

export const buildSelfAwareWorkItems = (vehicle: SelfAwareVehicle, settings: DealerAutomationSettings = {}): WorkItemDraft[] => {
  if (settings.auto_create_work_from_scraper === false) return [];

  const classified = classifyVehicle(vehicle, settings);
  const name = vehicleName(vehicle);
  const printApproval = settings.require_manager_approval_before_print ? "Manager approval required before print." : "Ready for approve-and-print or modify-and-print.";
  const drafts: WorkItemDraft[] = [];

  drafts.push({
    work_type: "vehicle_review",
    title: `Review new inventory: ${name}`,
    description: "Confirm VIN, stock number, condition, price, mileage, and required retail documents.",
    department: "inventory",
    priority: "normal",
    metadata: { classification: classified },
  });

  if (settings.auto_create_print_tasks !== false) {
    if (classified.isNew) {
      drafts.push({
        work_type: "print_new_vehicle_sticker",
        title: `New vehicle sticker needed: ${name}`,
        description: `System detected a new vehicle. Generate the correct new-vehicle sticker/addendum. ${printApproval}`,
        department: "print",
        priority: "high",
        metadata: { sticker_family: "new", approval_required: !!settings.require_manager_approval_before_print },
      });
    } else {
      drafts.push({
        work_type: "print_used_vehicle_sticker",
        title: `Used vehicle sticker needed: ${name}`,
        description: `System detected a used/CPO/demo-style vehicle. Generate the correct used-vehicle sticker. ${printApproval}`,
        department: "print",
        priority: "high",
        metadata: { sticker_family: "used", approval_required: !!settings.require_manager_approval_before_print },
      });
      drafts.push({
        work_type: "buyers_guide_required",
        title: `Buyers Guide required: ${name}`,
        description: "Used-vehicle compliance workflow should prepare and verify the FTC Buyers Guide before customer presentation.",
        department: "compliance",
        priority: "urgent",
        metadata: { compliance: "ftc_buyers_guide" },
      });
    }

    if (classified.isCpo) {
      drafts.push({
        work_type: "cpo_packet_required",
        title: `CPO packet needed: ${name}`,
        description: "Create CPO information sheet and verify warranty/certification language before Passport display.",
        department: "compliance",
        priority: "high",
        metadata: { cpo: true, factory_cpo: classified.isFactoryCpo },
      });
    }

    if (classified.isDemo) {
      drafts.push({
        work_type: "demo_disclosure_review",
        title: `Demo/loaner disclosure review: ${name}`,
        description: "Review mileage, prior-use status, warranty language, and required used/demo disclosures before printing or publishing.",
        department: "manager",
        priority: "high",
        metadata: { demo: true },
      });
    }

    if (classified.isEv) {
      drafts.push({
        work_type: "ev_disclosure_review",
        title: `EV disclosure review: ${name}`,
        description: "Review EV-specific customer information, charging notes, battery/health language, and Passport display settings.",
        department: "compliance",
        priority: "normal",
        metadata: { ev: true },
      });
    }
  }

  if ((classified.isUsed && settings.auto_send_used_to_get_ready) || (classified.isNew && settings.auto_send_new_to_get_ready)) {
    drafts.push({
      work_type: "get_ready_required",
      title: `Get-ready started: ${name}`,
      description: settings.auto_check_standard_prep !== false
        ? "Standard prep template auto-applied. Staff can add or subtract service, detail, and third-party items before sending or completing."
        : "Get-ready task created. Staff should select required service, detail, and third-party items.",
      department: "service",
      priority: classified.isUsed ? "high" : "normal",
      metadata: { auto_standard_prep: settings.auto_check_standard_prep !== false, classification: classified },
    });
  }

  drafts.push({
    work_type: "passport_draft",
    title: `Passport draft needed: ${name}`,
    description: settings.require_manager_approval_before_passport_publish !== false
      ? "Prepare customer Passport and route service/recon proof through manager approval before publishing."
      : "Prepare customer Passport with dealer-approved proof modules."
    ,
    department: "passport",
    priority: "normal",
    metadata: { approval_required: settings.require_manager_approval_before_passport_publish !== false },
  });

  drafts.push({
    work_type: "price_truth_check",
    title: `Price truth check: ${name}`,
    description: "Archive advertised price and compare it to quote/payment worksheet before delivery or add-on presentation.",
    department: "manager",
    priority: "normal",
    metadata: { price: vehicle.price ?? null },
  });

  return drafts;
};

export const createSelfAwareWorkItems = async (vehicle: SelfAwareVehicle, settings: DealerAutomationSettings = {}) => {
  const drafts = buildSelfAwareWorkItems(vehicle, settings);
  if (!drafts.length) return { created: 0 };

  const base = {
    tenant_id: vehicle.tenant_id || null,
    store_id: vehicle.store_id || vehicle.tenant_id || null,
    vehicle_id: vehicle.id || null,
    vin: vehicle.vin || null,
    stock: stock(vehicle),
    vehicle_title: vehicleName(vehicle),
    condition: classifyVehicle(vehicle, settings).kind,
    source: "automation",
  };

  let created = 0;
  for (const draft of drafts) {
    const { data: existing } = await (supabase as any)
      .from("dealer_work_items")
      .select("id")
      .eq("vehicle_id", vehicle.id || "")
      .eq("work_type", draft.work_type)
      .neq("status", "cancelled")
      .maybeSingle();

    if (existing?.id) continue;

    const { error } = await (supabase as any)
      .from("dealer_work_items")
      .insert({ ...base, ...draft, status: draft.metadata?.approval_required ? "needs_approval" : "open" });

    if (!error) created += 1;
  }

  return { created };
};
