import { useRef, useState, useEffect } from "react";
import { Pen, Type, RotateCcw, Check } from "lucide-react";

interface SignaturePadProps {
  label: string;
  subtitle: string;
  value?: string;
  type?: "draw" | "type";
  onChange: (data: string, type: "draw" | "type") => void;
  className?: string;
}

const SignaturePad = ({ label, subtitle, value, type: sigType, onChange, className }: SignaturePadProps) => {
  const [mode, setMode] = useState<"draw" | "type">(sigType || "draw");
  const [typedName, setTypedName] = useState(sigType === "type" ? (value || "") : "");
  const [hasDrawn, setHasDrawn] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

  useEffect(() => {
    if (mode === "draw" && value && canvasRef.current) {
      const img = new Image();
      img.onload = () => {
        const ctx = canvasRef.current?.getContext("2d");
        if (ctx && canvasRef.current) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          ctx.drawImage(img, 0, 0);
          setHasDrawn(true);
        }
      };
      img.src = value;
    }
  }, [mode, value]);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    isDrawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      const { x, y } = getPos(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current) return;
    if ("touches" in e) e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      const { x, y } = getPos(e);
      // Premium thin pen — 1.5px, dark ink, smooth curves
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1a1a2e";
      ctx.lineTo(x, y);
      ctx.stroke();
      setHasDrawn(true);
    }
  };

  const endDraw = () => {
    isDrawing.current = false;
    if (canvasRef.current) {
      onChange(canvasRef.current.toDataURL(), "draw");
    }
  };

  const clearCanvas = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      onChange("", "draw");
      setHasDrawn(false);
    }
  };

  const isSigned = mode === "draw" ? hasDrawn : !!typedName.trim();

  return (
    <div className={`${className || ""}`}>
      {/* Header with label + mode toggle */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isSigned && <Check className="w-3.5 h-3.5 text-emerald-500" />}
          <span className="text-xs font-semibold text-foreground">{label}</span>
        </div>
        <div className="flex gap-0.5 bg-muted rounded-md p-0.5">
          <button
            onClick={() => setMode("draw")}
            className={`inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded transition-colors ${
              mode === "draw"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Pen className="w-3 h-3" />
            Draw
          </button>
          <button
            onClick={() => setMode("type")}
            className={`inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded transition-colors ${
              mode === "type"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Type className="w-3 h-3" />
            Type
          </button>
        </div>
      </div>

      {mode === "draw" ? (
        <div className="relative group">
          {/* Signature line guide */}
          <div className="absolute bottom-[18px] left-4 right-4 h-[1px] bg-border-custom/60 pointer-events-none" />

          <canvas
            ref={canvasRef}
            width={800}
            height={160}
            className={`w-full h-[120px] md:h-[150px] rounded-lg border-2 transition-colors cursor-crosshair ${
              hasDrawn
                ? "border-emerald-300 bg-emerald-50/30"
                : "border-border bg-card hover:border-primary/30"
            }`}
            style={{ touchAction: "none" }}
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={endDraw}
            onMouseLeave={endDraw}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={endDraw}
          />

          {/* Placeholder text when empty */}
          {!hasDrawn && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <p className="text-xs text-muted-foreground/40">Sign here</p>
            </div>
          )}

          {/* Clear button */}
          {hasDrawn && (
            <button
              onClick={clearCanvas}
              className="absolute top-2 right-2 inline-flex items-center gap-1 text-[10px] px-2 py-1 bg-card/90 backdrop-blur-sm rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <input
            value={typedName}
            onChange={(e) => {
              setTypedName(e.target.value);
              onChange(e.target.value, "type");
            }}
            placeholder="Type your full legal name"
            className={`w-full h-[80px] px-4 rounded-lg border-2 bg-card outline-none text-center transition-colors ${
              typedName.trim()
                ? "border-emerald-300 bg-emerald-50/30"
                : "border-border hover:border-primary/30"
            }`}
            style={{
              fontFamily: "'Brush Script MT', 'Segoe Script', 'Apple Chancery', cursive",
              fontSize: "28px",
              letterSpacing: "0.02em",
            }}
          />
          {/* Baseline */}
          <div className="absolute bottom-[18px] left-4 right-4 h-[1px] bg-border-custom/40 pointer-events-none" />
        </div>
      )}

      <p className="text-[10px] text-muted-foreground mt-1.5">{subtitle}</p>
    </div>
  );
};

export default SignaturePad;
