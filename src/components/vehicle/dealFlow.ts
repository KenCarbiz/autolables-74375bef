import {
  ClipboardCheck, FolderCheck, Signature, Sparkles, Wrench,
} from "lucide-react";
import { dealDocStatus, type DealRecord } from "@/hooks/useDealRecord";

// ──────────────────────────────────────────────────────────────
// The deal derived once, for the two panels that show it.
//
// The Documents tab owns producing the official forms; the Customer tab owns
// the stage rail, processing and delivery. Both answer to the same derived
// state, so the badge on one tab can never disagree with the document cards on
// the other.
// ──────────────────────────────────────────────────────────────

export const fmtDealDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";

export type StageState = "complete" | "active" | "upcoming";

export interface StageDef {
  key: string;
  label: string;
  sub: string;
  icon: typeof Sparkles;
  tone: "blue" | "amber" | "emerald" | "slate" | "violet";
}

export const STAGES: StageDef[] = [
  { key: "created", label: "Vehicle file created", sub: "Documents auto-drafted", icon: Sparkles, tone: "blue" },
  { key: "approval", label: "Manager approval", sub: "Accept the addendum", icon: ClipboardCheck, tone: "amber" },
  { key: "dept", label: "Department work", sub: "Get-Ready + K-208", icon: Wrench, tone: "emerald" },
  { key: "package", label: "Deal package", sub: "Assemble + process", icon: FolderCheck, tone: "slate" },
  { key: "delivery", label: "Customer delivery", sub: "Signed on delivery", icon: Signature, tone: "violet" },
];

export const TONE_ACTIVE: Record<StageDef["tone"], string> = {
  blue: "bg-blue-600 text-white ring-blue-200",
  amber: "bg-amber-500 text-white ring-amber-200",
  emerald: "bg-emerald-600 text-white ring-emerald-200",
  slate: "bg-slate-700 text-white ring-slate-200",
  violet: "bg-violet-600 text-white ring-violet-200",
};

// The whole flow reduced to one derived object: which stage is live, whether
// each stage is done, and the single next action the dealer should take.
export interface FlowState {
  approved: boolean;
  deptDone: boolean;
  packageReady: boolean;
  processed: boolean;
  delivered: boolean;
  stageStates: Record<string, StageState>;
  activeStage: string;
  badge: { label: string; cls: string };
}

export function deriveFlow(record: DealRecord, s: ReturnType<typeof dealDocStatus>): FlowState {
  const approved = !!record.addendum?.acceptedAt;
  const deptDone = s.getReady && (record.isUsed ? s.k208 : true);
  const packageReady = s.complete;
  const processed = !!record.processedAt;
  const delivered = !!record.addendum?.signed;

  const stageStates: Record<string, StageState> = {
    created: "complete",
    approval: approved ? "complete" : "active",
    dept: !approved ? "upcoming" : deptDone ? "complete" : "active",
    package: !deptDone ? "upcoming" : processed ? "complete" : "active",
    delivery: !processed ? "upcoming" : delivered ? "complete" : "active",
  };
  const activeStage = STAGES.find((st) => stageStates[st.key] === "active")?.key ?? "delivery";

  let badge: FlowState["badge"];
  if (delivered) badge = { label: "Complete", cls: "bg-emerald-100 text-emerald-700" };
  else if (processed) badge = { label: "Ready for customer", cls: "bg-violet-100 text-violet-700" };
  else if (packageReady) badge = { label: "Ready to process", cls: "bg-slate-200 text-slate-700" };
  else if (approved && !deptDone) badge = { label: "Get-Ready in progress", cls: "bg-emerald-100 text-emerald-700" };
  else badge = { label: "Needs review", cls: "bg-amber-100 text-amber-700" };

  return { approved, deptDone, packageReady, processed, delivered, stageStates, activeStage, badge };
}

export type DealCtaKind = "navigate" | "fillForms" | "certifyK208" | "process";

export interface DealCta {
  kind: DealCtaKind;
  label: string;
  to?: string;
}

export interface NextDealAction {
  title: string;
  owner: string;
  why: string;
  // True while the blocker is a document the Documents tab produces, so that
  // tab can offer the step inline instead of only naming it.
  documentStep: boolean;
  cta?: DealCta;
}

export interface DealActionContext {
  vehicleId: string;
  vin: string;
  canProcess: boolean;
}

export function nextDealAction(
  record: DealRecord,
  flow: FlowState,
  ctx: DealActionContext,
): NextDealAction {
  const s = dealDocStatus(record);
  if (!flow.approved) {
    return {
      title: "The addendum needs manager approval.",
      owner: "Used-car manager",
      why: "Accepting the addendum sends the Get-Ready plan to the departments.",
      documentStep: true,
      cta: record.addendum
        ? { kind: "navigate", label: "Review addendum", to: `/addendum?id=${record.addendum.id}` }
        : { kind: "navigate", label: "Open addendum", to: `/vehicle-file/${ctx.vehicleId}?tab=addendum` },
    };
  }
  if (record.isUsed && !s.k208) {
    return {
      title: "Service must sign the CT K-208.",
      owner: "Service department",
      why: "The state safety inspection must be completed and signed before delivery.",
      documentStep: true,
      cta: { kind: "navigate", label: "Open K-208", to: `/k208/${ctx.vin}` },
    };
  }
  if (record.isUsed && record.k208 && !record.k208.certifiedAt) {
    return {
      title: "Certify the K-208 as the licensee.",
      owner: "Manager (licensee)",
      why: "The technician completed the inspection; an authorized manager must confirm the A/B/C result and sign the certification.",
      documentStep: true,
      cta: ctx.canProcess ? { kind: "certifyK208", label: "Certify K-208" } : undefined,
    };
  }
  if (!s.getReady) {
    return {
      title: "Get-Ready work is not complete.",
      owner: "Detail / install",
      why: "Recon, detail, and accessory installs need completion proof before the deal can be filed.",
      documentStep: false,
      cta: { kind: "navigate", label: "Open Prep & Install", to: `/vehicle-file/${ctx.vehicleId}?tab=prep` },
    };
  }
  if (record.isUsed && !s.buyersGuide) {
    return {
      title: "Confirm and publish the FTC Buyers Guide.",
      owner: "Used-car manager",
      why: "The correct As-Is / warranty box must be confirmed, then the official form filled for the deal jacket.",
      documentStep: true,
      cta: { kind: "fillForms", label: "Fill official forms" },
    };
  }
  if (!flow.processed) {
    return {
      title: "All documents are ready. Process the deal.",
      owner: "Used-car manager",
      why: "Filing assembles the deal jacket and emails the office a copy.",
      documentStep: false,
      cta: ctx.canProcess ? { kind: "process", label: "Process this deal" } : undefined,
    };
  }
  if (!flow.delivered) {
    return {
      title: "Ready for the customer to sign at delivery.",
      owner: "Delivery",
      why: "The customer signs the addendum, Buyers Guide, and K-208 as one bundle on their phone.",
      documentStep: false,
      cta: { kind: "navigate", label: "Open customer sign-off", to: `/vehicle-file/${ctx.vehicleId}?tab=sign` },
    };
  }
  return {
    title: "This deal is complete.",
    owner: "—",
    why: "Every required document is signed and archived by VIN.",
    documentStep: false,
  };
}
