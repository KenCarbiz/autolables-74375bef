import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Lock, ShieldCheck, ShieldAlert, Info, Plus, X, CheckCircle2, CircleSlash,
} from "lucide-react";
import { useVoiceProfile, useVoiceProfilePermissions } from "@/hooks/useVoiceProfile";
import {
  GATED_DEALER_CLAIMS, TONE_OPTIONS, validateVoiceProfile, diffVoiceProfiles,
  newlyApprovedClaims, type VoiceProfileDraft,
} from "@/lib/description/voiceProfile";

// ──────────────────────────────────────────────────────────────
// DescriptionVoiceSettings — the dealership's own voice, and the
// only place its gated claims can be approved.
//
// The governing rule is that absence is denial: a claim the store
// has not ticked here is stripped from every description, on every
// channel. The screen therefore has to show what is NOT approved
// as prominently as what is — an unticked box is a live policy,
// not an empty field.
// ──────────────────────────────────────────────────────────────

const CARD = "rounded-xl border border-border bg-card";
const INPUT = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60";
const LABEL = "text-xs font-semibold text-foreground";
const HINT = "text-[11px] text-muted-foreground mt-0.5";

function Section({ title, blurb, children }: {
  title: string; blurb: string; children: React.ReactNode;
}) {
  return (
    <section className={`${CARD} p-4 sm:p-5 space-y-4`}>
      <div>
        <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5 max-w-3xl">{blurb}</p>
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className={LABEL}>{label}</label>
      {children}
      {hint && <p className={HINT}>{hint}</p>}
    </div>
  );
}

/** Free-text list editor. Rows are stored verbatim — never paraphrased. */
function ListEditor({ value, onChange, placeholder, disabled, addLabel }: {
  value: string[]; onChange: (v: string[]) => void;
  placeholder: string; disabled: boolean; addLabel: string;
}) {
  return (
    <div className="space-y-2 mt-1">
      {value.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className={INPUT} value={row} placeholder={placeholder} disabled={disabled}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button
            type="button" disabled={disabled} aria-label={`Remove row ${i + 1}`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            className="shrink-0 rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button
        type="button" disabled={disabled} onClick={() => onChange([...value, ""])}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary disabled:opacity-40"
      >
        <Plus className="w-3.5 h-3.5" /> {addLabel}
      </button>
    </div>
  );
}

export default function DescriptionVoiceSettings() {
  const { canEdit } = useVoiceProfilePermissions();
  const {
    profile, draft, baseline, history, loading, error, version, saving, setDraft, save,
  } = useVoiceProfile();
  const [reason, setReason] = useState("");

  const findings = useMemo(() => (draft ? validateVoiceProfile(draft) : []), [draft]);
  const blockers = findings.filter((f) => f.blocking);
  const changes = useMemo(
    () => (draft && baseline ? diffVoiceProfiles(baseline, draft) : []), [draft, baseline]);
  const widening = useMemo(
    () => (draft && baseline ? newlyApprovedClaims(baseline, draft) : []), [draft, baseline]);

  const status = profile?.status ?? "draft";
  const everApproved = history.some((r) => r.status === "approved");
  // Generation only runs against an APPROVED profile with a dealership name.
  // Anything else is a hard stop the dealer discovers in the Studio, so it is
  // stated here in the same words instead.
  const generationLive = status === "approved" && blockers.length === 0 && changes.length === 0;

  const set = <K extends keyof VoiceProfileDraft>(k: K, v: VoiceProfileDraft[K]) =>
    setDraft({ [k]: v } as Partial<VoiceProfileDraft>);

  const submit = async (approve: boolean) => {
    if (approve && blockers.length) {
      toast.error("Resolve the blocking items before approving.");
      return;
    }
    const r = await save(approve, reason.trim());
    if (!r.ok) { toast.error(r.error); return; }
    setReason("");
    toast.success(approve
      ? `Voice profile approved (${r.version}). Descriptions generated from now on use it.`
      : `Draft saved (${r.version}). It does not affect generation until approved.`);
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-4 lg:p-6">
        <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading voice profile…
        </div>
      </div>
    );
  }
  if (error || !draft) {
    return (
      <div className="max-w-5xl mx-auto p-4 lg:p-6">
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error || "No dealership loaded."}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 lg:p-6 space-y-5 pb-32">
      {/* ── Header ─────────────────────────────────────────── */}
      <div>
        <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <ShieldAlert className="w-3 h-3" /> Governs every description
        </div>
        <h1 className="mt-1 text-2xl font-display font-semibold tracking-tight text-foreground">
          Description Voice &amp; SEO
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          How your store is described, and which claims about the dealership the AI is allowed to make. Every field here is versioned — a description keeps the profile it was written under, even after you change your mind.
        </p>
      </div>

      {!canEdit && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2 text-sm text-amber-800">
          <Lock className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">Read-only view</div>
            Only an owner, general manager, admin or compliance user can change what the store claims about itself.
          </div>
        </div>
      )}

      {/* ── Generation status ──────────────────────────────── */}
      <div className={`rounded-xl border p-4 ${
        generationLive
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-amber-500/30 bg-amber-500/5"}`}>
        <div className="flex items-start gap-2">
          {generationLive
            ? <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
            : <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />}
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${generationLive ? "text-emerald-800" : "text-amber-800"}`}>
              {generationLive
                ? `Generation is live on profile ${profile?.version}`
                : status !== "approved"
                  ? everApproved
                    ? "Unapproved draft — generation still uses the last approved profile"
                    : "Generation is blocked: this profile has never been approved"
                  : changes.length
                    ? "Unsaved changes — generation still uses the approved profile"
                    : "Generation is blocked"}
            </p>
            {blockers.length > 0 && (
              <ul className="mt-2 space-y-1">
                {blockers.map((b, i) => (
                  <li key={i} className="text-xs text-amber-900">
                    <span className="font-mono font-semibold">{b.code}</span> — {b.message}
                  </li>
                ))}
              </ul>
            )}
            {!blockers.length && status !== "approved" && (
              <p className="text-xs text-amber-900 mt-1">
                <span className="font-mono font-semibold">VOICE_PROFILE_UNAPPROVED</span> — approve the profile below to release it to generation.
              </p>
            )}
            {findings.filter((f) => !f.blocking).map((w, i) => (
              <p key={i} className="text-xs text-muted-foreground mt-1">{w.message}</p>
            ))}
          </div>
        </div>
      </div>

      {/* ── Identity ───────────────────────────────────────── */}
      <Section
        title="Dealership identity"
        blurb="Used verbatim in copy and to score local relevance. The name is required; without it no description can be generated."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dealership name" hint="Exactly as it should appear in customer copy.">
            <input className={INPUT} value={draft.dealerName} disabled={!canEdit}
              onChange={(e) => set("dealerName", e.target.value)} placeholder="Harte INFINITI" />
          </Field>
          <Field label="How to refer to the store" hint="Optional shorthand, e.g. “our Manchester showroom”.">
            <input className={INPUT} value={draft.storeReference} disabled={!canEdit}
              onChange={(e) => set("storeReference", e.target.value)} />
          </Field>
          <Field label="City">
            <input className={INPUT} value={draft.city} disabled={!canEdit}
              onChange={(e) => set("city", e.target.value)} placeholder="Manchester" />
          </Field>
          <Field label="State">
            <input className={INPUT} value={draft.state} disabled={!canEdit}
              onChange={(e) => set("state", e.target.value)} placeholder="Connecticut" />
          </Field>
          <Field label="Market area" hint="Mentioned at most twice per description, naturally.">
            <input className={INPUT} value={draft.marketArea} disabled={!canEdit}
              onChange={(e) => set("marketArea", e.target.value)} placeholder="Greater Hartford" />
          </Field>
        </div>
        <Field label="Approved market areas"
          hint="Only these may follow “serving”. Listing three or more towns in one sentence is doorway-page behavior and is blocked regardless of what is listed here.">
          <ListEditor value={draft.approvedAreas} disabled={!canEdit} addLabel="Add an area"
            placeholder="Manchester" onChange={(v) => set("approvedAreas", v)} />
        </Field>
      </Section>

      {/* ── Approved claims ────────────────────────────────── */}
      <Section
        title="Approved dealership claims"
        blurb="Statements about your business the AI may make. Anything left unticked is removed from every description — not softened, removed. These are the claims a model produces on its own because they are what dealership copy sounds like."
      >
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 flex items-start gap-2 text-xs text-sky-800">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            Tick only what your store can substantiate. Each of these is a factual claim about the business, and approving one here is what permits it in customer-facing copy across every channel.
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {GATED_DEALER_CLAIMS.map((c) => {
            const on = draft.approvedClaims.includes(c.key);
            return (
              <label key={c.key}
                className={`flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer transition-colors ${
                  on ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-background"
                } ${canEdit ? "" : "cursor-not-allowed opacity-70"}`}>
                <input
                  type="checkbox" checked={on} disabled={!canEdit} className="mt-0.5"
                  onChange={(e) => set("approvedClaims", e.target.checked
                    ? [...draft.approvedClaims, c.key]
                    : draft.approvedClaims.filter((k) => k !== c.key))}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground capitalize">{c.label}</span>
                  <span className={`inline-flex items-center gap-1 text-[11px] mt-0.5 ${
                    on ? "text-emerald-700" : "text-muted-foreground"}`}>
                    {on
                      ? <><CheckCircle2 className="w-3 h-3" /> Approved — may appear in copy</>
                      : <><CircleSlash className="w-3 h-3" /> Not approved — stripped from copy</>}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <Field label="Approved differentiators"
          hint="Used verbatim, never reworded. Anything you cannot substantiate does not belong here.">
          <ListEditor value={draft.differentiators} disabled={!canEdit} addLabel="Add a differentiator"
            placeholder="Complimentary loaner during any service visit"
            onChange={(v) => set("differentiators", v)} />
        </Field>
      </Section>

      {/* ── Voice ──────────────────────────────────────────── */}
      <Section
        title="Voice and tone"
        blurb="Wording only. Tone never changes a fact, adds a claim, or licenses a superlative."
      >
        <Field label="Positioning" hint="One or two sentences on how the store should come across.">
          <textarea className={`${INPUT} min-h-[72px]`} value={draft.brandPositioning} disabled={!canEdit}
            onChange={(e) => set("brandPositioning", e.target.value)} />
        </Field>
        <Field label="Default tone">
          <div className="grid gap-2 sm:grid-cols-2 mt-1">
            {TONE_OPTIONS.map((t) => (
              <label key={t.key}
                className={`flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer ${
                  draft.defaultTone === t.key ? "border-primary/40 bg-primary/5" : "border-border"
                } ${canEdit ? "" : "cursor-not-allowed opacity-70"}`}>
                <input type="radio" name="tone" className="mt-0.5" disabled={!canEdit}
                  checked={draft.defaultTone === t.key}
                  onChange={() => set("defaultTone", t.key)} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{t.label}</span>
                  <span className="block text-[11px] text-muted-foreground mt-0.5">{t.blurb}</span>
                </span>
              </label>
            ))}
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Closing call to action" hint="Left blank, descriptions close with a plain invitation to contact the store.">
            <input className={INPUT} value={draft.ctaTemplate} disabled={!canEdit}
              onChange={(e) => set("ctaTemplate", e.target.value)}
              placeholder="Contact Harte INFINITI to schedule a test drive." />
          </Field>
          <Field label="Contact preference">
            <input className={INPUT} value={draft.contactPreference} disabled={!canEdit}
              onChange={(e) => set("contactPreference", e.target.value)} placeholder="phone" />
          </Field>
        </div>
      </Section>

      {/* ── Language rules ─────────────────────────────────── */}
      <Section
        title="Language rules"
        blurb="Phrases the AI must never use, and text it must include verbatim. A disclosure with no text blocks generation — write it or remove the row."
      >
        <Field label="Never use">
          <ListEditor value={draft.prohibitedPhrases} disabled={!canEdit} addLabel="Add a phrase"
            placeholder="unbeatable" onChange={(v) => set("prohibitedPhrases", v)} />
        </Field>
        <Field label="Required disclosures" hint="Appended verbatim to every description. Never paraphrased.">
          <ListEditor value={draft.requiredDisclosures} disabled={!canEdit} addLabel="Add a disclosure"
            placeholder="Price excludes tax, title and registration."
            onChange={(v) => set("requiredDisclosures", v)} />
        </Field>
      </Section>

      {/* ── Terminology ────────────────────────────────────── */}
      <Section
        title="Terminology"
        blurb="Your house wording for the things every description mentions."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Certification"><input className={INPUT} value={draft.certificationTerminology}
            disabled={!canEdit} onChange={(e) => set("certificationTerminology", e.target.value)} /></Field>
          <Field label="Warranty"><input className={INPUT} value={draft.warrantyTerminology}
            disabled={!canEdit} onChange={(e) => set("warrantyTerminology", e.target.value)} /></Field>
          <Field label="Finance"><input className={INPUT} value={draft.financeTerminology}
            disabled={!canEdit} onChange={(e) => set("financeTerminology", e.target.value)} /></Field>
          <Field label="Trade"><input className={INPUT} value={draft.tradeTerminology}
            disabled={!canEdit} onChange={(e) => set("tradeTerminology", e.target.value)} /></Field>
          <Field label="Delivery"><input className={INPUT} value={draft.deliveryTerminology}
            disabled={!canEdit} onChange={(e) => set("deliveryTerminology", e.target.value)} /></Field>
        </div>
      </Section>

      {/* ── Save bar ───────────────────────────────────────── */}
      {canEdit && (
        <div className="fixed bottom-0 inset-x-0 border-t border-border bg-background/95 backdrop-blur z-30">
          <div className="max-w-5xl mx-auto p-3 lg:px-6 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">
                Version <span className="font-mono">{version || "…"}</span>
                {" · "}
                <span className="capitalize">{status}</span>
                {changes.length > 0 && ` · ${changes.length} unsaved change${changes.length === 1 ? "" : "s"}`}
              </p>
              {changes.length > 0 && (
                <p className="text-[11px] text-muted-foreground truncate">
                  {changes.map((c) => c.label).join(", ")}
                  {widening.length > 0 && (
                    <span className="text-amber-700 font-semibold">
                      {" "}· widens what the store may claim ({widening.length})
                    </span>
                  )}
                </p>
              )}
            </div>
            <input
              className={`${INPUT} sm:w-64`} value={reason} placeholder="Reason for this change"
              onChange={(e) => setReason(e.target.value)}
            />
            <button
              type="button" disabled={saving || changes.length === 0} onClick={() => submit(false)}
              className="rounded-lg border border-border px-3 py-2 text-sm font-semibold disabled:opacity-40"
            >
              Save draft
            </button>
            <button
              type="button" disabled={saving || blockers.length > 0} onClick={() => submit(true)}
              className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Approve &amp; release
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
