export const VEHICLE_NOTE_ACTION = "vehicle_note_added";
export const MAX_NOTE_LENGTH = 1000;

export interface VehicleNote { key: string; when: string | null; who: string; text: string }

export interface NoteAuditRow { id: string; created_at: string; user_email: string | null; details: { text?: unknown } | null }

export const cleanNote = (raw: string): string | null => {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return null;
  return text.slice(0, MAX_NOTE_LENGTH);
};

export const notesFromAudit = (rows: NoteAuditRow[]): VehicleNote[] =>
  rows
    .filter((r) => typeof r.details?.text === "string" && (r.details.text as string).trim())
    .map((r) => ({ key: r.id, when: r.created_at, who: r.user_email || "Team member", text: r.details!.text as string }));
