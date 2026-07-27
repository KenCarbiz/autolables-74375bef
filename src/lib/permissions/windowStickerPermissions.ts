// Granular window-sticker authority.
//
// The dealer capability model is coarse (can_approve_print covers every
// document type). Window stickers carry manufacturer pricing and a
// template choice, so the destructive edges — overriding source data,
// authorizing a billable provider pull, changing the template, publishing
// to the customer passport — get their own permissions. The server
// enforces the same table; this module exists so the UI never offers a
// control the server would reject.

export type WindowStickerPermission =
  | "window_sticker.view"
  | "window_sticker.create"
  | "window_sticker.regenerate"
  | "window_sticker.edit_permitted_fields"
  | "window_sticker.override_source_data"
  | "window_sticker.refresh_neovin"
  | "window_sticker.approve"
  | "window_sticker.publish"
  | "window_sticker.unpublish"
  | "window_sticker.download"
  | "window_sticker.view_history"
  | "window_sticker.restore_version";

export const WINDOW_STICKER_PERMISSIONS: WindowStickerPermission[] = [
  "window_sticker.view",
  "window_sticker.create",
  "window_sticker.regenerate",
  "window_sticker.edit_permitted_fields",
  "window_sticker.override_source_data",
  "window_sticker.refresh_neovin",
  "window_sticker.approve",
  "window_sticker.publish",
  "window_sticker.unpublish",
  "window_sticker.download",
  "window_sticker.view_history",
  "window_sticker.restore_version",
];

const VIEWER: WindowStickerPermission[] = [
  "window_sticker.view",
  "window_sticker.download",
];

// Requesting a regeneration is not the same as authorizing a provider
// charge or publishing to customers.
const REQUESTER: WindowStickerPermission[] = [
  ...VIEWER,
  "window_sticker.view_history",
  "window_sticker.regenerate",
];

const OPERATOR: WindowStickerPermission[] = [
  ...REQUESTER,
  "window_sticker.create",
  "window_sticker.edit_permitted_fields",
  "window_sticker.refresh_neovin",
  "window_sticker.approve",
  "window_sticker.publish",
  "window_sticker.unpublish",
  "window_sticker.restore_version",
];

const FULL: WindowStickerPermission[] = [
  ...OPERATOR,
  "window_sticker.override_source_data",
];

const ROLE_PERMISSIONS: Record<string, WindowStickerPermission[]> = {
  owner: FULL,
  admin: FULL,
  general_manager: FULL,
  gsm: FULL,
  manager: OPERATOR,
  used_car_manager: OPERATOR,
  inventory_manager: OPERATOR,
  sales_manager: REQUESTER,
  salesperson: VIEWER,
  finance: VIEWER,
  office: VIEWER,
  compliance: [...VIEWER, "window_sticker.view_history"],
  biller: VIEWER,
  readonly: VIEWER,
  // Service roles never touch manufacturer pricing or template choice.
  service_manager: VIEWER,
  service_advisor: VIEWER,
  detail: [],
  third_party_vendor: [],
};

const normalize = (role: string | null | undefined): string =>
  String(role ?? "").trim().toLowerCase();

export function windowStickerPermissions(
  role: string | null | undefined,
  isPlatformAdmin = false,
): WindowStickerPermission[] {
  if (isPlatformAdmin) return [...FULL];
  const key = normalize(role);
  if (!key) return [];
  return [...(ROLE_PERMISSIONS[key] ?? VIEWER)];
}

export function hasWindowStickerPermission(
  role: string | null | undefined,
  permission: WindowStickerPermission,
  isPlatformAdmin = false,
): boolean {
  return windowStickerPermissions(role, isPlatformAdmin).includes(permission);
}
