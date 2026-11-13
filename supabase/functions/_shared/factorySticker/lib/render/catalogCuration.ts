// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/catalogCuration.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { EquipmentCategory } from "../types.ts";
import type { EquipmentLine, EquipmentSelectionBase } from "../equipmentSelection.ts";
interface CurationPick {
    section: EquipmentCategory;
    match: RegExp;
    tier: 1 | 2;
}
const s = (section: EquipmentCategory, tier: 1 | 2, match: RegExp): CurationPick => ({ section, tier, match });
const HYUNDAI_TUCSON: CurationPick[] = [
    s("SAFETY_SECURITY", 1, /^\d+ airbags$/i),
    s("SAFETY_SECURITY", 1, /^pedestrian & cyclist avoidance system$/i),
    s("SAFETY_SECURITY", 2, /^front cross traffic collision avoidance\b/i),
    s("SAFETY_SECURITY", 1, /^lane keeping assist$/i),
    s("SAFETY_SECURITY", 1, /^active lane control$/i),
    s("SAFETY_SECURITY", 2, /^highway assist$/i),
    s("SAFETY_SECURITY", 1, /^driver pattern monitor$/i),
    s("SAFETY_SECURITY", 1, /^blind spot system$/i),
    s("SAFETY_SECURITY", 1, /^rear cross traffic collision avoidance\b/i),
    s("SAFETY_SECURITY", 1, /^rear parking camera$/i),
    s("SAFETY_SECURITY", 2, /^rear parking distance system$/i),
    s("SAFETY_SECURITY", 2, /^car exit warning$/i),
    s("SAFETY_SECURITY", 2, /^intelligent speed assist$/i),
    s("POWERTRAIN", 1, /^engine displacement\b/i),
    s("POWERTRAIN", 1, /^engine start\/stop$/i),
    s("POWERTRAIN", 1, /^\d+ speed transmission$/i),
    s("POWERTRAIN", 2, /^automatic with manual mode trans$/i),
    s("POWERTRAIN", 1, /^(awd|all wheel drive)$/i),
    s("POWERTRAIN", 2, /^selectable driver modes$/i),
    s("POWERTRAIN", 2, /^hill holder assist$/i),
    s("POWERTRAIN", 2, /^descent control system$/i),
    s("EXTERIOR", 1, /alloy wheels$/i),
    s("EXTERIOR", 2, /^all season tires$/i),
    s("EXTERIOR", 1, /^spacesaver spare wheel$/i),
    s("EXTERIOR", 1, /^led headlights\b/i),
    s("EXTERIOR", 2, /^auto high beam$/i),
    s("EXTERIOR", 1, /^day ?time running led lights$/i),
    s("EXTERIOR", 2, /^roof rails?\b/i),
    s("EXTERIOR", 1, /^running boards$/i),
    s("EXTERIOR", 2, /^roof spoiler$/i),
    s("EXTERIOR", 2, /^heated door mirrors$/i),
    s("EXTERIOR", 2, /^hands free tailgate\/trunk release$/i),
    s("EXTERIOR", 2, /^trailer hitch$/i),
    s("COMFORT_CONVENIENCE", 1, /^smart card \/ smart key$/i),
    s("COMFORT_CONVENIENCE", 1, /^vehicle start button$/i),
    s("COMFORT_CONVENIENCE", 2, /^remote engine starter$/i),
    s("COMFORT_CONVENIENCE", 1, /^adaptive cruise control$/i),
    s("COMFORT_CONVENIENCE", 2, /^stop\/go function cruise control$/i),
    s("COMFORT_CONVENIENCE", 2, /^dual zone air conditioning$/i),
    s("COMFORT_CONVENIENCE", 2, /^heated driver seat$/i),
    s("COMFORT_CONVENIENCE", 2, /^heated passenger seat$/i),
    s("COMFORT_CONVENIENCE", 2, /^driver-electrically adjustable$/i),
    s("COMFORT_CONVENIENCE", 2, /^(cloth|leatherette|synthetic leather|leather) seats$/i),
    s("COMFORT_CONVENIENCE", 2, /^leather steering wheel$/i),
    s("COMFORT_CONVENIENCE", 1, /^front\/rear usb charging port$/i),
    s("COMFORT_CONVENIENCE", 2, /^electronic hand brake$/i),
    s("TECHNOLOGY", 1, /^display screen-dashboard center 1\b/i),
    s("TECHNOLOGY", 2, /^instrument cluster tft screen$/i),
    s("TECHNOLOGY", 1, /^satellite radio$/i),
    s("TECHNOLOGY", 1, /^apple wireless connection$/i),
    s("TECHNOLOGY", 1, /^android wireless connection$/i),
    s("TECHNOLOGY", 2, /^bluetooth connection$/i),
    s("TECHNOLOGY", 2, /^\d+ speakers$/i),
    s("TECHNOLOGY", 2, /^voice recognition$/i),
    s("TECHNOLOGY", 1, /^telematics system$/i),
    s("TECHNOLOGY", 2, /^over air updates\b/i),
];
const PROFILES: Record<string, CurationPick[]> = {
    hyundai_2026_tucson_se_awd: HYUNDAI_TUCSON,
};
export const curationProfileFor = (templateId: string | undefined): string | undefined => templateId && PROFILES[templateId] ? templateId : undefined;
export function curateEquipment(base: EquipmentSelectionBase, profileId: string | undefined): EquipmentSelectionBase {
    const profile = profileId ? PROFILES[profileId] : undefined;
    if (!profile)
        return base;
    const used = new Set<EquipmentLine>();
    const picked = new Map<EquipmentLine, number>();
    profile.forEach((pick, i) => {
        const line = base.lines.find((l) => !used.has(l) && pick.match.test(l.text.trim()));
        if (!line)
            return;
        used.add(line);
        picked.set(line, i);
    });
    const sections = [...new Set(profile.map((p) => p.section))];
    const tierRank = new Map<number, number>();
    const seenPerSection = new Map<EquipmentCategory, number>();
    [...picked.values()].sort((a, b) => a - b).forEach((i) => {
        const pick = profile[i];
        if (pick.tier !== 2)
            return;
        const n = seenPerSection.get(pick.section) ?? 0;
        seenPerSection.set(pick.section, n + 1);
        tierRank.set(i, n * sections.length + sections.indexOf(pick.section));
    });
    const top = Math.max(0, ...base.lines.map((l) => l.score)) + 1;
    const span = profile.length * sections.length;
    const lines = base.lines.map((l): EquipmentLine => {
        const i = picked.get(l);
        if (i === undefined)
            return { ...l, order: profile.length + l.order };
        const pick = profile[i];
        const score = pick.tier === 1 ? top + 2 * span - i : top + span - tierRank.get(i)!;
        return { ...l, category: pick.section, order: i, score };
    });
    return { ...base, lines: lines.sort((a, b) => a.order - b.order) };
}
