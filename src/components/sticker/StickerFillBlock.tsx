import { QRCodeSVG } from "qrcode.react";

// The vehicle data AutoLabels prints into the empty area of pre-printed
// stock. Vehicle ID + QR always render; equipment and pricing are gated by
// the per-template dealer toggles. Sized with container-query units so it
// scales to whatever fill box the dealer drew.
export interface StickerFillData {
  ymm: string;
  vin?: string;
  stock?: string;
  mileage?: string;
  price?: string;
  equipment?: string[];
  qrUrl?: string;
}

export function StickerFillBlock({
  data,
  showEquipment = true,
  showPricing = true,
}: {
  data: StickerFillData;
  showEquipment?: boolean;
  showPricing?: boolean;
}) {
  const sub = [data.vin && `VIN ${data.vin}`, data.stock && `Stock #${data.stock}`, data.mileage && `${data.mileage} mi`]
    .filter(Boolean)
    .join(" · ");
  const equip = (data.equipment || []).filter(Boolean).slice(0, 8);

  return (
    <div className="w-full h-full flex flex-col p-[2.5%] text-gray-900 leading-tight">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-extrabold truncate" style={{ fontSize: "clamp(10px, 3.4cqw, 24px)" }}>
            {data.ymm || "—"}
          </div>
          {sub && (
            <div className="text-gray-500 truncate" style={{ fontSize: "clamp(6px, 1.7cqw, 11px)" }}>
              {sub}
            </div>
          )}
        </div>
        {showPricing && data.price && (
          <div className="text-right shrink-0">
            <div className="font-extrabold" style={{ fontSize: "clamp(11px, 3.8cqw, 28px)" }}>
              {data.price}
            </div>
          </div>
        )}
      </div>

      {showEquipment && equip.length > 0 && (
        <div
          className="mt-[3%] grid grid-cols-2 gap-x-[4%] gap-y-[0.5%] text-gray-700"
          style={{ fontSize: "clamp(6px, 1.7cqw, 11px)" }}
        >
          {equip.map((e) => (
            <div key={e} className="truncate">• {e}</div>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-end justify-between gap-2 pt-[2%]">
        <div className="text-gray-600" style={{ fontSize: "clamp(5px, 1.5cqw, 10px)" }}>
          Scan for full details, history &amp; sign-off
        </div>
        {data.qrUrl && (
          <div style={{ width: "clamp(36px, 16cqw, 110px)" }}>
            <QRCodeSVG value={data.qrUrl} className="w-full h-auto" />
          </div>
        )}
      </div>
    </div>
  );
}
