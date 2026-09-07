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

export const IconVehicleTruth = ({ className }: LoginIconProps) => (
  <Svg className={className} strokeWidth={1.9}>
    <path d="M5 11l1.5-4.2A2.5 2.5 0 0 1 8.85 5h6.3a2.5 2.5 0 0 1 2.35 1.8L19 11" />
    <path d="M4 11h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z" />
    <path d="M6 19v2M18 19v2M6 15h.01M18 15h.01M8.5 15h7" />
  </Svg>
);

export const IconComplianceShield = ({ className }: LoginIconProps) => (
  <Svg className={className} strokeWidth={1.9}>
    <path d="M12 3 5 6v5c0 4.7 2.9 8.2 7 10 4.1-1.8 7-5.3 7-10V6l-7-3Z" />
    <path d="m8.7 12.2 2.1 2.1 4.5-4.6" />
  </Svg>
);

export const IconRetailOperations = ({ className }: LoginIconProps) => (
  <Svg className={className} strokeWidth={1.9}>
    <path d="M4 20V13h4v7M10 20V8h4v12M16 20V4h4v16" />
  </Svg>
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
