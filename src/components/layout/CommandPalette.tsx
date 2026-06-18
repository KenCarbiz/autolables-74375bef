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
  Palette,
  ToggleLeft,
  Users,
  BarChart3,
  Store,
  CreditCard,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useViewTransitionNavigate } from "@/lib/navigation";
import { useVinScan } from "@/contexts/VinScanContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CommandPalette = ({ open, onOpenChange }: CommandPaletteProps) => {
  const { isAdmin, signOut } = useAuth();
  const navigate = useViewTransitionNavigate();

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
      <CommandInput placeholder="Search pages, actions, vehicles…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

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
          <CommandItem onSelect={() => go("/description-writer")}>
            <Sparkles className="w-4 h-4 mr-2" />
            Description Writer
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

        <CommandGroup heading="Admin">
          <CommandItem onSelect={() => go("/admin?tab=products")}>
            <Settings className="w-4 h-4 mr-2" />
            Products
          </CommandItem>
          <CommandItem onSelect={() => go("/admin?tab=branding")}>
            <Palette className="w-4 h-4 mr-2" />
            Branding
          </CommandItem>
          <CommandItem onSelect={() => go("/admin?tab=settings")}>
            <ToggleLeft className="w-4 h-4 mr-2" />
            Feature Toggles
          </CommandItem>
          <CommandItem onSelect={() => go("/admin?tab=audit")}>
            <ShieldCheck className="w-4 h-4 mr-2" />
            Audit Log
          </CommandItem>
          <CommandItem onSelect={() => go("/admin?tab=leads")}>
            <Users className="w-4 h-4 mr-2" />
            Leads
          </CommandItem>
          <CommandItem onSelect={() => go("/admin?tab=analytics")}>
            <BarChart3 className="w-4 h-4 mr-2" />
            Analytics
          </CommandItem>
        </CommandGroup>

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
            </CommandGroup>
          </>
        )}

        <CommandSeparator />

        <CommandGroup heading="Account">
          <CommandItem onSelect={doManageBilling}>
            <CreditCard className="w-4 h-4 mr-2" />
            Manage billing
          </CommandItem>
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
