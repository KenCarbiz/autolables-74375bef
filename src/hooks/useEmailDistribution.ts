import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeInvalidate } from "./useRealtimeInvalidate";

// ──────────────────────────────────────────────────────────────
// useEmailDistribution — Supabase-backed (Wave 19).
//
// Was localStorage-only for the recipient list (per-browser).
// Now reads/writes public.email_recipients (migration
// 20260613233000) so a dealer's F&I / GSM / GM / office-manager
// distribution follows them across devices. Mutations are
// TanStack-Query-wrapped + realtime-invalidated so two tabs
// editing the list see each other's writes.
//
// Send paths (sendPacket, sendGetReadyComplete) still go through
// the send-email edge function — no new infra. The recipient
// resolution lives on the client so the dealer can opt-in/out
// per workflow via the subscriptions JSONB without an edge fn
// rewrite.
// ──────────────────────────────────────────────────────────────

export type EmailRecipientRole =
  | "finance_manager"
  | "general_sales_manager"
  | "general_manager"
  | "office_manager"
  | "customer";

export interface EmailSubscriptions {
  get_ready_complete?: boolean;
  signed_addendum?: boolean;
}

export interface EmailRecipient {
  id?: string;
  role: EmailRecipientRole;
  name: string;
  email: string;
  subscriptions?: EmailSubscriptions;
}

export const ROLE_LABELS: Record<EmailRecipientRole, string> = {
  finance_manager: "Finance Manager",
  general_sales_manager: "General Sales Manager",
  general_manager: "General Manager",
  office_manager: "Office Manager",
  customer: "Customer",
};

const recipientsKey = (storeId: string) => ["email_recipients", storeId] as const;

interface DbRecipient {
  id: string;
  store_id: string;
  role: EmailRecipientRole;
  name: string;
  email: string;
  subscriptions: EmailSubscriptions | null;
}

const fromDb = (r: DbRecipient): EmailRecipient => ({
  id: r.id,
  role: r.role,
  name: r.name || "",
  email: r.email,
  subscriptions: r.subscriptions ?? { get_ready_complete: true, signed_addendum: true },
});

export const useEmailDistribution = (storeId: string = "") => {
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Recipient list ─────────────────────────────────────────
  const q = useQuery({
    queryKey: recipientsKey(storeId),
    queryFn: async (): Promise<EmailRecipient[]> => {
      const { data } = await (supabase as any)
        .from("email_recipients")
        .select("*")
        .eq("store_id", storeId)
        .order("role");
      return ((data as DbRecipient[]) || []).map(fromDb);
    },
    staleTime: 60_000,
  });

  useRealtimeInvalidate({
    table: "email_recipients",
    queryKey: recipientsKey(storeId),
    filter: storeId ? `store_id=eq.${storeId}` : undefined,
  });

  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: recipientsKey(storeId) }),
    [qc, storeId],
  );

  const addRecipientMutation = useMutation({
    mutationFn: async (r: Omit<EmailRecipient, "id">): Promise<EmailRecipient | null> => {
      const { data: row, error } = await (supabase as any)
        .from("email_recipients")
        .insert({
          store_id: storeId,
          role: r.role,
          name: r.name,
          email: r.email,
          subscriptions: r.subscriptions ?? { get_ready_complete: true, signed_addendum: true },
        })
        .select("*")
        .single();
      if (error || !row) return null;
      return fromDb(row as DbRecipient);
    },
    onSuccess: invalidate,
  });

  const updateRecipientMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<EmailRecipient> }) => {
      await (supabase as any)
        .from("email_recipients")
        .update({
          ...(updates.role !== undefined ? { role: updates.role } : {}),
          ...(updates.name !== undefined ? { name: updates.name } : {}),
          ...(updates.email !== undefined ? { email: updates.email } : {}),
          ...(updates.subscriptions !== undefined ? { subscriptions: updates.subscriptions } : {}),
        })
        .eq("id", id);
    },
    onSuccess: invalidate,
  });

  const deleteRecipientMutation = useMutation({
    mutationFn: async (id: string) => {
      await (supabase as any).from("email_recipients").delete().eq("id", id);
    },
    onSuccess: invalidate,
  });

  const addRecipient = useCallback(
    (r: Omit<EmailRecipient, "id">) => addRecipientMutation.mutateAsync(r),
    [addRecipientMutation],
  );
  const updateRecipient = useCallback(
    (id: string, updates: Partial<EmailRecipient>) =>
      updateRecipientMutation.mutateAsync({ id, updates }),
    [updateRecipientMutation],
  );
  const deleteRecipient = useCallback(
    (id: string) => deleteRecipientMutation.mutateAsync(id),
    [deleteRecipientMutation],
  );

  // Filter the recipient list to only those subscribed to a
  // given workflow. Customer rows are skipped here — the
  // per-deal customer email lives on the addendum / signing
  // record, not on the distribution list.
  const subscribersFor = useCallback(
    (workflow: keyof EmailSubscriptions): EmailRecipient[] => {
      return (q.data || [])
        .filter(r => r.role !== "customer")
        .filter(r => {
          const subs = r.subscriptions ?? {};
          return subs[workflow] !== false;
        });
    },
    [q.data],
  );

  // ── Send: signed-addendum packet (existing path) ───────────
  const sendPacket = async (data: {
    to: string[];
    dealerName: string;
    vehicleYmm: string;
    vehicleVin: string;
    customerName: string;
    signingDate: string;
    pdfBase64?: string;
  }): Promise<boolean> => {
    setSending(true);
    setError(null);

    const html = renderSignedAddendumEmail(data);

    try {
      const { data: result, error: fnError } = await supabase.functions.invoke("send-email", {
        body: {
          to: data.to,
          subject: `Signed Addendum: ${data.vehicleYmm} — ${data.customerName}`,
          html,
          attachments: data.pdfBase64 ? [{
            filename: `Addendum-${data.vehicleVin}.pdf`,
            content: data.pdfBase64,
          }] : undefined,
        },
      });

      if (fnError) throw new Error(fnError.message);
      if (!result?.success) throw new Error(result?.error || "Email failed");

      setSending(false);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Email failed";
      setError(msg);
      setSending(false);
      return false;
    }
  };

  // ── Send: get-ready completion (Wave 19, new path) ─────────
  // Fires when a vehicle's get-ready hits status='inventory' —
  // notifies the F&I + GSM / GM / office distribution that the
  // car is ready to advance into selling. The HTML includes the
  // timeline chain, per-accessory install proof summary, and a
  // deep link into the get-ready record for full detail.
  const sendGetReadyComplete = async (data: {
    dealerName: string;
    vehicleYmm: string;
    vehicleVin: string;
    stockNumber?: string;
    acquiredDate?: string;
    getReadyStartDate?: string;
    getReadyCompleteDate?: string;
    accessories: Array<{
      name: string;
      installed: boolean;
      installedDate?: string;
      installedBy?: string;
      photoCount: number;
      signed: boolean;
    }>;
    deepLinkUrl?: string;
  }): Promise<boolean> => {
    const to = subscribersFor("get_ready_complete").map(r => r.email).filter(Boolean);
    if (to.length === 0) {
      // No subscribers — nothing to send. Not an error; the
      // dealer may not have set up distribution yet. Caller
      // can detect this via the return value.
      return false;
    }
    setSending(true);
    setError(null);
    const html = renderGetReadyEmail(data);
    try {
      const { data: result, error: fnError } = await supabase.functions.invoke("send-email", {
        body: {
          to,
          subject: `Get-Ready Complete: ${data.vehicleYmm} — ${data.vehicleVin.slice(-8)}`,
          html,
        },
      });
      if (fnError) throw new Error(fnError.message);
      if (!result?.success) throw new Error(result?.error || "Email failed");
      setSending(false);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Email failed";
      setError(msg);
      setSending(false);
      return false;
    }
  };

  return {
    recipients: q.data ?? [],
    loading: q.isLoading,
    addRecipient,
    updateRecipient,
    deleteRecipient,
    subscribersFor,
    sendPacket,
    sendGetReadyComplete,
    sending,
    error,
    ROLE_LABELS,
  };
};

// ──────────────────────────────────────────────────────────────
// HTML renderers — kept inline. Both use the same navy-on-white
// chrome the dealer already sees in the rest of the platform.
// ──────────────────────────────────────────────────────────────

interface SignedAddendumEmailData {
  dealerName: string;
  vehicleYmm: string;
  vehicleVin: string;
  customerName: string;
  signingDate: string;
}

const renderSignedAddendumEmail = (data: SignedAddendumEmailData): string => `
  <div style="font-family: -apple-system, 'Inter', sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background: #0B2041; color: white; padding: 20px; text-align: center;">
      <h2 style="margin: 0; font-size: 18px;">Signed Addendum — ${data.vehicleYmm}</h2>
    </div>
    <div style="padding: 24px; background: #ffffff; border: 1px solid #e5e7eb;">
      <p style="font-size: 14px; color: #374151;">A dealer addendum has been signed and is ready for the deal file.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px;">
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Vehicle</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${data.vehicleYmm}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; color: #6b7280;">VIN</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-family: monospace;">${data.vehicleVin}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Customer</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${data.customerName}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Signed</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${data.signingDate}</td></tr>
        <tr><td style="padding: 8px; color: #6b7280;">Dealer</td><td style="padding: 8px; font-weight: 600;">${data.dealerName}</td></tr>
      </table>
      <p style="font-size: 12px; color: #6b7280;">This is an automated notification from your addendum platform. The signed document is attached as a PDF or can be accessed from the Vehicle Files section of your dashboard.</p>
    </div>
    <div style="padding: 12px; text-align: center; font-size: 11px; color: #9ca3af;">
      Powered by Autocurb.io — Where the lot meets the cloud
    </div>
  </div>
`;

interface GetReadyEmailData {
  dealerName: string;
  vehicleYmm: string;
  vehicleVin: string;
  stockNumber?: string;
  acquiredDate?: string;
  getReadyStartDate?: string;
  getReadyCompleteDate?: string;
  accessories: Array<{
    name: string;
    installed: boolean;
    installedDate?: string;
    installedBy?: string;
    photoCount: number;
    signed: boolean;
  }>;
  deepLinkUrl?: string;
}

const fmt = (s?: string) =>
  !s ? "—" : new Date(s).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

const renderGetReadyEmail = (data: GetReadyEmailData): string => {
  const accessoryRows = data.accessories.map(a => `
    <tr>
      <td style="padding: 6px 8px; border-bottom: 1px solid #f1f5f9; font-size: 12px;">${a.name}</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid #f1f5f9; font-size: 11px; color: #6b7280;">${fmt(a.installedDate)}</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid #f1f5f9; font-size: 11px;">${a.installedBy || "—"}</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid #f1f5f9; font-size: 11px; text-align: center;">${a.photoCount > 0 ? `${a.photoCount} on file` : "—"}</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid #f1f5f9; font-size: 11px; text-align: center;">${a.signed ? "Yes" : "—"}</td>
    </tr>
  `).join("");

  return `
    <div style="font-family: -apple-system, 'Inter', sans-serif; max-width: 640px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #0B2041 0%, #1E90FF 100%); color: white; padding: 22px 24px;">
        <p style="margin: 0 0 4px; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.18em; color: rgba(255,255,255,0.7);">Get-Ready Complete</p>
        <h2 style="margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.01em;">${data.vehicleYmm}</h2>
        <p style="margin: 6px 0 0; font-size: 12px; color: rgba(255,255,255,0.78); font-family: ui-monospace, monospace;">VIN ${data.vehicleVin}${data.stockNumber ? ` &middot; Stock ${data.stockNumber}` : ""}</p>
      </div>
      <div style="padding: 22px 24px; background: #ffffff; border: 1px solid #e5e7eb; border-top: none;">
        <p style="margin: 0 0 12px; font-size: 13px; color: #374151;">
          This vehicle has completed pre-sale preparation and is advancing to active inventory. Install proof, timeline, and customer-facing disclosure copy are on file.
        </p>

        <p style="margin: 16px 0 6px; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.14em; color: #5A6A82;">Timeline</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <tr><td style="padding: 6px 8px; color: #6b7280; width: 38%;">Acquired</td><td style="padding: 6px 8px; font-weight: 600;">${fmt(data.acquiredDate)}</td></tr>
          <tr><td style="padding: 6px 8px; color: #6b7280;">Get-ready started</td><td style="padding: 6px 8px; font-weight: 600;">${fmt(data.getReadyStartDate)}</td></tr>
          <tr><td style="padding: 6px 8px; color: #6b7280;">Get-ready complete</td><td style="padding: 6px 8px; font-weight: 600;">${fmt(data.getReadyCompleteDate)}</td></tr>
        </table>

        ${data.accessories.length > 0 ? `
          <p style="margin: 20px 0 6px; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.14em; color: #5A6A82;">Accessories installed &middot; ${data.accessories.length}</p>
          <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
            <thead>
              <tr>
                <th style="text-align: left; padding: 4px 8px; font-size: 10px; color: #5A6A82; font-weight: 700; background: #f8fafc;">Item</th>
                <th style="text-align: left; padding: 4px 8px; font-size: 10px; color: #5A6A82; font-weight: 700; background: #f8fafc;">Installed</th>
                <th style="text-align: left; padding: 4px 8px; font-size: 10px; color: #5A6A82; font-weight: 700; background: #f8fafc;">By</th>
                <th style="text-align: center; padding: 4px 8px; font-size: 10px; color: #5A6A82; font-weight: 700; background: #f8fafc;">Photos</th>
                <th style="text-align: center; padding: 4px 8px; font-size: 10px; color: #5A6A82; font-weight: 700; background: #f8fafc;">Signed</th>
              </tr>
            </thead>
            <tbody>${accessoryRows}</tbody>
          </table>
        ` : ""}

        ${data.deepLinkUrl ? `
          <p style="margin: 22px 0 0;">
            <a href="${data.deepLinkUrl}" style="display: inline-block; padding: 10px 16px; background: #0B2041; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 13px; font-weight: 700;">
              Open the vehicle file
            </a>
          </p>
        ` : ""}
      </div>
      <div style="padding: 12px; text-align: center; font-size: 11px; color: #9ca3af;">
        Powered by Autocurb.io &mdash; Get-Ready notifications from ${data.dealerName}
      </div>
    </div>
  `;
};
