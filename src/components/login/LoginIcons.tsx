import type { ReactNode } from "react";

export interface LoginIconProps {
  className?: string;
}

interface SvgProps extends LoginIconProps {
  strokeWidth: number;
  children: ReactNode;
}

const Svg = ({ className, strokeWidth, children }: SvgProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className={className}
  >
    {children}
  </svg>
);

// The three hero capability icons are solid in the approved mockup, so they are
// filled here rather than copied as strokes from the pack's SVGs. The form-field
// glyphs below are strokes in the mockup and do match the pack verbatim.
const SolidSvg = ({ className, children }: LoginIconProps & { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className={className}>
    {children}
  </svg>
);

export const IconVehicleTruth = ({ className }: LoginIconProps) => (
  <SolidSvg className={className}>
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M6.55 6.3A2.6 2.6 0 0 1 9 4.6h6a2.6 2.6 0 0 1 2.45 1.7l1.4 3.85A2.6 2.6 0 0 1 21 12.7v3.9a1.5 1.5 0 0 1-1.5 1.5H19v.9a1.5 1.5 0 0 1-3 0v-.9H8v.9a1.5 1.5 0 0 1-3 0v-.9h-.5A1.5 1.5 0 0 1 3 16.6v-3.9a2.6 2.6 0 0 1 2.15-2.55L6.55 6.3Zm1.9.7-1.1 3h9.3l-1.1-3a.6.6 0 0 0-.55-.4H9a.6.6 0 0 0-.55.4ZM6.3 13a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Zm11.4 0a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z"
    />
  </SolidSvg>
);

export const IconComplianceShield = ({ className }: LoginIconProps) => (
  <SolidSvg className={className}>
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 2.5 4.3 5.8v5.5c0 5.1 3.2 8.9 7.7 10.8 4.5-1.9 7.7-5.7 7.7-10.8V5.8L12 2.5Zm4.05 6.35-5.2 5.3-2.9-2.95 1.4-1.4 1.5 1.55 3.8-3.9 1.4 1.4Z"
    />
  </SolidSvg>
);

export const IconRetailOperations = ({ className }: LoginIconProps) => (
  <SolidSvg className={className}>
    <rect x={4} y={12.6} width={4} height={7.4} rx={1} />
    <rect x={10} y={7.6} width={4} height={12.4} rx={1} />
    <rect x={16} y={3.6} width={4} height={16.4} rx={1} />
  </SolidSvg>
);

export const IconEmail = ({ className }: LoginIconProps) => (
  <Svg className={className} strokeWidth={1.8}>
    <rect x={3} y={5} width={18} height={14} rx={2} />
    <path d="m4 7 8 6 8-6" />
  </Svg>
);

export const IconLock = ({ className }: LoginIconProps) => (
  <Svg className={className} strokeWidth={1.8}>
    <rect x={4} y={10} width={16} height={11} rx={2} />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    <path d="M12 15v2" />
  </Svg>
);

export const IconEye = ({ className }: LoginIconProps) => (
  <Svg className={className} strokeWidth={1.8}>
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
    <circle cx={12} cy={12} r={2.5} />
  </Svg>
);

export const IconEyeOff = ({ className }: LoginIconProps) => (
  <Svg className={className} strokeWidth={1.8}>
    <path d="M3 3l18 18" />
    <path d="M10.6 6.2A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.2 2.9M6.2 6.3C3.8 8 2.5 12 2.5 12s3.5 6 9.5 6a9.7 9.7 0 0 0 3-.5" />
    <path d="M9.9 9.9A3 3 0 0 0 14.1 14.1" />
  </Svg>
);

export const IconArrowRight = ({ className }: LoginIconProps) => (
  <Svg className={className} strokeWidth={1.9}>
    <path d="M5 12h14M14 7l5 5-5 5" />
  </Svg>
);

export const IconInfo = ({ className }: LoginIconProps) => (
  <Svg className={className} strokeWidth={1.8}>
    <circle cx={12} cy={12} r={9} />
    <path d="M12 11v6M12 7h.01" />
  </Svg>
);

export const IconWarning = ({ className }: LoginIconProps) => (
  <Svg className={className} strokeWidth={1.8}>
    <path d="M12 3 2.8 20h18.4L12 3Z" />
    <path d="M12 9v4M12 17h.01" />
  </Svg>
);

export const IconCheck = ({ className }: LoginIconProps) => (
  <Svg className={className} strokeWidth={1.9}>
    <path d="m5 12 4 4L19 6" />
  </Svg>
);

export const IconSpinner = ({ className }: LoginIconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    focusable="false"
    className={className}
  >
    <circle cx={12} cy={12} r={9} stroke="currentColor" strokeWidth={2} opacity={0.22} />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
  </svg>
);
