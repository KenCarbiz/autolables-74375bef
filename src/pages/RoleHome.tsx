import { lazy, Suspense, type ComponentType } from "react";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useAuth } from "@/contexts/AuthContext";

const GmHome = lazy(() => import("./GmHome"));
const SalesManagerHome = lazy(() => import("./SalesManagerHome"));
const UsedCarManagerHome = lazy(() => import("./UsedCarManagerHome"));
const ServiceManagerHome = lazy(() => import("./ServiceManagerHome"));
const ProcessDashboard = lazy(() => import("./ProcessDashboard"));

// Which landing page a role opens onto. A dealership's roles look at
// genuinely different work: a service manager reading a sales funnel, or a
// sales manager reading shop throughput, is noise on both screens.
//
// Roles absent from this map keep ProcessDashboard. That is deliberate --
// office, finance, compliance, biller and readonly have no dedicated board
// yet, and sending them somewhere that does not fit their work would be worse
// than the general one they already know.
const HOME_BY_ROLE: Record<string, ComponentType> = {
  owner: GmHome,
  general_manager: GmHome,
  gsm: GmHome,
  admin: GmHome,
  sales_manager: SalesManagerHome,
  salesperson: SalesManagerHome,
  used_car_manager: UsedCarManagerHome,
  inventory_manager: UsedCarManagerHome,
  service_manager: ServiceManagerHome,
  service_advisor: ServiceManagerHome,
};

const RoleHome = () => {
  const { member, loading } = useEntitlements();
  const { isAdmin } = useAuth();

  // Render nothing rather than guessing while the membership loads: picking a
  // default first would flash one role's board before swapping to another.
  if (loading) return null;

  const role = String(member?.role || "").trim().toLowerCase();
  const Home = HOME_BY_ROLE[role] || (isAdmin ? GmHome : ProcessDashboard);

  return (
    <Suspense fallback={null}>
      <Home />
    </Suspense>
  );
};

export default RoleHome;
