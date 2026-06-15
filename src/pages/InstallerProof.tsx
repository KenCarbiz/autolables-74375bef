import { useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Camera, Check, Loader2 } from "lucide-react";

// Public installer proof-of-installation page. The detail shop / vendor
// scans the QR on the car, identifies themselves, confirms what protection
// they installed and when, and attaches a photo of the equipment on the
// vehicle. The token resolves the vehicle (and its tenant) server-side via
// record_install_proof, so the installer never needs a dealer login.

const InstallerProof = () => {
  const { token } = useParams<{ token: string }>();
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [installerName, setInstallerName] = useState("");
  const [company, setCompany] = useState("");
  const [productName, setProductName] = useState("");
  const [installedAt, setInstalledAt] = useState(() => {
    // default to now, formatted for datetime-local
    const d = new Date();
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
  });
  const [notes, setNotes] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhotoFile(f);
    setPhotoPreview(URL.createObjectURL(f));
  };

  const submit = async () => {
    if (!token) { toast.error("Invalid install link."); return; }
    if (!installerName.trim()) { toast.error("Please enter your name."); return; }
    if (!productName.trim()) { toast.error("Please enter what you installed."); return; }
    setSubmitting(true);

    // Upload the photo first (best-effort; the proof still records without it).
    let photoPath: string | null = null;
    if (photoFile) {
      const safe = photoFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${token}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage
        .from("install-proofs")
        .upload(path, photoFile, { upsert: false });
      if (!upErr) photoPath = path;
    }

    const { error } = await (supabase as any).rpc("record_install_proof", {
      _install_token: token,
      _product_id: null,
      _product_name: productName.trim(),
      _installer_name: installerName.trim(),
      _installer_company: company.trim() || null,
      _installed_at: new Date(installedAt).toISOString(),
      _photo_path: photoPath,
      _notes: notes.trim() || null,
    });

    setSubmitting(false);
    if (error) {
      toast.error("Could not record. Check the link and try again.");
      return;
    }
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
            <Check className="w-7 h-7" strokeWidth={2.5} />
          </div>
          <h1 className="mt-4 text-2xl font-black font-display tracking-tight text-slate-950">Installation recorded</h1>
          <p className="mt-2 text-sm text-slate-600">
            Thank you. The dealer has a time-stamped record{photoFile ? " with your photo" : ""} that
            {" "}{productName || "this protection"} was installed.
          </p>
          <p className="mt-6 text-[10px] font-mono uppercase tracking-wider text-slate-400">You can close this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-md mx-auto px-5 py-8 space-y-5">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500 font-semibold">Installer verification</p>
          <h1 className="mt-1 text-3xl font-black font-display tracking-[-0.02em] text-slate-950">
            Confirm your installation
          </h1>
          <p className="mt-2 text-[13px] text-slate-600">
            Record what you installed on this vehicle, when, and a photo of the equipment in place.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <Field label="Your name">
            <input value={installerName} onChange={(e) => setInstallerName(e.target.value)} placeholder="Full name"
              className="w-full h-12 border-2 border-slate-300 rounded-xl px-4 text-base bg-white text-slate-900" />
          </Field>
          <Field label="Company / shop">
            <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. ProShield Detail"
              className="w-full h-12 border-2 border-slate-300 rounded-xl px-4 text-base bg-white text-slate-900" />
          </Field>
          <Field label="What did you install?">
            <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="As listed on the window sticker"
              className="w-full h-12 border-2 border-slate-300 rounded-xl px-4 text-base bg-white text-slate-900" />
          </Field>
          <Field label="Installed on">
            <input type="datetime-local" value={installedAt} onChange={(e) => setInstalledAt(e.target.value)}
              className="w-full h-12 border-2 border-slate-300 rounded-xl px-4 text-base bg-white text-slate-900" />
          </Field>

          <Field label="Photo of the equipment on the vehicle">
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPickPhoto} className="hidden" />
            {photoPreview ? (
              <button onClick={() => fileRef.current?.click()} className="block w-full rounded-xl overflow-hidden border-2 border-slate-300">
                <img src={photoPreview} alt="Install" className="w-full h-44 object-cover" />
              </button>
            ) : (
              <button onClick={() => fileRef.current?.click()}
                className="w-full h-32 rounded-xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center gap-1.5 text-slate-500">
                <Camera className="w-6 h-6" />
                <span className="text-sm font-semibold">Take or upload a photo</span>
              </button>
            )}
          </Field>

          <Field label="Notes (optional)">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Anything worth recording"
              className="w-full rounded-xl border-2 border-slate-300 px-4 py-2.5 text-sm bg-white text-slate-900" />
          </Field>
        </div>

        <button onClick={submit} disabled={submitting}
          className="w-full h-14 rounded-2xl bg-slate-950 text-white font-display font-bold text-lg disabled:opacity-50 inline-flex items-center justify-center gap-2">
          {submitting ? <><Loader2 className="w-5 h-5 animate-spin" /> Recording…</> : "Record installation"}
        </button>
        <p className="text-center text-[10px] font-mono uppercase tracking-wider text-slate-400">
          Time-stamped and stored as proof of installation
        </p>
      </div>
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{label}</label>
    {children}
  </div>
);

export default InstallerProof;
