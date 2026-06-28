// ──────────────────────────────────────────────────────────────────────
// Packet curation — the iPacket-style control over which customer-facing
// modules appear on the public scan page. The dealer toggles modules per
// vehicle; the public page renders a module unless it's explicitly off.
// Compliance modules (recall banner, drive-out price, verified installs)
// are intentionally NOT curatable.
// ──────────────────────────────────────────────────────────────────────

export interface PacketModule {
  id: string;
  label: string;
  desc: string;
}

export const PACKET_MODULES: PacketModule[] = [
  { id: "insights", label: "Why this is a great buy", desc: "Below-market, one-owner, clean title, MPG badges" },
  { id: "recon", label: "Reconditioning & inspection", desc: "Inspection result, reconditioning work performed, and prep photos" },
  { id: "oemSticker", label: "OEM window sticker", desc: "Original factory Monroney label" },
  { id: "programs", label: "Dealer programs", desc: "Your value propositions — warranties, free maintenance, etc." },
  { id: "marketValue", label: "Market value report", desc: "This price vs. the local market range" },
  { id: "factoryOptions", label: "Factory options & equipment", desc: "Decoded options list" },
  { id: "photos", label: "Photo gallery", desc: "Additional vehicle photos" },
  { id: "description", label: "Description", desc: "Long-form vehicle write-up" },
  { id: "payment", label: "Payment estimator", desc: "Monthly payment slider" },
  { id: "videos", label: "Videos", desc: "Walkaround videos" },
  { id: "warranty", label: "Warranty, service & accessories", desc: "Remaining warranty, service history, available accessories" },
  { id: "documents", label: "Documents", desc: "Window sticker + dealer-added PDFs" },
];

// A module shows unless the dealer explicitly switched it off.
export const packetVisible = (
  listing: { packet_modules?: Record<string, boolean> | null } | null | undefined,
  id: string
): boolean => {
  const m = listing?.packet_modules;
  return !m || m[id] !== false;
};
