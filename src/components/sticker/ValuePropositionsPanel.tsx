import { useState } from "react";
import { CheckCircle2, Lock, Plus } from "lucide-react";
import { PROGRAM_DISPLAY_STYLES, PROGRAM_IMAGE_SCALES, type DealerProgram, type ProgramDisplayStyle, type ProgramImageScale } from "@/lib/dealerPrograms";

const input = "w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm outline-none focus:border-primary";
const label = "text-[10px] font-bold uppercase tracking-wider text-muted-foreground";

export interface ValuePropositionsPanelProps {
  /** The dealership's approved programs offered on addenda (enabled and shown on stickers). */
  programs: DealerProgram[];
  /** Program ids left off this one addendum. Never written to the dealer library. */
  omitted: ReadonlySet<string>;
  onToggleIncluded: (id: string, include: boolean) => void;
  /** Add-on management roles edit the dealer library; everyone else selects from it. */
  canManage: boolean;
  imageLibrary: string[];
  uploading: boolean;
  onAdd: () => string | void;
  onSave: (id: string, patch: Partial<DealerProgram>) => void;
  onUpload: (id: string, file: File) => void;
}

export default function ValuePropositionsPanel({
  programs, omitted, onToggleIncluded, canManage, imageLibrary, uploading, onAdd, onSave, onUpload,
}: ValuePropositionsPanelProps) {
  const [selectedId, setSelectedId] = useState("");
  const selected = programs.find((p) => p.id === selectedId) || programs[0];
  const includedCount = programs.filter((p) => !omitted.has(p.id)).length;
  const selectedIncluded = selected ? !omitted.has(selected.id) : false;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {includedCount ? `${includedCount} on this addendum` : "None on this addendum yet"}
        </span>
        {canManage && (
          <button
            onClick={() => { const id = onAdd(); if (id) setSelectedId(id); }}
            className="h-8 shrink-0 inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700"
          >
            <Plus className="w-3.5 h-3.5" /> Add value proposition
          </button>
        )}
      </div>

      {programs.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {programs.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              aria-pressed={p.id === selected?.id}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${p.id === selected?.id ? "border-blue-300 bg-blue-50 text-blue-800" : "border-border text-muted-foreground hover:bg-muted"} ${omitted.has(p.id) ? "line-through decoration-1" : ""}`}
            >{p.title || "Untitled"}</button>
          ))}
        </div>
      )}

      {selected ? (
        <div className="rounded-lg border border-border p-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-foreground truncate">{selected.title || "Untitled"}</span>
            {selectedIncluded
              ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-700">On this addendum</span>
              : <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-black uppercase text-muted-foreground">Left off</span>}
          </div>

          <label className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <input
              type="checkbox"
              checked={selectedIncluded}
              onChange={(e) => onToggleIncluded(selected.id, e.target.checked)}
            />
            Include on this addendum
          </label>

          {canManage ? (
            <>
              <div>
                <span className={label}>Image library</span>
                <div className="mt-1 flex flex-wrap gap-2">
                  {imageLibrary.map((url) => (
                    <button
                      key={url}
                      onClick={() => onSave(selected.id, { imageUrl: url })}
                      className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-md border-2 bg-white ${selected.imageUrl === url ? "border-blue-500" : "border-border hover:border-blue-300"}`}
                    >
                      <img src={url} alt="" className="h-full w-full object-contain p-1" />
                      {selected.imageUrl === url && <CheckCircle2 className="absolute left-1 top-1 h-3.5 w-3.5 text-blue-600" />}
                    </button>
                  ))}
                  <label className="flex h-14 w-20 shrink-0 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-border text-[10px] font-semibold text-muted-foreground hover:border-blue-300">
                    <Plus className="h-3.5 w-3.5" />
                    {uploading ? "Uploading…" : "Upload"}
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(selected.id, f); e.target.value = ""; }} />
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <span className={label}>Display style</span>
                  <div className="mt-1 inline-flex rounded-lg border border-border bg-card p-0.5">
                    {PROGRAM_DISPLAY_STYLES.map((sty) => (
                      <button
                        key={sty.id}
                        onClick={() => onSave(selected.id, { displayStyle: sty.id as ProgramDisplayStyle })}
                        className={`px-3 h-8 rounded-md text-xs font-semibold ${(selected.displayStyle || "image_text") === sty.id ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
                      >{sty.label}</button>
                    ))}
                  </div>
                </div>
                {/* Size applies whether or not the text is shown, so a logo
                    can stand on its own at any scale. */}
                <div>
                  <span className={label}>Logo size</span>
                  <div className="mt-1 inline-flex rounded-lg border border-border bg-card p-0.5">
                    {PROGRAM_IMAGE_SCALES.map((sc) => (
                      <button
                        key={sc.id}
                        onClick={() => onSave(selected.id, { imageScale: sc.id as ProgramImageScale })}
                        disabled={!selected.imageUrl}
                        className={`px-3 h-8 rounded-md text-xs font-bold disabled:opacity-40 ${(selected.imageScale || "sm") === sc.id ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
                      >{sc.label}</button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="block">
                  <span className={label}>Headline</span>
                  <input value={selected.title} onChange={(e) => onSave(selected.id, { title: e.target.value })} className={input} />
                </label>
                <label className="block">
                  <span className={label}>Supporting line</span>
                  <input value={selected.supportingLine ?? selected.offer} onChange={(e) => onSave(selected.id, { supportingLine: e.target.value })} className={input} />
                </label>
              </div>

              <div>
                <label className="block">
                  <span className={label}>Disclosure</span>
                  <textarea
                    value={selected.disclosure}
                    onChange={(e) => onSave(selected.id, { disclosure: e.target.value })}
                    rows={2}
                    placeholder="Terms, conditions, and exclusions printed under the totals."
                    className="w-full px-2.5 py-2 rounded-md border border-border bg-background text-sm outline-none focus:border-primary resize-y"
                  />
                </label>
                <label className="mt-1.5 flex items-center gap-2 text-xs text-foreground">
                  <input type="checkbox" checked={selected.showAskForDetails !== false} onChange={(e) => onSave(selected.id, { showAskForDetails: e.target.checked })} />
                  Show "Ask for details"
                </label>
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Saved to dealer library · Available on all addendum templates
                </span>
                <button
                  onClick={() => onSave(selected.id, { showOnSticker: false })}
                  className="text-[11px] font-semibold text-rose-600 hover:underline"
                >Stop offering on addenda</button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start gap-3">
                {selected.imageUrl && (
                  <img src={selected.imageUrl} alt="" className="h-14 w-20 shrink-0 rounded-md border border-border bg-white object-contain p-1" />
                )}
                <div className="min-w-0 space-y-1">
                  {(selected.supportingLine ?? selected.offer) && <p className="text-xs text-foreground">{selected.supportingLine ?? selected.offer}</p>}
                  {selected.disclosure && <p className="text-[11px] text-muted-foreground">{selected.disclosure}</p>}
                </div>
              </div>
              <p className="flex items-center gap-1.5 border-t border-border pt-2 text-[10px] text-muted-foreground">
                <Lock className="w-3.5 h-3.5 shrink-0" />
                Approved by your dealership. The program itself is changed by an add-on manager in Admin, Programs.
              </p>
            </>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {canManage
            ? "Your dealer programs become value propositions here. Add one, or enable \"show on sticker\" for an existing program in Admin → Programs."
            : "No approved programs are offered on addenda yet. An add-on manager can add them in Admin, Programs."}
        </p>
      )}
    </div>
  );
}
