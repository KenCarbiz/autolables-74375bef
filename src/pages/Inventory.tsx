import InventoryModern from "./InventoryModern";
import InventoryMobileRestored from "./InventoryMobileRestored";

const Inventory = () => (
  <>
    <div className="lg:hidden">
      <InventoryMobileRestored />
    </div>
    <div className="hidden lg:block">
      <InventoryModern />
    </div>
  </>
);

export default Inventory;
