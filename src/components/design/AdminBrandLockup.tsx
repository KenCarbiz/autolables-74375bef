import { ADMIN_ASSETS } from "@/lib/design/adminAssets";
import { cn } from "@/lib/utils";

// The official AutoLabels lockup, for the ADMIN shell only.
//
// Deliberately NOT the shared brand/Logo component. That one hand-draws the
// auto(LABELS) wordmark and is rendered by 27 surfaces including
// VehiclePassportGoverned — the customer passport, which is owner-approved and
// locked. Swapping it there to make the system look uniform is exactly what the
// asset pack's own instructions forbid, so the admin gets its own component and
// every public surface keeps the logo it was signed off with.
//
// These are files, not inline paths: the pack marks the lockups "do not
// recolor", so the whole point is that they keep their own colours. That is the
// opposite of the icons, where currentColor inheritance is why AdminIcon has to
// inline them.

type Variant = "lockup" | "wordmark" | "mark";

/** Light-surface id, then the reverse cut for dark surfaces. */
const PAIRS: Record<Variant, readonly [light: string, dark: string]> = {
  lockup: ["001", "002"],
  wordmark: ["003", "004"],
  mark: ["005", "006"],
};

export interface AdminBrandLockupProps {
  variant?: Variant;
  /** Rendered height in px. Width follows the artwork's own ratio. */
  height?: number;
  className?: string;
}

export function AdminBrandLockup({
  variant = "lockup", height = 28, className,
}: AdminBrandLockupProps) {
  const [lightId, darkId] = PAIRS[variant];
  const light = ADMIN_ASSETS[lightId];
  const dark = ADMIN_ASSETS[darkId];
  if (!light || !dark) return null;

  // Both cuts are rendered and swapped in CSS rather than chosen in JS. The
  // theme can change without a re-render, and a server-rendered or
  // pre-hydration paint would otherwise show the wrong cut on a dark shell.
  return (
    <span
      className={cn("inline-flex items-center", className)}
      role="img"
      aria-label="AutoLabels"
    >
      <img
        src={light.path}
        alt=""
        aria-hidden="true"
        style={{ height }}
        className="w-auto dark:hidden"
        draggable={false}
      />
      <img
        src={dark.path}
        alt=""
        aria-hidden="true"
        style={{ height }}
        className="hidden w-auto dark:block"
        draggable={false}
      />
    </span>
  );
}

export default AdminBrandLockup;
