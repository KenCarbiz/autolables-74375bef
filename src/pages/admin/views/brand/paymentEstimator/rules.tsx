import { useMemo, useState } from "react";
import { AdminButton } from "@/components/admin/v2/primitives";
import { ReviewDialog } from "@/components/admin/v2/ReviewDialog";
import { cn } from "@/lib/utils";
import {
  MAX_TERM_MONTHS, SUGGESTED_TERMS, describeRule, formatApr, ruleLabel, validateRule,
  type TermEntry, type ValidationIssue, type YearRule,
} from "@/lib/payment/estimator";
import { EstimatorIcon } from "./icons";
import { FieldError, NumberField, Switch, fieldDomId } from "./parts";

// The model-year x term matrix and the year-range editor. Desktop edits APRs
// in place in the matrix; the range itself (years, custom terms, removal)
// opens in a dialog. Phones get one expandable card per range with labelled
// fields instead of a squeezed table. Both write the same YearRule.

const issueFor = (issues: ValidationIssue[], path: string) => issues.find((i) => i.path === path)?.message ?? null;

export function termColumns(rules: YearRule[]): number[] {
  const set = new Set<number>(SUGGESTED_TERMS);
  for (const r of rules) for (const t of r.terms) if (Number.isInteger(t.months) && t.months > 0 && t.months <= MAX_TERM_MONTHS) set.add(t.months);
  return [...set].sort((a, b) => a - b);
}

export function setTermEnabled(rule: YearRule, months: number, on: boolean): YearRule {
  const i = rule.terms.findIndex((t) => t.months === months);
  const terms = [...rule.terms];
  if (i === -1) terms.push({ months, enabled: on, aprPercent: null });
  else terms[i] = { ...terms[i], enabled: on };
  let defaultTermMonths = rule.defaultTermMonths;
  const enabled = terms.filter((t) => t.enabled).map((t) => t.months);
  if (on && defaultTermMonths == null) defaultTermMonths = months;
  if (!on && defaultTermMonths === months) defaultTermMonths = enabled.length ? enabled.sort((a, b) => a - b)[enabled.length - 1] : null;
  return { ...rule, terms, defaultTermMonths };
}

export function setTermApr(rule: YearRule, months: number, apr: number | null): YearRule {
  const i = rule.terms.findIndex((t) => t.months === months);
  const terms = [...rule.terms];
  if (i === -1) terms.push({ months, enabled: true, aprPercent: apr });
  else terms[i] = { ...terms[i], aprPercent: apr };
  return { ...rule, terms };
}

// ── Desktop matrix ───────────────────────────────────────────────────────

export function RateMatrix({ rules, issues, disabled, onChange, onEdit, onAdd }: {
  rules: YearRule[]; issues: ValidationIssue[]; disabled: boolean;
  onChange: (rule: YearRule) => void; onEdit: (id: string) => void; onAdd: () => void;
}) {
  const cols = useMemo(() => termColumns(rules), [rules]);
  if (rules.length === 0) {
    return (
      <div className="rounded-[6px] border border-dashed border-adm-border bg-adm-workspace px-6 py-8 text-center">
        <p className="text-[15px] font-semibold text-adm-ink">No model-year ranges yet</p>
        <p className="mt-1 text-[13px] leading-[18px] text-adm-muted">Add a range of model years, then turn on the terms you offer and enter the assumed APR for each. Nothing is filled in for you.</p>
        <AdminButton variant="primary" className="mt-4 min-h-[44px]" onClick={onAdd} disabled={disabled}><EstimatorIcon name="plus" size={20} /> Add year range</AdminButton>
      </div>
    );
  }
  return (
    <div className="relative overflow-x-auto rounded-[6px] border border-adm-border" role="region" aria-label="Assumed APR by model year and term" tabIndex={0}>
      <table className="w-full min-w-[640px] border-collapse text-[14px]">
        <caption className="sr-only">Assumed APR for each model-year range and loan term. Turn a term on to enter its APR. The default term is marked.</caption>
        <thead className="bg-adm-workspace">
          <tr>
            <th scope="col" className="px-3 py-2.5 text-left text-[13px] font-semibold text-adm-ink">Model years</th>
            {cols.map((m) => <th key={m} scope="col" className="px-2 py-2.5 text-left text-[13px] font-semibold text-adm-ink whitespace-nowrap">{m} mo</th>)}
            <th scope="col" className="px-3 py-2.5 text-left text-[13px] font-semibold text-adm-ink">Default term</th>
            <th scope="col" className="px-2 py-2.5"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => {
            const rowIssues = validateRule(r).length + issues.filter((i) => i.path.startsWith(`rules.${r.id}.`) && /overlap/i.test(i.message)).length;
            const enabled = r.terms.filter((t) => t.enabled).map((t) => t.months).sort((a, b) => a - b);
            return (
              <tr key={r.id} className={cn("border-t border-adm-border align-top", !r.enabled && "bg-adm-workspace/60")}>
                <th scope="row" className="px-3 py-3 text-left">
                  <span className="block font-semibold text-adm-ink whitespace-nowrap">{ruleLabel(r)}</span>
                  {!r.enabled && <span className="text-[12px] text-adm-muted">Off</span>}
                  {rowIssues > 0 && <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-adm-danger"><EstimatorIcon name="warning" size={16} /> {rowIssues === 1 ? "1 issue" : `${rowIssues} issues`}</span>}
                </th>
                {cols.map((m) => {
                  const idx = r.terms.findIndex((t) => t.months === m);
                  const t: TermEntry | undefined = idx >= 0 ? r.terms[idx] : undefined;
                  const on = !!t?.enabled;
                  const isDefault = on && r.defaultTermMonths === m;
                  const aprPath = `rules.${r.id}.terms.${idx}.apr`;
                  const err = idx >= 0 ? issueFor(issues, aprPath) : null;
                  return (
                    <td key={m} className={cn("px-2 py-2", isDefault && "bg-adm-selected")}>
                      <div className="flex items-center gap-1">
                        <Switch checked={on} disabled={disabled} label={`${ruleLabel(r)}, ${m} months offered`} onChange={(v) => onChange(setTermEnabled(r, m, v))} />
                        {on ? (
                          <NumberField
                            id={fieldDomId(aprPath)}
                            value={t?.aprPercent ?? null}
                            onChange={(v) => onChange(setTermApr(r, m, v))}
                            suffix="%"
                            invalid={!!err}
                            disabled={disabled}
                            label={`${ruleLabel(r)}, ${m} months, assumed APR`}
                            describedBy={err ? `${fieldDomId(aprPath)}-err` : undefined}
                            className="w-[86px]"
                          />
                        ) : (
                          <span className="w-[86px] pl-1 text-[13px] text-adm-muted">Off</span>
                        )}
                      </div>
                      {isDefault && <span className="ml-[46px] mt-0.5 inline-flex items-center gap-1 text-[12px] font-semibold text-adm-primary"><EstimatorIcon name="check" size={14} /> Default</span>}
                      {err && <span id={`${fieldDomId(aprPath)}-err`} className="sr-only">{err}</span>}
                    </td>
                  );
                })}
                <td className="px-3 py-2">
                  <label htmlFor={fieldDomId(`rules.${r.id}.defaultTermMonths`)} className="sr-only">{ruleLabel(r)} default term</label>
                  <select
                    id={fieldDomId(`rules.${r.id}.defaultTermMonths`)}
                    value={r.defaultTermMonths ?? ""}
                    disabled={disabled || enabled.length === 0}
                    onChange={(e) => onChange({ ...r, defaultTermMonths: e.target.value ? Number(e.target.value) : null })}
                    aria-invalid={!!issueFor(issues, `rules.${r.id}.defaultTermMonths`) || undefined}
                    className={cn("h-11 min-w-[104px] rounded-md border bg-adm-surface px-2 text-[14px] text-adm-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary",
                      issueFor(issues, `rules.${r.id}.defaultTermMonths`) ? "border-adm-danger" : "border-adm-border")}
                  >
                    <option value="">Choose</option>
                    {enabled.map((m) => <option key={m} value={m}>{m} mo</option>)}
                  </select>
                </td>
                <td className="px-2 py-2 text-right">
                  <button type="button" onClick={() => onEdit(r.id)} disabled={disabled} aria-label={`Edit ${ruleLabel(r)} range`}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-md text-adm-primary hover:bg-adm-selected disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary">
                    <EstimatorIcon name="edit" size={20} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Shared range fields (dialog body on desktop, card body on phones) ─────

export function RuleFields({ rule, issues, disabled, onChange, onRemove, idPrefix = "" }: {
  rule: YearRule; issues: ValidationIssue[]; disabled: boolean; onChange: (r: YearRule) => void; onRemove?: () => void; idPrefix?: string;
}) {
  const [custom, setCustom] = useState<number | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);
  const did = (path: string) => `${idPrefix}${fieldDomId(path)}`;
  const startErr = issueFor(issues, `rules.${rule.id}.startYear`);
  const endErr = issueFor(issues, `rules.${rule.id}.endYear`);
  const termsErr = issueFor(issues, `rules.${rule.id}.terms`);
  const defaultErr = issueFor(issues, `rules.${rule.id}.defaultTermMonths`);
  const ordered = rule.terms.map((t, i) => ({ t, i })).sort((a, b) => a.t.months - b.t.months);
  const offered = new Set(rule.terms.map((t) => t.months));
  const addable = SUGGESTED_TERMS.filter((m) => !offered.has(m));

  const addCustom = () => {
    if (custom == null || !Number.isInteger(custom) || custom <= 0) { setCustomError("Enter a whole number of months."); return; }
    if (custom > MAX_TERM_MONTHS) { setCustomError(`Terms can be up to ${MAX_TERM_MONTHS} months.`); return; }
    if (offered.has(custom)) { setCustomError(`${custom} months is already listed.`); return; }
    onChange(setTermEnabled(rule, custom, true));
    setCustom(null);
    setCustomError(null);
  };

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="text-[14px] font-semibold text-adm-ink">Model years</legend>
        <p className="text-[12px] leading-[18px] text-adm-muted">Explicit model years, both ends included. Ranges never move with the calendar.</p>
        <div className="mt-2 grid grid-cols-2 gap-3 max-w-[360px]">
          <div>
            <label htmlFor={did(`rules.${rule.id}.startYear`)} className="block text-[13px] font-semibold text-adm-ink">From</label>
            <NumberField id={did(`rules.${rule.id}.startYear`)} value={rule.startYear} inputMode="numeric" placeholder="2022" disabled={disabled}
              invalid={!!startErr} describedBy={startErr ? `${did(`rules.${rule.id}.startYear`)}-err` : undefined}
              onChange={(v) => onChange({ ...rule, startYear: v })} className="mt-1" />
          </div>
          <div>
            <label htmlFor={did(`rules.${rule.id}.endYear`)} className="block text-[13px] font-semibold text-adm-ink">Through</label>
            <NumberField id={did(`rules.${rule.id}.endYear`)} value={rule.endYear} inputMode="numeric" placeholder="2025" disabled={disabled}
              invalid={!!endErr} describedBy={endErr ? `${did(`rules.${rule.id}.endYear`)}-err` : undefined}
              onChange={(v) => onChange({ ...rule, endYear: v })} className="mt-1" />
          </div>
        </div>
        {startErr && <FieldError id={`${did(`rules.${rule.id}.startYear`)}-err`}>{startErr}</FieldError>}
        {endErr && <FieldError id={`${did(`rules.${rule.id}.endYear`)}-err`}>{endErr}</FieldError>}
      </fieldset>

      <div className="flex items-center justify-between gap-4 rounded-[6px] border border-adm-border px-3 py-1">
        <div>
          <p id={`${did(`rules.${rule.id}`)}-on`} className="text-[14px] font-semibold text-adm-ink">Use this range</p>
          <p className="text-[12px] text-adm-muted">Off keeps the range saved but gives these model years no estimate.</p>
        </div>
        <Switch checked={rule.enabled} disabled={disabled} labelledBy={`${did(`rules.${rule.id}`)}-on`} onChange={(v) => onChange({ ...rule, enabled: v })} />
      </div>

      <fieldset>
        <legend className="text-[14px] font-semibold text-adm-ink">Terms and assumed APR</legend>
        <p className="text-[12px] leading-[18px] text-adm-muted">Turn on each term you offer and enter its APR. 0% is allowed; a blank APR is not.</p>
        {termsErr && <FieldError id={`${did(`rules.${rule.id}.terms`)}-err`}>{termsErr}</FieldError>}
        <ul className="mt-2 divide-y divide-adm-border rounded-[6px] border border-adm-border" id={did(`rules.${rule.id}.terms`)} tabIndex={-1}>
          {ordered.map(({ t, i }) => {
            const aprPath = `rules.${rule.id}.terms.${i}.apr`;
            const monthsErr = issueFor(issues, `rules.${rule.id}.terms.${i}.months`);
            const aprErr = issueFor(issues, aprPath);
            const isDefault = t.enabled && rule.defaultTermMonths === t.months;
            return (
              <li key={`${t.months}-${i}`} className={cn("px-3 py-2", isDefault && "bg-adm-selected")}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span id={`${did(aprPath)}-name`} className="w-[92px] text-[14px] font-semibold text-adm-ink">{t.months} months</span>
                  <Switch checked={t.enabled} disabled={disabled} label={`${t.months} months offered`} onChange={(v) => onChange(setTermEnabled(rule, t.months, v))} />
                  {t.enabled ? (
                    <NumberField id={did(aprPath)} value={t.aprPercent} suffix="%" disabled={disabled} invalid={!!aprErr}
                      label={`${t.months} months assumed APR`} describedBy={aprErr ? `${did(aprPath)}-err` : undefined}
                      onChange={(v) => onChange(setTermApr(rule, t.months, v))} className="w-[110px]" />
                  ) : <span className="w-[110px] text-[13px] text-adm-muted">Off</span>}
                  <label className={cn("inline-flex min-h-[44px] items-center gap-2 text-[13px]", t.enabled ? "text-adm-ink" : "text-adm-muted")}>
                    <input type="radio" name={`${did(`rules.${rule.id}`)}-default`} checked={isDefault} disabled={disabled || !t.enabled}
                      onChange={() => onChange({ ...rule, defaultTermMonths: t.months })} className="h-5 w-5 accent-[#2457D6]" />
                    Default
                  </label>
                  {!SUGGESTED_TERMS.includes(t.months as (typeof SUGGESTED_TERMS)[number]) && (
                    <button type="button" disabled={disabled} onClick={() => {
                      const terms = rule.terms.filter((_, j) => j !== i);
                      onChange({ ...rule, terms, defaultTermMonths: rule.defaultTermMonths === t.months ? null : rule.defaultTermMonths });
                    }} className="ml-auto min-h-[44px] px-2 text-[13px] font-semibold text-adm-danger hover:underline">Remove</button>
                  )}
                </div>
                {aprErr && <FieldError id={`${did(aprPath)}-err`}>{aprErr}</FieldError>}
                {monthsErr && <FieldError id={`${did(aprPath)}-mo-err`}>{monthsErr}</FieldError>}
              </li>
            );
          })}
        </ul>
        {addable.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {addable.map((m) => (
              <AdminButton key={m} variant="secondary" className="min-h-[44px]" disabled={disabled} onClick={() => onChange(setTermEnabled(rule, m, true))}>
                <EstimatorIcon name="plus" size={16} /> {m} months
              </AdminButton>
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={did(`rules.${rule.id}.custom`)} className="block text-[13px] font-semibold text-adm-ink">Other term length</label>
            <NumberField id={did(`rules.${rule.id}.custom`)} value={custom} inputMode="numeric" suffix="mo" placeholder="66" disabled={disabled}
              invalid={!!customError} describedBy={customError ? `${did(`rules.${rule.id}.custom`)}-err` : undefined}
              onChange={(v) => { setCustom(v); setCustomError(null); }} className="mt-1 w-[130px]" />
          </div>
          <AdminButton variant="secondary" className="min-h-[44px]" disabled={disabled} onClick={addCustom}>Add term</AdminButton>
        </div>
        {customError && <FieldError id={`${did(`rules.${rule.id}.custom`)}-err`}>{customError}</FieldError>}
        {defaultErr && <FieldError id={`${did(`rules.${rule.id}.defaultTermMonths`)}-err`}>{defaultErr}</FieldError>}
      </fieldset>

      {onRemove && (
        <div className="border-t border-adm-border pt-4">
          <AdminButton variant="danger" className="min-h-[44px]" disabled={disabled} onClick={onRemove}>Remove this range</AdminButton>
          <p className="mt-1 text-[12px] text-adm-muted">Vehicles in these model years will show no estimate until another range covers them.</p>
        </div>
      )}
    </div>
  );
}

// ── Desktop add/edit dialog ───────────────────────────────────────────────

export function RuleDialog({ rule, isNew, issues, disabled, onSave, onRemove, onClose }: {
  rule: YearRule; isNew: boolean; issues: ValidationIssue[]; disabled: boolean;
  onSave: (r: YearRule) => void; onRemove: () => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(rule);
  const local = useMemo(() => [...issues.filter((i) => !i.path.startsWith(`rules.${rule.id}.`)), ...validateRule(draft)], [issues, draft, rule.id]);
  const own = local.filter((i) => i.path.startsWith(`rules.${draft.id}.`));
  const overlap = issues.filter((i) => i.path.startsWith(`rules.${rule.id}.`) && /overlap/i.test(i.message));
  const [confirmClose, setConfirmClose] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(rule);
  const close = () => { if (dirty && !confirmClose) { setConfirmClose(true); return; } onClose(); };
  return (
    <ReviewDialog
      open
      title={isNew ? "Add model-year range" : `Edit ${ruleLabel(rule)}`}
      subtitle="Changes stay in your draft until you review and apply them."
      onClose={close}
      className="max-w-[720px]"
      footer={
        <>
          <p className="text-[12px] text-adm-muted" role="status">{confirmClose ? "You have unsaved range changes. Close again to discard them." : own.length ? `${own.length} ${own.length === 1 ? "issue" : "issues"} in this range.` : describeRule(draft)}</p>
          <div className="flex gap-2">
            <AdminButton variant="secondary" className="min-h-[44px]" onClick={close}>Cancel</AdminButton>
            <AdminButton variant="primary" className="min-h-[44px] px-6" disabled={disabled} onClick={() => onSave(draft)}>{isNew ? "Add range" : "Done"}</AdminButton>
          </div>
        </>
      }
    >
      {overlap.map((o) => <p key={o.message} className="text-[13px] text-adm-danger" role="alert">{o.message}</p>)}
      <RuleFields rule={draft} issues={local} disabled={disabled} onChange={(r) => { setDraft(r); setConfirmClose(false); }} onRemove={isNew ? undefined : onRemove} idPrefix="dlg-" />
    </ReviewDialog>
  );
}

// ── Phone cards ──────────────────────────────────────────────────────────

export function RuleCards({ rules, issues, disabled, onChange, onRemove, onAdd, openId, setOpenId }: {
  rules: YearRule[]; issues: ValidationIssue[]; disabled: boolean; onChange: (r: YearRule) => void; onRemove: (id: string) => void; onAdd: () => void;
  openId: string | null; setOpenId: (id: string | null) => void;
}) {
  return (
    <div className="space-y-3">
      {rules.length === 0 && (
        <div className="rounded-[6px] border border-dashed border-adm-border bg-adm-workspace px-4 py-6 text-center">
          <p className="text-[15px] font-semibold text-adm-ink">No model-year ranges yet</p>
          <p className="mt-1 text-[13px] text-adm-muted">Add a range, turn on the terms you offer and enter each APR.</p>
        </div>
      )}
      {rules.map((r) => {
        const open = openId === r.id;
        const n = issues.filter((i) => i.path.startsWith(`rules.${r.id}.`)).length;
        const def = r.defaultTermMonths;
        return (
          <section key={r.id} className="rounded-[6px] border border-adm-border bg-adm-surface">
            <h4>
              <button type="button" aria-expanded={open} aria-controls={`card-${r.id}`} onClick={() => setOpenId(open ? null : r.id)}
                className="flex min-h-[56px] w-full items-center justify-between gap-3 px-4 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary">
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold text-adm-ink">{ruleLabel(r)}{!r.enabled && <span className="ml-2 text-[12px] font-normal text-adm-muted">Off</span>}</span>
                  <span className="block text-[12px] text-adm-muted">
                    {r.terms.filter((t) => t.enabled).length} terms{def != null ? ` · default ${def} mo` : ""}
                    {def != null && r.terms.find((t) => t.months === def)?.aprPercent != null ? ` at ${formatApr(r.terms.find((t) => t.months === def)!.aprPercent as number)}` : ""}
                  </span>
                  {n > 0 && <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-adm-danger"><EstimatorIcon name="warning" size={16} /> {n === 1 ? "1 issue" : `${n} issues`}</span>}
                </span>
                <EstimatorIcon name="chevron" size={20} className={cn("flex-shrink-0 text-adm-muted transition-transform motion-reduce:transition-none", open && "rotate-90")} />
              </button>
            </h4>
            {open && (
              <div id={`card-${r.id}`} className="border-t border-adm-border px-4 py-4">
                <RuleFields rule={r} issues={issues} disabled={disabled} onChange={onChange} onRemove={() => onRemove(r.id)} />
              </div>
            )}
          </section>
        );
      })}
      <AdminButton variant="primary" className="min-h-[48px] w-full" disabled={disabled} onClick={onAdd}><EstimatorIcon name="plus" size={20} /> Add year range</AdminButton>
    </div>
  );
}
