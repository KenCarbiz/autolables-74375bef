import { useEffect, useState } from "react";
import { classifyLogo, type AssetState } from "./assets";

// Probes the dealer logo + checks QR availability so the generator can warn
// before printing (low-res logo, missing QR on a QR template). Lightweight;
// reruns when the logo URL changes.
export function useAssetReadiness(args: { logoUrl?: string; logoEnabled: boolean; qrUrl?: string; qrSupported: boolean; qrRequired: boolean }) {
  const [logo, setLogo] = useState<AssetState>("missing");
  const [logoWidth, setLogoWidth] = useState<number | undefined>();

  useEffect(() => {
    let cancelled = false;
    if (!args.logoEnabled) { setLogo("missing"); return; }
    (async () => {
      const r = await classifyLogo(args.logoUrl);
      if (!cancelled) { setLogo(r.state); setLogoWidth(r.width); }
    })();
    return () => { cancelled = true; };
  }, [args.logoUrl, args.logoEnabled]);

  const qr: AssetState = !args.qrSupported ? "missing" : (args.qrUrl && args.qrUrl.trim()) ? "ready" : "missing";
  const qrBlocking = args.qrRequired && qr !== "ready";

  return { logo, logoWidth, qr, qrBlocking };
}
