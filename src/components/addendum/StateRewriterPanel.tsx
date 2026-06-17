import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Globe2, Copy, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import {
  rewriteForState,
  renderDisclosurePack,
  type RewriterInput,
} from "@/lib/stateRewriter";

// Per-state disclosure pack. Live re-computes when state or input
// changes. Rendered next to the red-team panel; copy-to-clipboard
// button gives F&I a drop-in block to paste into the deal jacket.
const StateRewriterPanel = ({
  state,
  input,
  className = "",
}: {
  state: string | null | undefined;
  input: RewriterInput;
  className?: string;
}) => {
  const pack = useMemo(() => rewriteForState(state, input), [state, input]);
  const [open, setOpen] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(renderDisclosurePack(pack));
      toast.success(`${pack.stateName} disclosure pack copied`);
    } catch {
      toast.error("Copy failed");
    }
  };

  const headerCls =
    pack.warnings.length > 0
      ? "bg-amber-50 border-amber-200 text-amber-900"
      : "bg-blue-50 border-blue-200 text-blue-900";

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
        <Globe2 className="w-5 h-5 flex-shrink-0" />
        <div className="flex-1 min-w-0 text-left">
          <p className="text-body-sm font-semibold">
            {pack.state
              ? `${pack.stateName} disclosure pack`
              : "State disclosure pack (FTC baseline)"}
          </p>
          <p className="text-caption opacity-80">
            {pack.blocks.length} block{pack.blocks.length === 1 ? "" : "s"}
            {pack.requiresSpanish ? " · bilingual" : ""}
            {pack.warnings.length ? ` · ${pack.warnings.length} warning${pack.warnings.length === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {open && (
        <div>
          {pack.warnings.length > 0 && (
            <div className="px-4 py-3 border-b border-amber-200 bg-amber-50/50 space-y-1">
              {pack.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-amber-600 flex-shrink-0" />
                  <p className="text-caption text-amber-900">{w}</p>
                </div>
              ))}
            </div>
          )}

          <div className="divide-y divide-border">
            {pack.blocks.map((b) => (
              <div key={b.id} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                  <p className="text-body-sm font-semibold text-foreground">
                    {b.title}
                    {b.language === "es" && (
                      <span className="ml-2 text-[10px] font-bold uppercase tracking-label px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">
                        ES
                      </span>
                    )}
                    {b.required && (
                      <span className="ml-2 text-[10px] font-bold uppercase tracking-label px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                        Required
                      </span>
                    )}
                  </p>
                </div>
                <p className="text-caption text-muted-foreground whitespace-pre-wrap">
                  {b.body}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1 font-mono">{b.citation}</p>
              </div>
            ))}
          </div>

          {pack.prohibited.length > 0 && (
            <div className="px-4 py-3 border-t border-border bg-muted/30 space-y-1">
              <p className="text-caption font-bold uppercase tracking-label text-muted-foreground mb-1">
                Do not use
              </p>
              {pack.prohibited.map((p, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-red-600 font-mono text-caption">"{p.phrase}"</span>
                  <span className="text-caption text-muted-foreground">— {p.reason}</span>
                </div>
              ))}
            </div>
          )}

          <div className="px-4 py-2 border-t border-border flex items-center justify-end">
            <button
              onClick={copy}
              className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-caption font-semibold inline-flex items-center gap-1.5"
            >
              <Copy className="w-3 h-3" />
              Copy pack
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default StateRewriterPanel;
