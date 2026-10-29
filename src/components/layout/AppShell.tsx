import { ReactElement, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useViewTransitionNavigate } from "@/lib/navigation";
import { hasDealerCapability, roleDisplayName, type DealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { canSeeAdminTab } from "@/lib/permissions/adminTabAccess";
import {
  Building2,
  Car,
  Check,
  CreditCard,
  HelpCircle,
  LayoutDashboard,
  Lock,
  LogOut,
  ScanLine,
  Settings,
  Tag,
  Users,
  Video,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { serviceNotificationLabel, isUnread, type UserNotificationRow } from "@/lib/service/notificationTypes";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useNavBadges } from "@/hooks/useNavBadges";
import { useAudit } from "@/contexts/AuditContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import CommandPalette, { useCommandPalette } from "@/components/layout/CommandPalette";
import { usePlatformEntitlements } from "@/hooks/usePlatformEntitlements";
import { VinScanContext, prefersLiveScanner } from "@/contexts/VinScanContext";
import {
  FRAME_LINKS,
  bottomNavCandidates,
  canOpenAdministration,
  findActiveNavItem,
  navModeForRole,
  navSectionsForViewer,
} from "@/components/layout/adminNav";
import { paletteSearchScope, searchPrompt } from "@/components/layout/searchScope";
import { useNavDrawer } from "@/components/layout/useNavDrawer";
import { AppRail } from "@/components/layout/AppRail";
import { AppHeader } from "@/components/layout/AppHeader";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";

interface AppShellProps {
  children: ReactNode;
}

// Family apps shown in the user-menu "Switch app" section. Access is
// gated on AutoCurb's product_ids (source of truth for cross-app
// subscriptions), fetched via platform-entitlements on dropdown open.
interface FamilyApp {
  id: string;
  name: string;
  icon: React.ElementType;
  url: string;
  entitlementKey: string;
}
const FAMILY_APPS: FamilyApp[] = [
  { id: "autolabels", name: "AutoLabels", icon: Tag,   url: "",                        entitlementKey: "autolabels" },
  { id: "autocurb",   name: "AutoCurb",   icon: Car,   url: "https://autocurb.io/sso", entitlementKey: "autocurb"   },
  { id: "autofilm",   name: "AutoFilm",   icon: Video, url: "https://autofilm.io/sso", entitlementKey: "autofilm"   },
];

const underSegment = (base: string) => (p: string) => p === base || p.startsWith(`${base}/`);

// The frame prints a page heading only where the page renders no h1 of its
// own on desktop, so no page shows its title twice and none loses it. An
// explicit list: pages are lazy, so the DOM cannot be asked at render time.
const SHELL_HEADINGS: { match: (pathname: string) => boolean; title: string; subtitle: string }[] = [
  { match: (p) => p === "/inventory" || p === "/inventory-v2", title: "Inventory Command Center", subtitle: "Manage, optimize, and publish your inventory with confidence." },
  { match: (p) => p === "/add-inventory", title: "Add to Inventory", subtitle: "Scan or enter a VIN to add the vehicle." },
  { match: (p) => p === "/description-operations", title: "Description Operations", subtitle: "Automated merchandising intelligence across every vehicle." },
  { match: underSegment("/print-center"), title: "Documents & Print Center", subtitle: "One versioned document package for the vehicle, printer, and customer Passport." },
  { match: (p) => p.startsWith("/get-ready-command/"), title: "Get Ready Command", subtitle: "Review the work AutoLabels prepared, then authorize once." },
  { match: underSegment("/vin-command"), title: "VIN Command Center", subtitle: "Everything created automatically. Review exceptions and authorize the next step." },
  { match: (p) => p.startsWith("/service/vehicle/"), title: "Vehicle Service Workspace", subtitle: "One shared task from inspection to K-208 execution and delivery clearance." },
  { match: (p) => p.startsWith("/service/scan/"), title: "Service Desk", subtitle: "Safety inspections, get-ready work, and K-208 execution." },
  { match: (p) => p.startsWith("/k208/"), title: "K-208 Inspection Form", subtitle: "The completed CT DMV K-208, ready to print as the buyer's copy." },
  { match: (p) => p.startsWith("/addendum-label/"), title: "Addendum Label", subtitle: "The 4.5 x 11 in addendum label, ready to print." },
];

// A platform administrator with no dealership membership is admitted on the
// house tenant; the rooftop slot names where they are instead of asking them
// to pick a store there is no control for.
const PLATFORM_LABEL = "AutoLabels platform";

const MENU_ITEM = "cursor-pointer rounded-lg min-h-11 gap-2.5 lg:min-h-0";
const MENU_ICON = "h-5 w-5 shrink-0 text-muted-foreground";

const AppShell = ({ children }: AppShellProps) => {
  const { user, isAdmin, signOut } = useAuth();
  const { tenant, currentStore, stores, setCurrentStore } = useTenant();
  const { settings } = useDealerSettings();
  const { member } = useEntitlements();
  const { entries } = useAudit();
  const location = useLocation();
  const navigate = useViewTransitionNavigate();
  const [showMobileQr, setShowMobileQr] = useState(false);
  const [rooftopOpen, setRooftopOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const bellPanelRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const { open: paletteOpen, setOpen: setPaletteOpen, restoreFocus: restorePaletteFocus } = useCommandPalette();
  const { productIds: platformProductIds, load: loadPlatformProducts } = usePlatformEntitlements();
  const drawer = useNavDrawer(`${location.pathname}${location.search}`);

  const role = member?.role;
  const can = useCallback((c: DealerCapability) => hasDealerCapability(role, c, isAdmin), [role, isAdmin]);
  // Technicians and third-party vendors get their own shell: one worklist, and
  // none of the dealer chrome that creates, prices or sells a vehicle.
  const navMode = navModeForRole(role);
  const dealerMode = navMode === "dealer";
  // A switch that is not set reads as on, exactly as Admin V2 reads it, so the
  // rail and the Administration tabs never disagree about a feature.
  const hasFeature = useCallback((key: string) => (settings as unknown as Record<string, unknown>)[key] !== false, [settings]);
  // Administration is offered only when Admin V2 has a tab this viewer may open.
  const adminDoor = dealerMode && canOpenAdministration({ role, isAdmin, hasFeature });

  // Someone who completes get-ready work but does not stock the lot is
  // checking a car IN when they scan it, not adding it to the print queue.
  const scanPath = can("can_complete_get_ready") && !can("can_edit_inventory") ? "/check-in" : "/scan";
  const openScan = useCallback(() => {
    if (prefersLiveScanner()) navigate(scanPath);
    else setShowMobileQr(true);
  }, [navigate, scanPath]);
  const vinScanApi = useMemo(() => ({ openScan }), [openScan]);

  // Worklist counts on the nav rows that represent queues; 0 renders no badge.
  const badges = useNavBadges();

  // One capability-gated model from ./adminNav; the rail and the drawer are
  // the same element, so both read this.
  const visibleSections = navSectionsForViewer({ role, isAdmin, badges, hasFeature });
  const activeLeaf = findActiveNavItem(visibleSections, location.pathname, location.search);

  const shellHeading = SHELL_HEADINGS.find((h) => h.match(location.pathname));

  // The header names the dealer GROUP on line 1 and the rooftop on line 2 --
  // two different facts, never sourced from the same field. The house
  // sentinel is not a real dealer.
  const realTenant = tenant && tenant.id !== "house" ? tenant : null;
  const settingsDealerName = settings.dealer_name && settings.dealer_name !== "Your Dealership" ? settings.dealer_name : "";
  const rooftopGroup = realTenant
    ? (realTenant.name || "").trim() || settingsDealerName || currentStore?.name || ""
    : isAdmin ? PLATFORM_LABEL : "";
  const rooftopStore = realTenant && currentStore?.name && currentStore.name !== rooftopGroup ? currentStore.name : "";
  // A rooftop's city is its own. The dealership's address stands in only for
  // the one store synthesized from the tenant (TenantContext), or no store.
  const usesDealershipAddress = !currentStore || (!!realTenant && currentStore.id === realTenant.id);
  const rooftopLocation = realTenant
    ? (usesDealershipAddress ? [settings.dealer_city, settings.dealer_state] : [currentStore?.city, currentStore?.state])
        .map((part) => (part || "").trim())
        .filter(Boolean)
        .join(", ")
    : "";

  const tenantId = realTenant?.id ?? null;
  const searchLabel = searchPrompt(paletteSearchScope({ role, isAdmin, hasMember: !!member, tenantId, storeId: currentStore?.id ?? null }));

  // The activity feed is the dealership's record, not the worker's: it is
  // offered only to the roles that can open the Activity tab it leads to.
  // Everyone else's bell carries the notifications addressed to them
  // (RLS-scoped, below).
  const canSeeActivity = dealerMode && canSeeAdminTab(role, "audit", isAdmin);
  const canSeeOverview = dealerMode && canSeeAdminTab(role, "home", isAdmin);

  // Personal bell items (user_notifications, 20260726106000), listed first,
  // then the recent activity feed. RLS scopes the query to the signed-in
  // user's own rows.
  const [serviceNotifs, setServiceNotifs] = useState<UserNotificationRow[]>([]);
  const loadServiceNotifs = useCallback(async () => {
    if (!user?.id) { setServiceNotifs([]); return; }
    try {
      const { data, error } = await (supabase as any)
        .from("user_notifications")
        .select("id, tenant_id, user_id, type, dedupe_key, vin, payload, read_at, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (!error) setServiceNotifs((data as UserNotificationRow[]) || []);
    } catch { /* table not yet migrated in this environment: bell stays activity-only */ }
  }, [user?.id]);
  useEffect(() => {
    loadServiceNotifs();
    const onFocus = () => loadServiceNotifs();
    window.addEventListener("focus", onFocus);
    const poll = window.setInterval(loadServiceNotifs, 60_000);
    return () => { window.removeEventListener("focus", onFocus); window.clearInterval(poll); };
  }, [loadServiceNotifs]);
  // The red count is what the viewer can clear: their own unread
  // notifications. Activity entries have no read state, so they never count.
  const unreadNotifs = serviceNotifs.filter(isUnread).length;
  const markNotifRead = useCallback(async (n: UserNotificationRow) => {
    setServiceNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
    await (supabase as any).from("user_notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
  }, []);
  const markAllNotifsRead = useCallback(async () => {
    if (!user?.id) return;
    const now = new Date().toISOString();
    setServiceNotifs((prev) => prev.map((x) => (x.read_at ? x : { ...x, read_at: now })));
    await (supabase as any).from("user_notifications").update({ read_at: now }).eq("user_id", user.id).is("read_at", null);
  }, [user?.id]);

  const recentActivity = useMemo(
    () =>
      canSeeActivity
        ? [...entries].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)).slice(0, 12)
        : [],
    [entries, canSeeActivity],
  );
  const formatActivityLabel = (a: string) =>
    a.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const formatActivityWhen = (iso: string) => {
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  const activityDot = (action: string) => {
    if (action.includes("block")) return "bg-rose-500";
    if (action.includes("signed") || action.includes("published")) return "bg-emerald-500";
    if (action.includes("created") || action.includes("added")) return "bg-blue-500";
    if (action.includes("deleted") || action.includes("rejected")) return "bg-rose-400";
    return "bg-slate-400";
  };
  // For sync events, read the outcome the edge function recorded into details so
  // the feed shows success vs failure (and the headline counts) at a glance.
  const syncOutcome = (e: { action: string; details?: Record<string, unknown> }): { ok: boolean; text: string } | null => {
    if (!/^(marketcheck_sync|autocurb_sync|inventory_sync)/.test(e.action)) return null;
    const d = (e.details || {}) as Record<string, unknown>;
    const failed = !!d.error || (d.seen === 0 && !!d.note);
    if (failed) return { ok: false, text: String(d.note || d.error || "Sync failed") };
    const seen = typeof d.seen === "number" ? d.seen : (typeof d.num_found === "number" ? d.num_found : null);
    const nu = typeof d.new_vehicles === "number" ? d.new_vehicles : null;
    return { ok: true, text: seen != null ? `${seen} vehicles${nu ? ` · ${nu} new` : ""}` : "Completed" };
  };
  // Pull the most identifying label for an activity row so the feed names
  // WHICH vehicle — stock #, VIN, year/make/model, or the public slug —
  // instead of a bare "vehicle_listing".
  const activitySubject = (e: { entity_type?: string; entity_id?: string; user_email?: string | null; details?: Record<string, unknown> }): string => {
    const d = (e.details || {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
    const stock = str(d.stock);
    const vin = str(d.vin) || (e.entity_type === "advertised_price" ? str(e.entity_id) : "");
    let subject = str(d.ymm) || [d.year, d.make, d.model].map(str).filter(Boolean).join(" ") || str(d.product);
    let idTag = stock ? `Stock #${stock}` : "";
    const slug = str(d.slug);
    if (!subject && slug) {
      const toks = slug.split("-");
      const last = toks[toks.length - 1];
      if (/^\d+$/.test(last)) { idTag = idTag || `#${last}`; toks.pop(); }
      subject = toks.map((t) => (/\d/.test(t) ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1))).join(" ");
    }
    // No full VIN — too long. Fall back to a short stock-style id (last 6),
    // which for these dealers matches the stock number.
    if (!idTag && vin) idTag = `#${vin.slice(-6)}`;
    return [subject, idTag].filter(Boolean).join(" · ");
  };

  const emailLocal = user?.email?.split("@")[0] || "";
  const metadataName = ((user?.user_metadata as { full_name?: string } | undefined)?.full_name || "").trim();
  const accountName = (() => {
    if (metadataName) return metadataName;
    const raw = emailLocal.split(/[._]/)[0] || "Account";
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  })();
  const accountInitials = (() => {
    const words = metadataName.split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    const parts = emailLocal.split(/[._-]/).filter(Boolean);
    const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : (metadataName || emailLocal).slice(0, 2);
    return (letters || "U").toUpperCase();
  })();
  // The dealership role and the platform authority are different facts and
  // get separate chips; a platform admin's dealer role is still their role.
  const accountRole = role ? roleDisplayName(role) : "";

  useEffect(() => {
    if (!user) return;
    if (tenant?.id !== "house") return;
    if (location.pathname === "/onboarding") return;
    const timer = setTimeout(() => {
      toast.info("Finish setup to activate your dealership workspace", {
        action: { label: "Continue", onClick: () => navigate("/onboarding") },
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [user, tenant?.id, location.pathname, navigate]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  const handleManageBilling = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("billing-portal-session", { body: { return_url: window.location.href } });
      if (error || !data?.url) {
        toast.error("Couldn't open billing portal");
        return;
      }
      window.location.href = data.url as string;
    } catch {
      toast.error("Couldn't open billing portal");
    }
  };

  const chooseStore = (store: (typeof stores)[number]) => {
    setCurrentStore(store);
    setRooftopOpen(false);
  };

  // A popover with a filter and a listbox: the filter takes focus when it
  // opens, the arrow keys move through the rooftops, Enter switches and closes,
  // and focus goes back to the switcher.
  const renderRooftopMenu = (trigger: ReactElement) => (
    <Popover open={rooftopOpen} onOpenChange={setRooftopOpen} modal>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" aria-label="Switch rooftop" className="w-[min(320px,calc(100vw-32px))] bg-card p-0">
        <Command loop label="Search dealerships" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground">
          <CommandInput placeholder="Search dealerships…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No dealerships match.</CommandEmpty>
            <CommandGroup heading="Rooftops">
              {stores.map((store, index) => {
                const active = store.id === currentStore?.id;
                const where = [store.city, store.state].filter(Boolean).join(", ");
                return (
                  <CommandItem
                    key={store.id}
                    value={`${store.name} ${where} #${index + 1}`}
                    onSelect={() => chooseStore(store)}
                    className={`min-h-11 cursor-pointer gap-2.5 rounded-lg px-2.5 py-2 lg:min-h-0 ${active ? "bg-blue-50/60" : ""}`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600/10 text-blue-700" aria-hidden="true">
                      <Building2 className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-[13px] font-semibold text-foreground">{store.name}</span>
                      {where && <span className="block truncate text-[11px] text-muted-foreground">{where}</span>}
                    </span>
                    {active && (
                      <>
                        <Check className="h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
                        <span className="sr-only">(current rooftop)</span>
                      </>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {canSeeOverview && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  {/* Named for where it goes: Admin V2 Overview. Rooftops are
                      added and edited in onboarding, not here. */}
                  <CommandItem
                    value="Dealership overview"
                    onSelect={() => { setRooftopOpen(false); navigate(FRAME_LINKS.dealershipOverview); }}
                    className="min-h-11 cursor-pointer gap-2.5 rounded-lg px-2.5 py-2 lg:min-h-0"
                  >
                    <LayoutDashboard className={MENU_ICON} aria-hidden="true" /> Dealership overview
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );

  const renderNotifications = (trigger: ReactElement) => (
    <Popover open={bellOpen} onOpenChange={setBellOpen} modal>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        ref={bellPanelRef}
        align="end"
        tabIndex={-1}
        aria-labelledby="frame-notifications-title"
        className="w-[min(360px,calc(100vw-32px))] bg-card p-0 focus:outline-none"
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <h2 id="frame-notifications-title" className="text-sm font-bold text-foreground">Notifications</h2>
          <span className="text-[11px] text-muted-foreground">{unreadNotifs > 0 ? `${unreadNotifs} unread` : "Nothing unread"}</span>
        </div>

        {serviceNotifs.length > 0 && (
          <section aria-labelledby="frame-for-you" className="border-b border-border">
            <div className="flex items-center justify-between px-3 py-1.5">
              <h3 id="frame-for-you" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">For you</h3>
              {unreadNotifs > 0 && (
                <button
                  type="button"
                  onClick={() => { void markAllNotifsRead(); bellPanelRef.current?.focus(); }}
                  className="min-h-11 rounded px-2 text-[12px] font-semibold text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary lg:min-h-0 lg:py-1"
                >
                  Mark all read
                </button>
              )}
            </div>
            <ul className="max-h-[220px] overflow-y-auto pb-1">
              {serviceNotifs.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      void markNotifRead(n);
                      setBellOpen(false);
                      navigate(n.vin ? FRAME_LINKS.serviceVehicle(n.vin) : FRAME_LINKS.serviceDesk);
                    }}
                    className="flex min-h-11 w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-adm-primary"
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-slate-300" : "bg-blue-600"}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className={`block truncate text-[13px] ${n.read_at ? "font-medium text-muted-foreground" : "font-semibold text-foreground"}`}>
                        {serviceNotificationLabel(n.type)}
                      </span>
                      {n.vin && <span className="block font-mono text-[11px] text-muted-foreground">VIN …{n.vin.slice(-6)}</span>}
                      {!n.read_at && <span className="sr-only">Unread.</span>}
                    </span>
                    <span className="mt-0.5 shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatActivityWhen(n.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {canSeeActivity && (
          <section aria-labelledby="frame-recent-activity">
            <div className="flex items-center justify-between px-3 py-1.5">
              <h3 id="frame-recent-activity" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Recent activity</h3>
              <span className="text-[11px] text-muted-foreground">{recentActivity.length} events</span>
            </div>
            {recentActivity.length === 0 ? (
              <p className="px-4 pb-6 pt-2 text-center text-xs text-muted-foreground">
                No recent activity yet. Stickers, signings, and compliance events will show here.
              </p>
            ) : (
              // A record of what happened, not a set of doors: the Activity
              // tab below is where an entry is opened and searched.
              <ul className="max-h-[360px] overflow-y-auto py-1">
                {recentActivity.map((e) => {
                  const outcome = syncOutcome(e as { action: string; details?: Record<string, unknown> });
                  return (
                    <li key={e.id} className="flex items-start gap-2.5 px-3 py-2">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${outcome ? (outcome.ok ? "bg-emerald-500" : "bg-rose-500") : activityDot(e.action)}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                          <span className="truncate">{formatActivityLabel(e.action)}</span>
                          {outcome && (
                            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${outcome.ok ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                              {outcome.ok ? "Success" : "Failed"}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {outcome ? outcome.text : (activitySubject(e) || `${e.entity_type}${e.user_email ? ` · ${e.user_email}` : ""}`)}
                        </span>
                      </span>
                      <span className="mt-0.5 shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatActivityWhen(e.created_at)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="border-t border-border p-1">
              <button
                type="button"
                onClick={() => { setBellOpen(false); navigate(FRAME_LINKS.activity); }}
                className="flex min-h-11 w-full items-center justify-center rounded-md text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-adm-primary lg:min-h-9"
              >
                View all activity
              </button>
            </div>
          </section>
        )}

        {serviceNotifs.length === 0 && !canSeeActivity && (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            You're all caught up. Work assigned to you will show here.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );

  const workspaceSettingsHref = canSeeAdminTab(role, "settings", isAdmin) ? FRAME_LINKS.workspaceSettings : FRAME_LINKS.administration;

  const renderUserMenu = (trigger: ReactElement) => (
    <DropdownMenu onOpenChange={(open) => { if (open) void loadPlatformProducts(); }}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(320px,calc(100vw-32px))] bg-card p-2">
        <div className="flex items-center gap-3 px-2 py-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-adm-selected text-sm font-semibold text-adm-primary" aria-hidden="true">
            {accountInitials}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-foreground">{accountName}</div>
            <div className="truncate text-[11px] text-muted-foreground">{user?.email}</div>
            {(accountRole || isAdmin) && (
              <div className="mt-1 inline-flex flex-wrap items-center gap-1">
                {accountRole && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700">{accountRole}</span>}
                {isAdmin && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-700">Platform Admin</span>}
              </div>
            )}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="px-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Switch app</DropdownMenuLabel>
        {FAMILY_APPS.map((app) => {
          const Icon = app.icon;
          const isCurrent = app.id === "autolabels";
          const unlocked = isCurrent || platformProductIds.includes(app.entitlementKey);
          return (
            <DropdownMenuItem
              key={app.id}
              disabled={!unlocked || isCurrent}
              onSelect={(event) => {
                if (isCurrent || !unlocked) { event.preventDefault(); return; }
                // Mint a short-lived handoff token so the sibling app can SSO
                // the user in without a re-login.
                void (async () => {
                  try {
                    const { data, error } = await supabase.functions.invoke("mint-handoff-token", {
                      body: { targetApp: app.id },
                    });
                    const token = (data as { token?: string } | null)?.token;
                    if (error || !token) {
                      window.location.href = app.url;
                      return;
                    }
                    window.location.href = `${app.url}?t=${encodeURIComponent(token)}`;
                  } catch {
                    window.location.href = app.url;
                  }
                })();
              }}
              className={`${MENU_ITEM} py-2 ${unlocked && !isCurrent ? "" : "cursor-default"} ${!unlocked ? "opacity-60" : ""}`}
            >
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${unlocked ? "bg-muted" : "bg-muted/60"}`} aria-hidden="true">
                <Icon className={`h-5 w-5 ${unlocked ? "" : "text-muted-foreground"}`} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  {app.name}
                  {!unlocked && <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                </div>
                {isCurrent && <div className="text-[11px] text-muted-foreground">Current app</div>}
                {!unlocked && <div className="text-[11px] text-muted-foreground">Not on your plan</div>}
              </div>
              {isCurrent && <span className="ml-2 h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="px-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Account</DropdownMenuLabel>
        {dealerMode && can("can_manage_team") && (
          <DropdownMenuItem onSelect={() => navigate(FRAME_LINKS.team)} className={MENU_ITEM}>
            <Users className={MENU_ICON} aria-hidden="true" /> Team & permissions
          </DropdownMenuItem>
        )}
        {adminDoor && (
          <DropdownMenuItem onSelect={() => navigate(workspaceSettingsHref)} className={MENU_ITEM}>
            <Settings className={MENU_ICON} aria-hidden="true" /> Workspace settings
          </DropdownMenuItem>
        )}
        {/* Same gate as the palette. The billing-portal-session function checks
            membership only; its missing role check is a separate backend item. */}
        {can("can_manage_billing") && (
          <DropdownMenuItem onSelect={() => void handleManageBilling()} className={MENU_ITEM}>
            <CreditCard className={MENU_ICON} aria-hidden="true" /> Plan & billing
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => navigate(FRAME_LINKS.trust)} className={MENU_ITEM}>
          <HelpCircle className={MENU_ICON} aria-hidden="true" /> Help & trust center
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void handleSignOut()} className={`${MENU_ITEM} text-destructive focus:text-destructive`}>
          <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Role-aware mobile bottom nav: Scan stays the raised center; the four side
  // slots are filled from the role's capabilities (a service writer gets Get
  // Ready instead of Deals/Create, etc.).
  const sideItems = bottomNavCandidates(navMode).filter((c) => can(c.capability)).slice(0, 4);
  const bottomNavItems: { label: string; path: string; icon: typeof Car; raised?: boolean }[] = [
    ...sideItems.slice(0, 2),
    { label: "Scan", path: "scan", icon: ScanLine, raised: true },
    ...sideItems.slice(2, 4),
  ];
  // Lit by the same matchers as the rail, so a nested page lights its slot.
  const bottomActive = (path: string) => (activeLeaf ? activeLeaf.path === path : location.pathname === path);

  return (
    <VinScanContext.Provider value={vinScanApi}>
      {/* al-admin scopes the admin palette. Public routes and the locked
          customer passport render outside this shell and keep :root. */}
      <div className="al-admin min-h-screen bg-background flex w-full overflow-hidden">
        <a
          href="#app-scroll"
          onClick={(event) => { event.preventDefault(); mainRef.current?.focus(); }}
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[70] focus:rounded-[6px] focus:bg-adm-surface focus:px-4 focus:py-2.5 focus:text-[14px] focus:font-semibold focus:text-adm-ink focus:shadow-lg focus:outline focus:outline-2 focus:outline-adm-primary"
        >
          Skip to content
        </a>

        {drawer.open && <div className="fixed inset-0 z-[45] bg-black/50 lg:hidden" onClick={drawer.closeDrawer} aria-hidden="true" />}

        {/* One rail at every width: sticky beside the content from lg, an
            off-canvas modal drawer below it. Closed, the drawer is invisible,
            so its links leave the tab order instead of hiding off-screen. */}
        <AppRail
          id="app-rail"
          sections={visibleSections}
          pathname={location.pathname}
          search={location.search}
          onNavigate={drawer.closeDrawer}
          onClose={drawer.closeDrawer}
          modal={drawer.modal}
          closeButtonRef={drawer.closeRef}
          className={drawer.railClassName}
        />

        <div ref={drawer.backgroundRef} className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
          <AppHeader
            groupName={rooftopGroup}
            storeLocation={rooftopLocation}
            storeName={rooftopStore}
            renderRooftopMenu={stores.length > 1 ? renderRooftopMenu : undefined}
            onOpenSearch={() => setPaletteOpen(true)}
            searchLabel={searchLabel}
            notificationCount={unreadNotifs}
            renderNotifications={renderNotifications}
            userName={accountName}
            userInitials={accountInitials}
            renderUserMenu={renderUserMenu}
            onOpenMenu={drawer.openDrawer}
            menuOpen={drawer.open}
            menuControls="app-rail"
            menuButtonRef={drawer.triggerRef}
          />

          <main ref={mainRef} id="app-scroll" tabIndex={-1} className="flex-1 overflow-y-auto pb-24 focus:outline-none lg:pb-0">
            {shellHeading && (
              <div className="hidden lg:block print:hidden px-6 pt-6">
                {/* The scale carries size, line-height, weight and tracking
                    together, so a heading cannot drift to the wrong weight. */}
                <h1 className="text-al-section text-foreground">{shellHeading.title}</h1>
                <p className="mt-0.5 text-al-meta text-muted-foreground">{shellHeading.subtitle}</p>
              </div>
            )}
            {children}
          </main>

          <nav aria-label="Quick actions" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-white/95 px-5 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden">
            <div className="mx-auto grid max-w-[520px] grid-cols-5 items-end gap-1">
              {bottomNavItems.map((item) => {
                const Icon = item.icon;
                if (item.raised) {
                  return (
                    <button key={item.label} type="button" onClick={openScan} className="flex flex-col items-center justify-end gap-1 rounded-lg text-[12px] font-bold text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary">
                      <span className="-mt-8 flex h-14 w-14 items-center justify-center rounded-full border border-border bg-white text-blue-700 shadow-lg">
                        <Icon className="h-7 w-7" aria-hidden="true" />
                      </span>
                      <span>{item.label}</span>
                    </button>
                  );
                }
                const active = bottomActive(item.path);
                return (
                  <Link
                    key={item.label}
                    to={item.path}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-11 flex-col items-center justify-end gap-1 rounded-lg text-[12px] font-bold transition-colors duration-hover ease-standard motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary ${active ? "text-blue-700" : "text-muted-foreground"}`}
                  >
                    <span className="flex h-7 items-center justify-center">
                      <Icon className="h-6 w-6" aria-hidden="true" />
                    </span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>

        {showMobileQr && (
          <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={() => setShowMobileQr(false)}>
            <div className="bg-card rounded-2xl p-6 max-w-sm w-full text-center" onClick={(event) => event.stopPropagation()}>
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
                <ScanLine className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-xl font-semibold mb-2">Scan with your phone</h2>
              <p className="text-sm text-muted-foreground mb-4">Open the live VIN scanner on your mobile device.</p>
              <div className="bg-white p-4 rounded-xl inline-block">
                <QRCodeSVG value={`${window.location.origin}${scanPath}`} size={180} />
              </div>
              <button onClick={() => setShowMobileQr(false)} className="mt-4 w-full h-10 rounded-lg border border-border hover:bg-muted text-sm font-medium">
                Close
              </button>
            </div>
          </div>
        )}

        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          onCloseAutoFocus={(event) => { if (restorePaletteFocus?.()) event.preventDefault(); }}
        />
      </div>
    </VinScanContext.Provider>
  );
};

export default AppShell;
