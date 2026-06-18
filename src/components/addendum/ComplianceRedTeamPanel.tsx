import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, AlertTriangle, XCircle, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import type { ComplianceFinding } from "@/lib/stateCompliance";
import { summarizeRedTeam } from "@/lib/complianceRedTeam";

// Live compliance read-out. The Wave 4.2 moat: every F&I user sees
// what a regulator would flag, before the customer signs.
const ComplianceRedTeamPanel = ({
  findings,
  className = "",
}: {
  findings: ComplianceFinding[];
  className?: string;
}) => {
  const summary = useMemo(() => summarizeRedTeam(findings), [findings]);
  // Collapsed by default when clean; auto-expands the first time an issue
  // (blocker or warning) appears, then respects manual toggling thereafter.
  const hasIssue = summary.fail > 0 || summary.warn > 0;
  const [open, setOpen] = useState(hasIssue);
  const autoOpened = useRef(hasIssue);
  useEffect(() => {
    if (hasIssue && !autoOpened.current) {
      autoOpened.current = true;
      setOpen(true);
    }
  }, [hasIssue]);

  const fails = findings.filter((f) => f.severity === "fail");
  const warns = findings.filter((f) => f.severity === "warn");
  const passes = findings.filter((f) => f.severity === "pass");

  const headerCls = summary.blocker
    ? "bg-red-50 border-red-200 text-red-900"
    : summary.warn > 0
      ? "bg-amber-50 border-amber-200 text-amber-900"
      : "bg-emerald-50 border-emerald-200 text-emerald-900";

  const HeaderIcon = summary.blocker ? XCircle : summary.warn > 0 ? AlertTriangle : ShieldCheck;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-xl border ${headerCls.split(" ").filter((c) => c.startsWith("border-")).join(" ")} bg-white overflow-hidden ${className}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-3 px-4 py-3 ${headerCls}`}
      >
        <HeaderIcon className="w-5 h-5 flex-shrink-0" />
        <div className="flex-1 min-w-0 text-left">
          <p className="text-body-sm font-semibold">
            {summary.blocker
              ? `Compliance check: ${summary.fail} item${summary.fail === 1 ? "" : "s"} to fix`
              : summary.warn > 0
                ? `Compliance check: ${summary.warn} note${summary.warn === 1 ? "" : "s"} to review`
                : "Compliance check passed"}
          </p>
          <p className="text-caption opacity-80">
            {summary.total} check{summary.total === 1 ? "" : "s"} · {summary.fail} fail · {summary.warn} warn · {summary.pass} pass
          </p>
        </div>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {open && (
        <div className="divide-y divide-border">
          {fails.map((f) => <FindingRow key={f.id} finding={f} />)}
          {warns.map((f) => <FindingRow key={f.id} finding={f} />)}
          {passes.map((f) => <FindingRow key={f.id} finding={f} />)}
          {findings.length === 0 && (
            <div className="px-4 py-4 text-caption text-muted-foreground">
              No checks run yet. Fill in vehicle details + state to trigger the red-team.
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
};

const FindingRow = ({ finding }: { finding: ComplianceFinding }) => {
  const Icon =
    finding.severity === "fail" ? XCircle :
    finding.severity === "warn" ? AlertTriangle :
    CheckCircle2;
  const iconCls =
    finding.severity === "fail" ? "text-red-600" :
    finding.severity === "warn" ? "text-amber-600" :
    "text-emerald-600";
  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${iconCls}`} />
      <div className="flex-1 min-w-0">
        <p className="text-body-sm font-semibold text-foreground">{finding.rule}</p>
        <p className="text-caption text-muted-foreground mt-0.5">{finding.message}</p>
        {finding.suggestion && (
          <p className="text-caption text-foreground/80 mt-1">
            <span className="font-semibold">Fix:</span> {finding.suggestion}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground mt-1 font-mono">{finding.citation}</p>
      </div>
    </div>
  );
};

export default ComplianceRedTeamPanel;
