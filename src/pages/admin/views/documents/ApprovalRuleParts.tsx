import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AdminIcon, StatusBadge, SwitchField } from "@/components/admin/v3/editor";
import { AdminLinkButton } from "@/components/admin/v2/primitives";
import type { DocumentRules } from "@/lib/documentRules";
import {
  DOCUMENT_RULE_LABELS,
  K208_SIGNER_ROLES,
  familyDef,
  roleLabelFor,
  type DocumentFamily,
  type ServiceGateContext,
} from "@/lib/admin/documentPolicy";
import { RULE_SECTION, SECTION_TITLE, SIGNED_VERSIONS_INVARIANT, changeConsequences, type RuleSection } from "@/lib/admin/approvalRulesModel";
import { adminTabHref } from "@/lib/admin/sections";
import { cn } from "@/lib/utils";

export const EditorSection = ({ n, title, children, id }: { n: number; title: string; children: ReactNode; id?: string }) => (
  <section id={id} aria-labelledby={`${id ?? title}-h`} className="space-y-3">
    <h4 id={`${id ?? title}-h`} className="flex items-center gap-2.5 text-[16px] leading-[24px] font-semibold text-adm-ink">
      <span aria-hidden="true" className="inline-grid place-items-center w-7 h-7 rounded-full bg-adm-selected text-adm-primary text-[13px] font-bold">{n}</span>
      {title}
    </h4>
    {children}
  </section>
);

const Fact = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="flex flex-wrap gap-x-4 gap-y-0.5 py-2 text-[14px] leading-[20px]">
    <dt className="w-[110px] flex-shrink-0 text-adm-muted">{label}</dt>
    <dd className="min-w-0 flex-1 font-medium text-adm-ink">{value}</dd>
  </div>
);

export function AppliesTo({ family, gates }: { family: DocumentFamily; gates: ServiceGateContext }) {
  const def = familyDef(family);
  const scope = family === "window_sticker" ? "New and Used vehicles" : family === "buyers_guide" ? "Used and CPO vehicles" : family === "addendum" ? "Every eligible vehicle" : gates.k208Required ? "Used and CPO vehicles. New vehicles are exempt." : "Used and CPO vehicles where a K-208 is required";
  return (
    <dl className="divide-y divide-adm-divider rounded-lg border border-adm-divider px-3.5">
      <Fact label="Document" value={def.label} />
      <Fact label="Vehicles" value={scope} />
      <Fact label="Where it applies" value="The whole dealership. These rules are saved once, not per rooftop." />
      <Fact label="Which records" value="Documents generated after a change is applied. Approved and signed documents keep their version." />
    </dl>
  );
}

export function ApprovalToggles({ keys, rules, onToggle, disabled, sections }: { keys: Array<keyof DocumentRules>; rules: DocumentRules; onToggle: (key: keyof DocumentRules, next: boolean) => void; disabled: boolean; sections: RuleSection[] }) {
  return (
    <div className="space-y-4">
      {sections.map((s) => {
        const inSection = keys.filter((k) => RULE_SECTION[k] === s);
        if (!inSection.length) return null;
        return (
          <div key={s} className="rounded-lg border border-adm-divider">
            <div className="px-3.5 pt-3">
              <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{SECTION_TITLE[s].title}</p>
              <p className="text-[13px] leading-[18px] text-adm-muted">{SECTION_TITLE[s].blurb}</p>
            </div>
            <ul className="divide-y divide-adm-divider mt-1">
              {inSection.map((k) => (
                <li key={k} className="px-3.5 py-0.5">
                  <SwitchField label={ruleLabel(k)} checked={rules[k]} onChange={(v) => onToggle(k, v)} disabled={disabled} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

const ruleLabel = (k: keyof DocumentRules): string => DOCUMENT_RULE_LABELS[k];

export function ConsequenceList({ rules, keys }: { rules: DocumentRules; keys: Array<keyof DocumentRules> }) {
  const has = (k: keyof DocumentRules) => keys.includes(k);
  const all = changeConsequences(rules).filter((c) => (c.trigger === "Price changed" ? has("staleOnPriceChange") : c.trigger === "MSRP changed" ? has("staleOnMsrpChange") : c.trigger === "Mileage changed" ? has("staleOnMileageChange") : c.trigger === "Addendum items changed" ? has("staleOnAddendumChange") : has("staleOnSoldRemoved")));
  return (
    <ul className="space-y-2" aria-label="What happens for each change">
      {all.map((c) => (
        <li key={c.trigger} className={cn("rounded-lg border px-3.5 py-2.5", c.outcome === "withdraw" ? "border-adm-warning/30 bg-adm-warning-bg" : "border-adm-primary/20 bg-adm-selected")}>
          <p className="flex items-center gap-2 text-[14px] leading-[20px] font-semibold text-adm-ink">
            <AdminIcon name={c.outcome === "withdraw" ? "archive" : "refresh"} />
            {c.trigger}
            <span className="ml-auto text-[13px] font-semibold text-adm-muted">{c.outcome === "withdraw" ? "Withdraw" : "Re-approval"}</span>
          </p>
          <p className="mt-0.5 text-[13px] leading-[18px] text-adm-ink/80">{c.text}</p>
        </li>
      ))}
    </ul>
  );
}

export const SignedVersionsNotice = () => (
  <div role="note" className="flex items-start gap-3 rounded-lg border border-adm-divider bg-adm-workspace px-3.5 py-3">
    <AdminIcon name="lock" size="card" className="mt-0.5 text-adm-primary flex-shrink-0" />
    <div className="min-w-0">
      <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">Signed versions are always kept</p>
      <p className="text-[13px] leading-[18px] text-adm-muted">{SIGNED_VERSIONS_INVARIANT}</p>
    </div>
  </div>
);

export function InspectionRuleSummary({ gates, canEdit }: { gates: ServiceGateContext; canEdit: boolean }) {
  const roles = gates.k208Roles;
  return (
    <div className="space-y-3">
      <dl className="divide-y divide-adm-divider rounded-lg border border-adm-divider px-3.5">
        <Fact label="Required" value={gates.k208Required ? "Before customer signing on Used and CPO. New is exempt." : "Not required before signing"} />
        <Fact label="Signers" value={roles.length ? `Selected roles: ${roles.map(roleLabelFor).join(", ")}. Must be signed in; an anonymous QR sign-off does not count.` : "Any accepted signer, including an anonymous QR sign-off"} />
        <Fact label="Certification" value={gates.licenseeCertification ? "Licensee certification required" : "Technician inspection is enough"} />
        <Fact label="Install proof" value={gates.installVerification ? "Verified install (photo and signature) required before signing" : "Not required before signing"} />
      </dl>
      <p className="text-[13px] leading-[18px] text-adm-muted">The inspection record follows the Service policy. {canEdit ? "Edit it there; the server limits these keys to owners, managers and service managers." : "Your role can view it but not change it."}</p>
      <AdminLinkButton to={adminTabHref("service-policy", "signing-gates")} size="sm">Edit in Service policy</AdminLinkButton>
    </div>
  );
}

export function SignerRoleDetails({ gates }: { gates: ServiceGateContext }) {
  const any = gates.k208Roles.length === 0;
  return (
    <div className="space-y-4">
      <p className="text-[14px] leading-[20px]">{any ? "Any accepted signer: a signed K-208 from anyone satisfies the gate, including an anonymous QR sign-off." : "Selected authorized roles: only a signed-in member holding one of these roles satisfies the gate. An anonymous QR sign-off does not count."}</p>
      <ul className="divide-y divide-adm-divider rounded-lg border border-adm-divider">
        {K208_SIGNER_ROLES.map((r) => {
          const on = any || gates.k208Roles.includes(r.key);
          return (
            <li key={r.key} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[14px]">
              <span className="font-medium">{r.label}</span>
              <StatusBadge state={any ? "enabled" : on ? "enabled" : "disabled"} label={any ? "Accepted (any signer)" : on ? "Authorized" : "Not authorized"} />
            </li>
          );
        })}
      </ul>
      <p className="text-[13px] leading-[18px] text-adm-muted">Individual signer grants are managed in <Link className="font-semibold text-adm-primary hover:underline" to="/service/settings">Service Desk settings</Link>.</p>
    </div>
  );
}
