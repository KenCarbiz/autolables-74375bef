import { supabase } from "@/integrations/supabase/client";
import { crawlPausedMessage } from "@/lib/inventory/crawlPaused";

export interface PriceCandidate { value: number; label: string; source: string }

export interface PriceTestResult {
  error?: string;
  paused?: boolean;
  price?: number | null;
  matched_label?: string | null;
  source?: string | null;
  reason?: string | null;
  rendered?: boolean;
  render_error?: string | null;
  http_status?: number | null;
  msrp?: number | null;
  candidates?: PriceCandidate[];
  configured_labels?: string[];
  strip_finance_params?: boolean;
  fetch_url?: string | null;
}

export const REASON_TEXT: Record<string, { title: string; fix: string }> = {
  no_price_extracted: { title: "No price found next to a known label", fix: "Add the label your page prints beside the selling price, then test again." },
  ambiguous_price: { title: "Two different prices matched the same label", fix: "Move the label that sits beside your selling price to the top of the list, or remove the label that also appears beside another figure." },
  implausible_vs_msrp: { title: "A price matched but it is far from the MSRP on the page", fix: "The figure was not trusted. Check the page for a financing or payment amount next to the label." },
  unlabeled_price_only: { title: "Dollar amounts were found, but none had a label from your list", fix: "Add the wording your page uses, for example Internet Price or Sale Price." },
  price_gated: { title: "The page asks the shopper to act before showing a price", fix: "There is no public price to read. Nothing can be extracted from this page." },
  bot_challenge: { title: "The website blocked the automated read", fix: "The page could not be read. Try again later, or ask your website provider to allow the AutoLabels crawler." },
  vin_mismatch: { title: "The page is for a different vehicle", fix: "Paste the page for the vehicle you meant to test." },
  identity_unverified: { title: "The page does not show a vehicle", fix: "Paste a vehicle detail page, not a list or search page." },
};

export const reasonText = (reason: string | null | undefined) =>
  (reason && REASON_TEXT[reason]) || { title: reason ? `Not read: ${reason.replace(/_/g, " ")}` : "No price found", fix: "Check the page address and the label list, then test again." };

/**
 * The crawler's own Test mode: one page, the saved labels, nothing written. It is the only extractor; the
 * client holds no copy. If the plain fetch is blocked the crawler may spend one metered page render, which is
 * why the caller must have the dealer's explicit acknowledgement before this runs.
 */
export async function runPriceTest(tenantId: string, url: string): Promise<PriceTestResult> {
  try {
    const { data, error } = await supabase.functions.invoke("crawl-advertised-prices", { body: { tenant_id: tenantId, test_url: url } });
    if (error) {
      const message = await crawlPausedMessage(error);
      return message ? { paused: true, error: message } : { error: error.message };
    }
    const result = (data?.test as PriceTestResult | undefined) ?? (data as PriceTestResult | null);
    return result ?? { error: "The test returned nothing." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
