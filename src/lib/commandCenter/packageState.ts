// ──────────────────────────────────────────────────────────────────────
// "The automation produced an artifact" and "the artifact is finished" are two
// different facts, and reading the first as the second is the defect this whole
// module exists to prevent.
//
// A draft sticker, an unsigned K-208 and a prefilled get-ready are all real
// artifacts the automation produced — and none of them is work anybody can stop
// doing. Counting them as complete painted a green "Ready to Market" over an
// unsigned safety inspection, three drafts and a get-ready that was 2 of 6 done.
//
// `automationDone` counts FINISHED. `automationProduced` counts produced, so the
// information the old count carried is still available under its true name.
// ──────────────────────────────────────────────────────────────────────

export type PackageItemStatus =
  | "draft_created" | "created" | "ready" | "prefilled"
  | "published" | "retry_required" | "blocked" | "pending";

const PRODUCED: ReadonlySet<PackageItemStatus> = new Set<PackageItemStatus>([
  "draft_created", "created", "ready", "prefilled", "published",
]);

const FINISHED: ReadonlySet<PackageItemStatus> = new Set<PackageItemStatus>([
  "ready", "published",
]);

const EXCEPTIONS: ReadonlySet<PackageItemStatus> = new Set<PackageItemStatus>([
  "retry_required", "blocked",
]);

export const isProducedState = (s: PackageItemStatus): boolean => PRODUCED.has(s);
export const isFinishedState = (s: PackageItemStatus): boolean => FINISHED.has(s);
export const isExceptionState = (s: PackageItemStatus): boolean => EXCEPTIONS.has(s);

export const countProduced = (items: { status: PackageItemStatus }[]): number =>
  items.filter((i) => isProducedState(i.status)).length;

export const countFinished = (items: { status: PackageItemStatus }[]): number =>
  items.filter((i) => isFinishedState(i.status)).length;

export const countExceptions = (items: { status: PackageItemStatus }[]): number =>
  items.filter((i) => isExceptionState(i.status)).length;

/**
 * "Ready to Market" on screen 1 is the SAME fact as step 4 on screen 2, so it
 * is derived from the same two inputs: nothing in the package is unfinished,
 * and the get-ready has been authorized and worked to completion.
 */
export function isReadyToMarket(args: {
  items: { status: PackageItemStatus }[];
  getReadyStep: number;
}): boolean {
  const { items, getReadyStep } = args;
  return items.length > 0 && countFinished(items) === items.length && getReadyStep === 4;
}
