# AutoLabels Passport: Five-Agent Customer Experience Blueprint

## Product North Star

AutoLabels Passport is not a document list. It is the customer's premium, trusted, mobile-first story of the vehicle.

The experience should feel like the shopper unlocked a verified digital vault for the car: condition, warranty, FTC disclosures, K208 disclosure, service and recon proof, original equipment, payment/trade paths, and direct dealership contact.

Tagline direction:

> Every vehicle has a story. Passport proves it.

## Competitive Benchmark

The market already values digital vehicle packets that replace paper evidence manuals, automate vehicle information, make documents shareable, track customer engagement with heatmaps/live alerts, support multilingual experiences, and integrate with CRM/retargeting workflows.

AutoLabels Passport should compete by adding:

1. A more premium customer presentation.
2. Compliance-native FTC/K208 workflows.
3. Real lead capture with dealer-controlled friction.
4. SMS verification when the dealer wants stronger lead quality.
5. AutoCurb trade-value handoff with vehicle-of-interest context.
6. Vehicle-level engagement intelligence tied to VIN, stock, document, QR scan, and customer action.

---

# Agent 1: Customer Emotion & Trust

## Goal

Make the customer feel confidence in the vehicle within the first 10 seconds.

## First Screen

The opening screen should show:

- Vehicle hero image or premium gradient fallback.
- Year / Make / Model / Trim.
- Price, mileage, VIN, stock number.
- Dealer identity.
- Clear trust status.

## Trust Badges

Examples:

- Verified VIN.
- FTC Buyers Guide available.
- CT K208 warranty disclosure available.
- Service / recon records available.
- Original equipment / window sticker available.
- Dealer-certified packet.
- Trade value available through AutoCurb.

## Tone

Use phrases like:

- Verified vehicle packet.
- Review before you visit.
- Everything in one place.
- Transparent by design.
- Sent securely to your email.

Avoid language that feels like paperwork, compliance burden, or a file cabinet.

---

# Agent 2: UX / Interaction Flow

## Customer Flow

1. Customer scans QR code or clicks website passport.
2. Passport opens with hero summary.
3. Customer sees confidence modules instead of a flat PDF list.
4. Customer taps modules:
   - Vehicle Story
   - Warranty & Buyer Protection
   - Documents
   - Service / Recon
   - Payment & Finance
   - Value Your Trade
   - Contact Dealer
5. Customer can email the packet to themselves.
6. Dealer settings decide whether customer name, phone, and SMS verification are required.
7. Customer gets packet by email.
8. Customer sees AutoCurb trade CTA.
9. Dealer sees lead + engagement trail.

## Key UI Sections

### 1. Hero

- Big vehicle title.
- Price/miles/stock/VIN.
- Trust badge row.
- Primary CTA: Email me this packet.
- Secondary CTA: Value my trade.

### 2. Confidence Timeline

A guided list:

- Vehicle verified.
- Buyer guide available.
- Warranty disclosure available.
- Service/recon evidence available.
- Trade value available.

### 3. Smart Document Cards

Documents should be cards with icons and plain-English explanations:

- FTC Buyers Guide: See warranty terms and buyer protection details.
- CT K208: Review Connecticut used-vehicle warranty disclosure.
- Original Window Sticker: See factory equipment and MSRP.
- Service Records: Review maintenance/recon evidence.
- Vehicle History: Review history report if available.

### 4. Email Packet Modal

Fields:

- Customer name, if required.
- Email address, always required.
- Mobile phone, if required or SMS verification is enabled.
- Consent text.

States:

- Input.
- SMS code sent.
- Verifying.
- Packet queued/sent.
- Optional trade CTA.

### 5. AutoCurb Trade Handoff

When a shopper clicks trade value, pass:

- tenant_id
- store_id
- vehicle_id
- VIN
- stock number
- passport_request_id
- session_id
- vehicle_of_interest

---

# Agent 3: Compliance & Legal Confidence

## Goal

Make compliance feel like customer confidence, not legal clutter.

## Compliance Cards

- FTC Buyers Guide: Official buyer guide for this vehicle.
- Connecticut K208: Warranty disclosure and customer acknowledgement.
- Warranty System: AS IS, dealer warranty, manufacturer warranty, service contract, or CT statutory tier.
- Signed Packet: If signed, show signed/archived status.

## Customer Messaging

Use:

- This packet helps you review important vehicle information before making a decision.
- Documents may include warranty disclosures, service records, and dealer-provided information.

Avoid:

- Anything that claims legal compliance is guaranteed.
- Overpromising document completeness.

## Audit Events

Every important customer action should be tracked:

- passport_opened
- window_sticker_scanned
- packet_opened
- document_opened
- document_downloaded
- email_request_started
- sms_verification_sent
- sms_verification_completed
- documents_delivered
- trade_clicked
- lead_submitted

---

# Agent 4: Analytics & Dealer Intelligence

## Goal

Turn every customer interaction into useful sales intelligence.

## Metrics

Vehicle-level:

- Sticker scans.
- Passport opens.
- Unique sessions.
- Packet email requests.
- Document opens.
- FTC/K208 opens.
- Trade CTA clicks.
- Finance CTA clicks.
- Call/text clicks.
- Leads created.
- Engagement score.

Document-level:

- Opens.
- Downloads.
- Prints.
- Time viewed.
- Open-to-lead contribution.

Funnel-level:

- QR scan to passport open.
- Passport open to packet request.
- Packet request to SMS verified.
- Verified to packet delivered.
- Packet delivered to trade click.
- Trade click to lead.

## Dashboards

- Passport Engagement Dashboard.
- Vehicle Engagement Detail.
- Document Heatmap.
- Hot Inventory Ranking.
- Lead Quality by Source.
- Store comparison.

## Sales Alerts

Examples:

- Customer viewed packet 3 times.
- Customer opened warranty docs.
- Customer clicked trade value.
- Customer requested packet and verified phone.
- Customer opened email packet after delivery.

---

# Agent 5: Growth / AutoCurb / Differentiation

## Goal

Make Passport the front door to AutoLabels + AutoCurb ecosystem value.

## Growth Differentiators

1. Dealer-controlled lead capture friction.
2. SMS verification for higher-quality leads.
3. AutoCurb trade value CTA inside passport and packet email.
4. Vehicle-of-interest handoff into AutoCurb.
5. Compliance-native FTC/K208 experience.
6. Engagement-driven follow-up intelligence.
7. Multi-language future support.
8. A/B testable passport modules.

## AutoCurb Merge Flow

1. Shopper opens Passport for a specific vehicle.
2. Shopper requests packet or clicks Value My Trade.
3. AutoLabels passes vehicle-of-interest context to AutoCurb.
4. AutoCurb captures customer's trade vehicle.
5. Dealer sees both:
   - customer vehicle of interest
   - customer trade vehicle
6. Sales team receives a richer lead.

## Suggested Product Name

AutoLabels Passport

Optional package names:

- TrustPassport
- SmartPacket
- Confidence Packet
- Vehicle Passport Pro

---

# Build Sequence

## Phase 1: Customer Experience Shell

Create:

- Passport hero component.
- Trust badge row.
- Confidence module grid.
- Document cards.
- CTA section.

## Phase 2: Lead Capture

Create:

- PassportLeadCaptureModal.
- SMS verification UI.
- Packet delivery success state.
- AutoCurb trade CTA.

## Phase 3: Engagement Wiring

Track:

- opens
- card taps
- document opens
- CTA clicks
- modal starts
- SMS verifies
- email deliveries

## Phase 4: Dealer Admin Controls

Create settings panel for:

- enable packet email
- require customer name
- require phone
- require SMS verification
- create lead
- notify sales team
- enable AutoCurb trade CTA
- AutoCurb trade URL

## Phase 5: Dealer Analytics

Create:

- Passport Engagement Dashboard.
- Hot Vehicle list.
- Document heatmap.
- Funnel conversion cards.
- Sales alert inbox.

---

# Initial UI Requirements

Mobile-first.
Premium visual hierarchy.
Fast loading.
No login for customer-facing passport.
Every CTA trackable.
Every document card explainable.
Every customer action tied to VIN/stock/session.
Dealer-configurable capture rules.
AutoCurb-ready handoff data.

---

# Success Criteria

A customer scanning a sticker should feel:

1. This car is transparent.
2. This dealer is trustworthy.
3. I can understand the vehicle quickly.
4. I can send the packet to myself.
5. I can value my trade without starting over.
6. I can contact the dealer with confidence.

A dealer should learn:

1. Which vehicles are attracting attention.
2. Which documents customers care about.
3. Which customers are highly engaged.
4. Which QR scans become leads.
5. Which trade opportunities connect to which vehicle of interest.
