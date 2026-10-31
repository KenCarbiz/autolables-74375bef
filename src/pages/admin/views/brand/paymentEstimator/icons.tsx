import type { SVGProps } from "react";

// The payment estimator handoff glyph set (24px viewBox, 1.75 stroke,
// currentColor), transcribed from assets/icons/*.svg without changes.

const PATHS = {
  back: <><path d="M14 3l-9 9 9 9M5 12h17"/></>,
  calculator: <><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M7 6h10M7 11h2m6 0h2M7 15h2m6 0h2M7 19h2m6 0h2"/></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M7 2v5m10-5v5M3 10h18m-13 5h2m4 0h2"/></>,
  car: <><path d="M3 11l3-7h12l3 7M2 11h20v8H2zM5 19v3m14-3v3M5 15h3m8 0h3"/></>,
  check: <><path d="M3 12l6 6L21 5"/></>,
  chevron: <><path d="M8 3l9 9-9 9"/></>,
  clock: <><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 3"/></>,
  close: <><path d="M4 4l16 16M20 4L4 20"/></>,
  copy: <><rect x="8" y="8" width="13" height="14" rx="2"/><path d="M16 8V2H2v14h6"/></>,
  dollar: <><path d="M12 2v20m6-16H9a4 4 0 0 0 0 8h6a4 4 0 0 1 0 8H5"/></>,
  download: <><path d="M12 2v13m-5-5l5 5 5-5M3 16v6h18v-6"/></>,
  edit: <><path d="M15 3l6 6M3 21l5-1L21 7a3 3 0 0 0-4-4L4 16z"/></>,
  history: <><path d="M3 10a9 9 0 1 1 1 8M3 3v7h7M12 7v5l4 2"/></>,
  info: <><circle cx="12" cy="12" r="10"/><path d="M12 11v7m0-12v1"/></>,
  lock: <><rect x="3" y="10" width="18" height="12" rx="2"/><path d="M7 10V6a5 5 0 0 1 10 0v4m-5 5v3"/></>,
  menu: <><path d="M2 5h20M2 12h20M2 19h20"/></>,
  percent: <><path d="M3 21L21 3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/></>,
  plus: <><path d="M12 2v20M2 12h20"/></>,
  preview: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
  rates: <><path d="M5 19V5M5 19h15M8 14l4-4 3 2 5-7"/></>,
  settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></>,
  shield: <><path d="M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6z"/><path d="M8 12l3 3 5-6"/></>,
  store: <><path d="M3 10v11h18V10M2 10l2-7h16l2 7M8 21v-7h8v7M2 10c2 3 4 3 5 0 2 3 4 3 5 0 2 3 4 3 5 0 1 3 3 3 5 0"/></>,
  warning: <><path d="M12 2L2 21h20zM12 8v6m0 3v1"/></>,
} as const;

export type EstimatorIconName = keyof typeof PATHS;

export function EstimatorIcon({ name, size = 20, ...rest }: { name: EstimatorIconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {PATHS[name]}
    </svg>
  );
}
