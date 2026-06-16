import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

interface SmsResult {
  success: boolean;
  message: string;
}

// Twilio-ready SMS hook. In production, this calls a Supabase Edge Function
// that forwards to Twilio. For now, it logs the intent and stores for later.
export const useSmsDelivery = () => {
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<SmsResult | null>(null);
  const { tenant } = useTenant();
  const queueKey = `sms_queue:${tenant?.id || "none"}`;

  const sendSigningLink = async (phone: string, signingUrl: string, vehicleInfo: string): Promise<SmsResult> => {
    setSending(true);

    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length < 10) {
      const result = { success: false, message: "Invalid phone number" };
      setLastResult(result);
      setSending(false);
      return result;
    }

    const message = `Review & sign your ${vehicleInfo} addendum: ${signingUrl}`;

    // Try the live Twilio path first. Fall back to the local queue if the
    // function isn't deployed or Twilio isn't configured yet.
    try {
      const { data, error } = await supabase.functions.invoke("send-sms", {
        body: { to: cleaned, body: message },
      });
      if (!error && (data as { success?: boolean })?.success) {
        setSending(false);
        const result = { success: true, message: `Text sent to ${formatPhone(cleaned)}.` };
        setLastResult(result);
        return result;
      }
    } catch {
      /* fall through to queue */
    }

    const smsQueue = JSON.parse(localStorage.getItem(queueKey) || "[]");
    smsQueue.push({
      id: crypto.randomUUID(),
      to: cleaned,
      body: message,
      signing_url: signingUrl,
      vehicle: vehicleInfo,
      status: "queued",
      created_at: new Date().toISOString(),
    });
    localStorage.setItem(queueKey, JSON.stringify(smsQueue));

    setSending(false);
    const result = { success: true, message: `Queued for ${formatPhone(cleaned)}. Connect Twilio to send live.` };
    setLastResult(result);
    return result;
  };

  return { sendSigningLink, sending, lastResult };
};

function formatPhone(digits: string): string {
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1") return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return digits;
}
