import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import PrepMobileFlow, { type PrepStep } from "@/components/prep/PrepMobileFlow";
import type { WorkEvent, WorkEventInput } from "@/hooks/useWorkEvents";

// Design harness for the QR mobile prep flow — mock data, no auth, no DB.
// /dev/prep-mobile-preview?step=<found|worktype|detailChoice|detailInitial|
// reclean|service|protection|vendor|manager|timeline|confirm>&events=1
const DevPrepMobilePreview = () => {
  const [searchParams] = useSearchParams();
  const step = (searchParams.get("step") || "found") as PrepStep;
  const withEvents = searchParams.get("events") === "1";
  const framed = searchParams.get("frame") === "1";

  const seedEvents = useMemo<WorkEvent[]>(() => {
    if (!withEvents) return [];
    const base = {
      tenant_id: "t1",
      vin: "1FTFW1E52PKE10432",
      listing_id: null,
      reason: null,
      ro_number: null,
      company_name: null,
      tech_name: null,
      photos: [] as string[],
      notes: null,
      signature_data: "sig",
      signature_type: "type",
      content_hash: "9f2c1e7a4b8d3f6a9c0e5b2d7f4a1c8e9f2c1e7a4b8d3f6a9c0e5b2d7f4a1c8e",
      user_agent: "preview",
      locked: true,
      correction_of: null,
      created_by: null,
    };
    return [
      {
        ...base,
        id: "e2",
        event_type: "vendor_visit",
        visit_number: 1,
        company_name: "ShieldPro Coatings",
        tech_name: "Marco D.",
        signer_name: "Marco D.",
        status: "submitted",
        tasks: [
          { label: "Ceramic Protection", done: true, photo_required: true, photo_urls: ["/placeholder.svg"] },
          { label: "VIN Etch", done: true, photo_required: true, photo_urls: ["/placeholder.svg"] },
        ],
        created_at: "2026-07-02T18:40:00Z",
        updated_at: "2026-07-02T18:40:00Z",
      },
      {
        ...base,
        id: "e1",
        event_type: "initial_detail",
        visit_number: null,
        signer_name: "Danny R.",
        status: "submitted",
        tasks: [
          { label: "Full detail", done: true, photo_required: false, photo_urls: [] },
          { label: "Exterior wash", done: true, photo_required: false, photo_urls: [] },
          { label: "Interior clean / vacuum", done: true, photo_required: false, photo_urls: [] },
        ],
        created_at: "2026-07-01T14:05:00Z",
        updated_at: "2026-07-01T14:05:00Z",
      },
    ] as WorkEvent[];
  }, [withEvents]);

  const [events, setEvents] = useState<WorkEvent[]>(seedEvents);

  const onSubmitEvent = async (input: WorkEventInput) => {
    const event: WorkEvent = {
      id: crypto.randomUUID(),
      tenant_id: "t1",
      vin: "1FTFW1E52PKE10432",
      listing_id: null,
      event_type: input.event_type,
      visit_number: input.event_type === "vendor_visit" ? events.filter((e) => e.event_type === "vendor_visit").length + 1 : null,
      reason: input.reason || null,
      ro_number: input.ro_number || null,
      company_name: input.company_name || null,
      tech_name: input.tech_name || null,
      tasks: input.tasks || [],
      photos: input.photos || [],
      notes: input.notes || null,
      signer_name: input.signer_name,
      signature_data: input.signature_data,
      signature_type: input.signature_type || "draw",
      content_hash: "preview",
      user_agent: "preview",
      status: input.status || "submitted",
      locked: true,
      correction_of: input.correction_of || null,
      created_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setEvents((prev) => [event, ...prev]);
    return { event, error: null };
  };

  const correctionTargets = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => { if (e.correction_of) set.add(e.correction_of); });
    return set;
  }, [events]);

  // Headless chromium in the sandbox enforces a 500px minimum window width;
  // ?frame=1 embeds the preview in a true 390x844 iframe viewport so
  // screenshots match a real phone, including fixed-position elements.
  if (framed) {
    const inner = new URLSearchParams(searchParams);
    inner.delete("frame");
    return (
      <div className="min-h-screen bg-slate-200 flex items-start justify-start">
        <iframe
          title="Prep mobile preview"
          src={`/dev/prep-mobile-preview?${inner.toString()}`}
          style={{ width: 390, height: 844, border: 0, background: "white" }}
        />
      </div>
    );
  }

  return (
    <PrepMobileFlow
      vin="1FTFW1E52PKE10432"
      vehicle={{
        found: true,
        ymm: "2023 Ford F-150 XLT",
        stockNumber: "P4482",
        photoUrl: "",
        listingId: null,
      }}
      events={events}
      correctionTargets={correctionTargets}
      available
      requiredProducts={[
        { name: "Ceramic Protection Package" },
        { name: "All-Weather Floor Liners" },
        { name: "Door Edge Guards" },
      ]}
      requireRo
      detailPhotosRequired={false}
      servicePhotoTasks={["Mud flaps installed", "Running boards installed"]}
      uploadOpts={{ tenantId: null }}
      defaultName="Danny R."
      managerView
      initialStep={step}
      onSubmitEvent={onSubmitEvent}
      onExit={() => { window.location.href = "/dev/prep-mobile-preview"; }}
    />
  );
};

export default DevPrepMobilePreview;
