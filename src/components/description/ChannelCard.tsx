import { AlertTriangle, Check, Globe, ImageOff } from "lucide-react";
import { assetFor, isRenderable, logoBox, LOGO_VIEWPORT, type ChannelAsset } from "@/lib/description/channelAssets";
import type { ChannelCardMeta } from "@/lib/description/model";

// Provider cards for "Choose Your Writing Preset".
//
// Selection is a semantic radio group, not a div with an onClick: the seven
// providers are one mutually-exclusive choice, so arrow keys and Space/Enter
// have to work and a screen reader has to announce which one is current.

export type ChannelCardState =
  /** Generated, saved, nothing outstanding. */
  | "ready"
  /** Enabled, but nothing generated for this vehicle yet. */
  | "not_generated"
  /** Tenant has this channel switched off. */
  | "disabled"
  /** Selectable, but something about the configuration needs saying. */
  | "warning";

export interface ChannelCardStatus {
  state: ChannelCardState;
  /** Short line under the card. Never a publication claim. */
  note?: string;
  /** Why the card cannot be chosen. Required when state is "disabled". */
  disabledReason?: string;
}

/**
 * The shared logo viewport.
 *
 * Every provider gets the same box and the same `object-contain`, so no logo
 * is ever stretched or cropped. When the licensed asset has not been supplied
 * the card says so in plain words — it must never fall back to the provider's
 * name set in a similar typeface, because a wordmark we typed ourselves is a
 * trademark approximation, not a logo.
 */
export function ChannelLogo({ channel, name }: { channel: string; name: string }) {
  const asset: ChannelAsset | undefined = assetFor(channel);

  if (asset && isRenderable(asset)) {
    const box = logoBox(asset);
    return (
      <div
        className="flex items-center justify-center"
        style={{ width: LOGO_VIEWPORT.width, height: LOGO_VIEWPORT.height }}
      >
        <img
          src={asset.src!}
          alt={asset.alt}
          width={box.width}
          height={box.height}
          loading="lazy"
          className="max-h-full max-w-full object-contain"
          style={{ width: box.width, height: box.height }}
        />
      </div>
    );
  }

  // AutoLabels' own product icon for the dealer's own site — not a third-party
  // mark, so there is nothing to license and nothing to approximate.
  if (channel === "dealer_website") {
    return (
      <div
        className="flex items-center justify-center"
        style={{ width: LOGO_VIEWPORT.width, height: LOGO_VIEWPORT.height }}
        aria-hidden="true"
      >
        <Globe className="h-8 w-8 text-slate-700" />
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 bg-slate-50"
      style={{ width: LOGO_VIEWPORT.width, height: LOGO_VIEWPORT.height }}
      title={asset?.note || `No licensed ${name} brand asset has been supplied.`}
      data-testid={`logo-missing-${channel}`}
    >
      <ImageOff className="h-4 w-4 text-slate-400" aria-hidden="true" />
      <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Logo pending</span>
    </div>
  );
}

export function ChannelCard({
  meta, status, selected, onSelect,
}: {
  meta: ChannelCardMeta;
  status: ChannelCardStatus;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const disabled = status.state === "disabled";

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      // The description carries the state for a screen reader, so selection is
      // never communicated by the blue border alone.
      aria-describedby={`channel-note-${meta.key}`}
      disabled={disabled}
      onClick={() => { if (!disabled) onSelect(meta.key); }}
      data-testid={`channel-card-${meta.key}`}
      data-selected={selected ? "true" : "false"}
      className={[
        "relative flex min-h-[150px] min-w-[132px] flex-col items-center justify-center rounded-2xl border p-4 text-center shadow-sm transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2",
        "motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-md",
        disabled
          ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60"
          : selected
            ? "border-blue-500 bg-blue-50 ring-2 ring-blue-500"
            : "cursor-pointer border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
      ].join(" ")}
    >
      <ChannelLogo channel={meta.key} name={meta.name} />
      <div className="mt-3 text-base font-black text-slate-950">{meta.name}</div>
      <div className="mt-1 text-xs font-semibold text-slate-500">{meta.helper}</div>

      <span id={`channel-note-${meta.key}`} className="sr-only">
        {disabled ? `Unavailable: ${status.disabledReason || "not enabled for this dealership"}.` : status.note || ""}
      </span>

      {status.note && !disabled && (
        <span
          className={[
            "mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black",
            status.state === "warning" ? "bg-amber-50 text-amber-800"
              : status.state === "not_generated" ? "bg-slate-100 text-slate-600"
              : "bg-slate-100 text-slate-600",
          ].join(" ")}
        >
          {status.state === "warning" && <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
          {status.note}
        </span>
      )}
      {disabled && status.disabledReason && (
        <span className="mt-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
          {status.disabledReason}
        </span>
      )}

      {selected && !disabled && (
        <Check className="absolute right-3 top-3 h-4 w-4 text-blue-600" aria-hidden="true" />
      )}
    </button>
  );
}

export function ChannelCardGrid({
  cards, statusFor, selected, onSelect,
}: {
  cards: ChannelCardMeta[];
  statusFor: (key: string) => ChannelCardStatus;
  selected: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Writing preset — publishing channel"
      // Two per row on the narrowest screens so vAuto is never stranded behind
      // a horizontal scroll, three from small tablet up to match the desktop
      // composition.
      className="grid grid-cols-2 gap-3 sm:grid-cols-3"
    >
      {cards.map((c) => (
        <ChannelCard
          key={c.key}
          meta={c}
          status={statusFor(c.key)}
          selected={selected === c.key}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
