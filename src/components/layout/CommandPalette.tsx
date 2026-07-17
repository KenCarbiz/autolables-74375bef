import { useEffect, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  Car,
  FileText,
  FolderOpen,
  ScrollText,
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
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useTenant } from "@/contexts/TenantContext";
import { hasAnyDealerCapability, hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { ADMIN_SETTINGS_INDEX, settingEntryHref } from "@/lib/adminSearchIndex";
import { useViewTransitionNavigate } from "@/lib/navigation";
import { useVinScan } from "@/contexts/VinScanContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface VehicleHit {
  id: string;
  vin: string;
  ymm: string | null;
  condition: string | null;
  status: string | null;
}

const CommandPalette = ({ open, onOpenChange }: CommandPaletteProps) => {
  const { isAdmin, signOut } = useAuth();
  const { member } = useEntitlements();
  const { tenant } = useTenant();
  const role = member?.role;
  const navigate = useViewTransitionNavigate();
  const canManageBilling = hasDealerCapability(role, "can_manage_billing", isAdmin);

  // Live vehicle search: a VIN fragment, stock number, or year/make/model
  // text queries the tenant's vehicle_listings (debounced, max 8) and lands
  // on the vehicle file. Gated to signed-in members who can view inventory.
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const canSearchVehicles = !!tenantId && (!!member || isAdmin) && hasDealerCapability(role, "can_view_inventory", isAdmin);
  const [query, setQuery] = useState("");
  const [vehicleHits, setVehicleHits] = useState<VehicleHit[]>([]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setVehicleHits([]);
    }
  }, [open]);

  useEffect(() => {
    const term = query.trim().replace(/[%,"()]/g, " ").replace(/\s+/g, " ").trim();
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

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search vehicles (VIN, stock #, year/make/model), pages, settings…"
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

        <CommandGroup heading="Create">
          <CommandItem onSelect={() => go("/inventory?add=1")}>
            <Plus className="w-4 h-4 mr-2" />
            Add Vehicle
            <CommandShortcut>N</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={doScan}>
            <ScanLine className="w-4 h-4 mr-2" />
            Scan VIN
          </CommandItem>
          <CommandItem onSelect={() => go("/addendum")}>
            <FileText className="w-4 h-4 mr-2" />
            New Addendum
          </CommandItem>
          <CommandItem onSelect={() => go("/used-car-sticker")}>
            <Car className="w-4 h-4 mr-2" />
            New Used Car Sticker
          </CommandItem>
          <CommandItem onSelect={() => go("/new-car-sticker")}>
            <FileText className="w-4 h-4 mr-2" />
            New Car Sticker
          </CommandItem>
          <CommandItem onSelect={() => go("/buyers-guide")}>
            <ScrollText className="w-4 h-4 mr-2" />
            New Buyers Guide
          </CommandItem>
          <CommandItem onSelect={() => go("/cpo-sheet")}>
            <Award className="w-4 h-4 mr-2" />
            New CPO Sheet
          </CommandItem>
          <CommandItem onSelect={() => go("/trade-up")}>
            <TrendingUp className="w-4 h-4 mr-2" />
            New Trade-Up Sticker
          </CommandItem>
          <CommandItem onSelect={() => go("/description-studio")}>
            <Sparkles className="w-4 h-4 mr-2" />
            Description Studio
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Go to">
          <CommandItem onSelect={() => go("/dashboard")}>
            <LayoutDashboard className="w-4 h-4 mr-2" />
            Dashboard
          </CommandItem>
          <CommandItem onSelect={() => go("/inventory")}>
            <Car className="w-4 h-4 mr-2" />
            Inventory
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

export const useCommandPalette = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  return { open, setOpen };
};

export default CommandPalette;
