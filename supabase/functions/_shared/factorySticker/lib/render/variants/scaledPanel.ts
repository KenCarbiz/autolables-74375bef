// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/scaledPanel.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { Painter, type LayoutPrimitive } from "../layout.ts";
export const SCALED_MIN_PT = 5.5;
const scalePath = (d: string, s: number): string => d.replace(/-?\d*\.?\d+/g, (n) => String(Math.round(Number(n) * s * 100) / 100));
export function paintScaled(p: Painter, s: number, ox: number, oy: number, draw: (local: Painter) => void): void {
    const local = new Painter([]);
    draw(local);
    const qrs = (local.primitives as LayoutPrimitive[]).filter((q) => q.kind === "qr");
    const qr = qrs.length === 1 && qrs[0].kind === "qr" ? qrs[0] : null;
    const grow = qr ? qr.size * (1 - s) : 0;
    const beside = (x: number, y: number, align: string): boolean => qr !== null && align === "right" && y >= qr.y - 2 && y <= qr.y + qr.size && x <= qr.x;
    const X = (v: number): number => ox + v * s;
    const Y = (v: number): number => oy + v * s;
    const isQrBacking = (r: {
        x: number;
        y: number;
        w: number;
        h: number;
    }): boolean => qr !== null && Math.abs(r.x - qr.x) < 0.01 && Math.abs(r.y - qr.y) < 0.01 && Math.abs(r.w - qr.size) < 0.01 && Math.abs(r.h - qr.size) < 0.01;
    for (const prim of local.primitives as LayoutPrimitive[]) {
        switch (prim.kind) {
            case "text":
                p.text(prim.str, X(prim.x) - (beside(prim.x, prim.y, prim.align) ? grow : 0), Y(prim.y), Math.max(SCALED_MIN_PT, prim.size * s), prim.font, prim.color, {
                    align: prim.align,
                    ...(prim.maxWidth !== undefined ? { maxWidth: prim.maxWidth * s } : {}),
                    ...(prim.charSpacing ? { charSpacing: prim.charSpacing * s } : {}),
                });
                break;
            case "rect":
                if (qr && isQrBacking(prim)) {
                    p.rect(X(qr.x + qr.size) - qr.size, Y(qr.y + qr.size) - qr.size, qr.size, qr.size, prim.fill, prim.stroke, prim.strokeWidth);
                    break;
                }
                p.rect(X(prim.x), Y(prim.y), prim.w * s, prim.h * s, prim.fill, prim.stroke, prim.strokeWidth !== undefined ? prim.strokeWidth * s : undefined);
                break;
            case "rule":
                p.rule(X(prim.x), Y(prim.y), prim.w * s, prim.h * s, prim.color);
                break;
            case "path":
                p.path(scalePath(prim.d, s), X(prim.x), Y(prim.y), prim.w * s, prim.h * s, prim.fill, prim.stroke, prim.strokeWidth !== undefined ? prim.strokeWidth * s : undefined);
                break;
            case "barcode":
                p.barcode(X(prim.x), Y(prim.y), prim.w * s, prim.h * s, prim.payload, prim.color);
                break;
            case "image":
                p.image(prim.png, prim.assetId, X(prim.x), Y(prim.y), prim.w * s, prim.h * s);
                break;
            case "qr":
                p.qr(X(prim.x + prim.size) - prim.size, Y(prim.y + prim.size) - prim.size, prim.size, prim.payload, prim.color);
                break;
        }
    }
}
