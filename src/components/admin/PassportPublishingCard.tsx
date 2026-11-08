import { Link } from "react-router-dom";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { Switch } from "@/components/ui/switch";
import { Globe } from "lucide-react";

// Mirror of the ingest_auto_publish setting from Store Settings > Feed
// Automation, surfaced in the Passport group where dealers look for
// publishing config. One source of truth — both cards read and write the
// same setting, and the dangerous-toggle confirm applies in both places.
export default function PassportPublishingCard({ readOnly = false, value, manageTo }: { readOnly?: boolean; value?: boolean; manageTo?: string } = {}) {
  const { settings, updateSettings } = useDealerSettings();

  if (readOnly) {
    const on = value ?? settings.ingest_auto_publish !== false;
    return (
      <div id="passport-publishing" className="rounded-xl border border-adm-divider bg-adm-surface p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Globe className="w-6 h-6 text-adm-primary mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <h3 className="text-[16px] leading-[24px] font-semibold text-adm-ink">Passport publishing</h3>
            <p className="text-[14px] leading-[20px] text-adm-muted mt-0.5">
              Auto-publish on intake is <strong className="text-adm-ink">{on ? "on" : "off"}</strong>. {on ? "A passport goes live the moment a vehicle is ingested, before recon, K-208 or installs are done." : "A person publishes each vehicle from Inventory when it is ready."}
            </p>
            <p className="text-[13px] leading-[18px] text-adm-muted mt-2">Read only here. This is the same shared setting as Publishing, which owns it.</p>
            {manageTo && (
              <Link to={manageTo} className="mt-2 inline-flex items-center min-h-[44px] sm:min-h-0 font-semibold text-[14px] text-adm-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary rounded-sm">
                Manage in Publishing, Effective policy
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

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
