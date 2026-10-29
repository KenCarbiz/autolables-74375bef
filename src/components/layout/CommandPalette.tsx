import { useCallback, useEffect, useRef, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  Car,
  FileText,
  FolderOpen,
  Award,
  TrendingUp,
  Sparkles,
  BookOpen,
  ShieldCheck,
  ScanLine,
  Plus,
  LogOut,
  Settings,
  Users,
  Store,
  CreditCard,
  Code,
  FilePlus2,
  Printer,
  UserRound,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useTenant } from "@/contexts/TenantContext";
import { hasAnyDealerCapability, hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { ADMIN_SETTINGS_INDEX, settingEntryHref } from "@/lib/adminSearchIndex";
import { navModeForRole } from "@/components/layout/adminNav";
import { paletteSearchScope } from "@/components/layout/searchScope";
import { identityKey } from "@/components/customers/customerBook";
import { useViewTransitionNavigate } from "@/lib/navigation";
import { useVinScan } from "@/contexts/VinScanContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs as the dialog closes; the frame uses it to put focus back where it was. */
  onCloseAutoFocus?: (event: Event) => void;
}

interface VehicleHit {
  id: string;
  vin: string;
  ymm: string | null;
  condition: string | null;
  status: string | null;
}

interface CustomerHit {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  vehicle_vin: string | null;
  vehicle_interest: string | null;
}

// Strips the characters PostgREST's or() grammar would read as syntax.
const searchTerm = (query: string) => query.trim().replace(/[%,"()]/g, " ").replace(/\s+/g, " ").trim();

const CommandPalette = ({ open, onOpenChange, onCloseAutoFocus }: CommandPaletteProps) => {
  const { isAdmin, signOut } = useAuth();
  const { member } = useEntitlements();
  const { tenant, currentStore } = useTenant();
  const role = member?.role;
  const navigate = useViewTransitionNavigate();
  const canManageBilling = hasDealerCapability(role, "can_manage_billing", isAdmin);
  // Technicians and vendors are contained by role, like the rail: the palette
  // offers them scanning and their account, not the dealer's creation and
  // navigation doors (the route guard would turn them away anyway).
  const dealerSurface = navModeForRole(role) === "dealer";
  const canCreateDocuments = hasDealerCapability(role, "can_create_documents", isAdmin);

  // Live vehicle search: a VIN fragment, stock number, or year/make/model
  // text queries the tenant's vehicle_listings (debounced, max 8) and lands
  // on the vehicle file. Gated to signed-in members who can view inventory.
  // Customer search reads the current rooftop's leads the same way and opens
  // the customer record. The header's search box names exactly this scope.
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const storeId = currentStore?.id || null;
  const scope = paletteSearchScope({ role, isAdmin, hasMember: !!member, tenantId, storeId });
  const canSearchVehicles = scope.vehicles;
  const canSearchCustomers = scope.customers;
  const [query, setQuery] = useState("");
  const [vehicleHits, setVehicleHits] = useState<VehicleHit[]>([]);
  const [customerHits, setCustomerHits] = useState<CustomerHit[]>([]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setVehicleHits([]);
      setCustomerHits([]);
    }
  }, [open]);

  useEffect(() => {
    const term = searchTerm(query);
    if (!open || !canSearchCustomers || term.length < 2) {
      setCustomerHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const pattern = `%${term}%`;
      const { data } = await (supabase as any)
        .from("leads")
        .select("id, name, email, phone, vehicle_vin, vehicle_interest")
        .eq("store_id", storeId)
        .or(`name.ilike."${pattern}",email.ilike."${pattern}",phone.ilike."${pattern}"`)
        .order("captured_at", { ascending: false })
        .limit(6);
      if (!cancelled) setCustomerHits((data as CustomerHit[]) || []);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open, canSearchCustomers, storeId]);

  useEffect(() => {
    const term = searchTerm(query);
    if (!open || !canSearchVehicles || term.length < 3) {
      setVehicleHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const pattern = `%${term}%`;
      const { data } = await (supabase as any)
        .from("vehicle_listings")
        .select("id, vin, ymm, condition, status")
        .eq("tenant_id", tenantId)
        .or(`vin.ilike."${pattern}",ymm.ilike."${pattern}",sticker_snapshot->>stock_number.ilike."${pattern}"`)
        .limit(8);
      if (!cancelled) setVehicleHits((data as VehicleHit[]) || []);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open, canSearchVehicles, tenantId]);

  const go = (path: string) => {
    onOpenChange(false);
    setTimeout(() => navigate(path), 50);
  };

  // Device-aware VIN scan: live camera on phone/tablet, QR hand-off on
  // desktop — shared with every Scan VIN button via VinScanContext.
  const { openScan } = useVinScan();
  const doScan = () => {
    onOpenChange(false);
    setTimeout(() => openScan(), 50);
  };

  const doSignOut = async () => {
    onOpenChange(false);
    await signOut();
    navigate("/login");
  };

  const doManageBilling = async () => {
    onOpenChange(false);
    try {
      const { data, error } = await supabase.functions.invoke(
        "billing-portal-session",
        { body: { return_url: window.location.href } }
      );
      if (error || !data?.url) {
        toast.error("Couldn't open billing portal");
        return;
      }
      window.location.href = data.url as string;
    } catch {
      toast.error("Couldn't open billing portal");
    }
  };

  // A lead with neither an email nor a name has no customer record to open.
  const customerRows = customerHits
    .map((c) => ({ hit: c, key: identityKey(c.email, c.name, c.vehicle_vin) }))
    .filter((row): row is { hit: CustomerHit; key: string } => !!row.key);

  const placeholder = canSearchVehicles && canSearchCustomers
    ? "Search vehicles, customers, pages, settings…"
    : canSearchVehicles
      ? "Search vehicles (VIN, stock #, year/make/model), pages, settings…"
      : canSearchCustomers
        ? "Search customers (name, email, phone), pages, settings…"
        : "Search commands…";

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search AutoLabels" onCloseAutoFocus={onCloseAutoFocus}>
      <CommandInput
        placeholder={placeholder}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {vehicleHits.length > 0 && (
          <>
            <CommandGroup heading="Vehicles">
              {vehicleHits.map((v) => (
                <CommandItem
                  key={v.id}
                  value={`vehicle:${v.vin}:${v.id}`}
                  keywords={[query, v.vin, v.ymm || ""]}
                  onSelect={() => go(`/vehicle-file/${v.id}`)}
                >
                  <Car className="w-4 h-4 mr-2" />
                  <span className="flex-1 min-w-0 truncate">{v.ymm || "Vehicle"}</span>
                  <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                    …{v.vin.slice(-8)}{v.status ? ` · ${v.status}` : ""}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {customerRows.length > 0 && (
          <>
            <CommandGroup heading="Customers">
              {customerRows.map(({ hit, key }) => (
                <CommandItem
                  key={hit.id}
                  value={`customer:${hit.id}`}
                  keywords={[query, hit.name || "", hit.email || "", hit.phone || ""]}
                  onSelect={() => go(`/customers/${encodeURIComponent(key)}`)}
                >
                  <UserRound className="w-4 h-4 mr-2" />
                  <span className="flex-1 min-w-0 truncate">{hit.name || hit.email || "Customer"}</span>
                  <span className="ml-2 truncate text-[11px] text-muted-foreground">
                    {hit.vehicle_interest || hit.email || hit.phone || ""}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Create">
          {dealerSurface && (
            <CommandItem onSelect={() => go("/inventory?add=1")}>
              <Plus className="w-4 h-4 mr-2" />
              Add Vehicle
            </CommandItem>
          )}
          <CommandItem onSelect={doScan}>
            <ScanLine className="w-4 h-4 mr-2" />
            Scan VIN
          </CommandItem>
          {dealerSurface && canCreateDocuments && (
            <CommandItem value="Create a document" keywords={["create", "new document", "create hub"]} onSelect={() => go("/create")}>
              <FilePlus2 className="w-4 h-4 mr-2" />
              Create a document
            </CommandItem>
          )}
          {dealerSurface && (
            <>
              <CommandItem onSelect={() => go("/addendum")}>
                <FileText className="w-4 h-4 mr-2" />
                New Addendum
              </CommandItem>
              <CommandItem onSelect={() => go("/used-car-sticker")}>
                <Car className="w-4 h-4 mr-2" />
                New Used Car Sticker
              </CommandItem>
              <CommandItem onSelect={() => go("/window-sticker-studio")}>
                <FileText className="w-4 h-4 mr-2" />
                OEM Window Sticker Studio
              </CommandItem>
              <CommandItem onSelect={() => go("/inventory-intelligence")}>
                Inventory Intelligence
              </CommandItem>
              <CommandItem onSelect={() => go("/cpo-sheet")}>
                <Award className="w-4 h-4 mr-2" />
                New CPO Sheet
              </CommandItem>
              <CommandItem onSelect={() => go("/trade-up")}>
                <TrendingUp className="w-4 h-4 mr-2" />
                New Trade-Up Sticker
              </CommandItem>
              <CommandItem onSelect={() => go("/description-operations")}>
                <Sparkles className="w-4 h-4 mr-2" />
                Description Operations
              </CommandItem>
            </>
          )}
        </CommandGroup>

        <CommandSeparator />

        {dealerSurface && (
          <CommandGroup heading="Go to">
            <CommandItem onSelect={() => go("/dashboard")}>
              <LayoutDashboard className="w-4 h-4 mr-2" />
              Dashboard
            </CommandItem>
            <CommandItem onSelect={() => go("/inventory")}>
              <Car className="w-4 h-4 mr-2" />
              Inventory
            </CommandItem>
            <CommandItem onSelect={() => go("/print-queue")}>
              <Printer className="w-4 h-4 mr-2" />
              Print Queue
            </CommandItem>
            <CommandItem onSelect={() => go("/saved")}>
              <FolderOpen className="w-4 h-4 mr-2" />
              Saved Addendums
            </CommandItem>
            <CommandItem onSelect={() => go("/compliance")}>
              <BookOpen className="w-4 h-4 mr-2" />
              Compliance Guide
            </CommandItem>
            <CommandItem onSelect={() => go("/prep")}>
              <ShieldCheck className="w-4 h-4 mr-2" />
              Prep Sign-Off
            </CommandItem>
          </CommandGroup>
        )}

        <CommandSeparator />

        {(() => {
          // Generated settings index: label OR dealer-vocabulary keywords match
          // the typed query (cmdk matches value + keywords), gated per-tab caps.
          const visible = ADMIN_SETTINGS_INDEX.filter((entry) =>
            hasAnyDealerCapability(role, entry.caps, isAdmin)
          );
          if (visible.length === 0) return null;
          return (
            <CommandGroup heading="Settings">
              {visible.map((entry) => (
                <CommandItem
                  key={`${entry.tab}:${entry.panel || ""}:${entry.label}`}
                  value={`${entry.label} ${entry.tab} ${entry.panel || ""}`}
                  keywords={entry.keywords}
                  onSelect={() => go(settingEntryHref(entry))}
                >
                  <Settings className="w-4 h-4 mr-2" />
                  {entry.label}
                </CommandItem>
              ))}
              {hasDealerCapability(role, "manage_source_authority", isAdmin) || hasAnyDealerCapability(role, ["can_view_compliance"], isAdmin) ? (
                <CommandItem
                  value="Source Authority high risk data integrity"
                  keywords={["source authority", "authoritative source", "data integrity", "conflict rules", "primary source"]}
                  onSelect={() => go("/admin/source-authority")}
                >
                  <Settings className="w-4 h-4 mr-2" />
                  Source Authority
                </CommandItem>
              ) : null}
              {hasDealerCapability(role, "can_manage_settings", isAdmin) ? (
                <CommandItem
                  value="Description Voice SEO dealership claims approved language"
                  keywords={["voice", "voice profile", "seo", "description", "approved claims", "dealership claims", "tone", "disclosures", "prohibited phrases"]}
                  onSelect={() => go("/admin/description-voice")}
                >
                  <Settings className="w-4 h-4 mr-2" />
                  Description Voice &amp; SEO
                </CommandItem>
              ) : null}
              {hasDealerCapability(role, "can_manage_settings", isAdmin) ? (
                <CommandItem
                  value="Website Integration embed widget passport"
                  keywords={["website", "embed", "widget", "vdp", "passport button", "integration"]}
                  onSelect={() => go("/admin/website-embed")}
                >
                  <Code className="w-4 h-4 mr-2" />
                  Website Integration
                </CommandItem>
              ) : null}
            </CommandGroup>
          );
        })()}

        {isAdmin && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Platform">
              <CommandItem onSelect={() => go("/platform-admin?tab=tenants")}>
                <Store className="w-4 h-4 mr-2" />
                Tenants
              </CommandItem>
              <CommandItem onSelect={() => go("/platform-admin?tab=members")}>
                <Users className="w-4 h-4 mr-2" />
                Members
              </CommandItem>
              <CommandItem onSelect={() => go("/platform-admin?tab=entitlements")}>
                <Award className="w-4 h-4 mr-2" />
                Entitlements
              </CommandItem>
              <CommandItem onSelect={() => go("/platform-admin?tab=audit")}>
                <ShieldCheck className="w-4 h-4 mr-2" />
                Platform Audit
              </CommandItem>
              <CommandItem onSelect={() => go("/platform-admin?tab=budgets")}>
                <Wallet className="w-4 h-4 mr-2" />
                Budgets & alerts
              </CommandItem>
              <CommandItem onSelect={() => go("/admin/command-center")}>
                <ShieldCheck className="w-4 h-4 mr-2" />
                Compliance Command Center
              </CommandItem>
              <CommandItem onSelect={() => go("/admin/inventory-sync")}>
                <ShieldCheck className="w-4 h-4 mr-2" />
                Inventory Sync Center
              </CommandItem>
              <CommandItem onSelect={() => go("/admin/exceptions")}>
                <ShieldCheck className="w-4 h-4 mr-2" />
                Exceptions
              </CommandItem>
            </CommandGroup>
          </>
        )}

        <CommandSeparator />

        <CommandGroup heading="Account">
          {canManageBilling && (
            <CommandItem onSelect={doManageBilling}>
              <CreditCard className="w-4 h-4 mr-2" />
              Manage billing
            </CommandItem>
          )}
          <CommandItem onSelect={doSignOut}>
            <LogOut className="w-4 h-4 mr-2" />
            Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};

// Opens and closes the palette, from a control or from Cmd/Ctrl+K, and
// remembers what had focus so closing it can put focus back there: the dialog
// has no trigger of its own to return to.
export const useCommandPalette = () => {
  const [open, setOpenState] = useState(false);
  const openRef = useRef(false);
  const returnTo = useRef<HTMLElement | null>(null);

  const apply = useCallback((next: boolean) => {
    if (next && !openRef.current) {
      const active = document.activeElement;
      returnTo.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    openRef.current = next;
    setOpenState(next);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        apply(!openRef.current);
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [apply]);

  /** Focuses what was focused when the palette opened; false when there is nothing to return to. */
  const restoreFocus = useCallback(() => {
    const el = returnTo.current;
    returnTo.current = null;
    if (!el || !el.isConnected) return false;
    el.focus();
    return true;
  }, []);

  return { open, setOpen: apply, restoreFocus };
};

export default CommandPalette;
