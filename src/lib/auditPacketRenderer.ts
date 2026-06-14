import type { AuditPacket } from "./auditPacket";

// ──────────────────────────────────────────────────────────────
// Audit-Defense Packet HTML renderer (Wave 14.1)
//
// Produces a single self-contained HTML document that embeds the
// full AuditPacket: manifest, SHA-256 chain root, every section
// rendered as a printable card, and a print stylesheet. The
// dealer opens it in any browser, prints to PDF if needed, and
// hands it to counsel / AG / FTC.
//
// Self-contained means: no external CSS, no external JS, no
// images fetched at view-time. The file is the artifact.
// ──────────────────────────────────────────────────────────────

const escapeHtml = (s: unknown): string => {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const fmtDate = (s: string | null | undefined): string => {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZoneName: "short",
  });
};

const fmtJson = (v: unknown, indent = 2): string =>
  escapeHtml(JSON.stringify(v, null, indent));

const sectionLabel: Record<string, string> = {
  "01-vehicle-file":  "Vehicle file",
  "02-listings":      "Vehicle listings",
  "03-addendums":     "Addendums",
  "04-signings":      "Customer & employee signings (E-SIGN)",
  "05-prep-sign-offs": "Prep & install sign-offs",
  "06-deal-jackets":  "Deal jackets",
  "07-recall-snapshot": "NHTSA recall snapshot (live)",
  "08-audit-log":     "Audit log events",
  "09-archive":       "Archived signed documents",
  // Wave 22 — install proof (photos + installer signatures) and
  // the advertised-price history per VIN.
  "10-get-ready":     "Get-ready records · install photos & signatures",
  "11-advertised-prices": "Advertised price history · drift evidence",
};

const renderSection = (section: { name: string; count: number; sha256: string; data: unknown }) => {
  const label = sectionLabel[section.name] || section.name;
  const isEmpty = section.count === 0;
  return `
    <section class="card section" id="${escapeHtml(section.name)}">
      <header class="section-head">
        <div>
          <h3>${escapeHtml(label)}</h3>
          <p class="muted">${section.count} record${section.count === 1 ? "" : "s"} · sha256 <code>${escapeHtml(section.sha256)}</code></p>
        </div>
        <a href="#manifest" class="back-link">↑ manifest</a>
      </header>
      ${isEmpty
        ? `<p class="empty">No records on file for this VIN in this section at packet time.</p>`
        : `<pre class="data">${fmtJson(section.data)}</pre>`}
    </section>
  `;
};

const renderManifestTable = (packet: AuditPacket): string => {
  const rows = packet.manifest.sections.map(s => `
    <tr>
      <td><a href="#${escapeHtml(s.name)}">${escapeHtml(sectionLabel[s.name] || s.name)}</a></td>
      <td class="num">${s.count}</td>
      <td><code class="hash">${escapeHtml(s.sha256)}</code></td>
    </tr>
  `).join("");
  return `
    <table class="manifest-table">
      <thead>
        <tr><th>Section</th><th class="num">Count</th><th>SHA-256</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
};

const renderSummaryCards = (packet: AuditPacket): string => {
  const s = packet.summary;
  // Wave 22 — install-proof + advertised-price cards added.
  // Cards may be undefined-safe (older AuditPacket consumers can
  // still render packets shipped before Wave 22 because the
  // missing fields default to falsy "0" via the chained ?? 0).
  const cards: { label: string; value: string | number; note?: string }[] = [
    { label: "Listing on file", value: s.has_listing ? "Yes" : "No" },
    { label: "Vehicle file", value: s.has_vehicle_file ? "Yes" : "No" },
    { label: "Signed addendums", value: s.signed_addendum_count, note: `${s.addendum_count} total` },
    { label: "Customer signings", value: s.customer_signing_count, note: "E-SIGN provenance attached" },
    { label: "Signed prep sign-offs", value: s.signed_prep_count, note: `${s.prep_signoff_count} total` },
    { label: "Signed deal jackets", value: s.signed_deal_count, note: `${s.deal_token_count} total` },
    { label: "Install photos", value: s.install_photo_count ?? 0, note: `${s.install_signature_count ?? 0} installer signatures` },
    { label: "Advertised snapshots", value: s.advertised_price_snapshot_count ?? 0, note: s.latest_advertised_price != null ? `Latest $${s.latest_advertised_price.toLocaleString()} · ${s.latest_advertised_source || "manual"}` : "no snapshots" },
    { label: "Audit events", value: s.audit_event_count },
    { label: "Open recalls", value: s.open_recall_count, note: s.do_not_drive ? "DO NOT DRIVE" : "" },
  ];
  return cards.map(c => `
    <div class="kpi">
      <p class="kpi-label">${escapeHtml(c.label)}</p>
      <p class="kpi-value">${escapeHtml(c.value)}</p>
      ${c.note ? `<p class="kpi-note ${c.note === "DO NOT DRIVE" ? "alert" : ""}">${escapeHtml(c.note)}</p>` : ""}
    </div>
  `).join("");
};

// Add-On Election Record — per-item proof that the customer reviewed
// each add-on (price, optional flag, benefit) and affirmatively
// elected or declined it. Reads the derived "12-addon-elections"
// section produced by buildAuditPacket.
function renderElectionRecord(packet: AuditPacket): string {
  const section = packet.sections.find((s) => s.name === "12-addon-elections");
  const deals = (section?.data as Array<{
    customer_name: string | null;
    signed_at: string | null;
    content_hash: string | null;
    elected_count: number;
    item_count: number;
    items: Array<{ name: string; price: number | null; disclosed_optional: boolean; benefit_justification: string; elected: boolean; acknowledgment: string }>;
  }>) || [];

  const intro = `<h2>Add-On Election Record</h2>
    <p class="muted">Per-item proof that the customer reviewed each add-on &mdash; the price shown, whether it was disclosed as optional, and its stated benefit &mdash; then affirmatively elected or declined it. Documents informed election under FTC Act &sect;5; tamper-evident, not a guarantee of outcome.</p>`;

  if (deals.length === 0) {
    return `<section class="card" id="addon-elections">${intro}<p class="empty">No signed addendums with add-ons on record for this VIN.</p></section>`;
  }

  const dealsHtml = deals.map((d) => {
    const rows = d.items.map((i) => `
      <tr>
        <td>${escapeHtml(i.name)}</td>
        <td class="num">${i.price != null ? "$" + i.price.toLocaleString() : "&mdash;"}</td>
        <td>${i.disclosed_optional ? "Optional" : "Installed"}</td>
        <td>${i.benefit_justification ? escapeHtml(i.benefit_justification) : '<span class="muted">&mdash;</span>'}</td>
        <td>${i.elected ? '<strong style="color:#15803D;">Elected</strong>' : '<span class="muted">Declined</span>'}</td>
        <td>${escapeHtml(i.acknowledgment)}</td>
      </tr>`).join("");
    return `
      <div style="margin-top:16px;">
        <h3>${escapeHtml(d.customer_name || "Customer")} &middot; ${escapeHtml(d.signed_at ? fmtDate(d.signed_at) : "unsigned")} &middot; ${d.elected_count}/${d.item_count} elected</h3>
        <p class="muted">Content hash <code>${escapeHtml((d.content_hash || "—").slice(0, 24))}…</code></p>
        <table class="manifest-table">
          <thead><tr><th>Add-on</th><th class="num">Price</th><th>Type</th><th>Benefit shown</th><th>Election</th><th>Ack</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join("");

  return `<section class="card" id="addon-elections">${intro}${dealsHtml}</section>`;
}

export function renderPacketHtml(packet: AuditPacket): string {
  const m = packet.manifest;
  const title = `Audit-Defense Packet · ${m.vin}`;
  const tenantLabel = m.tenant.name || m.tenant.id || "—";

  // Self-contained: zero external resources. Print stylesheet
  // hides nav, expands sections, lets the dealer save-as-PDF in
  // the browser and produce a uniform artifact.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  *,*::before,*::after { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #0B2041; background: #F7F8FB; margin: 0; padding: 32px; line-height: 1.45; }
  .wrap { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 4px; }
  h2 { font-size: 18px; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 8px; }
  h3 { font-size: 14px; font-weight: 700; margin: 0; }
  p { margin: 4px 0; }
  code, pre { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  code { background: #EEF0F4; padding: 1px 4px; border-radius: 3px; font-size: 11px; }
  pre.data { background: #0B2041; color: #E6F0FF; padding: 14px; border-radius: 10px; font-size: 11px; overflow: auto; max-height: 480px; white-space: pre-wrap; word-break: break-word; }
  pre.data code { background: transparent; padding: 0; color: inherit; }
  .muted { color: #5A6A82; font-size: 12px; }
  .alert { color: #B91C1C; font-weight: 700; }
  .card { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 14px; padding: 18px; margin-bottom: 16px; box-shadow: 0 1px 0 rgba(11,32,65,0.04); }
  .cover { background: linear-gradient(135deg,#0B2041 0%,#1E3A5F 60%,#1E90FF 100%); color: #FFFFFF; }
  .cover .muted { color: rgba(255,255,255,0.78); }
  .cover h1 { color: #FFFFFF; }
  .badge { display: inline-flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; background: rgba(255,255,255,0.16); padding: 3px 9px; border-radius: 999px; }
  .chain-root { margin-top: 14px; padding: 10px 12px; background: rgba(255,255,255,0.10); border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 11px; word-break: break-all; color: #E6F0FF; }
  .chain-root .lbl { display: block; font-family: inherit; color: rgba(255,255,255,0.65); font-size: 9px; text-transform: uppercase; letter-spacing: 0.18em; font-weight: 700; margin-bottom: 4px; }
  .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-top: 14px; }
  .meta-grid .meta { background: rgba(255,255,255,0.10); border: 1px solid rgba(255,255,255,0.16); border-radius: 8px; padding: 8px 10px; }
  .meta .meta-lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 0.16em; color: rgba(255,255,255,0.65); font-weight: 700; }
  .meta .meta-val { font-size: 13px; font-weight: 600; color: #FFFFFF; word-break: break-all; }
  .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px,1fr)); gap: 10px; margin-top: 4px; }
  .kpi { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; padding: 10px 12px; }
  .kpi-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.14em; color: #5A6A82; font-weight: 700; margin: 0; }
  .kpi-value { font-size: 22px; font-weight: 800; margin: 4px 0 0; color: #0B2041; }
  .kpi-note { font-size: 10px; color: #5A6A82; margin: 2px 0 0; }
  .kpi-note.alert { color: #B91C1C; font-weight: 700; }
  .manifest-table { width: 100%; border-collapse: collapse; }
  .manifest-table th, .manifest-table td { padding: 8px 10px; border-bottom: 1px solid #E2E8F0; font-size: 12px; text-align: left; }
  .manifest-table th { background: #F1F4F9; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: #5A6A82; }
  .manifest-table .num { text-align: right; font-variant-numeric: tabular-nums; }
  .manifest-table .hash { font-size: 10px; word-break: break-all; }
  .section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .back-link { font-size: 10px; color: #5A6A82; text-decoration: none; }
  .back-link:hover { color: #1E90FF; }
  .empty { color: #5A6A82; font-style: italic; font-size: 12px; margin: 0; padding: 12px 0; }
  .attestation { background: #FFF7ED; border: 1px solid #FED7AA; color: #7C2D12; border-radius: 10px; padding: 14px; margin-bottom: 16px; font-size: 12px; }
  .attestation strong { color: #7C2D12; }
  footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid #E2E8F0; color: #5A6A82; font-size: 11px; }
  @media print {
    body { background: #FFFFFF; padding: 0; }
    .wrap { max-width: none; padding: 0; }
    .back-link { display: none; }
    .card { page-break-inside: avoid; box-shadow: none; }
    pre.data { max-height: none; background: #F4F6FA; color: #0B2041; }
    .cover { background: #0B2041 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <div class="wrap">

    <section class="card cover" id="cover">
      <span class="badge">Audit-Defense Packet · ${escapeHtml(m.version)}</span>
      <h1 style="margin-top:10px;">VIN <code style="background:rgba(255,255,255,0.14);color:#FFFFFF;font-size:22px;padding:2px 8px;">${escapeHtml(m.vin)}</code></h1>
      <p class="muted">Self-contained snapshot of every artifact AutoLabels.io has on record for this VIN, retrieved on behalf of ${escapeHtml(tenantLabel)}.</p>

      <div class="chain-root">
        <span class="lbl">SHA-256 chain root</span>
        ${escapeHtml(m.chain_root)}
      </div>

      <div class="meta-grid">
        <div class="meta"><p class="meta-lbl">Generated</p><p class="meta-val">${escapeHtml(fmtDate(m.generated_at))}</p></div>
        <div class="meta"><p class="meta-lbl">Tenant</p><p class="meta-val">${escapeHtml(tenantLabel)}</p></div>
        <div class="meta"><p class="meta-lbl">Generated by</p><p class="meta-val">${escapeHtml(m.generated_by || "unknown")}</p></div>
        <div class="meta"><p class="meta-lbl">User agent</p><p class="meta-val">${escapeHtml(m.user_agent)}</p></div>
      </div>
    </section>

    <section class="attestation">
      <strong>Attestation.</strong> Any modification to any included artifact changes its
      section SHA-256, which changes the chain root above. The chain root may be
      quoted verbatim to counsel, state Attorney General, or federal regulator.
      This document is intended for production in matters arising under the FTC
      Used Car Rule (16 CFR Part 455), the federal E-SIGN Act (15 U.S.C. §7001),
      and state consumer-protection statutes including California SB 766 (eff.
      October 1, 2026). Signing artifacts include the verbatim E-SIGN consent
      shown at signing, the SHA-256 hash of the canonical payload the signer
      saw, and the IP / user agent recorded at the moment of signature.
    </section>

    <section class="card" id="summary">
      <h2>Snapshot</h2>
      <div class="kpi-row">
        ${renderSummaryCards(packet)}
      </div>
    </section>

    ${renderElectionRecord(packet)}

    <section class="card" id="manifest">
      <h2>Manifest</h2>
      <p class="muted">Every section below, with row count and SHA-256 of its canonical JSON. Section ordering is fixed; the chain root above is the SHA-256 of this manifest's sorted (name, sha256) pairs.</p>
      ${renderManifestTable(packet)}
    </section>

    ${packet.sections.map(renderSection).join("")}

    <footer>
      Produced by AutoLabels.io · packet ${escapeHtml(m.version)} · ${escapeHtml(fmtDate(m.generated_at))}<br>
      This file is self-contained. No external resources are fetched when it is opened.
    </footer>
  </div>
</body>
</html>`;
}

export function downloadPacketHtml(packet: AuditPacket): void {
  const html = renderPacketHtml(packet);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `audit-defense-packet-${packet.manifest.vin}-${stamp}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
