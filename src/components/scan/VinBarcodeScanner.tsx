import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, ScanLine, X, Zap, ZapOff } from "lucide-react";
import { normalizeScannedVin } from "@/lib/vinScan";

// ──────────────────────────────────────────────────────────────
// VinBarcodeScanner — in-browser camera VIN scanner.
//
// Uses the browser-native BarcodeDetector API (iOS Safari 16.4+,
// Chrome 83+, Edge, Samsung Internet). Detects Code-39 (the format
// VIN barcodes on door jambs use) plus QR / Code-128 for windshield
// stock-number labels.
//
// Fallback path: if BarcodeDetector isn't in the window, we open
// the camera anyway so the user can see what they're framing, and
// they manually type the 17 chars below. Never blocks them.
//
// Permissions: getUserMedia triggers the browser's camera prompt.
// We stop the stream when the component unmounts or the scanner
// closes so the LED turns off.
// ──────────────────────────────────────────────────────────────

interface Props {
  onDetected: (value: string) => void;
  onClose: () => void;
  formats?: string[]; // default Code-39 + Code-128 + QR
}

const hasBarcodeDetector = (): boolean =>
  typeof (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector === "function";

interface BarcodeDetectorResult {
  rawValue: string;
  format: string;
}

interface BarcodeDetectorInstance {
  detect: (source: HTMLVideoElement | ImageBitmap) => Promise<BarcodeDetectorResult[]>;
}

export const VinBarcodeScanner = ({
  onDetected,
  onClose,
  formats = ["code_39", "code_128", "qr_code"],
}: Props) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const pollRef = useRef<number | null>(null);
  const torchSupportedRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [supported, setSupported] = useState(hasBarcodeDetector());

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      try {
        // 1. Camera permission + stream
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        // Torch support (Chrome only typically)
        const caps = (track.getCapabilities?.() || {}) as {
          torch?: boolean;
        };
        torchSupportedRef.current = !!caps.torch;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }

        // 2. Build a BarcodeDetector if available. If not, user types.
        if (hasBarcodeDetector()) {
          const Ctor = (window as unknown as {
            BarcodeDetector: new (opts: { formats: string[] }) => BarcodeDetectorInstance;
          }).BarcodeDetector;
          detectorRef.current = new Ctor({ formats });
          scheduleScan();
        } else {
          setSupported(false);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "camera unavailable";
        setError(msg);
      }
    };

    const scheduleScan = () => {
      if (cancelled || !detectorRef.current) return;
      pollRef.current = window.setTimeout(scanFrame, 200);
    };

    const scanFrame = async () => {
      if (cancelled) return;
      const video = videoRef.current;
      const detector = detectorRef.current;
      if (!video || !detector || video.readyState < 2) {
        scheduleScan();
        return;
      }
      try {
        const found = await detector.detect(video);
        for (const r of found) {
          // A door-jamb Code 39 payload is not always the bare VIN, so the
          // shared reader decides what counts — not a second regex here.
          const read = normalizeScannedVin(r.rawValue || "", "barcode");
          if (read.ok) {
            setDetected(read.vin);
            onDetected(read.vin);
            return;
          }
        }
      } catch {
        /* ignore per-frame errors, keep polling */
      }
      scheduleScan();
    };

    start();

    return () => {
      cancelled = true;
      if (pollRef.current) window.clearTimeout(pollRef.current);
      const s = streamRef.current;
      if (s) s.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !torchSupportedRef.current) return;
    try {
      await (track.applyConstraints as (c: unknown) => Promise<void>)({
        advanced: [{ torch: !torch }],
      });
      setTorch((v) => !v);
    } catch {
      /* some Android builds throw when torch isn't really available */
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 h-14 flex-shrink-0 bg-black/60 backdrop-blur">
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-[#3BB4FF]" />
          <div className="text-sm font-semibold">Scan VIN barcode</div>
        </div>
        <div className="flex items-center gap-1">
          {torchSupportedRef.current && (
            <button
              onClick={toggleTorch}
              className="h-9 w-9 rounded-full bg-white/10 flex items-center justify-center"
              aria-label="Toggle flashlight"
            >
              {torch ? <Zap className="w-4 h-4 text-amber-300" /> : <ZapOff className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={onClose}
            className="h-9 w-9 rounded-full bg-white/10 flex items-center justify-center"
            aria-label="Close scanner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Camera surface */}
      <div className="relative flex-1 overflow-hidden">
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-sm text-center space-y-3">
              <CameraOff className="w-10 h-10 text-white/50 mx-auto" />
              <h3 className="text-lg font-bold">Can't open the camera</h3>
              <p className="text-sm text-white/70">
                {error}. On iPhone: tap the "aA" icon in the address bar → Website Settings →
                allow Camera. On desktop: click the camera icon in the address bar and allow
                it for autolabels.io.
              </p>
            </div>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* Reticle overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative w-[86%] max-w-md aspect-[4/1]">
                <div className="absolute inset-0 rounded-xl border-2 border-[#3BB4FF]/80 shadow-[0_0_40px_rgba(59,180,255,0.35)]" />
                <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-[#3BB4FF] to-transparent animate-pulse" />
                <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-transparent via-[#3BB4FF] to-transparent animate-pulse" />
              </div>
            </div>
            {/* Status */}
            <div className="absolute bottom-6 left-0 right-0 px-6">
              {detected ? (
                <div className="mx-auto max-w-md rounded-xl bg-emerald-500 text-white px-4 py-3 text-center shadow-lg">
                  <div className="text-[10px] font-bold uppercase tracking-label opacity-80">
                    VIN detected
                  </div>
                  <div className="font-mono font-bold text-lg tracking-wider">{detected}</div>
                </div>
              ) : (
                <div className="mx-auto max-w-md rounded-xl bg-white/10 backdrop-blur px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-2 text-sm">
                    <ScanLine className="w-4 h-4 text-[#3BB4FF]" />
                    {supported
                      ? "Point at the VIN barcode on the driver's door jamb"
                      : "Camera on — your device can't auto-detect, type the 17 chars below"}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Manual entry fallback — always available so nobody's stuck */}
      <div className="flex-shrink-0 p-4 bg-black/60 backdrop-blur">
        <label className="text-[10px] font-bold uppercase tracking-label text-white/60">
          Or type the VIN
        </label>
        <input
          type="text"
          value={manual}
          maxLength={17}
          autoCapitalize="characters"
          autoComplete="off"
          onChange={(e) => {
            const typed = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
            setManual(typed);
            const read = normalizeScannedVin(typed, "typed");
            if (read.ok) {
              setManualError(null);
              onDetected(read.vin);
              return;
            }
            // Silence until they have typed a full VIN's worth, then say what
            // is wrong with it — a dead field that does nothing is worse.
            setManualError(typed.length >= 17 ? read.message : null);
          }}
          placeholder="17-character VIN"
          className="mt-1 w-full h-11 rounded-lg bg-white/10 border border-white/20 text-white px-3 font-mono tracking-widest text-center focus:outline-none focus:border-[#3BB4FF]"
        />
        {manualError && <p className="mt-2 text-xs text-amber-300">{manualError}</p>}
      </div>
    </div>
  );
};

export default VinBarcodeScanner;
