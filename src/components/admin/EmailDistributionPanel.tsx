import { useState } from "react";
import { Mail, Plus, Trash2, X, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
  useEmailDistribution,
  ROLE_LABELS,
  type EmailRecipientRole,
  type EmailRecipient,
} from "@/hooks/useEmailDistribution";
import { useTenant } from "@/contexts/TenantContext";

// ──────────────────────────────────────────────────────────────
// EmailDistributionPanel — Wave 19.
//
// Manages the recipient list for one store's get-ready + signed-
// addendum email workflows. Roles match the EmailRecipientRole
// union (F&I / GSM / GM / office manager; customer is per-deal,
// not maintained here).
//
// Subscriptions live in the email_recipients.subscriptions JSONB
// so a dealer can opt one F&I manager out of get-ready emails
// without removing them from signed-addendum delivery.
//
// Reads/writes useEmailDistribution which is TanStack-Query'd +
// realtime-invalidated (Wave 14.6), so two tabs editing the
// list see each other's writes.
// ──────────────────────────────────────────────────────────────

const ROLE_OPTIONS: { value: EmailRecipientRole; label: string }[] = [
  { value: "finance_manager",       label: ROLE_LABELS.finance_manager },
  { value: "general_sales_manager", label: ROLE_LABELS.general_sales_manager },
  { value: "general_manager",       label: ROLE_LABELS.general_manager },
  { value: "office_manager",        label: ROLE_LABELS.office_manager },
];

interface Props {
  // Empty string acceptable — the hook just won't load anything.
  storeId: string;
}

export const EmailDistributionPanel = ({ storeId }: Props) => {
  const { currentStore } = useTenant();
  const effectiveStoreId = storeId || currentStore?.id || "";
  const {
    recipients,
    loading,
    addRecipient,
    updateRecipient,
    deleteRecipient,
  } = useEmailDistribution(effectiveStoreId);

  const [adding, setAdding] = useState(false);

  const handleAdd = async (r: Omit<EmailRecipient, "id">) => {
    const result = await addRecipient(r);
    if (result) {
      toast.success(`Added ${r.name || r.email}`);
      setAdding(false);
    } else {
      toast.error("Couldn't add recipient — check for duplicates");
    }
  };

  const handleToggle = (rec: EmailRecipient, key: "get_ready_complete" | "signed_addendum") => {
    if (!rec.id) return;
    const next = {
      ...(rec.subscriptions || {}),
      [key]: !(rec.subscriptions?.[key] !== false),
    };
    updateRecipient(rec.id, { subscriptions: next });
  };

  const handleDelete = async (rec: EmailRecipient) => {
    if (!rec.id) return;
    if (!confirm(`Remove ${rec.name || rec.email} from distribution?`)) return;
    await deleteRecipient(rec.id);
    toast.success("Recipient removed");
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Mail className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Email distribution</h3>
            <p className="text-[11px] text-muted-foreground">
              {recipients.length} recipient{recipients.length === 1 ? "" : "s"} ·
              get-ready emails + signed-addendum packets
            </p>
          </div>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90"
          >
            <Plus className="w-3.5 h-3.5" /> Add recipient
          </button>
        )}
      </div>

      {adding && (
        <AddRecipientForm
          onSubmit={handleAdd}
          onCancel={() => setAdding(false)}
        />
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground py-2">Loading…</p>
      ) : recipients.length === 0 && !adding ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
          <AlertCircle className="w-5 h-5 text-muted-foreground/60 mx-auto mb-1.5" />
          <p className="text-xs font-semibold text-foreground">No recipients on file</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Without recipients, get-ready completion emails will silently no-op.
            Add at least one F&amp;I manager to receive notifications.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-bold">Role</th>
                <th className="text-left px-3 py-2 font-bold">Name</th>
                <th className="text-left px-3 py-2 font-bold">Email</th>
                <th className="text-center px-3 py-2 font-bold" title="Get-ready completion emails">
                  Get-Ready
                </th>
                <th className="text-center px-3 py-2 font-bold" title="Signed addendum packets">
                  Signed
                </th>
                <th className="text-right px-3 py-2 font-bold"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recipients.map(rec => (
                <tr key={rec.id}>
                  <td className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-foreground">
                    {ROLE_LABELS[rec.role]}
                  </td>
                  <td className="px-3 py-2 text-sm">{rec.name || "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{rec.email}</td>
                  <td className="px-3 py-2 text-center">
                    <SubscriptionToggle
                      on={rec.subscriptions?.get_ready_complete !== false}
                      onChange={() => handleToggle(rec, "get_ready_complete")}
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <SubscriptionToggle
                      on={rec.subscriptions?.signed_addendum !== false}
                      onChange={() => handleToggle(rec, "signed_addendum")}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => handleDelete(rec)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 h-7 rounded-md text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="w-3 h-3" /> Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// AddRecipientForm — inline form panel.
// ──────────────────────────────────────────────────────────────

interface AddFormProps {
  onSubmit: (r: Omit<EmailRecipient, "id">) => void;
  onCancel: () => void;
}

const AddRecipientForm = ({ onSubmit, onCancel }: AddFormProps) => {
  const [role, setRole] = useState<EmailRecipientRole>("finance_manager");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const valid = email.includes("@") && email.length > 3;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onSubmit({
      role,
      name: name.trim(),
      email: email.trim(),
      subscriptions: { get_ready_complete: true, signed_addendum: true },
    });
  };

  return (
    <form onSubmit={submit} className="rounded-lg border-2 border-primary bg-card p-3 space-y-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-bold text-foreground">Add recipient</p>
        <button
          type="button"
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as EmailRecipientRole)}
          className="h-9 px-2 rounded-md border border-border bg-background text-sm"
        >
          {ROLE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional)"
          className="h-9 px-2 rounded-md border border-border bg-background text-sm"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@dealership.com"
          type="email"
          className="h-9 px-2 rounded-md border border-border bg-background text-sm"
        />
      </div>
      <div className="flex items-center justify-end gap-2 pt-0.5">
        <button
          type="button"
          onClick={onCancel}
          className="h-8 px-3 rounded-md text-xs text-muted-foreground hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid}
          className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </form>
  );
};

const SubscriptionToggle = ({ on, onChange }: { on: boolean; onChange: () => void }) => (
  <button
    type="button"
    onClick={onChange}
    aria-pressed={on}
    className={`relative w-9 h-5 rounded-full transition-colors ${on ? "bg-emerald-500" : "bg-muted"}`}
    title={on ? "Subscribed — click to unsubscribe" : "Not subscribed — click to subscribe"}
  >
    <span
      className={`absolute top-0.5 w-4 h-4 rounded-full bg-card shadow transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`}
    />
  </button>
);

export default EmailDistributionPanel;
