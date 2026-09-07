import ComplianceShell from "@/components/compliance/ComplianceShell";

// Legacy /compliance-center route. Same surface as /compliance, opened on the
// section it used to be its own page for.
const ComplianceActionCenter = () => <ComplianceShell defaultSection="issues" />;

export default ComplianceActionCenter;
