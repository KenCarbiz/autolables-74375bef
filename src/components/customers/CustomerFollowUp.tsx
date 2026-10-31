import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/product";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { identityKey, type CustomerEntry } from "./customerBook";

// Tasks are dealer_work_items rows and logged contacts are audit_log rows,
// both keyed to the customer id. They are the same tables the Work Queue and
// the vehicle notes already use; nothing here adds schema.

const TASK_SOURCE = "customer_record";
const CONTACT_ACTION = "customer_contact_logged";

export interface FollowUpTask {
  id: string;
  title: string;
  due_at: string | null;
  status: string;
}

export interface LoggedContact {
  at: string;
  label: string;
  detail: string;
  kind: "lead";
}

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

export const useCustomerFollowUp = (customer: CustomerEntry | null) => {
  const { tenant } = useTenant();
  const { user } = useAuth();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const [tasks, setTasks] = useState<FollowUpTask[]>([]);
  const [contacts, setContacts] = useState<LoggedContact[]>([]);
  const queryClient = useQueryClient();

  const load = useCallback(async () => {
    if (!tenantId || !customer) return;
    try {
      const [taskRes, logRes] = await Promise.all([
        sb().from("dealer_work_items")
          .select("id, title, due_at, status")
          .eq("tenant_id", tenantId).eq("source", TASK_SOURCE).eq("metadata->>customer_id", customer.id)
          .order("created_at", { ascending: false }).limit(20),
        sb().from("audit_log")
          .select("created_at, user_email, details")
          .eq("action", CONTACT_ACTION).eq("entity_id", customer.id)
          .order("created_at", { ascending: false }).limit(20),
      ]);
      setTasks(((taskRes?.data || []) as FollowUpTask[]));
      setContacts(((logRes?.data || []) as { created_at: string; user_email: string | null; details: { method?: string; note?: string } | null }[]).map((r) => ({
        at: r.created_at,
        label: `Contact logged${r.details?.method ? `: ${r.details.method}` : ""}`,
        detail: [r.details?.note, r.user_email].filter(Boolean).join(" - ") || "Logged by the store.",
        kind: "lead" as const,
      })));
    } catch {
      setTasks([]);
      setContacts([]);
    }
  }, [tenantId, customer?.id]);

  useEffect(() => { void load(); }, [load]);

  const vehicle = customer?.vehicles[0] ?? null;

  const addTask = async (title: string, due: string) => {
    if (!customer) return false;
    const { error } = await sb().from("dealer_work_items").insert({
      tenant_id: tenantId,
      store_id: tenantId,
      title,
      work_type: "customer_follow_up",
      department: "inventory",
      source: TASK_SOURCE,
      status: "open",
      priority: "normal",
      assigned_to: user?.id ?? null,
      due_at: due ? new Date(`${due}T17:00:00`).toISOString() : null,
      vin: vehicle?.vin ?? null,
      vehicle_id: vehicle?.listingId ?? null,
      vehicle_title: vehicle?.label ?? null,
      metadata: { customer_id: customer.id, customer_name: customer.name || customer.email || null },
    });
    if (error) { toast.error("The task could not be saved"); return false; }
    toast.success("Task added");
    void load();
    return true;
  };

  const toggleTask = async (task: FollowUpTask) => {
    const done = task.status !== "completed";
    const { error } = await sb().from("dealer_work_items")
      .update({ status: done ? "completed" : "open", completed_at: done ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq("id", task.id);
    if (error) { toast.error("The task could not be updated"); return; }
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: done ? "completed" : "open" } : t)));
  };

  const logContact = async (method: string, note: string) => {
    if (!customer) return false;
    const { error } = await sb().from("audit_log").insert({
      action: CONTACT_ACTION,
      entity_type: "customer",
      entity_id: customer.id,
      store_id: tenantId,
      user_email: user?.email || null,
      details: { method, note: note || null, customer_name: customer.name || customer.email || null },
    });
    if (error) { toast.error("The contact could not be logged"); return false; }
    toast.success("Contact logged");
    void load();
    return true;
  };

  const updateContact = async (input: { name: string; phone: string; email: string }): Promise<string | false> => {
    if (!customer || customer.leads.length === 0) return false;
    const { error } = await sb().from("leads")
      .update({ name: input.name, phone: input.phone, email: input.email })
      .in("id", customer.leads.map((l) => l.id));
    if (error) { toast.error("The contact details could not be saved"); return false; }
    toast.success("Contact details saved");
    await queryClient.invalidateQueries({ queryKey: ["customer-book"] });
    return identityKey(input.email || null, input.name || null, customer.leads[0].vehicle_vin) ?? customer.id;
  };

  return { tenantId, tasks, contacts, addTask, toggleTask, logContact, updateContact };
};

const FIELD = "h-9 w-full rounded-[6px] border border-adm-border bg-adm-surface px-3 text-[14px] text-adm-ink";

export const AddTaskDialog = ({ open, onOpenChange, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; onSave: (title: string, due: string) => Promise<boolean> }) => {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const ok = await onSave(title.trim(), due);
    setBusy(false);
    if (ok) { setTitle(""); setDue(""); onOpenChange(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add task</DialogTitle>
            <DialogDescription>A follow-up for this customer. It also appears in the Work Queue.</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-[14px] text-adm-ink">Task
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} className={FIELD} autoFocus />
          </label>
          <label className="flex flex-col gap-1 text-[14px] text-adm-ink">Due date
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={FIELD} />
          </label>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy || !title.trim()}>{busy ? "Saving" : "Save task"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const METHODS = ["Call", "Text", "Email", "In person"];

export const LogContactDialog = ({ open, onOpenChange, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; onSave: (method: string, note: string) => Promise<boolean> }) => {
  const [method, setMethod] = useState(METHODS[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await onSave(method, note.trim());
    setBusy(false);
    if (ok) { setNote(""); onOpenChange(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Log contact</DialogTitle>
            <DialogDescription>Record a conversation with this customer. It joins the intent timeline.</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-[14px] text-adm-ink">Method
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={FIELD}>
              {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[14px] text-adm-ink">Note
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} className={`${FIELD} h-auto py-2`} />
          </label>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving" : "Log contact"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export const EditContactDialog = ({ open, onOpenChange, initial, leadCount, onSave }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: { name: string; phone: string; email: string };
  leadCount: number;
  onSave: (input: { name: string; phone: string; email: string }) => Promise<boolean>;
}) => {
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [email, setEmail] = useState(initial.email);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setName(initial.name); setPhone(initial.phone); setEmail(initial.email); }
  }, [open, initial.name, initial.phone, initial.email]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || (!phone.trim() && !email.trim())) return;
    setBusy(true);
    const ok = await onSave({ name: name.trim(), phone: phone.trim(), email: email.trim() });
    setBusy(false);
    if (ok) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Edit customer</DialogTitle>
            <DialogDescription>
              Updates the contact fields on {leadCount === 1 ? "this customer's lead" : `this customer's ${leadCount} leads`}. Deals and document requests keep the name and email they were created with.
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-[14px] text-adm-ink">Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={FIELD} autoFocus />
          </label>
          <label className="flex flex-col gap-1 text-[14px] text-adm-ink">Phone
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} className={FIELD} />
          </label>
          <label className="flex flex-col gap-1 text-[14px] text-adm-ink">Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} className={FIELD} />
          </label>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy || !name.trim() || (!phone.trim() && !email.trim())}>{busy ? "Saving" : "Save changes"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
