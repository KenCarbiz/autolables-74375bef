import { useRef } from "react";
import { Camera, Check } from "lucide-react";
import PhotoUploadGrid from "./PhotoUploadGrid";
import type { WorkEventTask } from "@/hooks/useWorkEvents";

interface TaskChecklistProps {
  tasks: WorkEventTask[];
  onChange: (tasks: WorkEventTask[]) => void;
  uploadOpts: { tenantId?: string | null; storeId?: string; vin?: string };
  onBusyChange?: (busy: boolean) => void;
}

const TaskChecklist = ({ tasks, onChange, uploadOpts, onBusyChange }: TaskChecklistProps) => {
  const busyRef = useRef<Set<number>>(new Set());

  const setTaskBusy = (index: number, busy: boolean) => {
    if (busy) busyRef.current.add(index);
    else busyRef.current.delete(index);
    onBusyChange?.(busyRef.current.size > 0);
  };

  const toggle = (index: number) =>
    onChange(tasks.map((t, i) => (i === index ? { ...t, done: !t.done } : t)));

  const setPhotos = (index: number, photo_urls: string[]) =>
    onChange(tasks.map((t, i) => (i === index ? { ...t, photo_urls } : t)));

  return (
    <div className="rounded-2xl bg-card border border-border shadow-premium divide-y divide-border overflow-hidden">
      {tasks.map((task, i) => {
        const showPhotos = task.photo_required && (task.done || task.photo_urls.length > 0);
        return (
          <div key={task.label}>
            <button
              onClick={() => toggle(i)}
              className="w-full min-h-[52px] px-4 py-3 flex items-center gap-3 text-left active:bg-muted/60 transition"
            >
              <span
                className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition ${
                  task.done ? "bg-emerald-500 border-emerald-500" : "border-border bg-background"
                }`}
              >
                {task.done && <Check className="w-4 h-4 text-white" />}
              </span>
              <span className={`flex-1 text-sm font-medium ${task.done ? "text-foreground" : "text-foreground/80"}`}>
                {task.label}
              </span>
              {task.photo_required && (
                <Camera
                  className={`w-4 h-4 shrink-0 ${
                    task.photo_urls.length > 0 ? "text-emerald-500" : "text-amber-500"
                  }`}
                />
              )}
            </button>
            {showPhotos && (
              <div className="px-4 pb-4 pl-[52px]">
                <PhotoUploadGrid
                  photos={task.photo_urls}
                  onChange={(urls) => setPhotos(i, urls)}
                  uploadOpts={uploadOpts}
                  required={task.done}
                  compact
                  onBusyChange={(b) => setTaskBusy(i, b)}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default TaskChecklist;
