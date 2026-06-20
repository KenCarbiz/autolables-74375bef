import LegalPage, { Section, Sub, List } from "@/components/legal/LegalPage";

const Privacy = () => (
  <LegalPage
    title="Privacy Policy"
    path="/privacy"
    intro={
      <p>
        This Privacy Policy explains how AutoLabels.io ("AutoLabels," "we," "us," or "our") collects,
        uses, shares, and protects information in connection with our window-sticker, dealer addendum,
        electronic signing, Buyers Guide, and compliance platform (the "Services"). It applies to
        dealership customers who use the Services and to consumers who receive documents, text messages,
        or electronic signing requests through a dealership that uses AutoLabels.
      </p>
    }
  >
    <Section n={1} title="Who We Are / Data Controller">
      <p>
        AutoLabels provides software that dealerships use to generate, deliver, and electronically sign
        vehicle documents. When you purchase or transact with a dealership, that <strong>dealership (the
        "Dealer") is the party you are transacting with and is the controller of your personal
        information</strong>. AutoLabels acts as the Dealer's <strong>service provider / processor</strong>,
        handling information on the Dealer's behalf and under their instructions. Where this policy
        references "[Dealer]," it means the specific dealership you interacted with.
      </p>
    </Section>

    <Section n={2} title="Information We Collect">
      <List
        items={[
          <><strong>Vehicle data</strong> — VIN, year/make/model/trim, mileage, options, pricing, and related listing or sticker data.</>,
          <><strong>Customer contact information</strong> — name, phone number, email, and (where provided) mailing address.</>,
          <><strong>E-signature and signing metadata</strong> — your electronic signature, consent records, IP address, timestamp, device/user-agent, and a tamper-evident content hash of the document you signed.</>,
          <><strong>Documents generated</strong> — addendums, Buyers Guides, disclosures, and related records created or signed through the Services.</>,
          <><strong>Dealer account data</strong> — for dealership users: name, business email, role, and dealership profile/settings.</>,
          <><strong>Usage and device data</strong> — log data, IP address, and standard analytics needed to operate and secure the Services.</>,
        ]}
      />
    </Section>

    <Section n={3} title="How We Use Your Information">
      <List
        items={[
          "Generate, deliver, and electronically sign vehicle documents at the Dealer's direction.",
          "Send document links, signing confirmations, and document-related follow-ups (including by text message — see Section 4).",
          "Verify advertised pricing and disclosures, and maintain a tamper-evident audit record of the transaction.",
          "Provide, secure, support, and improve the Services.",
          "Comply with legal, regulatory, and record-retention obligations.",
        ]}
      />
      <p>We do not use consumer personal information for our own advertising, and we never sell it.</p>
    </Section>

    <Section id="sms-consent" n={4} title="Text Message (SMS/MMS) Consent & Communication">
      <p>
        By providing your phone number in connection with a vehicle purchase or document from [Dealer],
        you consent to receive autodialed and/or pre-recorded SMS/MMS text messages from [Dealer] —
        including links to review and electronically sign your dealer addendum and related documents,
        signing confirmations, and document-related follow-ups. <strong>Consent is not a condition of
        purchase.</strong> Message frequency varies (up to approximately 10 messages per month). Message
        and data rates may apply. <strong>Reply STOP to opt out</strong> (you will receive a one-time
        confirmation); <strong>reply HELP for help.</strong> Your consent is documented at the time you
        provide your number and retained in our records. We do not sell, rent, or share your mobile
        number or opt-in consent with third parties or affiliates for their marketing or promotional
        purposes. Supported carriers include AT&amp;T, Verizon, T-Mobile, and most major U.S. carriers;
        carriers are not liable for delayed or undelivered messages.
      </p>
      <p className="text-[13px] text-slate-500">
        <strong>Mobile opt-in data and consent are never shared with or sold to third parties or
        affiliates for their marketing or promotional purposes.</strong>
      </p>
    </Section>

    <Section n={5} title="Electronic Records & E-Signature">
      <p>
        Documents signed through the Services are captured as electronic records under the federal E-SIGN
        Act and applicable state Uniform Electronic Transactions Act (UETA) laws. When you sign, we record
        your consent to do business electronically along with your signature, the document's content hash,
        your IP address, a timestamp, and device information. These records establish that the signed
        document was presented to and accepted by you, and are retained as described in Section 8. You may
        request a paper copy of any document you signed (see our Terms of Service for how to request a copy
        or withdraw consent to electronic records).
      </p>
    </Section>

    <Section n={6} title="How We Share Your Information">
      <p>We share information only as needed to provide the Services:</p>
      <List
        items={[
          <><strong>With the Dealer</strong> you transacted with, who controls your information.</>,
          <><strong>With sub-processors</strong> that operate the Services on our behalf, under contract and confidentiality — including our SMS/messaging provider, electronic-signature provider, and cloud hosting/infrastructure provider.</>,
          <><strong>For legal reasons</strong> — to comply with law, enforce our agreements, or protect rights, safety, and security.</>,
          <><strong>In a business transfer</strong> — in connection with a merger, acquisition, or sale of assets, subject to this policy.</>,
        ]}
      />
      <p>
        We do <strong>not</strong> sell your personal information. <strong>Mobile opt-in data and consent
        are never shared with or sold to third parties or affiliates for their marketing or promotional
        purposes.</strong>
      </p>
    </Section>

    <Section n={7} title="Data Security">
      <p>
        We use administrative, technical, and physical safeguards designed to protect information,
        including encryption in transit, access controls, and tamper-evident audit logging of signed
        documents. No method of transmission or storage is completely secure, and we cannot guarantee
        absolute security.
      </p>
    </Section>

    <Section n={8} title="Data Retention">
      <p>
        We retain signed documents, disclosures, and the associated consent and audit records for as long
        as needed to provide the Services and to meet the Dealer's applicable federal and state
        record-retention requirements — <strong>typically at least seven (7) years</strong> for motor
        vehicle sale and disclosure records, or longer where law requires. Other personal information is
        retained only as long as necessary for the purposes described in this policy or as required by law.
      </p>
    </Section>

    <Section n={9} title="Your Rights">
      <p>
        Depending on where you live, you may have rights to access, correct, delete, or obtain a copy of
        your personal information, and to opt out of certain processing. Because the Dealer is the
        controller of your transaction data, please direct rights requests to the Dealer; AutoLabels will
        assist the Dealer in fulfilling valid requests. You can also contact us using Section 12 below.
      </p>
      <Sub title="California (CCPA/CPRA)">
        <p>
          California residents have the right to know what personal information is collected, used, shared,
          or sold; to access and delete personal information; to correct inaccurate information; to limit
          use of sensitive personal information; and to be free from discrimination for exercising these
          rights. <strong>We do not sell or share personal information for cross-context behavioral
          advertising.</strong> You may submit a request as described in Section 12.
        </p>
      </Sub>
      <Sub title="Connecticut (CTDPA)">
        <p>
          Connecticut residents have the right to confirm whether we process their personal data; to
          access, correct, and delete it; to obtain a portable copy; and to opt out of targeted
          advertising, sale of personal data, and certain profiling. We do not sell personal data or use
          it for targeted advertising. You may appeal a declined request and submit requests as described
          in Section 12.
        </p>
      </Sub>
    </Section>

    <Section n={10} title="Children's Privacy">
      <p>
        The Services are intended for dealerships and adult consumers transacting for a vehicle. We do not
        knowingly collect personal information from children under 13 (or under the age required by
        applicable law). If you believe a child has provided us information, please contact us and we will
        delete it.
      </p>
    </Section>

    <Section n={11} title="Changes to This Policy">
      <p>
        We may update this Privacy Policy from time to time. When we do, we will revise the "Last updated"
        date above and, where appropriate, provide additional notice. Your continued use of the Services
        after an update means you accept the revised policy.
      </p>
    </Section>

    <Section n={12} title="Contact Us">
      <p>
        Questions or privacy requests? Email <a href="mailto:privacy@autolabels.io" className="font-medium text-blue-600 hover:underline">privacy@autolabels.io</a>.
        For requests about a specific transaction, please also contact the dealership you transacted with,
        who controls your information.
      </p>
    </Section>
  </LegalPage>
);

export default Privacy;
