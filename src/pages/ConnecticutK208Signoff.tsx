import { useMemo, useState } from "react";
import {
  canCustomerSignK208,
  canServiceSignK208,
  createConnecticutK208Record,
  signK208Customer,
  signK208Service,
  updateK208ChecklistItem,
  type ConnecticutK208Record,
  type K208ChecklistStatus,
  type K208WorkflowRole,
} from "@/components/saturday/ConnecticutK208Workflow";
import { buildConnecticutK208AutofillPayload } from "@/components/saturday/ConnecticutK208FormSchema";
import { createESignatureRequest, signDocument } from "@/components/saturday/ESignatureEngine";

const initialRecord = () => createConnecticutK208Record({
  dealerId: "demo-ct-dealer",
  vehicleId: "SAMPLEVIN123456789",
  vin: "SAMPLEVIN123456789",
  stock: "CT1001",
  modelYear: new Date().getFullYear() - 3,
  make: "INFINITI",
  model: "QX60",
  mileage: 42150,
  warrantyDisposition: "state_required_warranty",
  warrantyTermLabel: "60 days or 3,000 miles",
});

const statusOptions: K208ChecklistStatus[] = ["not_started", "checked", "not_applicable", "needs_attention"];
const serviceRoles: Exclude<K208WorkflowRole, "customer">[] = ["service_manager", "service_writer", "technician", "used_car_manager", "sales_manager"];

export default function ConnecticutK208Signoff() {
  const [record, setRecord] = useState<ConnecticutK208Record>(() => initialRecord());
  const [serviceName, setServiceName] = useState("Service Manager");
  const [serviceRole, setServiceRole] = useState<Exclude<K208WorkflowRole, "customer">>("service_manager");
  const [buyerName, setBuyerName] = useState("Test Buyer");

  const payload = useMemo(() => buildConnecticutK208AutofillPayload({
    record,
    bodyStyle: "SUV",
    dealer: {
      dealerName: "Harte Infiniti of Hartford",
      phoneNumber: "860-000-0000",
      address: "150 Weston Road",
      townCity: "Hartford",
      state: "CT",
      zipCode: "06120",
      principal: "",
      dealerLicenseNumber: "",
    },
    buyer: { buyerNamePrint: buyerName },
    licenseePrintedName: serviceName,
  }), [record, buyerName, serviceName]);

  const serviceCanSign = canServiceSignK208(record);
  const customerCanSign = canCustomerSignK208(record);

  const updateItem = (itemId: string, status: K208ChecklistStatus) => {
    setRecord((current) => updateK208ChecklistItem(current, itemId, {
      status,
      completedBy: serviceName,
      completedByRole: serviceRole,
      notes: status === "needs_attention" ? "Needs correction or defect explanation before sale." : undefined,
    }));
  };

  const signService = () => {
    const signed = signK208Service(record, {
      signerName: serviceName,
      signerRole: serviceRole,
      typedName: serviceName,
      method: "click_to_sign" as never,
    } as never);

    const esign = createESignatureRequest({
      dealerId: record.dealerId,
      vehicleId: record.vehicleId,
      vin: record.vin,
      stock: record.stock,
      documentType: "ct_k208",
      documentId: record.id,
      documentVersion: record.formVersion,
      title: "Connecticut K-208 Service Signoff",
      signers: [{ role: serviceRole === "technician" ? "technician" : serviceRole === "service_writer" ? "service_writer" : "service_manager", name: serviceName }],
    });
    signDocument(esign, esign.signers[0].id, { method: "click_to_sign", typedName: serviceName });
    setRecord(signed);
  };

  const signCustomer = () => {
    const signed = signK208Customer(record, {
      signerName: buyerName,
      typedName: buyerName,
      method: "click_to_sign" as never,
    } as never);
    setRecord(signed);
  };

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-6 text-slate-100">
      <section className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl">
          <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">Connecticut Compliance</p>
          <h1 className="mt-2 text-4xl font-black tracking-[-0.04em]">K-208 Service Signoff</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">Service completes the K-208 inspection checklist, signs it, then the customer signs after service approval. This is the operational UI foundation for the CT rollout.</p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <aside className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl">
            <h2 className="text-xl font-black">Vehicle / Signer</h2>
            <div className="mt-4 space-y-3">
              <ReadOnly label="Vehicle" value={`${record.modelYear} ${record.make} ${record.model}`} />
              <ReadOnly label="VIN" value={record.vin} />
              <ReadOnly label="Stock" value={record.stock || ""} />
              <ReadOnly label="Warranty" value={record.warrantyTermLabel || record.warrantyDisposition} />
              <Input label="Service Signer" value={serviceName} onChange={setServiceName} />
              <label className="block space-y-1 text-xs font-bold uppercase tracking-wide text-slate-400">Service Role<select className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none" value={serviceRole} onChange={(event) => setServiceRole(event.target.value as Exclude<K208WorkflowRole, "customer">)}>{serviceRoles.map((role) => <option key={role} value={role}>{role.replace(/_/g, " ")}</option>)}</select></label>
              <Input label="Buyer Name" value={buyerName} onChange={setBuyerName} />
            </div>
          </aside>

          <section className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              <StatusCard label="Checklist" value={serviceCanSign ? "Complete" : "Open"} active={serviceCanSign} />
              <StatusCard label="Service Signature" value={record.serviceSignature.status} active={record.serviceSignature.status === "signed"} />
              <StatusCard label="Customer Signature" value={record.customerSignature.status} active={record.customerSignature.status === "signed"} />
            </div>

            <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl">
              <h2 className="text-xl font-black">Inspection Checklist</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {record.checklist.map((item) => (
                  <article key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="text-sm font-black text-white">{item.label}</div>
                    <p className="mt-1 text-xs text-slate-400">{item.description}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {statusOptions.map((status) => <button key={status} onClick={() => updateItem(item.id, status)} className={`rounded-xl px-3 py-2 text-[11px] font-black uppercase ${item.status === status ? "bg-cyan-400 text-slate-950" : "bg-white/10 text-white hover:bg-white/15"}`}>{status.replace(/_/g, " ")}</button>)}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="grid gap-4 md:grid-cols-2">
              <button disabled={!serviceCanSign || record.serviceSignature.status === "signed"} onClick={signService} className="rounded-3xl bg-emerald-400 px-5 py-5 text-left text-slate-950 shadow-xl disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">
                <div className="text-xs font-black uppercase tracking-[0.2em]">Step 1</div>
                <div className="mt-1 text-2xl font-black">Service Signoff</div>
                <div className="mt-2 text-sm font-bold">Available after required checklist items are checked or marked not applicable.</div>
              </button>
              <button disabled={!customerCanSign || record.customerSignature.status === "signed"} onClick={signCustomer} className="rounded-3xl bg-cyan-400 px-5 py-5 text-left text-slate-950 shadow-xl disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">
                <div className="text-xs font-black uppercase tracking-[0.2em]">Step 2</div>
                <div className="mt-1 text-2xl font-black">Customer Signoff</div>
                <div className="mt-2 text-sm font-bold">Available only after service signature is complete.</div>
              </button>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl">
              <h2 className="text-xl font-black">K-208 Autofill Preview</h2>
              <pre className="mt-4 max-h-[520px] overflow-auto rounded-2xl bg-slate-900 p-4 text-xs text-slate-300">{JSON.stringify(payload, null, 2)}</pre>
            </section>
          </section>
        </section>
      </section>
    </main>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block space-y-1 text-xs font-bold uppercase tracking-wide text-slate-400">{label}<input className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"><div className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-sm font-black text-white">{value}</div></div>;
}

function StatusCard({ label, value, active }: { label: string; value: string; active: boolean }) {
  return <div className={`rounded-3xl border p-5 shadow-xl ${active ? "border-emerald-400/40 bg-emerald-950/20" : "border-white/10 bg-white/[0.04]"}`}><div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">{label}</div><div className="mt-2 text-2xl font-black text-white">{value}</div></div>;
}
