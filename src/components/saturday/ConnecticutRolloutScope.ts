// Connecticut-first rollout scope.
// We are intentionally NOT stacking every state compliance document into MVP.
// Initial rollout focuses on Connecticut dealers and only the documents/products needed for launch.

export type ConnecticutLaunchWorkflowItemStatus = "ready" | "foundation_built" | "needs_renderer" | "needs_ui" | "needs_verification";

export type ConnecticutLaunchWorkflowItem = {
  id: string;
  title: string;
  description: string;
  status: ConnecticutLaunchWorkflowItemStatus;
  requiredForLaunch: boolean;
  notes: string[];
};

export const CONNECTICUT_FIRST_ROLLOUT_SCOPE: ConnecticutLaunchWorkflowItem[] = [
  {
    id: "new-car-addendum",
    title: "New Car Addendum",
    description: "Dealer addendum for new vehicles showing MSRP, dealer-installed accessories, optional protection packages, incentives/passport link, and dealer disclosures.",
    status: "foundation_built",
    requiredForLaunch: true,
    notes: [
      "NewVehicleCatalog now contains new-vehicle addendum definitions.",
      "Next step is a real renderer and admin selection path for Connecticut dealers.",
    ],
  },
  {
    id: "used-window-sticker",
    title: "Used Car Window Sticker",
    description: "Large used vehicle window sticker for vehicle details, image, specs, pricing strategy, passport/QR setting, trust source, and dealer value story.",
    status: "foundation_built",
    requiredForLaunch: true,
    notes: [
      "Used window sticker catalog and rendering pack exist.",
      "Needs final smoke-test wiring through rule engine and template picker.",
    ],
  },
  {
    id: "used-ftc-buyers-guide",
    title: "Used Car FTC Buyers Guide / Warranty Sticker",
    description: "Mandatory FTC used car warranty/Buyers Guide workflow for used vehicles, with As-Is/warranty state-aware behavior for Connecticut rollout.",
    status: "needs_renderer",
    requiredForLaunch: true,
    notes: [
      "Federal FTC Buyers Guide renderer is required before launch.",
      "Connecticut warranty logic should feed the correct Buyers Guide election.",
      "Do not expand all-state compliance yet; build Connecticut and federal first.",
    ],
  },
  {
    id: "used-addendum-sticker",
    title: "Used Car Addendum Sticker",
    description: "Used vehicle addendum for installed equipment, dealer value, certification/warranty upgrade language, and optional passport/QR.",
    status: "foundation_built",
    requiredForLaunch: true,
    notes: [
      "Used addendum catalog and rendering pack exist.",
      "Needs final render-policy cleanup and connection to dealer settings/rules.",
    ],
  },
  {
    id: "ct-k208",
    title: "Connecticut K-208 Inspection Form",
    description: "CT licensed dealer vehicle inspection form with vehicle/dealer autofill, service checklist/signoff, buyer name/signature, and audit trail.",
    status: "needs_ui",
    requiredForLaunch: true,
    notes: [
      "Official uploaded K-208 form has been mapped in ConnecticutK208FormSchema.",
      "Service-side checklist/signoff workflow has been modeled.",
      "Needs UI, official PDF renderer/autofill, customer signature integration, and audit storage.",
    ],
  },
  {
    id: "state-specific-expansion",
    title: "Future State-Specific Compliance Expansion",
    description: "Non-Connecticut state disclosure and warranty documents are backlog only and should be added only when launch geography requires them.",
    status: "needs_verification",
    requiredForLaunch: false,
    notes: [
      "Do not load the MVP with every state packet.",
      "Keep framework flexible, but Connecticut-first execution comes first.",
    ],
  },
];

export const CONNECTICUT_FIRST_REQUIRED_IDS = CONNECTICUT_FIRST_ROLLOUT_SCOPE
  .filter((item) => item.requiredForLaunch)
  .map((item) => item.id);

export const CONNECTICUT_FIRST_NEXT_BUILD_ORDER = [
  "FTC Buyers Guide renderer and warranty-election engine",
  "K-208 service checklist/signoff UI",
  "K-208 PDF autofill renderer using official CT form",
  "Smoke-test route that runs new addendum + used sticker + FTC + used addendum + K-208",
  "Dealer settings persistence for template/rule choices",
  "Final render-policy cleanup for used addendum and used window sticker",
];
