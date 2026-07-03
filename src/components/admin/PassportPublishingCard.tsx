import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { Switch } from "@/components/ui/switch";
import { Globe } from "lucide-react";

// Mirror of the ingest_auto_publish setting from Store Settings > Feed
// Automation, surfaced in the Passport group where dealers look for
// publishing config. One source of truth — both cards read and write the
// same setting, and the dangerous-toggle confirm applies in both places.
export default function PassportPublishingCard() {
  const { settings, updateSettings } = useDealerSettings();

  return (
    <div id="passport-publishing" className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Globe className="w-5 h-5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-foreground">Passport Publishing</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Controls when the customer passport goes live. This is the same setting as
            Auto-publish on intake under Store Settings, shown here too.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-semibold text-foreground">Auto-publish on intake</span>
          <Switch
            checked={settings.ingest_auto_publish !== false}
            onCheckedChange={(v) => {
              if (v && !window.confirm("Auto-publish puts the customer passport live the moment a vehicle is ingested, before recon, K-208, or installs are done. Enable it?")) return;
              updateSettings({ ingest_auto_publish: v });
            }}
            className="data-[state=checked]:bg-teal"
          />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mt-2 pl-8">
        On: the passport publishes the moment a vehicle is ingested — recon, K-208, and installs happen
        afterward. Off: a person publishes each vehicle from Inventory when it's ready.
      </p>
    </div>
  );
}
