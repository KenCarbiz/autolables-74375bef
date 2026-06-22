# Five-Agent Product Audit: Dealer Template Library + Customer Passport Experience

## Purpose

This audit reviews two critical AutoLabels experiences:

1. Dealer-facing Sticker & Addendum Template Library inside Platform Admin / Sticker Studio.
2. Customer-facing AutoLabels Passport experience after a shopper scans a QR code or clicks a vehicle passport link.

The goal is to identify what is good, what is bad, and what must change to make both experiences feel premium, intuitive, and commercially powerful.

---

# Part 1: Dealer View — Sticker & Addendum Template Library

## Agent 1: Dealer Workflow Agent

### What is good

- Dealers now have a dedicated Platform Admin section for sticker templates.
- Templates can be activated, featured, and versioned.
- Saturday templates now render through their correct renderer instead of the generic renderer.
- Template cards are clickable and open a larger preview modal.
- The larger preview modal gives dealers a much better way to inspect layout, QR placement, typography, disclosures, and branding.

### What is bad

- The library still behaves like a flat technical grid instead of a true dealer-facing design library.
- The full 100-template catalog is not fully restored into the active UI.
- Used addendum templates, new vehicle Monroney templates, OEM-match templates, CPO templates, luxury templates, and Passport-first templates are not separated clearly.
- Dealers cannot easily answer: “Which template should I use for this vehicle?”
- No side-by-side comparison exists.
- No “assign this template to store/dealer/OEM/inventory segment” workflow exists yet.

### What to change

- Rebuild the page as a true Template Library.
- Add top-level sections:
  - All Templates
  - Saturday Premium
  - Used Addendums
  - New Vehicle Window Stickers
  - New Vehicle Addendums
  - OEM Match
  - CPO / Certification
  - Luxury
  - One Price / Pricing
  - Passport First
  - Archived
- Add count badges for each section.
- Add template assignment workflow:
  - Assign to dealer
  - Assign to store
  - Assign to OEM
  - Assign to inventory type
  - Assign as default

---

## Agent 2: Library UX Agent

### What is good

- The current card grid is familiar and simple.
- Active/Inactive and Featured states are visible.
- Tags already exist and can become filter chips.
- Larger preview modal is a major improvement.

### What is bad

- The grid does not teach the dealer what each template is for.
- Tags are small and passive.
- There is no visual hierarchy between flagship templates and utility templates.
- Templates are not organized by dealer decision-making categories.
- Dealers may feel overwhelmed once the full 100+ catalog is restored.

### What to change

- Add a library header with stats:
  - Total templates
  - Active
  - Featured
  - OEM match
  - Used addendums
  - New vehicle stickers
- Add a left filter rail:
  - Vehicle type: New / Used
  - Format: Window Sticker / Addendum
  - OEM
  - Style: Luxury, Classic, Modern, Compliance, Passport
  - Pricing: One Price, Market Transparency, Live Price, Addendum Only
  - Certification: OEM CPO, Dealer Certified, Warranty Included
  - Placement: Inside window, Outside window, Either
- Add search by template name, OEM, style, tag, and use case.
- Add clear empty states: “No templates match these filters.”
- Add “Recommended” ribbons for common dealership use cases.

---

## Agent 3: OEM Experience Agent

### What is good

- The historical work includes OEM theme presets and OEM-style catalog direction.
- OEM-match templates can become a strong differentiator because franchise dealers care deeply about brand fit.
- The system already supports theme/accent customization.

### What is bad

- OEM-match templates are not currently visible as a dedicated collection.
- OEM logos, colors, and layout language are not organized by brand in the active UI.
- A dealer cannot currently click “Hyundai” or “Infiniti” and see matching sticker/addendum options.
- OEM templates could be confused with generic templates.

### What to change

- Add an OEM Match section with brand collections:
  - Infiniti
  - Hyundai
  - Kia
  - Nissan
  - Toyota
  - Honda
  - Ford
  - Chevrolet / GM
  - BMW
  - Mercedes-Benz
  - Volkswagen
  - Subaru
- Each OEM collection should show:
  - Window sticker templates
  - Addendum templates
  - CPO templates
  - Used templates
  - New vehicle templates
- Add a disclaimer internally: OEM-match means brand-aligned styling, not official OEM documents unless supplied by OEM data.
- Add “Use dealer branding” vs “Use OEM-inspired theme” toggle.

---

## Agent 4: Preview & Quality Agent

### What is good

- Large preview modal is now the right direction.
- Saturday templates no longer rely on generic preview rendering.
- Full-size preview makes spacing, QR placement, price band, disclosures, and typography inspectable.

### What is bad

- No PDF sample output from the preview yet.
- No print-safe quality check.
- No side-by-side compare.
- No zoom controls.
- No page size guide or safe margin overlay.
- No visual warning for overflow or missing required fields.

### What to change

- Add preview modal controls:
  - Zoom in/out
  - Fit to screen
  - Actual size
  - Download sample PDF
  - Print sample
  - Compare template
- Add quality warnings:
  - Missing VIN
  - Missing stock
  - Too many installed items
  - QR missing
  - Text overflow risk
  - Unsafe print margin
- Add side-by-side comparison mode:
  - Saturday Hero vs OEM Match
  - One Price vs Market Transparency
  - Luxury vs Minimal Compliance

---

## Agent 5: Platform Growth Agent

### What is good

- A large template marketplace/library can become a competitive moat.
- Versioning allows templates to evolve without breaking prior generated documents.
- Template categories can become plan-level entitlements later.
- OEM-match and Passport-first templates create premium upgrade opportunities.

### What is bad

- The current admin page does not yet feel like a monetizable template marketplace.
- There is no template performance data.
- There is no “most used,” “highest QR scan,” or “highest lead conversion” view.
- There is no dealer feedback loop.

### What to change

- Add template analytics:
  - Times selected
  - Times printed
  - QR scans generated from template
  - Passport opens from template
  - Lead conversions from template
- Add badges:
  - Most Popular
  - Best for QR Scans
  - Best for Luxury
  - Best for CPO
  - Best for One Price
- Add template notes and changelog history.
- Add future dealer marketplace concept:
  - Platform templates
  - Dealer custom templates
  - Group templates
  - Archived templates

---

# Dealer Template Library: Priority Change List

## Must fix immediately

1. Restore the full historical template catalog files:
   - src/components/saturday/UsedAddendumCatalog.ts
   - src/components/saturday/UsedAddendumPack.tsx
   - src/components/saturday/NewVehicleCatalog.ts
2. Wire recovered templates into active Platform Admin and Sticker Studio.
3. Seed the database with the full catalog, not just the 3 Saturday templates.
4. Categorize templates into dealer-friendly sections.
5. Keep clickable large preview modal.

## Next build

1. Add category tabs.
2. Add filter rail.
3. Add search.
4. Add OEM Match section.
5. Add compare mode.
6. Add sample PDF output.

## Later premium features

1. Template analytics.
2. Assign template to dealer/store/OEM/inventory type.
3. Template performance dashboard.
4. Marketplace-style featured templates.
5. Template A/B testing against QR scan and lead conversion.

---

# Part 2: Customer View — AutoLabels Passport Experience

## Agent 1: Customer Emotion Agent

### What is good

- The Passport concept is strong: “Every vehicle has a story. Passport proves it.”
- The experience starts with trust instead of paperwork.
- Hero section, trust badges, and “Email me this packet” are the right emotional anchors.
- Value My Trade CTA gives the shopper a clear next step.

### What is bad

- The current shell is still more component foundation than finished emotional experience.
- It does not yet feel enough like a polished consumer product.
- It needs stronger first-screen drama: vehicle photo, dealer trust, price/mileage, and clear confidence score.
- The Passport story needs to feel guided, not like modules placed on a page.

### What to change

- Add a premium opening moment:
  - Large vehicle image
  - Dealer name
  - Vehicle title
  - Price and mileage
  - “Verified Vehicle Passport” badge
  - Confidence score
- Add a short trust statement:
  - “Review this vehicle before you visit.”
  - “Documents, warranty information, and dealer proof in one place.”
- Add a sticky bottom CTA on mobile:
  - Email Packet
  - Value Trade
  - Call Dealer

---

## Agent 2: Customer UX Flow Agent

### What is good

- Core flow exists:
  - Open Passport
  - Review cards
  - Open documents
  - Request packet by email
  - Optional SMS verification
  - Trade value CTA
- The form can respect dealer settings.
- Engagement tracking is wired conceptually.

### What is bad

- The shopper journey is not yet clearly sequenced.
- “Documents” may still feel too much like a file list.
- SMS verification state needs a complete customer-friendly flow.
- Success screen needs to tell the customer what happens next.
- There is no progress or guided journey feel.

### What to change

- Reframe Passport as a guided journey:
  1. Vehicle Summary
  2. Confidence Proof
  3. Warranty & Buyer Guide
  4. Service / Recon
  5. Documents
  6. Trade Value
  7. Contact Dealer
- Add “You are reviewing” header for mobile.
- Add completion markers:
  - Viewed Buyer Guide
  - Viewed K208
  - Packet emailed
  - Trade value started
- Add better success states:
  - “Your packet is on the way.”
  - “Check your email.”
  - “Want to value your trade for this vehicle?”

---

## Agent 3: Trust / Compliance Agent

### What is good

- FTC Buyers Guide and CT K208 are core differentiators.
- Compliance-native document flow is stronger than generic digital packet tools.
- Customer-facing language can transform compliance into trust.

### What is bad

- Need to avoid saying anything that implies legal guarantee.
- Need clearer distinction between official document, dealer-provided document, and informational summary.
- Need to show document status clearly.

### What to change

- Add document status chips:
  - Available
  - Signed
  - Dealer Provided
  - Official Disclosure
  - Pending
- Add plain-English explanations:
  - FTC Buyers Guide: “Warranty and buyer information for this vehicle.”
  - K208: “Connecticut used-vehicle warranty disclosure.”
  - Service / Recon: “Dealer-provided work and inspection evidence.”
- Add disclaimer:
  - “Information is provided by the dealer and may be updated. See dealer for complete details.”

---

## Agent 4: Lead / AutoCurb Agent

### What is good

- Email packet request is a strong lead capture moment.
- Dealer-controlled requirements are smart.
- SMS verification improves lead quality.
- AutoCurb trade handoff is a major differentiator.

### What is bad

- Packet request currently needs a stronger public-safe backend flow.
- The shopper should not feel like they are filling out a generic lead form.
- AutoCurb CTA should feel naturally connected to the vehicle of interest.
- Sales notification and CRM handoff need clear status feedback.

### What to change

- Rename modal experience to “Send me my Passport” instead of generic lead capture.
- Add a softer first step:
  - Name
  - Email
  - Mobile if required
- Add optional trust copy:
  - “We’ll send this vehicle packet so you can review it anytime.”
- After success, show:
  - Packet sent/queued
  - Value your trade for this vehicle
  - Call/text dealer
- Ensure AutoCurb receives vehicle-of-interest context:
  - VIN
  - stock
  - year/make/model
  - price
  - dealer
  - passport request/session

---

## Agent 5: Analytics / Sales Intelligence Agent

### What is good

- Customer engagement tracking schema is in place.
- Events can track passport opens, document opens, packet requests, CTA clicks, and lead submissions.
- This can become a dealer intelligence advantage.

### What is bad

- Dealer-facing analytics view for Passport engagement is not yet finished.
- No customer heat score exists yet.
- Sales team cannot yet see “who is hot and why.”
- No template-to-passport performance loop exists yet.

### What to change

- Build Passport Engagement Dashboard:
  - Passport opens by vehicle
  - Unique visitors
  - Packet requests
  - SMS verified leads
  - Document opens
  - Trade clicks
  - Call/text clicks
  - Engagement score
- Add hot lead alerts:
  - “Customer opened packet 3 times.”
  - “Customer viewed warranty docs.”
  - “Customer clicked trade value.”
- Connect sticker template analytics to Passport results:
  - Which sticker template drove scans?
  - Which template led to packet requests?
  - Which template generated trade leads?

---

# Customer Passport: Priority Change List

## Must fix immediately

1. Make the first screen feel premium and emotional.
2. Add guided journey sections.
3. Strengthen Email Passport modal flow.
4. Complete SMS verification UX.
5. Make AutoCurb handoff feel native.
6. Add mobile sticky CTA.

## Next build

1. Vehicle Story Timeline:
   - Acquired
   - Inspected
   - Reconditioned
   - Certified / Ready
2. Confidence Score.
3. Service Investment Card.
4. Better document status chips.
5. Packet email success screen.
6. Passport Engagement Dashboard.

## Later premium features

1. Multi-language Passport.
2. Personalized customer packet email.
3. Side-by-side vehicle comparison.
4. Customer saved vehicle/passport wallet.
5. AI summary of the vehicle story.
6. Template-to-lead performance analytics.

---

# Combined Product Direction

The dealer Template Library and customer Passport should be connected.

## Dealer chooses template

Dealer selects a sticker/addendum style from the library.

## Customer scans QR

Customer lands in a premium Passport experience.

## System tracks engagement

AutoLabels knows which template drove the scan, which documents were viewed, and which CTAs converted.

## Dealer improves performance

Dealer can choose templates based on real results, not guesswork.

---

# Final Recommendation

## Build order

1. Restore full template catalog.
2. Rebuild Platform Admin as a categorized Template Library.
3. Add filters/search/OEM collections.
4. Improve customer Passport hero and guided flow.
5. Finish SMS verification and packet success UX.
6. Build Passport Engagement Dashboard.
7. Connect template analytics to Passport analytics.

## Product positioning

AutoLabels should not be positioned as a sticker tool.

It should be positioned as:

> A vehicle transparency and engagement platform that starts at the window sticker and continues into the customer Passport.

This ties together:

- Sticker design
- Addendum compliance
- QR scanning
- Digital Passport
- Document delivery
- Trade value
- Lead capture
- Sales intelligence
