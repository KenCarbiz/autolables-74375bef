import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // Must include the headers supabase-js attaches to functions.invoke, or the
  // browser preflight fails with "Failed to send a request to the Edge Function".
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RecallBody {
  vin?: string;
  make: string;
  model: string;
  year: string;
}

interface Recall {
  campaignNumber: string;
  component: string;
  summary: string;
  consequence: string;
  remedy: string;
  reportReceivedDate: string;
  manufacturer: string;
  notes?: string;
}

interface RecallResponse {
  recalls: Recall[];
  hasOpenRecall: boolean;
  hasStopSale: boolean;
  hasTakata: boolean;
  lastChecked: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = (await req.json()) as RecallBody;
    const { vin, make, model, year } = body;

    if (!make || !model || !year) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: make, model, year" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch recalls by vehicle
    const recallsUrl = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`;
    const recallsRes = await fetch(recallsUrl);
    const recallsData = await recallsRes.json() as {
      Results?: Array<{
        CampaignNumber: string;
        Component: string;
        Summary: string;
        Consequence: string;
        Remedy: string;
        ReportReceivedDate: string;
        Manufacturer: string;
        Notes?: string;
      }>;
    };

    const recalls: Recall[] = (recallsData.Results || []).map((r) => ({
      campaignNumber: r.CampaignNumber,
      component: r.Component,
      summary: r.Summary,
      consequence: r.Consequence,
      remedy: r.Remedy,
      reportReceivedDate: r.ReportReceivedDate,
      manufacturer: r.Manufacturer,
      notes: r.Notes,
    }));

    // Detect conditions
    const hasOpenRecall = recalls.length > 0;
    const hasStopSale = recalls.some((r) =>
      /do not drive|stop sale|park outside|fire risk/i.test(r.summary + r.consequence)
    );
    const hasTakata = recalls.some((r) =>
      /airbag/i.test(r.summary + r.component)
    );

    // Optional: fetch safety ratings if VIN provided
    if (vin) {
      try {
        const safetyUrl = `https://api.nhtsa.gov/SafetyRatings/VehicleId/${encodeURIComponent(vin)}`;
        await fetch(safetyUrl);
      } catch {
        // Safety data optional, ignore errors
      }
    }

    const response: RecallResponse = {
      recalls,
      hasOpenRecall,
      hasStopSale,
      hasTakata,
      lastChecked: new Date().toISOString(),
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
