import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { logScan } from "@/lib/stickerStudio/qrTracking";

// Public QR landing at /q/:token. Logs the scan (device/browser/referrer only)
// then forwards to the Vehicle Passport. Keeps a brief interstitial so the log
// fires before navigation; falls back to home if the token can't be resolved.
const QrRedirect = () => {
  const { token = "" } = useParams();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token) { setFailed(true); return; }
    let done = false;
    (async () => {
      const dest = await logScan(token);
      if (done) return;
      if (dest) window.location.replace(dest);
      else setFailed(true);
    })();
    // Safety: if the RPC hangs, don't strand the shopper.
    const t = window.setTimeout(() => { if (!done) setFailed(true); }, 4000);
    return () => { done = true; window.clearTimeout(t); };
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-8 text-center">
      <div>
        {!failed ? (
          <>
            <div className="w-8 h-8 mx-auto rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" />
            <p className="text-sm text-slate-600 mt-3">Opening this vehicle…</p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-slate-900">Link unavailable</p>
            <p className="text-xs text-slate-500 mt-1">This QR code could not be resolved.</p>
            <a href="/" className="text-xs font-semibold text-blue-600 mt-3 inline-block">Go to AutoLabels</a>
          </>
        )}
      </div>
    </div>
  );
};

export default QrRedirect;
