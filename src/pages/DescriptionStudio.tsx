import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTenant } from "@/contexts/TenantContext";
import { supabase } from "@/integrations/supabase/client";
import { useDescriptionCase, useDescriptionPermissions } from "@/hooks/useDescriptionOps";
import { CHANNEL_CARDS, CHANNEL_META, channelMeta, connectorLabel, STATUS_META, TONE_CLASS,
         type DescriptionStatus } from "@/lib/description/model";
import { ChannelCardGrid, type ChannelCardStatus } from "@/components/description/ChannelCard";
import { missingAssets } from "@/lib/description/channelAssets";
import type { GenerationOutcome } from "@/lib/description/generationOutcome";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowRight, CheckCircle2, Copy, Download, Gauge, Globe, ImageIcon,
  Loader2, RotateCcw, Save, Send, ShieldCheck, Sparkles, Star, Target, Wrench,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────
// SEO Description Studio.
//
// The layout is the approved one. What changed is where the content comes
// from: every number, every feature and every word on this screen is read
// back from a stored server record. There are no fixture scores, no sample
// description and no hard-coded feature list, because an operator acts on
// what this screen says and a decorative "A+" is a lie with a button next
// to it.
//
// The rule that shapes the whole component: SELECTING A CHANNEL IS A READ.
// It loads the saved variant for that channel and nothing else — no AI
// request, no version, no approval, no publication. Generation is only ever
// an explicit, labeled action.
// ─────────────────────────────────────────────────────────────────────

type Tone = "professional" | "luxury" | "sporty" | "family" | "value";
const TONES: Tone[] = ["professional", "luxury", "sporty", "family", "value"];

type Row = Record<string, any>;

const DescriptionStudio = () => {
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const perms = useDescriptionPermissions();
  const [params, setParams] = useSearchParams();

  const vehicleParam = params.get("vehicle") || "";
  const vinParam = (params.get("vin") || "").toUpperCase();
  const [vehicleId, setVehicleId] = useState<string>(vehicleParam);
  const [resolving, setResolving] = useState(false);

  // A VIN in the URL is resolved to the tenant's own listing server-side. The
  // browser never gets to say which vehicle row it is looking at.
  useEffect(() => {
    let cancelled = false;
    if (vehicleParam || !vinParam || !tenant?.id) return;
    setResolving(true);
    (async () => {
      const { data } = await (supabase as any).from("vehicle_listings")
        .select("id").eq("tenant_id", tenant.id).eq("vin", vinParam).maybeSingle();
      if (cancelled) return;
      setResolving(false);
      if (data?.id) setVehicleId(data.id);
    })();
    return () => { cancelled = true; };
  }, [vinParam, vehicleParam, tenant?.id]);

  const { record, busy, generate } = useDescriptionCase(vehicleId || undefined);

  const [refusal, setRefusal] = useState<GenerationOutcome | null>(null);
  const [channel, setChannel] = useState<string>(params.get("channel") || "autotrader");
  const [tone, setTone] = useState<Tone>("professional");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [primaryKeyword, setPrimaryKeyword] = useState("");
  const [includeCta, setIncludeCta] = useState(true);
  const [includeDealerName, setIncludeDealerName] = useState(true);
  const [configTouched, setConfigTouched] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const hydrated = useRef(false);

  const caseRow = record?.caseRow ?? null;
  const vehicle = record?.vehicle ?? null;
  const snapshot = record?.snapshot ?? null;
  const versions: Row[] = record?.versions ?? [];
  const channels: Row[] = record?.channels ?? [];
  const findings: Row[] = record?.findings ?? [];
  const deliveries: Row[] = record?.deliveries ?? [];

  const masterVersion = useMemo(
    () => versions.find((v) => v.id === caseRow?.current_master_version_id) ?? versions[0] ?? null,
    [versions, caseRow?.current_master_version_id]);

  const channelVersion = useMemo(
    () => channels.find((c) => c.channel === channel) ?? null, [channels, channel]);

  // Seed the configuration controls from the record ONCE. After that the user
  // owns them: re-seeding on every refetch would silently discard an edit
  // they were in the middle of making.
  useEffect(() => {
    if (hydrated.current || !masterVersion) return;
    hydrated.current = true;
    const t = String(masterVersion.tone || "professional");
    if ((TONES as string[]).includes(t)) setTone(t as Tone);
    const targeting = (masterVersion.seo_targeting_json || {}) as Row;
    setCity(String(targeting.city || ""));
    setStateName(String(targeting.state || ""));
    setPrimaryKeyword(String(targeting.primaryKeyword || ""));
  }, [masterVersion]);

  const selectChannel = useCallback((key: string) => {
    setChannel(key);
    // Route state, so a reload or a shared link lands on the same channel.
    const next = new URLSearchParams(params);
    next.set("channel", key);
    setParams(next, { replace: true });
  }, [params, setParams]);

  const touchConfig = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setConfigTouched(true); };

  // ── Derived, all from stored records ───────────────────────────────
  const displayed = channelVersion ?? null;
  const content = String(displayed?.content ?? "");
  const score = (displayed?.score_breakdown_json ?? null) as Row | null;
  const masterScore = (masterVersion?.score_breakdown_json ?? null) as Row | null;
  const activeScore = score ?? (channel === "vehicle_passport" ? masterScore : null);

  const meta = channelMeta(channel);
  const connector = connectorLabel(meta);
  // The limit shown is the one the SERVER stored with this variant, not the
  // current registry value — an older approved variant keeps its own contract.
  const charLimit = Number(displayed?.character_limit ?? meta?.characterLimit ?? 0);
  const charCount = Number(displayed?.character_count ?? content.length);
  const wordCount = Number(displayed?.word_count ?? (content.trim() ? content.trim().split(/\s+/).length : 0));
  const readSeconds = Number(displayed?.read_time_seconds ?? 0);

  const channelFindings = findings.filter((f) =>
    displayed ? f.channel_version_id === displayed.id : f.channel_version_id == null);
  const blocking = channelFindings.filter((f) => f.blocking);

  const statusFor = useCallback((key: string): ChannelCardStatus => {
    const enabled = CHANNEL_META.some((m) => m.key === key);
    if (!enabled) return { state: "disabled", disabledReason: "Not available" };
    const cv = channels.find((c) => c.channel === key);
    if (!cv) return { state: "not_generated", note: "Not generated" };
    if (cv.validation_status === "blocked") return { state: "warning", note: "Validation failed" };
    if (cv.potentially_stale) return { state: "warning", note: "Stale" };
    const m = channelMeta(key);
    if (m?.connectorStatus === "not_configured") return { state: "warning", note: "No connector" };
    if (m?.deliveryMode === "export_only") return { state: "ready", note: "Export only" };
    return { state: "ready", note: "Draft ready" };
  }, [channels]);

  // ── Actions ────────────────────────────────────────────────────────
  const copy = async () => {
    if (!content) return toast.error("There is no saved description to copy.");
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    if (displayed?.master_version_id) {
      await (supabase as any).rpc("record_description_output_use", {
        p_version_id: displayed.master_version_id, p_channel: channel, p_action: "copied",
      });
    }
    toast.success("Copied the saved version");
  };

  const download = async () => {
    if (!content) return toast.error("There is no saved description to download.");
    const safe = `${String(vehicle?.vin || "vehicle")}-${channel}`.replace(/[^A-Za-z0-9_-]/g, "");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${safe}.txt`; a.click();
    URL.revokeObjectURL(url);
    if (displayed?.master_version_id) {
      await (supabase as any).rpc("record_description_output_use", {
        p_version_id: displayed.master_version_id, p_channel: channel, p_action: "exported",
      });
    }
    toast.success("Downloaded the saved version");
  };

  const saveToVehicle = async () => {
    if (!displayed?.master_version_id) return toast.error("There is no saved version to attach.");
    setSaving(true);
    const { data, error } = await (supabase as any).rpc("record_description_output_use", {
      p_version_id: displayed.master_version_id, p_channel: channel, p_action: "saved_to_vehicle",
    });
    setSaving(false);
    if (error || (data as Row)?.ok === false) {
      return toast.error(String(error?.message || (data as Row)?.error || "Could not attach the version"));
    }
    toast.success(`Attached v${(data as Row)?.version_number} to the Vehicle File`);
  };

  const regenerate = async (scopeToChannel: boolean) => {
    if (!perms.canGenerate) return toast.error("Your role cannot run description generation.");
    const label = scopeToChannel ? channelMeta(channel)?.label ?? channel : "every enabled channel";
    if (!window.confirm(
      `Generate a new draft for ${label}?\n\nThis sends a new AI request and will incur provider cost. ` +
      `The current version is preserved — regeneration always creates a new draft and never replaces an approved or published version.`,
    )) return;
    const res = await generate("manual_regenerate", scopeToChannel ? [channel] : undefined);
    if (!res.ok) {
      setRefusal(null);
      return toast.error(res.error || "Generation failed");
    }
    const o = res.outcome;
    // A refusal is pinned to the page, not just toasted: the operator needs the
    // blocking code and its remedy after the toast has gone.
    setRefusal(o.tone === "error" ? o : null);
    toast[o.tone](o.message, o.remedy
      ? { action: { label: o.remedy.label, onClick: () => navigate(o.remedy!.href) } }
      : undefined);
  };

  // Publication truth: the button only appears for a channel we genuinely
  // write. Everything else is honestly labeled as an export.
  const canPublish = meta?.deliveryMode === "internal_projection" && meta?.connectorStatus === "available";
  const pendingAssets = missingAssets();

  if (!vehicleId) {
    return (
      <EmptyShell
        title="Select a vehicle"
        body={resolving
          ? "Looking up that VIN in your inventory…"
          : "The Studio works against a real vehicle in your inventory so every fact, feature and score is traceable. Open it from Description Operations, or add ?vehicle=<id> or ?vin=<vin> to the URL."}
        action={{ label: "Go to Description Operations", onClick: () => navigate("/description-operations") }}
      />
    );
  }

  if (!record) {
    return <EmptyShell title="Loading" body="Reading the description record for this vehicle…" />;
  }

  return (
    <div className="min-h-screen bg-[#F7F9FC]">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1600px] gap-8 overflow-x-auto px-5 py-5">
          {[
            { label: "Vehicle & Features", sub: "Canonical truth snapshot", done: !!snapshot },
            { label: "SEO Settings", sub: "Target & tone", done: !!masterVersion?.seo_targeting_json },
            { label: "Generate", sub: "Server-side, versioned", done: !!masterVersion },
            { label: "Review & Export", sub: "Approve and export", done: !!displayed },
          ].map((s, index) => (
            <div key={s.label} className="flex min-w-fit items-center gap-3">
              <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-black ${s.done ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}>
                {s.done ? <CheckCircle2 className="h-5 w-5" /> : index + 1}
              </span>
              <div>
                <div className="text-sm font-black text-slate-950">{s.label}</div>
                <div className="text-xs font-semibold text-slate-500">{s.sub}</div>
              </div>
              {index < 3 && <ArrowRight className="h-4 w-4 text-slate-300" />}
            </div>
          ))}
        </div>
      </div>

      {/* A refused run stays on screen with its blocking code and the screen
          that clears it. The toast is gone in four seconds; the block is not. */}
      {refusal && (
        <div className="mx-auto max-w-[1600px] px-5 pt-5">
          <div className="flex items-start gap-3 rounded-2xl border-2 border-red-200 bg-red-50 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-red-900">{refusal.message}</p>
              {refusal.codes.length > 0 && (
                <p className="mt-1 font-mono text-xs font-bold text-red-700">
                  {refusal.codes.join(" · ")}
                </p>
              )}
              {refusal.costFree && (
                <p className="mt-1 text-xs font-semibold text-red-800">
                  No AI request was made and nothing was charged.
                </p>
              )}
              {refusal.remedy && (
                <button
                  onClick={() => navigate(refusal.remedy!.href)}
                  className="mt-2 text-sm font-black text-red-700 underline"
                >
                  {refusal.remedy.label} →
                </button>
              )}
            </div>
            <button
              onClick={() => setRefusal(null)}
              aria-label="Dismiss"
              className="shrink-0 text-xs font-bold text-red-500 hover:text-red-800"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto grid max-w-[1600px] gap-5 p-5 xl:grid-cols-[370px_1fr_470px]">
        {/* ── Column 1: the vehicle, straight from the truth snapshot ── */}
        <section className="space-y-4">
          <Card
            title="Vehicle Preview"
            action={
              <button
                onClick={() => navigate(`/description-intelligence/${vehicleId}`)}
                className="text-sm font-black text-blue-600"
              >
                Open truth record
              </button>
            }
          >
            {vehicle?.hero_image_url || vehicle?.primary_photo_url ? (
              <img
                src={vehicle.hero_image_url || vehicle.primary_photo_url}
                alt={String(vehicle?.ymm || "Vehicle")}
                className="h-56 w-full rounded-2xl object-cover"
              />
            ) : (
              <div className="flex h-56 w-full items-center justify-center rounded-2xl bg-slate-100 text-sm font-bold text-slate-400">
                No photo on this listing
              </div>
            )}
            <h2 className="mt-5 text-2xl font-black text-slate-950">{fact(snapshot, "ymm") || vehicle?.ymm || "—"}</h2>
            <p className="text-lg font-semibold text-slate-600">{fact(snapshot, "trim") || vehicle?.trim || ""}</p>
            <div className="mt-5 grid grid-cols-3 gap-4">
              <Spec label="Stock #" value={fact(snapshot, "stock_number")} icon={ImageIcon} />
              <Spec label="Mileage" value={num(fact(snapshot, "mileage"), " mi")} icon={Gauge} />
              <Spec label="Condition" value={fact(snapshot, "condition")} icon={ShieldCheck} />
              <Spec label="Engine" value={fact(snapshot, "engine")} icon={Wrench} />
              <Spec label="Transmission" value={fact(snapshot, "transmission")} icon={Target} />
              <Spec label="Drivetrain" value={fact(snapshot, "drivetrain")} icon={Globe} />
              <Spec label="Ext. Color" value={fact(snapshot, "exterior_color")} icon={Sparkles} />
              <Spec label="Int. Color" value={fact(snapshot, "interior_color")} icon={Star} />
              <Spec label="Fuel Type" value={fact(snapshot, "fuel_type")} icon={Gauge} />
            </div>
          </Card>

          <Card
            title="Source-Backed Features"
            badge={snapshot ? `Snapshot ${String(snapshot.source_data_version || "").slice(0, 10)}` : undefined}
          >
            {snapshot ? <FeatureList snapshot={snapshot} /> : (
              <p className="text-sm font-semibold text-slate-500">
                No truth snapshot has been built for this vehicle yet.
              </p>
            )}
            <button
              onClick={() => navigate(`/description-intelligence/${vehicleId}`)}
              className="mt-5 text-sm font-black text-blue-600"
            >
              View sources & confidence →
            </button>
          </Card>
        </section>

        {/* ── Column 2: configuration ─────────────────────────────────── */}
        <section className="space-y-4">
          <Card title="Choose Your Writing Preset" subtitle="Selecting a channel loads its saved version. It never generates, approves or publishes.">
            <ChannelCardGrid
              cards={CHANNEL_CARDS}
              statusFor={statusFor}
              selected={channel}
              onSelect={selectChannel}
            />
            {pendingAssets.length > 0 && (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {pendingAssets.length} provider {pendingAssets.length === 1 ? "logo has" : "logos have"} not been
                  supplied yet ({pendingAssets.map((a) => a.alt).join(", ")}). These cards show a placeholder rather than
                  a look-alike wordmark. Licensed brand assets are required before release.
                </span>
              </p>
            )}
          </Card>

          <Card title="Tone of Voice" subtitle="Tone changes wording only. It can never change, add or soften a vehicle fact.">
            <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Tone of voice">
              {TONES.map((item) => (
                <button
                  key={item}
                  role="radio"
                  aria-checked={tone === item}
                  onClick={() => touchConfig(setTone)(item)}
                  className={`h-12 min-w-[110px] rounded-xl border px-5 text-sm font-black capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${tone === item ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700"}`}
                >
                  {item}
                </button>
              ))}
            </div>
          </Card>

          <Card title="SEO Targeting" subtitle="Used to make the copy findable. Never to stuff it.">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="City" value={city} onChange={touchConfig(setCity)} placeholder="Manchester" />
              <Field label="State" value={stateName} onChange={touchConfig(setStateName)} placeholder="Connecticut" />
            </div>
            <div className="mt-4">
              <Field
                label="Primary Keyword (Optional)"
                value={primaryKeyword}
                onChange={touchConfig(setPrimaryKeyword)}
                placeholder="e.g. 2025 INFINITI QX80 for sale"
              />
              <p className="mt-1 text-xs font-semibold text-slate-500">
                Used once, inside a sentence that would exist anyway. Repetition is scored down, not up.
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-4">
              <CheckOption checked={includeCta} onClick={() => touchConfig(setIncludeCta)(!includeCta)} label="Include call to action" />
              <CheckOption checked={includeDealerName} onClick={() => touchConfig(setIncludeDealerName)(!includeDealerName)} label="Include dealer name" />
            </div>
            {configTouched && (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  The configuration has changed since this version was written. The saved copy below is unchanged and
                  still shows exactly what was stored — regenerate to apply the new settings.
                </span>
              </p>
            )}
          </Card>

          {displayed && (
            <Card title="Channel Differences" subtitle="Same facts, genuinely different presentation.">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs font-black uppercase tracking-wide text-slate-400">
                      <th className="pb-2">Channel</th><th className="pb-2">Words</th>
                      <th className="pb-2">Characters</th><th className="pb-2">Policy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {channels.map((cv) => (
                      <tr key={cv.id} className="border-t border-slate-100">
                        <td className="py-2 font-bold text-slate-800">{channelMeta(cv.channel)?.label || cv.channel}</td>
                        <td className="py-2 font-semibold text-slate-600">{cv.word_count ?? "—"}</td>
                        <td className="py-2 font-semibold text-slate-600">
                          {cv.character_count ?? "—"}{cv.character_limit ? ` / ${cv.character_limit}` : ""}
                        </td>
                        <td className="py-2 font-mono text-xs text-slate-500">{cv.channel_policy_version || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </section>

        {/* ── Column 3: the saved output and its real scores ──────────── */}
        <section className="space-y-4">
          <Card title="Validation & Quality">
            {activeScore ? <ScorePanel score={activeScore} blocking={blocking.length} /> : (
              <div className="rounded-xl bg-slate-50 px-4 py-6 text-center">
                <div className="text-lg font-black text-slate-500">Not scored</div>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  No score record exists for this version yet.
                </p>
              </div>
            )}
          </Card>

          <Card
            title={`${channelMeta(channel)?.label || channel} Version`}
            action={
              <button
                onClick={() => regenerate(true)}
                disabled={busy || !perms.canGenerate}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-black text-slate-700 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Regenerate
              </button>
            }
          >
            {displayed ? (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <Meta label="Version" value={`v${masterVersion?.version_number ?? "—"}`} />
                  <Meta label="Validation" value={String(displayed.validation_status || "pending")} />
                  <Meta label="Words" value={String(wordCount)} />
                  <Meta
                    label="Characters"
                    value={charLimit ? `${charCount} / ${charLimit}` : String(charCount)}
                    tone={charLimit && charCount > charLimit ? "amber" : "slate"}
                  />
                  <Meta label="Read time" value={readSeconds ? `${Math.max(1, Math.round(readSeconds / 60))} min` : "—"} />
                  <Meta label="Approval" value={String(masterVersion?.approval_status || "none")} />
                  <Meta label="Policy" value={String(displayed.channel_policy_version || "—")} />
                  <Meta label="Delivery" value={connector.label} />
                </div>

                {blocking.length > 0 && (
                  <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm font-black text-red-800">
                      <AlertTriangle className="h-4 w-4" /> {blocking.length} unsupported claim
                      {blocking.length === 1 ? "" : "s"} — cannot be approved
                    </div>
                    <ul className="mt-2 space-y-1 text-xs font-semibold text-red-700">
                      {blocking.slice(0, 4).map((f) => <li key={f.id}>{f.message}</li>)}
                    </ul>
                  </div>
                )}

                {/* The exact stored text. Never reassembled client-side. */}
                <div className="max-h-[360px] overflow-y-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-white p-4 text-sm font-medium leading-relaxed text-slate-800">
                  {content}
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <Button onClick={copy} icon={copied ? CheckCircle2 : Copy} label={copied ? "Copied" : "Copy"} />
                  <Button onClick={download} icon={Download} label="Download .txt" />
                  <Button onClick={saveToVehicle} icon={saving ? Loader2 : Save} label="Save to Vehicle" />
                  {canPublish ? (
                    <button
                      onClick={() => navigate(`/description-intelligence/${vehicleId}`)}
                      className="inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white"
                    >
                      <Send className="h-4 w-4" /> Review & Publish
                    </button>
                  ) : (
                    <button
                      onClick={() => navigate(`/description-intelligence/${vehicleId}`)}
                      className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-black text-white"
                    >
                      <Send className="h-4 w-4" /> Mark Ready for Export
                    </button>
                  )}
                </div>
                {!canPublish && (
                  <p className="mt-3 text-xs font-semibold text-slate-500">
                    Live publishing is unavailable for {channelMeta(channel)?.label || channel} until an inventory
                    connector is configured. This version can be approved and exported.
                  </p>
                )}
                <DeliveryNote deliveries={deliveries} channel={channel} />
              </>
            ) : (
              <div className="rounded-xl bg-slate-50 px-4 py-8 text-center">
                <div className="text-base font-black text-slate-700">
                  No description has been generated for this channel.
                </div>
                <p className="mx-auto mt-2 max-w-sm text-sm font-semibold text-slate-500">
                  The master description is not shown here — it is a different piece of copy written under a
                  different policy, and displaying it would misrepresent what this channel would send.
                </p>
                <button
                  onClick={() => regenerate(true)}
                  disabled={busy || !perms.canGenerate}
                  className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-black text-white disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Generate Channel Version
                </button>
              </div>
            )}
          </Card>

          <Card title="Description Strength">
            {activeScore ? <StrengthPanel score={activeScore} /> : (
              <p className="text-sm font-semibold text-slate-500">
                Strength is calculated when a version is scored. Nothing is shown until then.
              </p>
            )}
          </Card>

          {caseRow && (
            <Card title="Version & Approval">
              <div className="space-y-2">
                {versions.slice(0, 5).map((v) => (
                  <div key={v.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                    <span className="text-sm font-black text-slate-800">Draft v{v.version_number}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-black ${
                      v.id === caseRow.published_master_version_id ? TONE_CLASS.emerald
                      : v.id === caseRow.current_master_version_id ? TONE_CLASS.blue
                      : v.approval_status === "rejected" ? TONE_CLASS.red : TONE_CLASS.slate}`}>
                      {v.id === caseRow.published_master_version_id ? "Published"
                        : v.id === caseRow.current_master_version_id ? "Current"
                        : v.approval_status === "rejected" ? "Rejected" : "Superseded"}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between text-xs font-bold text-slate-500">
                <span>Case status</span>
                <span className={`rounded-full border px-2 py-0.5 ${TONE_CLASS[STATUS_META[caseRow.status as DescriptionStatus]?.tone ?? "slate"]}`}>
                  {STATUS_META[caseRow.status as DescriptionStatus]?.label ?? caseRow.status}
                </span>
              </div>
            </Card>
          )}
        </section>
      </main>

      <div className="border-t border-slate-200 bg-white py-3 text-center text-sm font-semibold text-slate-500">
        AI-generated content. Always review for accuracy.
      </div>
    </div>
  );
};

// ── Presentational pieces ────────────────────────────────────────────

function ScorePanel({ score, blocking }: { score: Row; blocking: number }) {
  const total = Number(score.total ?? 0);
  const band = String(score.band ?? "");
  const cats: Row[] = Array.isArray(score.categories) ? score.categories : [];
  // A blocked description is never dressed up as a good one, however well it
  // reads. The ring turns red the moment a truth blocker exists.
  const blocked = blocking > 0 || score.blockedByValidation === true;
  const ring = blocked ? "border-red-500" : total >= 85 ? "border-emerald-500"
    : total >= 70 ? "border-blue-500" : "border-amber-500";

  return (
    <div className="grid gap-5 md:grid-cols-[130px_1fr] md:items-start">
      <div className={`mx-auto flex h-28 w-28 items-center justify-center rounded-full border-[7px] bg-white ${ring}`}>
        <div className="text-center">
          <div className="text-4xl font-black text-slate-950">{total}</div>
          <div className="text-xs font-bold text-slate-500">/100</div>
          <div className={`mt-1 rounded-full px-2 py-0.5 text-xs font-black ${blocked ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700"}`}>
            {blocked ? "Blocked" : band || "—"}
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        {cats.map((c) => (
          <div key={String(c.category)} className="flex items-center justify-between gap-3 text-sm">
            <span className="font-semibold text-slate-700">{humanize(String(c.category))}</span>
            <span className="shrink-0 font-black text-slate-900" title={String(c.detail || "")}>
              {Math.round(Number(c.score ?? 0))}
              <span className="ml-1 text-xs font-bold text-slate-400">×{c.weight}</span>
            </span>
          </div>
        ))}
        {Array.isArray(score.warnings) && score.warnings.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs font-semibold text-amber-700">
            {score.warnings.slice(0, 3).map((w: string) => <li key={w}>{w}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}

function StrengthPanel({ score }: { score: Row }) {
  const r = (score.readability ?? {}) as Row;
  const u = (score.uniqueness ?? {}) as Row;
  const k = (score.keywords ?? {}) as Row;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Strength label="Readability" value={r.grade ? String(r.grade) : "—"} sub={r.score != null ? `Flesch ${r.score}` : ""} />
        <Strength
          label="Uniqueness"
          value={u.score != null ? `${u.score}%` : "—"}
          // The number is meaningless without its comparison set, so the set
          // is always shown next to it.
          sub={u.comparisonCount ? `vs ${u.comparisonCount} doc${u.comparisonCount === 1 ? "" : "s"}` : "not measured"}
        />
        <Strength label="Duplication Risk" value={u.duplicationRisk ? humanize(String(u.duplicationRisk)) : "—"}
          sub={u.highestMatch ? `worst ${Math.round(Number(u.highestMatch.similarity) * 100)}%` : ""} />
        <Strength label="Keywords" value={k.stuffing ? "Stuffed" : k.primaryNatural ? "Natural" : k.primaryPresent ? "Present" : "Absent"}
          sub={k.peakDensity != null ? `peak ${k.peakDensity}/100w` : ""} />
      </div>
      {Array.isArray(score.recommendations) && score.recommendations.length > 0 && (
        <ul className="mt-4 space-y-1 text-xs font-semibold text-slate-600">
          {score.recommendations.slice(0, 3).map((rec: string) => <li key={rec}>• {rec}</li>)}
        </ul>
      )}
      <p className="mt-3 text-[11px] font-semibold text-slate-400">
        Calculated {score.calculatedAt ? new Date(String(score.calculatedAt)).toLocaleString() : "—"} · {String(score.version || "")}
      </p>
    </>
  );
}

function FeatureList({ snapshot }: { snapshot: Row }) {
  const features: Row[] = Array.isArray(snapshot.features_json?.features)
    ? snapshot.features_json.features
    : Array.isArray(snapshot.features) ? snapshot.features : [];
  const equipment = String(snapshot.facts_json?.equipment?.value || "");
  const excluded: Row[] = Array.isArray(snapshot.excluded_claims_json) ? snapshot.excluded_claims_json : [];

  // Prefer the canonical feature records; fall back to the flat equipment
  // string for snapshots written before the canonical layer existed.
  const items = features.length
    ? features.filter((f) => f.description_eligible !== false).map((f) => String(f.display_name))
    : equipment.split(",").map((s) => s.trim()).filter(Boolean);

  return (
    <>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.slice(0, 12).map((label) => (
          <div key={label} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> {label}
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-sm font-semibold text-slate-500">No description-eligible equipment on this snapshot.</p>
        )}
      </div>
      {excluded.length > 0 && (
        <div className="mt-4 rounded-xl bg-amber-50 px-3 py-2">
          <div className="text-xs font-black uppercase tracking-wide text-amber-800">Excluded from copy</div>
          <ul className="mt-1 space-y-0.5 text-xs font-semibold text-amber-800">
            {excluded.slice(0, 4).map((e, i) => (
              <li key={`${e.field}-${i}`}>{String(e.claim || e.field)} — {humanize(String(e.reason || ""))}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function DeliveryNote({ deliveries, channel }: { deliveries: Row[]; channel: string }) {
  const rows = deliveries.filter((d) => d.destination === channel);
  const delivered = rows.find((d) => d.status === "delivered");
  if (!rows.length) return null;
  return (
    <p className="mt-3 text-xs font-semibold text-slate-500">
      {delivered
        ? `Delivered ${new Date(String(delivered.published_at || delivered.created_at)).toLocaleString()}.`
        : "Recorded for export. No automated delivery has been performed for this destination."}
    </p>
  );
}

function EmptyShell({ title, body, action }: {
  title: string; body: string; action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F9FC] p-6">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-black text-slate-950">{title}</h1>
        <p className="mt-2 text-sm font-semibold text-slate-500">{body}</p>
        {action && (
          <button onClick={action.onClick} className="mt-5 inline-flex h-11 items-center rounded-xl bg-blue-600 px-5 text-sm font-black text-white">
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

function Card({ title, subtitle, badge, action, children }: {
  title: string; subtitle?: string; badge?: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-slate-950">
            {title}
            {badge && <span className="ml-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">{badge}</span>}
          </h2>
          {subtitle && <p className="mt-1 text-sm font-semibold text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Spec({ icon: Icon, label, value }: { icon: typeof Sparkles; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Icon className="h-4 w-4" />{label}</div>
      <div className="mt-1 truncate text-sm font-black text-slate-950">{value || "—"}</div>
    </div>
  );
}

function Meta({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "amber" }) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className={`mt-0.5 truncate text-sm font-black capitalize ${tone === "amber" ? "text-amber-700" : "text-slate-950"}`}>{value}</div>
    </div>
  );
}

function Strength({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 font-black text-slate-900">{value}</div>
      {sub && <div className="text-[11px] font-semibold text-slate-400">{sub}</div>}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-slate-600">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold outline-none focus:border-blue-400"
      />
    </label>
  );
}

function CheckOption({ checked, onClick, label }: { checked: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} role="checkbox" aria-checked={checked} className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
      <span className={`flex h-5 w-5 items-center justify-center rounded border ${checked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"}`}>
        {checked && <CheckCircle2 className="h-3.5 w-3.5" />}
      </span>
      {label}
    </button>
  );
}

function Button({ icon: Icon, label, onClick }: { icon: typeof Copy; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700">
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

const fact = (snapshot: Row | null, key: string): string => {
  const f = snapshot?.facts_json?.[key];
  return f?.value != null ? String(f.value) : "";
};
const num = (v: string, suffix = ""): string =>
  v && Number.isFinite(Number(v)) ? `${Number(v).toLocaleString()}${suffix}` : v;
const humanize = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default DescriptionStudio;
