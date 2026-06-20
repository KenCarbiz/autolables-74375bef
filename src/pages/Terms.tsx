import LegalPage, { Section, List } from "@/components/legal/LegalPage";

const Terms = () => (
  <LegalPage
    title="Terms of Service"
    path="/terms"
    intro={
      <p>
        These Terms of Service ("Terms") govern your use of the AutoLabels.io platform and services
        ("Services"), including window-sticker and dealer addendum generation, electronic signature,
        Buyers Guides, and compliance tooling. By accessing or using the Services — as a dealership user
        or as a consumer who receives or signs documents — you agree to these Terms.
      </p>
    }
  >
    <Section n={1} title="Acceptance of Terms">
      <p>
        By accessing or using the Services, you agree to be bound by these Terms and our{" "}
        <a href="/privacy" className="font-medium text-blue-600 hover:underline">Privacy Policy</a>. If you
        are using the Services on behalf of a dealership, you represent that you are authorized to bind
        that dealership to these Terms. If you do not agree, do not use the Services.
      </p>
    </Section>

    <Section n={2} title="The Services">
      <p>
        AutoLabels provides software for generating vehicle window stickers and dealer addendums, capturing
        electronic signatures, producing FTC Buyers Guides, and supporting disclosure and pricing
        compliance workflows. <strong>The dealership is solely responsible for the prices, products,
        add-ons, and disclosures it enters and presents to its customers.</strong> AutoLabels provides
        tools that document a dealership's compliance posture; it does not provide legal advice and does
        not guarantee any particular legal or regulatory outcome.
      </p>
    </Section>

    <Section n={3} title="User Submissions / Accuracy">
      <p>
        Dealership users represent and warrant that all pricing, product, fee, and vehicle information they
        enter into the Services is accurate and complete, and that they have the right to use and present
        it. You are responsible for the content you submit and for ensuring your documents and disclosures
        comply with applicable federal, state, and local law. AutoLabels is not responsible for inaccurate
        information entered by a dealership.
      </p>
    </Section>

    <Section id="sms-terms" n={4} title="Text Messaging Program Terms (SMS/MMS)">
      <p>
        AutoLabels sends transactional text messages on behalf of dealerships. By providing your mobile
        number, you agree to the following program terms:
      </p>
      <List
        items={[
          <><strong>Program &amp; purpose.</strong> Document and addendum messages — links to review and electronically sign your dealer addendum and related documents, signing confirmations, and document-related follow-ups, sent by or on behalf of the dealership you transacted with.</>,
          <><strong>Message frequency.</strong> Message frequency varies; up to approximately 10 messages per month.</>,
          <><strong>Rates.</strong> Message and data rates may apply.</>,
          <><strong>Opt out / help.</strong> <strong>Reply STOP</strong> to cancel at any time (you will receive a one-time confirmation), and <strong>reply HELP</strong> for help.</>,
          <><strong>Not a condition of purchase.</strong> Your consent to receive text messages is not a condition of purchasing any vehicle, product, or service.</>,
          <><strong>Carriers.</strong> Supported carriers include AT&amp;T, Verizon, T-Mobile, and most major U.S. carriers. Carriers are not liable for delayed or undelivered messages.</>,
          <><strong>Privacy.</strong> See our <a href="/privacy#sms-consent" className="font-medium text-blue-600 hover:underline">Privacy Policy</a> for how messaging consent is handled. Mobile opt-in data and consent are never shared with or sold to third parties or affiliates for their marketing or promotional purposes.</>,
        ]}
      />
    </Section>

    <Section n={5} title="Electronic Records & Signatures Consent (E-SIGN / UETA)">
      <p>
        By signing a document electronically through the Services, you agree that electronic records and
        electronic signatures are legally equivalent to paper documents and handwritten signatures under
        the federal E-SIGN Act and applicable state UETA laws, and that you intend to be bound by them.
      </p>
      <List
        items={[
          <><strong>Right to a paper copy.</strong> You may request a paper copy of any document you signed by contacting the dealership or emailing <a href="mailto:support@autolabels.io" className="font-medium text-blue-600 hover:underline">support@autolabels.io</a>.</>,
          <><strong>Withdrawing consent.</strong> You may withdraw consent to transact electronically before signing; doing so may mean the dealership completes the document on paper instead. Withdrawal does not affect the validity of documents already signed.</>,
          <><strong>Hardware/software.</strong> To access and retain electronic records you need a device with a modern web browser, internet access, and the ability to view and save PDF documents.</>,
        ]}
      />
    </Section>

    <Section n={6} title="Disclaimer of Warranties; Limitation of Liability">
      <p>
        THE SERVICES ARE PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR
        IMPLIED, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
        NON-INFRINGEMENT. AutoLabels does not warrant that the Services will be uninterrupted, error-free,
        or that they will guarantee compliance with any law.
      </p>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, AutoLabels WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
        SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS OR REVENUES, ARISING OUT OF OR
        RELATED TO YOUR USE OF THE SERVICES. AutoLabels' TOTAL LIABILITY FOR ANY CLAIM RELATING TO THE
        SERVICES WILL NOT EXCEED THE AMOUNTS PAID BY THE DEALERSHIP FOR THE SERVICES IN THE TWELVE (12)
        MONTHS PRECEDING THE CLAIM.
      </p>
    </Section>

    <Section n={7} title="Acceptable Use & Intellectual Property">
      <p>
        You agree not to misuse the Services, including by attempting to access them without authorization,
        interfering with their operation, scraping, reverse-engineering, or using them to submit unlawful,
        false, or infringing content. The Services, software, and AutoLabels marks are owned by AutoLabels
        and its licensors and are protected by intellectual-property laws. You retain ownership of the
        content you submit and grant AutoLabels a limited license to host, process, and display it solely
        to provide the Services.
      </p>
    </Section>

    <Section n={8} title="Governing Law">
      <p>
        These Terms are governed by the laws of the State of Connecticut, without regard to its conflict-of-laws
        rules, except where a consumer's mandatory home-state protections apply. Any dispute will be brought
        in the state or federal courts located in Connecticut, unless applicable law provides otherwise.
      </p>
    </Section>

    <Section n={9} title="Contact">
      <p>
        Questions about these Terms? Email{" "}
        <a href="mailto:legal@autolabels.io" className="font-medium text-blue-600 hover:underline">legal@autolabels.io</a>.
        For help with a document or signing request, email{" "}
        <a href="mailto:support@autolabels.io" className="font-medium text-blue-600 hover:underline">support@autolabels.io</a>{" "}
        or contact the dealership you transacted with.
      </p>
    </Section>
  </LegalPage>
);

export default Terms;
