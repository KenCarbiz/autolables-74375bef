import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, XCircle, Clock, CircleSlash } from "lucide-react";

// Platform-admin-only: shows whether a named pg_cron job actually fired, and
// its last status, so the operator can see green/red without SQL. Self-hides
// for non-admins (the RPC errors) and when the job isn't scheduled.

interface CronStatus {
  jobname: string;
  schedule: string;
  active: boolean;
  last_status: string | null;
  last_message: string | null;
  last_start: string | null;
  last_end: string | null;
}

export default function CronStatusBadge({ jobName, label }: { jobName: string; label?: string }) {
  const [status, setStatus] = useState<CronStatus | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await (supabase as any).rpc("get_cron_job_status", { _jobname: jobName });
      if (!active) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row) { setHidden(true); return; }
      setStatus(row as CronStatus);
    })();
    return () => { active = false; };
  }, [jobName]);

  if (hidden || !status) return null;

  const s = (status.last_status || "").toLowerCase();
  const ok = s === "succeeded";
  const failed = s === "failed";
  const running = s === "running" || s === "starting" || s === "sending";

  const Icon = !status.active ? CircleSlash : ok ? CheckCircle2 : failed ? XCircle : Clock;
  const tone = !status.active
    ? "bg-muted text-muted-foreground border-border"
    : ok ? "bg-emerald-50 text-emerald-800 border-emerald-200"
    : failed ? "bg-red-50 text-red-800 border-red-200"
    : "bg-amber-50 text-amber-800 border-amber-200";

  const when = status.last_start ? new Date(status.last_start).toLocaleString() : null;
  const headline = !status.active
    ? "Schedule paused"
    : !status.last_status ? "Scheduled — no run yet"
    : ok ? "Last run succeeded"
    : failed ? "Last run FAILED"
    : `Last run: ${status.last_status}`;

  return (
    <div className={`rounded-lg border px-3 py-2 text-[12px] ${tone}`}>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 flex-shrink-0" />
        <span className="font-semibold">{label || jobName} cron · {headline}</span>
        <span className="ml-auto font-mono opacity-70">{status.schedule}</span>
      </div>
      {(when || (failed && status.last_message)) && (
        <p className="mt-0.5 pl-6 opacity-80">
          {when && <span>{when}</span>}
          {failed && status.last_message && <span className="block truncate">{status.last_message}</span>}
        </p>
      )}
    </div>
  );
}
