import { useState } from "react";
import { Banner, Card, KeyVals } from "@/components/admin/al97/al97ui";
import { reasonOk, settingLabel, sourceLabel } from "@/lib/vehicleHistory/labels";
import type { SettingRow } from "@/lib/vehicleHistory/types";
import { Chip, NotInstalled, Notice, ReadFailure, Reason, type SectionProps } from "./shared";

const valueText = (s: SettingRow, v: boolean | number | null): string => (v === null ? "Unknown" : s.value_type === "boolean" ? (v ? "On" : "Off") : String(v));
const SCOPE_NAMES: Record<string, string> = { platform: "Platform", tenant: "This account", store: "Store" };

function SettingEditor({ setting, actions, onChanged }: { setting: SettingRow; actions: SectionProps["actions"]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string>(() => String(setting.tenant_value ?? setting.effective_value ?? (setting.value_type === "boolean" ? false : "")));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const id = `vr-set-${setting.key.replace(/\W/g, "-")}`;

  const parsed = (): boolean | number | null => {
    if (setting.value_type === "boolean") return draft === "true";
    const n = Number(draft);
    return draft.trim() !== "" && Number.isInteger(n) ? n : null;
  };

  const save = async () => {
    const value = parsed();
    if (value === null) return setMsg({ tone: "bad", text: "Enter a whole number." });
    if (typeof value === "number" && setting.min_value !== null && setting.max_value !== null && (value < setting.min_value || value > setting.max_value)) {
      return setMsg({ tone: "bad", text: `Enter a number from ${setting.min_value} to ${setting.max_value}.` });
    }
    if (!reasonOk(reason)) return setMsg({ tone: "bad", text: "Enter a reason of at least 5 characters." });
    setBusy(true);
    setMsg(null);
    const r = await actions.saveSetting(setting.key, value, setting.tenant_version, reason.trim()).catch(() => ({ ok: false as const, message: "The request did not reach the server. Nothing was changed." }));
    setBusy(false);
    if (r.ok) { setMsg({ tone: "ok", text: "Saved for this account." }); setOpen(false); setReason(""); onChanged(); }
    else setMsg({ tone: "bad", text: r.message });
  };

  if (!open) {
    return (
      <div>
        <button type="button" className="btn" onClick={() => setOpen(true)} aria-label={`Change ${settingLabel(setting.key)} for this account`}>Change for this account</button>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </div>
    );
  }
  return (
    <div>
      <div className="vr-edit">
        <label className="field" htmlFor={id}>
          <span>New value for this account</span>
          {setting.value_type === "boolean" ? (
            <select id={id} className="input" value={draft} onChange={(e) => setDraft(e.target.value)}>
              <option value="false">Off</option>
              <option value="true">On</option>
            </select>
          ) : (
            <input id={id} className="input" inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value)} />
          )}
          {setting.min_value !== null && <small>Allowed {setting.min_value} to {setting.max_value}. Based on version {setting.tenant_version}.</small>}
        </label>
        <Reason id={`${id}-reason`} value={reason} onChange={setReason} />
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving" : "Save"}</button>
          <button type="button" className="btn" onClick={() => { setOpen(false); setMsg(null); }}>Cancel</button>
        </div>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}

export default function SettingsSection({ settings, installed, canManage, actions, onChanged }: SectionProps & { settings: SettingRow[] | null; installed: boolean }) {
  return (
    <div className="vr-stack">
      <Banner tone="blue" icon="info" title="Limits only tighten as they pass down" detail="A store or dealer cannot raise a value past the platform limit, and the strictest emergency hold wins: if any level holds, it is held." />
      <Card id="vr-settings" title="Vehicle history settings" description="Each setting shows the value in force for this account, where it comes from, and the server code that reads it.">
        {!installed ? <NotInstalled /> : settings === null ? <ReadFailure what="Settings" /> : (
          <div className="vr-stack">
            {settings.map((s) => (
              <article key={s.key} className="vr-setting" aria-label={settingLabel(s.key)}>
                <header>
                  <div><h3>{settingLabel(s.key)}</h3><code>{s.key}</code></div>
                  {s.policy_status === "awaiting_approval"
                    ? <Chip chip={{ label: "Awaiting approval", tone: "amber" }} />
                    : <Chip chip={{ label: "Approved default", tone: "blue" }} />}
                </header>
                <KeyVals rows={[
                  ["In force now", <strong key="v">{valueText(s, s.effective_value)}</strong>],
                  ["Comes from", sourceLabel(s.source)],
                  ["Can be set at", s.allowed_scopes.map((a) => SCOPE_NAMES[a] ?? a).join(", ")],
                  ["Read by", s.consumer],
                ]} />
                {canManage && s.allowed_scopes.includes("tenant") && <SettingEditor setting={s} actions={actions} onChanged={onChanged} />}
              </article>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
