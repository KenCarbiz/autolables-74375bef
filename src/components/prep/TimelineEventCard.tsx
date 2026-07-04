import { useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, Camera, ChevronDown, ClipboardList, Lock } from "lucide-react";
import { workEventLabel, type WorkEvent } from "@/hooks/useWorkEvents";

interface TimelineEventCardProps {
  event: WorkEvent;
  needsCorrection?: boolean;
}

const TimelineEventCard = ({ event, needsCorrection }: TimelineEventCardProps) => {
  const [open, setOpen] = useState(false);
  const doneTasks = event.tasks.filter((t) => t.done).length;
  const photoCount =
    event.photos.length + event.tasks.reduce((n, t) => n + t.photo_urls.length, 0);
  const allPhotos = [...event.photos, ...event.tasks.flatMap((t) => t.photo_urls)];

  const statusBadge = needsCorrection
    ? { text: "Needs Correction", cls: "bg-red-50 text-red-700" }
    : event.event_type === "correction"
      ? { text: "Correction", cls: "bg-red-50 text-red-700" }
      : event.status === "approved"
        ? { text: "Approved", cls: "bg-emerald-50 text-emerald-700" }
        : event.status === "rejected"
          ? { text: "Rejected", cls: "bg-red-50 text-red-700" }
          : { text: "Completed", cls: "bg-emerald-50 text-emerald-700" };

  const provider =
    event.company_name ||
    (event.event_type === "service_install"
      ? "Service Dept."
      : event.event_type === "manager_review"
        ? "Management"
        : event.event_type === "correction"
          ? "Manager"
          : "Detail Dept.");

  return (
    <div className="rounded-2xl bg-card border border-border shadow-premium overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full p-4 text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">{workEventLabel(event)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {provider}
              {event.tech_name ? ` · ${event.tech_name}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-lg ${statusBadge.cls}`}>
              {statusBadge.text}
            </span>
            {event.locked && (
              <span className="w-6 h-6 rounded-lg bg-muted text-muted-foreground flex items-center justify-center" title="Locked">
                <Lock className="w-3 h-3" />
              </span>
            )}
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {event.signer_name && <span>Signed by {event.signer_name}</span>}
          <span>{format(new Date(event.created_at), "MMM d, h:mm a")}</span>
          {event.tasks.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <ClipboardList className="w-3 h-3" /> {doneTasks}/{event.tasks.length} tasks
            </span>
          )}
          {photoCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Camera className="w-3 h-3" /> {photoCount} photo{photoCount !== 1 ? "s" : ""}
            </span>
          )}
          {event.ro_number && <span>RO {event.ro_number}</span>}
        </div>
        <div className="mt-2 flex items-center gap-1 text-xs font-semibold text-blue-600">
          View details
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
          {event.reason && (
            <p className="text-xs text-foreground">
              <span className="font-semibold">Reason:</span> {event.reason}
            </p>
          )}
          {event.event_type === "correction" && (
            <p className="text-xs text-red-700 inline-flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              This correction supersedes the original event. Originals are never edited.
            </p>
          )}
          {event.tasks.length > 0 && (
            <ul className="space-y-1">
              {event.tasks.map((t) => (
                <li key={t.label} className="text-xs text-foreground flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${t.done ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                  {t.label}
                  {t.photo_required && <Camera className="w-3 h-3 text-amber-500" />}
                </li>
              ))}
            </ul>
          )}
          {allPhotos.length > 0 && (
            <div className="grid grid-cols-4 gap-1.5">
              {allPhotos.map((url, i) => (
                <img key={`${url}-${i}`} src={url} alt="" className="aspect-square rounded-lg object-cover border border-border" />
              ))}
            </div>
          )}
          {event.notes && <p className="text-xs text-muted-foreground">{event.notes}</p>}
          {event.signature_data && event.signature_data.startsWith("data:") && (
            <img src={event.signature_data} alt="Signature" className="h-12 object-contain" />
          )}
          {event.content_hash && (
            <p className="text-[10px] font-mono text-muted-foreground/70 truncate">
              SHA-256 {event.content_hash}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default TimelineEventCard;
