import { Building2, ChevronRight, Droplet, Shield, UserCheck, Wrench } from "lucide-react";

export type WorkType = "detail" | "service" | "protection" | "vendor" | "manager";

const OPTIONS: Array<{
  id: WorkType;
  label: string;
  helper: string;
  Icon: typeof Droplet;
  iconCls: string;
}> = [
  {
    id: "detail",
    label: "Detail / Re-clean",
    helper: "Wash, detail, or touch up this vehicle",
    Icon: Droplet,
    iconCls: "bg-blue-50 text-blue-600",
  },
  {
    id: "service",
    label: "Service Install",
    helper: "Complete service-installed equipment or RO work",
    Icon: Wrench,
    iconCls: "bg-indigo-50 text-indigo-600",
  },
  {
    id: "protection",
    label: "Protection / Addendum Install",
    helper: "Install products that may need photo proof",
    Icon: Shield,
    iconCls: "bg-violet-50 text-violet-600",
  },
  {
    id: "vendor",
    label: "Third-Party Vendor",
    helper: "Vendor work, install, or repair visit",
    Icon: Building2,
    iconCls: "bg-amber-50 text-amber-600",
  },
  {
    id: "manager",
    label: "Manager Review",
    helper: "Review all work and approve vehicle ready",
    Icon: UserCheck,
    iconCls: "bg-emerald-50 text-emerald-600",
  },
];

const WorkTypeSelector = ({ onSelect }: { onSelect: (type: WorkType) => void }) => (
  <div className="space-y-3">
    {OPTIONS.map(({ id, label, helper, Icon, iconCls }) => (
      <button
        key={id}
        onClick={() => onSelect(id)}
        className="w-full rounded-2xl bg-card border border-border shadow-premium p-4 flex items-center gap-4 text-left active:scale-[0.99] hover:border-blue-300 transition"
      >
        <span className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${iconCls}`}>
          <Icon className="w-6 h-6" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-foreground">{label}</span>
          <span className="block text-xs text-muted-foreground mt-0.5">{helper}</span>
        </span>
        <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
      </button>
    ))}
  </div>
);

export default WorkTypeSelector;
